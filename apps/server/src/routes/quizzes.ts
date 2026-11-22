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
import { prepareQuizMedia } from "../services/quiz-media.js";
import { exportPackage, importPackage, PackageError, previewPackage, readPackage } from "../services/packages.js";
import { z } from "zod";

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

  // ---------------------------------------------------------------- packages (zip)
  app.addContentTypeParser(
    ["application/zip", "application/x-zip-compressed", "application/octet-stream"],
    { parseAs: "buffer", bodyLimit: 600 * 1024 * 1024 },
    (_req, body, done) => done(null, body),
  );

  const readUpload = (body: unknown) => {
    if (!Buffer.isBuffer(body)) throw new HttpError(415, "not_a_zip");
    try {
      return readPackage(body);
    } catch (err) {
      if (err instanceof PackageError) throw new HttpError(400, err.message, err.issues);
      throw err;
    }
  };

  /** Validates an uploaded package and describes it, without storing anything. */
  app.post("/package/preview", async (req) => previewPackage(app.db, readUpload(req.body)));

  app.post("/package/import", async (req, reply) => {
    const { mode } = parse(z.object({ mode: z.enum(["new", "replace"]).default("new") }), req.query);
    const pkg = readUpload(req.body);
    try {
      const { id, warnings } = await importPackage(app.db, app.media, pkg, mode);
      return reply.status(201).send({ ...loadQuiz(app.db, id), warnings });
    } catch (err) {
      if (err instanceof PackageError) throw new HttpError(409, err.message);
      throw err;
    }
  });

  app.get("/:id/package", async (req, reply) => {
    const { id } = parse(QuizIdParams, req.params);
    const pkg = exportPackage(app.db, app.media, id);
    if (!pkg) throw new HttpError(404, "quiz_not_found");
    return reply
      .header("content-type", "application/zip")
      .header("content-disposition", `attachment; filename="${pkg.name}"`)
      .send(Buffer.from(pkg.zip));
  });

  app.get("/", async () => listQuizzes(app.db));

  app.post("/", async (req, reply) => {
    const { title, language } = parse(CreateQuizBody, req.body);
    const id = createQuiz(app.db, starterQuiz(title, language));
    return reply.status(201).send(loadQuiz(app.db, id));
  });

  /**
   * Import a quiz document (plain .json). Nothing is saved unless the whole file is
   * valid. Image URLs are downloaded; missing media files come back as warnings.
   */
  app.post("/import", async (req, reply) => {
    const parsed = parse(Quiz, req.body, "invalid_quiz");
    const { doc, warnings } = await prepareQuizMedia(app.media, parsed);
    const id = createQuiz(app.db, doc);
    return reply.status(201).send({ ...loadQuiz(app.db, id), warnings });
  });

  app.get("/:id", async (req) => {
    const { id } = parse(QuizIdParams, req.params);
    const q = loadQuiz(app.db, id);
    if (!q) throw new HttpError(404, "quiz_not_found");
    return q;
  });

  app.put("/:id", async (req) => {
    const { id } = parse(QuizIdParams, req.params);
    const parsed = parse(Quiz, req.body, "invalid_quiz");
    const { doc, warnings } = await prepareQuizMedia(app.media, parsed);
    if (!replaceQuiz(app.db, id, doc)) throw new HttpError(404, "quiz_not_found");
    return { ...loadQuiz(app.db, id), warnings };
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
