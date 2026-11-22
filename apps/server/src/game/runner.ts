import { createHash, randomBytes, randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, desc, eq, isNull, notInArray } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { buildRunOrder, collectNewsUrls, Quiz, type GameState, type NewsInfo, type RunItem } from "@kwistig/shared";
import type { Db } from "../db/client.js";
import { answer, gameSession, player, team } from "../db/schema.js";
import { loadQuiz, toDocument } from "../services/quizzes.js";
import { GameError, initialState, reduce, type MachineIntent } from "./machine.js";
import { computeScores } from "./scoring.js";
import type { MediaStore } from "../services/media.js";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";

/** Notified after every committed transition. */
export interface RunnerListener {
  changed(): void;
  /** Phones whose player no longer exists (removed, or a new session started). */
  playersRemoved(playerIds: number[], reason: "removed" | "session_ended"): void;
}

/**
 * Owns the single active game session. Every transition is computed by the pure
 * reducer, written to SQLite in one transaction, and only then broadcast.
 */
export class GameRunner {
  state: GameState | null = null;
  run: RunItem[] = [];
  private timer: NodeJS.Timeout | null = null;
  private listener: RunnerListener | null = null;

  constructor(
    private readonly db: Db,
    private readonly dataDir: string,
    private readonly log: FastifyBaseLogger,
    /** Read-only here: looks up cached news headlines when a session starts. */
    private readonly media: MediaStore,
    private readonly now: () => number = Date.now,
  ) {}

  setListener(l: RunnerListener) {
    this.listener = l;
  }

  sessionDir(sessionId: number) {
    return path.join(this.dataDir, "sessions", String(sessionId));
  }

  /** Resume the active session after a restart. */
  resume(): void {
    const row = this.db
      .select()
      .from(gameSession)
      .where(isNull(gameSession.endedAt))
      .orderBy(desc(gameSession.id))
      .limit(1)
      .get();
    if (!row) return;
    const quiz = Quiz.safeParse(row.quizSnapshot);
    if (!quiz.success) {
      this.log.error({ sessionId: row.id }, "stored quiz snapshot is invalid; not resuming");
      return;
    }
    this.state = row.stateJson as GameState;
    this.run = buildRunOrder(quiz.data);
    this.log.info({ sessionId: row.id, phase: this.state.phase, cursor: this.state.cursor }, "resumed game session");
    this.syncTimer();
  }

  /** Starts a new session for a quiz, ending the current one with its scores saved. */
  startQuiz(quizId: number): void {
    const loaded = loadQuiz(this.db, quizId);
    if (!loaded) throw new GameError("quiz_not_found");
    const doc = toDocument(loaded);
    const run = buildRunOrder(doc);
    if (run.length === 0) throw new GameError("quiz_not_playable");

    const oldPlayers = this.state?.players.map((p) => p.id) ?? [];
    const next = this.db.transaction((tx) => {
      if (this.state) this.endInTx(tx as unknown as Db, this.state);
      const joinCode = Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
      const { id } = tx
        .insert(gameSession)
        .values({ quizId, joinCode, state: "lobby", stateJson: {}, quizSnapshot: doc })
        .returning({ id: gameSession.id })
        .get();
      const s = initialState({ sessionId: id, quizId, joinCode, quizTitle: doc.title, quizLang: doc.language });
      // Headlines and images were fetched when the quiz was saved; copy them into the session.
      s.news = Object.fromEntries(
        collectNewsUrls(doc).map((url) => [url, this.media.getMeta<NewsInfo>("news", url) ?? { headline: null, image: null }]),
      );
      this.persist(tx as unknown as Db, s);
      return s;
    });
    this.state = next;
    this.run = run;
    this.syncTimer();
    if (oldPlayers.length) this.listener?.playersRemoved(oldPlayers, "session_ended");
    this.listener?.changed();
  }

  /** Applies one intent: reduce → persist → broadcast. Throws GameError on rejection. */
  dispatch(intent: MachineIntent): GameState {
    return this.transact(() => [intent]);
  }

  /**
   * Runs `build` inside a DB transaction (so it can insert rows for new ids), then
   * reduces the intents it returns and persists the result in the same transaction.
   */
  transact(build: (tx: Db) => MachineIntent[]): GameState {
    const prev = this.state;
    if (!prev) throw new GameError("no_session");
    const before = new Set(prev.players.map((p) => p.id));
    const next = this.db.transaction((tx) => {
      let s = prev;
      for (const intent of build(tx as unknown as Db)) s = reduce(s, intent, { now: this.now(), run: this.run, random: Math.random });
      this.persist(tx as unknown as Db, s);
      return s;
    });
    this.state = next;
    this.syncTimer();
    const after = new Set(next.players.map((p) => p.id));
    const removed = [...before].filter((id) => !after.has(id));
    if (removed.length) this.listener?.playersRemoved(removed, "removed");
    this.listener?.changed();
    return next;
  }

