import type { Item, LocalizedText, Question, Quiz } from "./quiz.js";

/** One entry in a session's flattened run order. */
export interface RunItem {
  cursor: number;
  roundIndex: number;
  roundTitle: LocalizedText;
  item: Item;
  /** 1-based question number across the quiz; undefined for slides. */
  questionNumber?: number;
  /** Resolved with round defaults. */
  points: number;
  timeLimitSec?: number;
}

export function buildRunOrder(quiz: Quiz): RunItem[] {
  const out: RunItem[] = [];
  let q = 0;
  quiz.rounds.forEach((round, roundIndex) => {
    for (const item of round.items) {
      const isQ = item.kind === "question";
      const own = isQ && item.answerType !== "rapid_sequence" ? item : undefined;
      const timeLimitSec = isQ ? (own?.timeLimitSec ?? round.defaults?.timeLimitSec) : undefined;
      out.push({
        cursor: out.length,
        roundIndex,
        roundTitle: round.title,
        item,
        ...(isQ ? { questionNumber: ++q } : {}),
        points: own?.points ?? round.defaults?.points ?? 1,
        ...(timeLimitSec !== undefined && item.kind === "question" && item.answerType !== "rapid_sequence"
          ? { timeLimitSec }
          : {}),
      });
    }
  });
  return out;
}

export function questionCount(run: readonly RunItem[]): number {
  return run.filter((r) => r.item.kind === "question").length;
}

/** Answer types the Phase 2 game supports on phones. */
export const PLAYABLE_TYPES = ["multiple_choice", "true_false", "open", "number", "rapid_sequence", "buzzer"] as const;
export type PlayableType = (typeof PLAYABLE_TYPES)[number];
export const isPlayable = (q: Question): q is Extract<Question, { answerType: PlayableType }> =>
  (PLAYABLE_TYPES as readonly string[]).includes(q.answerType);
