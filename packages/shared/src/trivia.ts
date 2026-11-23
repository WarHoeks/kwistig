import { z } from "zod";
import type { Item, Round } from "./quiz.js";

/** Open Trivia DB (opentdb.com): request and conversion to an editable round. */

export const TriviaRequest = z.strictObject({
  amount: z.number().int().min(1).max(30),
  /** Open Trivia DB category id; omitted = any category. */
  category: z.number().int().min(1).max(999).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  type: z.enum(["multiple", "boolean"]).optional(),
});
export type TriviaRequest = z.infer<typeof TriviaRequest>;

export interface TriviaCategory {
  id: number;
  name: string;
}

/** One question as Open Trivia DB returns it, already URL-decoded. */
export interface TriviaQuestion {
  type: "multiple" | "boolean";
  difficulty: string;
  category: string;
  question: string;
  correct_answer: string;
  incorrect_answers: string[];
}

/**
 * Turns Open Trivia DB questions into a round of normal, editable questions.
 * The questions are English, so every text is stored as `{ en }`: a Dutch quiz
 * shows them in English until someone adds a translation.
 */
export function roundFromTrivia(title: string, questions: TriviaQuestion[], random: () => number = Math.random): Round {
  const items: Item[] = questions.map((q) => {
    if (q.type === "boolean") {
      return { kind: "question", answerType: "true_false", prompt: { en: q.question }, correct: q.correct_answer === "True" };
    }
    // Insert the correct answer at a random position among the wrong ones.
    const wrong = q.incorrect_answers.slice(0, 5);
    const at = Math.floor(random() * (wrong.length + 1));
    const options = [...wrong.slice(0, at), q.correct_answer, ...wrong.slice(at)];
    return { kind: "question", answerType: "multiple_choice", prompt: { en: q.question }, options: options.map((o) => ({ en: o })), correct: at };
  });
  return { title: { en: title }, items: [{ kind: "slide", title: { en: title } }, ...items] };
}
