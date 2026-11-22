import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const here = path.dirname(fileURLToPath(import.meta.url));

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const Env = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default("0.0.0.0"),
  DEFAULT_LOCALE: z.enum(["nl", "en"]).default("nl"),
  HOST_PIN: z.string().min(1).default("change-me"),
  PUBLIC_BASE_URL: z.preprocess(emptyToUndefined, z.url().optional()),
  SPOTIFY_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  SPOTIFY_REDIRECT_URI: z.preprocess(
    emptyToUndefined,
    z.url().default("http://127.0.0.1:8080/api/spotify/callback"),
  ),
  DATA_DIR: z.string().default(path.resolve(process.cwd(), "data")),
  WEB_DIST: z.string().default(path.resolve(here, "../../web/dist")),
  MIGRATIONS_DIR: z.string().default(path.resolve(here, "../drizzle")),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${msg}`);
  }
  return parsed.data;
}

export const APP_VERSION = "0.1.0";
