import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { JoinResult, SessionSummary } from "@kwistig/shared";
import { testApp } from "./helpers.js";

const quiz = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../../samples/text-10.json"), "utf8")) as object;
// Smallest valid JPEG header is enough: the server checks the magic bytes.
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);

let app: FastifyInstance;
afterEach(async () => app?.close());

describe("past sessions", () => {
  it("lists sessions with final standings, and deletes one with its photos", async () => {
    let cookie: string;
    ({ app, cookie } = await testApp());
    const quizId = (await app.inject({ method: "POST", url: "/api/quizzes/import", payload: quiz, headers: { cookie } })).json<{ id: number }>().id;

    app.game.startQuiz(quizId);
    const code = app.game.state!.joinCode;
    const join = (name: string) =>
      app.inject({ method: "POST", url: "/api/join", payload: { mode: "new", code, name, emoji: "🦊", color: "#3b82f6" } }).then((r) => r.json<JoinResult>());
    const a = await join("De Bollen");
    await join("Quizzers");
    const photo = await app.inject({ method: "POST", url: "/api/play/photo", payload: jpeg, headers: { "content-type": "image/jpeg", "x-kwistig-token": a.token } });
    expect(photo.statusCode).toBe(200);
    app.game.dispatch({ type: "adjustScore", teamId: a.teamId, delta: 3 });
    const sessionId = app.game.state!.sessionId;
    const dir = app.game.sessionDir(sessionId);
    expect(fs.readdirSync(dir)).toHaveLength(1);

    // The running session is listed as active and can't be deleted.
    let list = (await app.inject({ url: "/api/sessions", headers: { cookie } })).json<SessionSummary[]>();
    expect(list[0]).toMatchObject({ id: sessionId, active: true, quizTitle: "Huiskamerquiz: tien vragen" });
    expect((await app.inject({ method: "DELETE", url: `/api/sessions/${sessionId}`, headers: { cookie } })).json()).toEqual({ error: "session_active" });

    app.game.endSession();
    list = (await app.inject({ url: "/api/sessions", headers: { cookie } })).json<SessionSummary[]>();
    expect(list[0]).toMatchObject({ active: false, endedAt: expect.any(String) });
    expect(list[0]!.teams).toEqual([
      expect.objectContaining({ name: "De Bollen", score: 3, rank: 1, photoUrl: expect.stringMatching(/^\/api\/sessions\/\d+\/photos\/team-/) }),
      expect.objectContaining({ name: "Quizzers", score: 0, rank: 2, photoUrl: null }),
    ]);

    const del = await app.inject({ method: "DELETE", url: `/api/sessions/${sessionId}`, headers: { cookie } });
    expect(del.statusCode).toBe(204);
    expect(fs.existsSync(dir)).toBe(false);
    expect((await app.inject({ url: "/api/sessions", headers: { cookie } })).json()).toEqual([]);
    expect((await app.inject({ url: "/api/sessions" })).statusCode).toBe(401);
  });
});
