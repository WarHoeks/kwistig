import type { FastifyInstance } from "fastify";
import { CreateQuizBody, primaryText, Quiz, QuizIdParams } from "@kwistig/shared";
import { HttpError, parse } from "../http.js";
import {
  createQuiz,
  deleteQuiz,
  listQuizzes,
  loadQuiz,
  replaceQuiz,
  starterQuiz,
  toDocument,
} from "../services/quizzes.js";
import { requireHost } from "./auth.js";

function slug(s: string): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "quiz"
  );
}

export async function quizRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireHost(app));

  app.get("/", async () => listQuizzes(app.db));

  app.post("/", async (req, reply) => {
    const { title, language } = parse(CreateQuizBody, req.body);
    const id = createQuiz(app.db, starterQuiz(title, language));
    return reply.status(201).send(loadQuiz(app.db, id));
  });

  /** Import a quiz document (plain .json). Nothing is saved unless the whole file is valid. */
  app.post("/import", async (req, reply) => {
    const doc = parse(Quiz, req.body, "invalid_quiz");
    const id = createQuiz(app.db, doc);
    return reply.status(201).send(loadQuiz(app.db, id));
  });

  app.get("/:id", async (req) => {
    const { id } = parse(QuizIdParams, req.params);
    const q = loadQuiz(app.db, id);
    if (!q) throw new HttpError(404, "quiz_not_found");
    return q;
  });

  app.put("/:id", async (req) => {
    const { id } = parse(QuizIdParams, req.params);
    const doc = parse(Quiz, req.body, "invalid_quiz");
    if (!replaceQuiz(app.db, id, doc)) throw new HttpError(404, "quiz_not_found");
    return loadQuiz(app.db, id);
  });

  app.delete("/:id", async (req, reply) => {
    const { id } = parse(QuizIdParams, req.params);
    if (!deleteQuiz(app.db, id)) throw new HttpError(404, "quiz_not_found");
    return reply.status(204).send();
  });

  app.post("/:id/duplicate", async (req, reply) => {
    const { id } = parse(QuizIdParams, req.params);
    const q = loadQuiz(app.db, id);
    if (!q) throw new HttpError(404, "quiz_not_found");
    const doc = toDocument(q);
    const suffix = doc.language === "nl" ? " (kopie)" : " (copy)";
    const title =
      typeof doc.title === "string"
        ? doc.title + suffix
        : Object.fromEntries(Object.entries(doc.title).map(([k, v]) => [k, v + suffix]));
    const newId = createQuiz(app.db, { ...doc, title });
    return reply.status(201).send(loadQuiz(app.db, newId));
  });

  /** Export as the import format, as a download. */
  app.get("/:id/export", async (req, reply) => {
    const { id } = parse(QuizIdParams, req.params);
    const q = loadQuiz(app.db, id);
    if (!q) throw new HttpError(404, "quiz_not_found");
    const doc = toDocument(q);
    const name = `kwistig-${slug(primaryText(doc.title, doc.language))}.json`;
    return reply
      .header("content-type", "application/json; charset=utf-8")
      .header("content-disposition", `attachment; filename="${name}"`)
      .send(JSON.stringify(doc, null, 2) + "\n");
  });
}
