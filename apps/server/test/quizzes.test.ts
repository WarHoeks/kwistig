import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { testApp } from "./helpers.js";

const sample = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, "../../../samples/kitchen-sink.json"), "utf8"),
) as unknown;

let app: FastifyInstance;
afterEach(async () => app?.close());

describe("health and auth", () => {
  it("health is public", async () => {
    ({ app } = await testApp());
    const res = await app.inject("/api/health");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok" });
  });

  it("quiz routes need the PIN", async () => {
    ({ app } = await testApp());
    expect((await app.inject("/api/quizzes")).statusCode).toBe(401);
    const wrong = await app.inject({ method: "POST", url: "/api/auth/login", payload: { pin: "nope" } });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ error: "wrong_pin" });
  });

  it("changing the PIN signs existing cookies out", async () => {
    let cookie: string;
    ({ app, cookie } = await testApp());
    expect((await app.inject({ url: "/api/quizzes", headers: { cookie } })).statusCode).toBe(200);
    app.auth.setPin("9999");
    expect((await app.inject({ url: "/api/quizzes", headers: { cookie } })).statusCode).toBe(401);
  });
});

describe("import and export", () => {
  it("imports the sample and exports it identically", async () => {
    let cookie: string;
    ({ app, cookie } = await testApp());
    const imp = await app.inject({ method: "POST", url: "/api/quizzes/import", payload: sample as object, headers: { cookie } });
    expect(imp.statusCode).toBe(201);
    const { id } = imp.json<{ id: number }>();

    const exp = await app.inject({ url: `/api/quizzes/${id}/export`, headers: { cookie } });
    expect(exp.statusCode).toBe(200);
    expect(exp.headers["content-disposition"]).toContain("kwistig-kwistig-proefquiz.json");
    expect(JSON.parse(exp.body)).toEqual(sample);

    const list = await app.inject({ url: "/api/quizzes", headers: { cookie } });
    expect(list.json()).toEqual([
      expect.objectContaining({ id, title: "Kwistig proefquiz", language: "nl", roundCount: 3, itemCount: 16 }),
    ]);
  });

  it("rejects an invalid file with paths and saves nothing", async () => {
    let cookie: string;
    ({ app, cookie } = await testApp());
    const bad = structuredClone(sample) as { rounds: { items: Record<string, unknown>[] }[] };
    bad.rounds[0]!.items[1]!.options = ["only one"];
    bad.rounds[0]!.items[1]!.correct = 0;
    const res = await app.inject({ method: "POST", url: "/api/quizzes/import", payload: bad, headers: { cookie } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: "invalid_quiz",
      issues: [{ path: "rounds[0].items[1].options", message: "needs 2 to 6 entries" }],
    });
    expect((await app.inject({ url: "/api/quizzes", headers: { cookie } })).json()).toEqual([]);
  });

  it("saves edits, duplicates and deletes", async () => {
    let cookie: string;
    ({ app, cookie } = await testApp());
    const created = await app.inject({
      method: "POST",
      url: "/api/quizzes",
      payload: { title: "Nieuw", language: "nl" },
      headers: { cookie },
    });
    expect(created.statusCode).toBe(201);
    const quiz = created.json<{ id: number; uid: string; rounds: { title: string; items: unknown[] }[] }>();
    expect(quiz.rounds[0]!.title).toBe("Ronde 1");

    const { id: _id, uid: _uid, ...doc } = quiz;
    doc.rounds.push({ title: "Ronde 2", items: [{ kind: "question", answerType: "true_false", prompt: "Waar?", correct: false }] });
    const put = await app.inject({ method: "PUT", url: `/api/quizzes/${quiz.id}`, payload: doc, headers: { cookie } });
    expect(put.statusCode).toBe(200);
    expect(put.json<{ rounds: unknown[] }>().rounds).toHaveLength(2);

    const dup = await app.inject({ method: "POST", url: `/api/quizzes/${quiz.id}/duplicate`, headers: { cookie } });
    expect(dup.json()).toMatchObject({ title: "Nieuw (kopie)" });

    expect((await app.inject({ method: "DELETE", url: `/api/quizzes/${quiz.id}`, headers: { cookie } })).statusCode).toBe(204);
    expect((await app.inject({ url: `/api/quizzes/${quiz.id}`, headers: { cookie } })).statusCode).toBe(404);
  });

  it("serves the JSON Schema", async () => {
    ({ app } = await testApp());
    const res = await app.inject("/api/schema/quiz.json");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ title: "Kwistig quiz", type: "object" });
  });
});