  /** Ends the session for good (scores stay in the database). */
  endSession(): void {
    const s = this.state;
    if (!s) throw new GameError("no_session");
    const players = s.players.map((p) => p.id);
    this.db.transaction((tx) => this.endInTx(tx as unknown as Db, s));
    this.state = null;
    this.run = [];
    this.syncTimer();
    this.listener?.playersRemoved(players, "session_ended");
    this.listener?.changed();
  }

  private endInTx(tx: Db, s: GameState) {
    const ended = s.phase === "finished" ? s : reduce(s, { type: "endSession" }, { now: this.now(), run: this.run, random: Math.random });
    this.persist(tx, ended);
    tx.update(gameSession)
      .set({ endedAt: new Date(this.now()).toISOString() })
      .where(eq(gameSession.id, s.sessionId))
      .run();
  }

  /** Creates a player token and its row; returns the plain token. */
  newToken(): { token: string; tokenHash: string } {
    const token = randomBytes(24).toString("base64url");
    return { token, tokenHash: hashToken(token) };
  }

  findPlayerByToken(token: string) {
    const h = hashToken(token);
    return this.state?.players.find((p) => p.tokenHash === h);
  }

  /** Writes the snapshot plus the normalised team/player/answer rows. */
  private persist(tx: Db, s: GameState) {
    tx.update(gameSession)
      .set({ state: s.phase, stateJson: s, currentItem: s.phase === "item" ? s.cursor : null })
      .where(eq(gameSession.id, s.sessionId))
      .run();

    const teamIds = s.teams.map((t) => t.id);
    const playerIds = s.players.map((p) => p.id);

    // Scores are derived; store them on the row for history and queries.
    const scores = computeScores(s);
    for (const t of s.teams) {
      tx.update(team)
        .set({ name: t.name, emoji: t.emoji, color: t.color, photoPath: t.photo, score: scores.get(t.id) ?? 0 })
        .where(eq(team.id, t.id))
        .run();
    }

    // Move phones first: deleting a merged-away team would cascade to its phones.
    for (const p of s.players) {
      tx.update(player).set({ teamId: p.teamId, nickname: p.nickname }).where(eq(player.id, p.id)).run();
    }
    const stale = tx
      .select({ id: player.id })
      .from(player)
      .innerJoin(team, eq(player.teamId, team.id))
      .where(eq(team.sessionId, s.sessionId))
      .all()
      .filter((p) => !playerIds.includes(p.id));
    for (const p of stale) tx.delete(player).where(eq(player.id, p.id)).run();

    tx.delete(team)
      .where(and(eq(team.sessionId, s.sessionId), teamIds.length ? notInArray(team.id, teamIds) : undefined))
      .run();

    tx.delete(answer).where(eq(answer.sessionId, s.sessionId)).run();
    for (const [cursor, run] of Object.entries(s.items)) {
      for (const [teamId, a] of Object.entries(run.answers)) {
        if (!teamIds.includes(Number(teamId))) continue;
        tx.insert(answer)
          .values({
            sessionId: s.sessionId,
            itemId: Number(cursor),
            teamId: Number(teamId),
            playerId: playerIds.includes(a.playerId) ? a.playerId : null,
            value: a.value,
            submittedAt: new Date(a.at).toISOString(),
            verdict: a.verdict,
            points: a.points,
          })
          .run();
      }
    }
  }

  /** Arms a server-side timeout for the running question timer. */
  private syncTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const s = this.state;
    const run = s?.phase === "item" ? s.items[s.cursor] : undefined;
    if (!s || !run || run.step !== "answering" || !run.timer) return;
    const delay = Math.max(0, run.timer.endsAt - this.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        this.dispatch({ type: "timerExpired" });
      } catch (err) {
        this.log.error({ err }, "timer expiry failed");
      }
    }, delay + 20);
  }

  /** Removes stored photos of a session (used when the host deletes a session). */
  deleteSessionFiles(sessionId: number) {
    fs.rmSync(this.sessionDir(sessionId), { recursive: true, force: true });
  }

  close() {
    if (this.timer) clearTimeout(this.timer);
  }
}

/** Inserts the rows for a new team and/or phone inside a runner transaction. */
export function insertTeamRow(tx: Db, sessionId: number, t: { name: string; emoji: string; color: string }) {
  return tx.insert(team).values({ sessionId, ...t }).returning({ id: team.id }).get().id;
}

export function insertPlayerRow(tx: Db, teamId: number, nickname: string | null, tokenHash: string) {
  return tx.insert(player).values({ teamId, nickname, tokenHash }).returning({ id: player.id }).get().id;
}
