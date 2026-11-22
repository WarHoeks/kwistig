import { z } from "zod";
import { Language } from "./quiz.js";

/** REST payloads shared by server and web. */

export const LoginBody = z.strictObject({ pin: z.string().min(1).max(200) });

export const CreateQuizBody = z.strictObject({
  title: z.string().trim().min(1).max(200),
  language: Language,
});

export const QuizIdParams = z.object({ id: z.coerce.number().int().positive() });

export const QuizSummary = z.object({
  id: z.number(),
  title: z.string(),
  language: Language,
  description: z.string().nullable(),
  roundCount: z.number(),
  itemCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type QuizSummary = z.infer<typeof QuizSummary>;

/** Error body for every 4xx. `issues` is set for validation failures. */
export interface ApiError {
  error: string;
  issues?: { path: string; message: string }[];
}

export interface HealthResponse {
  status: "ok";
  version: string;
  uptimeSec: number;
}

export interface AuthStatus {
  authenticated: boolean;
  /** True while the PIN is still the shipped "change-me". */
  defaultPin?: boolean;
}
