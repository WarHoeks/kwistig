import {
  isPlayable,
  type AnswerValue,
  type GameErrorCode,
  type GameState,
  type HostIntent,
  type ItemRun,
  type PlayerRec,
  type RunItem,
  type TeamRec,
} from "@kwistig/shared";
import { judge } from "./scoring.js";

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
  | { type: "setAnswer"; teamId: number; playerId: number; value: AnswerValue }
  | { type: "addTeam"; team: TeamRec }
  | { type: "addPlayer"; player: PlayerRec }
  | { type: "setPhoto"; teamId: number; photo: string }
  | { type: "timerExpired" };

export interface Ctx {
  now: number;
  run: readonly RunItem[];
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

function lockRun(run: ItemRun, ri: RunItem) {
  run.step = "locked";
  run.timer = null;
  run.answers = judge(ri, run.answers);
}

/** Leaves the current item (locking it if teams were answering) and enters `cursor`. */
function enter(s: GameState, cursor: number, ctx: Ctx) {
  const cur = currentRun(s);
  const curRi = ctx.run[s.cursor];
  if (cur && curRi && cur.step === "answering") lockRun(cur, curRi);
  s.phase = "item";
  s.cursor = cursor;
  s.items[cursor] ??= { step: "shown", answers: {}, timer: null };
  s.overlay.scoreboard = false;
}

function finish(s: GameState, ctx: Ctx) {
  const cur = currentRun(s);
  const curRi = ctx.run[s.cursor];
  if (cur && curRi && cur.step === "answering") lockRun(cur, curRi);
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
      if (ri.timeLimitSec) startTimer(run, ri.timeLimitSec, now);
      return;
    }

    case "lock": {
      const { ri, run } = requireQuestion(s, ctx);
      if (run.step !== "answering") fail("not_answering");
      lockRun(run, ri);
      return;
    }

    case "reveal": {
      const { ri, run } = requireQuestion(s, ctx);
      if (run.step === "revealed") return;
      if (run.step === "answering" || run.step === "shown") lockRun(run, ri);
      run.step = "revealed";
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
      if (s.autoLock) lockRun(run, ri);
      return;
    }

    case "setAutoLock":
      s.autoLock = intent.on;
      return;

    // ---------------------------------------------------------- answers
    case "setAnswer": {
      team(s, intent.teamId);
      const { ri, run } = requireQuestion(s, ctx);
      if (run.step === "locked" || run.step === "revealed") fail("locked");
      if (run.step !== "answering") fail("not_answering");
      if (run.timer && now > run.timer.endsAt + TIMER_SLACK_MS) fail("locked");
      if (!validAnswer(ri, intent.value)) fail("invalid_answer");
      run.answers[intent.teamId] = {
        value: typeof intent.value === "string" ? intent.value.trim() : intent.value,
        playerId: intent.playerId,
        at: now,
        verdict: "pending",
        points: 0,
      };
      return;
    }

    case "mark": {
      team(s, intent.teamId);
      const { ri, run } = requireQuestion(s, ctx);
      if (run.step !== "locked" && run.step !== "revealed") fail("wrong_phase");
      const a = run.answers[intent.teamId] ?? fail("no_answer");
      a.verdict = intent.verdict;
      a.points = intent.verdict === "correct" ? ri.points : intent.verdict === "half" ? ri.points / 2 : 0;
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
      for (const run of Object.values(s.items)) {
        const from = run.answers[intent.fromId];
        if (from && !run.answers[intent.intoId]) run.answers[intent.intoId] = from;
      }
      s.adjustments[intent.intoId] = (s.adjustments[intent.intoId] ?? 0) + (s.adjustments[intent.fromId] ?? 0);
      removeTeam(s, intent.fromId);
      return;
    }

    case "movePlayer": {
      const p = s.players.find((x) => x.id === intent.playerId) ?? fail("unknown_player");
      team(s, intent.teamId);
      p.teamId = intent.teamId;
      return;
    }

    case "removePlayer": {
      const i = s.players.findIndex((x) => x.id === intent.playerId);
      if (i < 0) fail("unknown_player");
      s.players.splice(i, 1);
      return;
    }
  }
}

function removeTeam(s: GameState, teamId: number) {
  s.teams = s.teams.filter((t) => t.id !== teamId);
  s.players = s.players.filter((p) => p.teamId !== teamId);
  delete s.adjustments[teamId];
  for (const run of Object.values(s.items)) delete run.answers[teamId];
}
