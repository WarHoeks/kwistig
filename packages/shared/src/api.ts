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

export const Settings = z.object({
  /** Join URL base saved in admin; wins over PUBLIC_BASE_URL. */
  joinBaseUrl: z.string().nullable(),
  envBaseUrl: z.string().nullable(),
  defaultLocale: Language,
  quickMessages: z.array(z.string()),
});
export type Settings = z.infer<typeof Settings>;

export const SettingsPatch = z.strictObject({
  joinBaseUrl: z
    .url({ protocol: /^https?$/, error: "must be an http(s) URL such as http://192.168.1.23:8080" })
    .max(200)
    .nullable()
    .optional(),
  defaultLocale: Language.optional(),
  quickMessages: z.array(z.string().trim().min(1).max(280)).max(20).optional(),
});

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
