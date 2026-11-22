import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { APP_VERSION, type Config } from "./config.js";
import { openDb, type Db } from "./db/client.js";
import { HostAuth } from "./auth/pin.js";
import { HttpError, sendError } from "./http.js";
import { authRoutes } from "./routes/auth.js";
import { quizRoutes } from "./routes/quizzes.js";
import { schemaRoutes } from "./routes/schema.js";
import { playRoutes } from "./routes/play.js";
import { settingsRoutes } from "./routes/settings.js";
import { mediaApiRoutes, mediaFileRoutes } from "./routes/media.js";
import { GameRunner } from "./game/runner.js";
import { attachHub } from "./game/hub.js";
import { MediaStore } from "./services/media.js";
import { setExternalFetch } from "./services/safe-fetch.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    auth: HostAuth;
    config: Config;
    game: GameRunner;
    media: MediaStore;
  }
}

export interface BuildOptions {
  config: Config;
  /** Override the database file (tests use ":memory:"). */
  dbFile?: string;
}

export async function buildApp({ config, dbFile }: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.LOG_LEVEL === "silent" ? false : { level: config.LOG_LEVEL },
    bodyLimit: 20 * 1024 * 1024,
    trustProxy: false,
  });

  const db = openDb(dbFile ?? path.join(config.DATA_DIR, "kwistig.db"), config.MIGRATIONS_DIR);
  const auth = new HostAuth(db, config.HOST_PIN);
  app.decorate("db", db);
  app.decorate("auth", auth);
  app.decorate("config", config);
  setExternalFetch(config.EXTERNAL_FETCH);
  const media = new MediaStore(db, config.DATA_DIR);
  app.decorate("media", media);
  const runner = new GameRunner(db, config.DATA_DIR, app.log, media);
  app.decorate("game", runner);
  app.addHook("onClose", async () => db.$client.close());

  await app.register(fastifyCookie, { secret: auth.cookieSecret() });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return sendError(reply, err);
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: (err as Error).message });
    }
    req.log.error(err);
    return reply.status(500).send({ error: "internal_error" });
  });

  const startedAt = Date.now();
  app.get("/api/health", async () => ({
    status: "ok" as const,
    version: APP_VERSION,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
  }));

  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(schemaRoutes, { prefix: "/api/schema" });
  await app.register(quizRoutes, { prefix: "/api/quizzes" });
  await app.register(settingsRoutes, { prefix: "/api/settings" });
  await app.register(playRoutes, { prefix: "/api" });
  await app.register(mediaApiRoutes, { prefix: "/api/media" });
  await app.register(mediaFileRoutes);

  attachHub(app, runner);
  runner.resume();

  app.all("/api/*", async (_req, reply) => reply.status(404).send({ error: "not_found" }));

  // The built frontend, with SPA fallback for the client-side routes.
  if (fs.existsSync(path.join(config.WEB_DIST, "index.html"))) {
    await app.register(fastifyStatic, { root: config.WEB_DIST, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/") && !path.extname(req.url.split("?")[0] ?? "")) {
        return reply.sendFile("index.html");
      }
      return reply.status(404).send({ error: "not_found" });
    });
  } else {
    app.log.warn({ webDist: config.WEB_DIST }, "frontend build not found; serving API only");
  }

  return app;
}
