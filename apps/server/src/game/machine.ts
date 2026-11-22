import {
  isPlayable,
  type AnswerValue,
  type GameErrorCode,
  type GameState,
  type HostIntent,
  type Item,
  type ItemRun,
  type Media,
  type MediaPlayback,
  type PlayerRec,
  type RunItem,
  type SequenceState,
  type TeamRec,
  type TvIntent,
} from "@kwistig/shared";
import { judge, resolveVotes } from "./scoring.js";

/**
 * The game state machine: a pure reducer. No I/O, no clocks other than ctx.now,
 * so it can be unit-tested directly. The runner persists and broadcasts.
 *
 *   lobby ─startPhotos─► photos ─beginQuiz─► item[0] … item[n] ─next─► finished
 *   per question: shown ─open─► answering ─lock/timer─► locked ─reveal─► revealed
 */

export class GameError extends Error {
  constructor(readonly code: GameErrorCode | "name_taken") {
    super(code);
  }
}

export type MachineIntent =
  | Exclude<HostIntent, { type: "startQuiz" }>
  | { type: "vote"; teamId: number; playerId: number; value: AnswerValue }
  | { type: "retractVote"; teamId: number; playerId: number }
  | { type: "press"; teamId: number; playerId: number }
  | TvIntent
  | { type: "addTeam"; team: TeamRec }
  | { type: "addPlayer"; player: PlayerRec }
  | { type: "setPhoto"; teamId: number; photo: string }
  | { type: "timerExpired" };

export interface Ctx {
  now: number;
  run: readonly RunItem[];
  /** Used to break tied team votes; tests pass a fixed sequence. */
  random: () => number;
}

/** Timers are checked against server receive time with this much slack. */
const TIMER_SLACK_MS = 250;

export function initialState(init: {
  sessionId: number;
  quizId: number | null;
  joinCode: string;
  quizTitle: GameState["quizTitle"];
  quizLang: GameState["quizLang"];
}): GameState {
  return {
    v: 1,
    ...init,
    phase: "lobby",
    cursor: 0,
    items: {},
    teams: [],
    players: [],
    adjustments: {},
    overlay: { scoreboard: false, message: null },
    autoLock: true,
  };
}

export function reduce(prev: GameState, intent: MachineIntent, ctx: Ctx): GameState {
  const s = structuredClone(prev);
  apply(s, intent, ctx);
  return s;
}

const fail = (code: ConstructorParameters<typeof GameError>[0]): never => {
  throw new GameError(code);
};

function currentRun(s: GameState): ItemRun | undefined {
  return s.phase === "item" ? s.items[s.cursor] : undefined;
}

function requireQuestion(s: GameState, ctx: Ctx) {
  const ri = s.phase === "item" ? ctx.run[s.cursor] : undefined;
  const run = currentRun(s);
  if (!ri || !run) return fail("wrong_phase");
  if (ri.item.kind !== "question") return fail("not_a_question");
  return { ri, run, q: ri.item };
}

function team(s: GameState, id: number): TeamRec {
  return s.teams.find((t) => t.id === id) ?? fail("unknown_team");
}

/** Closes answering: votes (or flitsreeks presses) become one judged answer per team. */
function lockRun(s: GameState, run: ItemRun, ri: RunItem, ctx: Ctx) {
  run.step = "locked";
  run.timer = null;
  if (ri.item.kind === "question" && ri.item.answerType === "rapid_sequence") {
    run.answers = judgeSequence(s, run, ri.item);
    return;
  }
  run.votes ??= {};
  run.answers = judge(ri, resolveVotes(ri, run, ctx.random));
}

/** Drops a phone's votes (it left the team or the game). */
function dropVotes(s: GameState, playerId: number) {
  for (const run of Object.values(s.items)) {
    for (const teamVotes of Object.values(run.votes ?? {})) delete teamVotes[playerId];
  }
}

