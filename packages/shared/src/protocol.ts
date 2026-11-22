import { z } from "zod";

/**
 * Socket.IO protocol. Every client message is an "intent", validated with these
 * schemas on the server. The server answers each intent with an ack and
 * broadcasts the resulting view on the "view" event.
 */

const Id = z.number().int().positive();
const TeamName = z.string().trim().min(1).max(40);

export const HostIntent = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("startQuiz"), quizId: Id }),
  z.strictObject({ type: z.literal("endSession") }),
  z.strictObject({ type: z.literal("startPhotos") }),
  z.strictObject({ type: z.literal("beginQuiz") }),
  z.strictObject({ type: z.literal("next") }),
  z.strictObject({ type: z.literal("previous") }),
  z.strictObject({ type: z.literal("jump"), cursor: z.number().int().min(0) }),
  z.strictObject({ type: z.literal("open") }),
  z.strictObject({ type: z.literal("lock") }),
  z.strictObject({ type: z.literal("reveal") }),
  z.strictObject({ type: z.literal("timerStart"), seconds: z.number().int().min(1).max(600).optional() }),
  z.strictObject({ type: z.literal("timerAdd"), seconds: z.number().int().min(1).max(600) }),
  z.strictObject({ type: z.literal("timerStop") }),
  z.strictObject({ type: z.literal("setAutoLock"), on: z.boolean() }),
  z.strictObject({ type: z.literal("mark"), teamId: Id, verdict: z.enum(["correct", "half", "wrong"]) }),
  z.strictObject({ type: z.literal("adjustScore"), teamId: Id, delta: z.number().min(-1000).max(1000) }),
  z.strictObject({ type: z.literal("scoreboard"), show: z.boolean() }),
  z.strictObject({
    type: z.literal("message"),
    text: z.string().trim().min(1).max(280),
    style: z.enum(["slide", "banner"]),
  }),
  z.strictObject({ type: z.literal("dismissMessage") }),
  z.strictObject({ type: z.literal("renameTeam"), teamId: Id, name: TeamName }),
  z.strictObject({ type: z.literal("removeTeam"), teamId: Id }),
  z.strictObject({ type: z.literal("mergeTeams"), fromId: Id, intoId: Id }),
  z.strictObject({ type: z.literal("movePlayer"), playerId: Id, teamId: Id }),
  z.strictObject({ type: z.literal("removePlayer"), playerId: Id }),
]);
export type HostIntent = z.infer<typeof HostIntent>;

export const AnswerInput = z.union([
  z.number().finite(),
  z.boolean(),
  z.string().trim().min(1).max(200),
]);

export const TeamIntent = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("setAnswer"), value: AnswerInput }),
]);
export type TeamIntent = z.infer<typeof TeamIntent>;

export type Ack = { ok: true } | { ok: false; error: string };

/** Error codes the server may return in an ack. Each has an i18n key errors.game.<code>. */
export const GAME_ERRORS = [
  "invalid_intent",
  "no_session",
  "wrong_phase",
  "not_answering",
  "locked",
  "invalid_answer",
  "unknown_team",
  "unknown_player",
  "not_a_question",
  "no_answer",
  "same_team",
  "quiz_not_found",
  "quiz_not_playable",
  "forbidden",
] as const;
export type GameErrorCode = (typeof GAME_ERRORS)[number];

// ---------------------------------------------------------------- REST: join

export const TEAM_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
] as const;

export const JoinBody = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("new"),
    code: z.string().trim().toUpperCase().length(4),
    name: TeamName,
    emoji: z.string().min(1).max(16),
    color: z.enum(TEAM_COLORS),
    nickname: z.string().trim().max(24).optional(),
  }),
  z.strictObject({
    mode: z.literal("existing"),
    code: z.string().trim().toUpperCase().length(4),
    teamId: Id,
    nickname: z.string().trim().max(24).optional(),
  }),
]);
export type JoinBody = z.infer<typeof JoinBody>;

export interface JoinInfo {
  code: string;
  quizTitle: import("./quiz.js").LocalizedText;
  quizLang: import("./quiz.js").Language;
  phase: import("./state.js").Phase;
  teams: { id: number; name: string; emoji: string; color: string; players: number }[];
}

export interface JoinResult {
  token: string;
  playerId: number;
  teamId: number;
}

export interface TvJoinInfo {
  joinUrl: string | null;
  qrSvg: string | null;
  source: "settings" | "env" | "origin" | null;
}
