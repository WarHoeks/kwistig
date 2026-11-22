import { normalizeAnswer } from "./matching.js";
import type { AnswerType } from "./quiz.js";
import type { AnswerValue } from "./state.js";

/**
 * Votes with the same key count for the same option: open answers compare after
 * normalising case, accents, punctuation and articles; numbers compare by value.
 */
export function voteKey(answerType: AnswerType, value: AnswerValue): string {
  if (answerType === "open" && typeof value === "string") return `s:${normalizeAnswer(value)}`;
  return `${typeof value}:${String(value)}`;
}
