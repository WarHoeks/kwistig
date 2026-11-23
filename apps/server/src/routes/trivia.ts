import type { FastifyInstance } from "fastify";
import { roundFromTrivia, TriviaRequest } from "@kwistig/shared";
import { HttpError, parse } from "../http.js";
import { TriviaError } from "../services/trivia.js";
import { requireHost } from "./auth.js";

const asHttp = (err: unknown): never => {
  if (err instanceof TriviaError) throw new HttpError(err.code === "rate_limited" ? 429 : err.code === "not_enough" ? 409 : 502, `trivia_${err.code}`);
  throw err;
};

/**
 * Open Trivia DB rounds for the editor. Returns a round; the editor adds it to
 * the quiz like any other change, so nothing is saved until the host saves.
 */
export async function triviaRoutes(app: FastifyInstance) {
  const host = { preHandler: requireHost(app) };

  app.get("/categories", host, async () => app.trivia.categories().catch(asHttp));

  app.post("/round", host, async (req) => {
    const body = parse(TriviaRequest, req.body);
    const questions = await app.trivia.questions(body).catch(asHttp);
    const cats = body.category ? await app.trivia.categories().catch(() => []) : [];
    const title = cats.find((c) => c.id === body.category)?.name ?? "Trivia";
    return roundFromTrivia(title, questions);
  });
}