/** Leaves the current item (locking it if teams were answering) and enters `cursor`. */
function enter(s: GameState, cursor: number, ctx: Ctx) {
  const cur = currentRun(s);
  const curRi = ctx.run[s.cursor];
  if (cur && curRi && cur.step === "answering") lockRun(s, cur, curRi, ctx);
  s.phase = "item";
  s.cursor = cursor;
  s.items[cursor] ??= { step: "shown", votes: {}, answers: {}, timer: null };
  s.overlay.scoreboard = false;
  const ri = ctx.run[cursor];
  const media = ri && "media" in ri.item ? ri.item.media : undefined;
  setPlayback(s, cursor, "question", media);
}

/** Audio/video the TV plays on command; images and news need no playback. */
const isPlayableMedia = (m: Media | undefined): m is Media => m?.type === "youtube" || m?.type === "spotify";

/** Resets playback for an item's media slot; `seq` only ever increases. */
function setPlayback(s: GameState, cursor: number, slot: MediaPlayback["slot"], media: Media | undefined) {
  if (!isPlayableMedia(media)) {
    if (slot === "question") delete s.media;
    return;
  }
  s.media = { cursor, slot, status: "idle", seq: (s.media?.seq ?? 0) + 1, muted: s.media?.muted ?? false };
}

function requireMedia(s: GameState): MediaPlayback {
  return s.phase === "item" && s.media?.cursor === s.cursor ? s.media : fail("no_media");
}

// ---------------------------------------------------------------- flitsreeks

/** 3-2-1 on the TV before the first image. */
export const SEQUENCE_LEAD_MS = 3000;

type RapidItem = Extract<Item, { answerType: "rapid_sequence" }>;

function startSequence(run: ItemRun, q: RapidItem, now: number) {
  const ms = (q.secondsPerImage ?? 5) * 1000;
  const graceMs = q.graceMs ?? 300;
  const startAt = now + SEQUENCE_LEAD_MS;
  const endsAt = startAt + q.images.length * ms + graceMs;
  run.seq = { startAt, ms, count: q.images.length, graceMs };
  run.presses = {};
  run.timer = { endsAt, durationMs: endsAt - now };
}

/**
 * Which image a press received at `now` counts for. A press in the grace window
 * right after a switch counts for the previous image if the team hadn't pressed it.
 */
export function pressIndex(seq: SequenceState, now: number, teamPresses: Record<string, unknown>): number | null {
  const t = now - seq.startAt;
  if (t < 0) return null;
  let index = Math.floor(t / seq.ms);
  if (index >= seq.count) return t < seq.count * seq.ms + seq.graceMs ? seq.count - 1 : null;
  if (index > 0 && t - index * seq.ms < seq.graceMs && teamPresses[index - 1] === undefined) index -= 1;
  return index;
}

/** Most points a flitsreeks can give (no speed bonus). */
export function sequenceMaxPoints(q: RapidItem): number {
  return q.images.length * (q.scoring?.pointsPerImage ?? 1);
}

/**
 * Judges every team: each image is right when pressed on a "yes" image or left
 * alone on a "no" image. Points per right image, an optional speed bonus of up to
 * 1 point for a right press in the image's first second, and an optional penalty
 * per press on a "no" image. Teams that never pressed still score their "no"s.
 */
function judgeSequence(s: GameState, run: ItemRun, q: RapidItem): ItemRun["answers"] {
  const seq = run.seq;
  const ppi = q.scoring?.pointsPerImage ?? 1;
  const out: ItemRun["answers"] = {};
  for (const team of s.teams) {
    const presses = run.presses?.[team.id] ?? {};
    const prev = run.answers[team.id];
    let right = 0;
    let points = 0;
    const mask = q.images
      .map((img, i) => {
        const p = presses[i];
        if (!!p === img.yes) {
          right += 1;
          points += ppi;
          if (p && q.scoring?.speedBonus && seq) {
            const sinceShown = p.at - (seq.startAt + i * seq.ms);
            points += Math.max(0, Math.round((1 - sinceShown / 1000) * 10) / 10);
          }
        } else if (p) {
          points -= q.scoring?.wrongPressPenalty ?? 0;
        }
        return p ? "1" : "0";
      })
      .join("");
    const first = Object.values(presses).sort((a, b) => a.at - b.at)[0];
    const auto = {
      value: mask,
      playerId: first?.playerId ?? 0,
      at: first?.at ?? 0,
      verdict: right === q.images.length ? ("correct" as const) : right === 0 ? ("wrong" as const) : ("half" as const),
      points: Math.round(points * 10) / 10,
      votes: 0,
      totalVotes: 0,
      tieBreak: false,
    };
    out[team.id] = prev?.manual && prev.value === mask ? { ...auto, verdict: prev.verdict, points: prev.points, manual: true } : auto;
  }
  return out;
}

function finish(s: GameState, ctx: Ctx) {
  const cur = currentRun(s);
  const curRi = ctx.run[s.cursor];
  if (cur && curRi && cur.step === "answering") lockRun(s, cur, curRi, ctx);
  s.phase = "finished";
  s.overlay.scoreboard = false;
}

function startTimer(run: ItemRun, seconds: number, now: number) {
  run.timer = { endsAt: now + seconds * 1000, durationMs: seconds * 1000 };
}

function validAnswer(ri: RunItem, value: AnswerValue): boolean {
  const q = ri.item;
  if (q.kind !== "question") return false;
  switch (q.answerType) {
    case "multiple_choice":
      return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < q.options.length;
    case "true_false":
      return typeof value === "boolean";
    case "open":
      return typeof value === "string" && value.trim().length > 0 && value.length <= 200;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    default:
      return false;
  }
}

function apply(s: GameState, intent: MachineIntent, ctx: Ctx): void {
  const { now } = ctx;
  switch (intent.type) {
    // ---------------------------------------------------------- flow
    case "startPhotos":
      if (s.phase !== "lobby") fail("wrong_phase");
      s.phase = "photos";
      return;

    case "beginQuiz":
      if (s.phase !== "lobby" && s.phase !== "photos") fail("wrong_phase");
      if (ctx.run.length === 0) fail("quiz_not_playable");
      enter(s, 0, ctx);
      return;

    case "next":
      if (s.phase === "lobby") return apply(s, { type: "startPhotos" }, ctx);
      if (s.phase === "photos") return apply(s, { type: "beginQuiz" }, ctx);
      if (s.phase !== "item") fail("wrong_phase");
      if (s.cursor + 1 < ctx.run.length) enter(s, s.cursor + 1, ctx);
      else finish(s, ctx);
      return;

    case "previous":
      if (s.phase === "finished") return enter(s, s.cursor, ctx);
      if (s.phase !== "item" || s.cursor === 0) fail("wrong_phase");
      enter(s, s.cursor - 1, ctx);
      return;

    case "jump":
      if (s.phase !== "item" && s.phase !== "finished") fail("wrong_phase");
      if (intent.cursor >= ctx.run.length) fail("invalid_intent");
      enter(s, intent.cursor, ctx);
      return;

    case "endSession":
      finish(s, ctx);
      return;

    // ---------------------------------------------------------- question steps
    case "open": {
      const { ri, run, q } = requireQuestion(s, ctx);
      if (!isPlayable(q)) fail("quiz_not_playable");
      if (run.step === "answering") return;
      if (run.step === "revealed") fail("wrong_phase");
      // Re-opening a locked question clears automatic verdicts.
      for (const a of Object.values(run.answers)) {
        if (!a.manual) {
          a.verdict = "pending";
          a.points = 0;
          delete a.match;
        }
      }
      run.step = "answering";
      if (q.answerType === "rapid_sequence") startSequence(run, q, now);
      else if (ri.timeLimitSec) startTimer(run, ri.timeLimitSec, now);
      return;
    }

    case "lock": {
      const { ri, run } = requireQuestion(s, ctx);
      if (run.step !== "answering") fail("not_answering");
      lockRun(s, run, ri, ctx);
      return;
    }

    case "reveal": {
      const { ri, run, q } = requireQuestion(s, ctx);
      if (run.step === "revealed") return;
      if (run.step === "answering" || run.step === "shown") lockRun(s, run, ri, ctx);
      run.step = "revealed";
      run.spotlight = null;
      // Reveal media (e.g. the full clip) takes over the TV's player.
      if (q.answerType !== "rapid_sequence" && isPlayableMedia(q.revealMedia)) setPlayback(s, s.cursor, "reveal", q.revealMedia);
      return;
    }

    case "spotlight": {
      const { run, q } = requireQuestion(s, ctx);
      if (q.answerType !== "rapid_sequence" || run.step !== "revealed") fail("wrong_phase");
      if (intent.index !== null && intent.index >= (q as RapidItem).images.length) fail("invalid_intent");
      run.spotlight = intent.index;
      return;
    }

    // ---------------------------------------------------------- media playback
    case "mediaPlay": {
      const m = requireMedia(s);
      if (m.status !== "paused") m.seq += 1; // (re)start from the start marker
      m.status = "playing";
      delete m.error;
      return;
    }

    case "mediaReplay": {
      const m = requireMedia(s);
      m.seq += 1;
      m.status = "playing";
      delete m.error;
      return;
    }

    case "mediaPause": {
      const m = requireMedia(s);
      if (m.status === "playing") m.status = "paused";
      return;
    }

    case "mediaMute":
      requireMedia(s).muted = intent.on;
      return;

    case "mediaEnded": {
      // Reports for an older start (a replay already happened) are ignored.
      const m = s.media;
      if (m && m.seq === intent.seq && m.status === "playing") m.status = "ended";
      return;
    }

    case "mediaError": {
      const m = s.media;
      if (m && m.seq === intent.seq) {
        m.status = "error";
        m.error = intent.code;
      }
      return;
    }

    case "press": {
      team(s, intent.teamId);
      const { run, q } = requireQuestion(s, ctx);
      if (q.answerType !== "rapid_sequence") fail("not_a_question");
      if (run.step === "locked" || run.step === "revealed") fail("locked");
      if (run.step !== "answering" || !run.seq) fail("not_running");
      run.presses ??= {};
      const teamPresses = (run.presses[intent.teamId] ??= {});
      const index = pressIndex(run.seq!, now, teamPresses);
      if (index === null) fail(now < run.seq!.startAt ? "not_running" : "locked");
      if (teamPresses[index!] !== undefined) fail("already_pressed");
      teamPresses[index!] = { playerId: intent.playerId, at: now };
      return;
    }

    case "timerStart": {
      const { ri, run } = requireQuestion(s, ctx);
      if (run.step !== "answering") fail("not_answering");
      startTimer(run, intent.seconds ?? ri.timeLimitSec ?? 30, now);
      return;
    }

    case "timerAdd": {
      const { run } = requireQuestion(s, ctx);
      if (run.step !== "answering") fail("not_answering");
      if (run.timer && run.timer.endsAt > now) {
        run.timer.endsAt += intent.seconds * 1000;
        run.timer.durationMs += intent.seconds * 1000;
      } else {
        startTimer(run, intent.seconds, now);
      }
      return;
    }

    case "timerStop": {
      const { run } = requireQuestion(s, ctx);
      run.timer = null;
      return;
    }

    case "timerExpired": {
      const run = currentRun(s);
      const ri = ctx.run[s.cursor];
      if (!run || !ri || run.step !== "answering" || !run.timer) return;
      if (now + TIMER_SLACK_MS < run.timer.endsAt) return;
      // A flitsreeks always closes at the end of its sequence.
      const rapid = ri.item.kind === "question" && ri.item.answerType === "rapid_sequence";
      if (s.autoLock || rapid) lockRun(s, run, ri, ctx);
      return;
    }

    case "setAutoLock":
      s.autoLock = intent.on;
      return;

    // ---------------------------------------------------------- answers
    case "vote":
    case "retractVote": {
      team(s, intent.teamId);
      const { ri, run } = requireQuestion(s, ctx);
      if (run.step === "locked" || run.step === "revealed") fail("locked");
      if (run.step !== "answering") fail("not_answering");
      if (run.timer && now > run.timer.endsAt + TIMER_SLACK_MS) fail("locked");
      run.votes ??= {};
      const teamVotes = (run.votes[intent.teamId] ??= {});
      if (intent.type === "retractVote") {
        delete teamVotes[intent.playerId];
        return;
      }
      if (!validAnswer(ri, intent.value)) fail("invalid_answer");
      teamVotes[intent.playerId] = {
        value: typeof intent.value === "string" ? intent.value.trim() : intent.value,
        at: now,
      };
      return;
    }

    case "mark": {
      team(s, intent.teamId);
      const { ri, run } = requireQuestion(s, ctx);
      if (run.step !== "locked" && run.step !== "revealed") fail("wrong_phase");
      const a = run.answers[intent.teamId] ?? fail("no_answer");
      const max = ri.item.kind === "question" && ri.item.answerType === "rapid_sequence" ? sequenceMaxPoints(ri.item) : ri.points;
      a.verdict = intent.verdict;
      a.points = intent.verdict === "correct" ? max : intent.verdict === "half" ? max / 2 : 0;
      a.manual = true;
      return;
    }

    case "adjustScore":
      team(s, intent.teamId);
      s.adjustments[intent.teamId] = (s.adjustments[intent.teamId] ?? 0) + intent.delta;
      return;

    // ---------------------------------------------------------- overlays
    case "scoreboard":
      s.overlay.scoreboard = intent.show;
      return;

    case "message":
      s.overlay.message = { text: intent.text, style: intent.style };
      return;

    case "dismissMessage":
      s.overlay.message = null;
      return;

    // ---------------------------------------------------------- teams and phones
    case "addTeam": {
      if (s.phase === "finished") fail("wrong_phase");
      const lower = intent.team.name.toLocaleLowerCase();
      if (s.teams.some((t) => t.name.toLocaleLowerCase() === lower)) fail("name_taken");
      s.teams.push(intent.team);
      return;
    }

    case "addPlayer":
      team(s, intent.player.teamId);
      s.players.push(intent.player);
      return;

    case "setPhoto":
      if (s.phase === "finished") fail("wrong_phase");
      team(s, intent.teamId).photo = intent.photo;
      return;

    case "renameTeam": {
      const t = team(s, intent.teamId);
      const lower = intent.name.toLocaleLowerCase();
      if (s.teams.some((o) => o.id !== t.id && o.name.toLocaleLowerCase() === lower)) fail("name_taken");
      t.name = intent.name;
      return;
    }

    case "removeTeam":
      team(s, intent.teamId);
      removeTeam(s, intent.teamId);
      return;

    case "mergeTeams": {
      if (intent.fromId === intent.intoId) fail("same_team");
      team(s, intent.fromId);
      team(s, intent.intoId);
      for (const p of s.players) if (p.teamId === intent.fromId) p.teamId = intent.intoId;
      // The target team keeps its own answers; it inherits the other's where it had none.
      // Votes from both teams now count together.
      for (const run of Object.values(s.items)) {
        const from = run.answers[intent.fromId];
        if (from && !run.answers[intent.intoId]) run.answers[intent.intoId] = from;
        run.votes ??= {};
        const fromVotes = run.votes[intent.fromId];
        if (fromVotes) run.votes[intent.intoId] = { ...fromVotes, ...run.votes[intent.intoId] };
      }
      s.adjustments[intent.intoId] = (s.adjustments[intent.intoId] ?? 0) + (s.adjustments[intent.fromId] ?? 0);
      removeTeam(s, intent.fromId);
      return;
    }

    case "movePlayer": {
      const p = s.players.find((x) => x.id === intent.playerId) ?? fail("unknown_player");
      team(s, intent.teamId);
      // A moved phone's votes are dropped; answers its old team already locked stay.
      if (p.teamId !== intent.teamId) dropVotes(s, p.id);
      p.teamId = intent.teamId;
      return;
    }

    case "removePlayer": {
      const i = s.players.findIndex((x) => x.id === intent.playerId);
      if (i < 0) fail("unknown_player");
      s.players.splice(i, 1);
      dropVotes(s, intent.playerId);
      return;
    }
  }
}

function removeTeam(s: GameState, teamId: number) {
  s.teams = s.teams.filter((t) => t.id !== teamId);
  s.players = s.players.filter((p) => p.teamId !== teamId);
  delete s.adjustments[teamId];
  for (const run of Object.values(s.items)) {
    delete run.answers[teamId];
    if (run.votes) delete run.votes[teamId];
  }
}
