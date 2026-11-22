import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { io as connect, type Socket } from "socket.io-client";
import type { Ack, HostView, JoinResult, TeamView } from "@kwistig/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { TEST_PIN } from "./helpers.js";

const sample = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../../samples/text-10.json"), "utf8")) as object;

let dataDir: string;
const apps: FastifyInstance[] = [];
const sockets: Socket[] = [];

async function start() {
  const config = loadConfig({
    HOST_PIN: TEST_PIN,
    LOG_LEVEL: "silent",
    EXTERNAL_FETCH: "false",
    DATA_DIR: dataDir,
    MIGRATIONS_DIR: path.resolve(import.meta.dirname, "../drizzle"),
    WEB_DIST: path.resolve(import.meta.dirname, "__no_web__"),
  });
  const app = await buildApp({ config });
  await app.listen({ port: 0, host: "127.0.0.1" });
  apps.push(app);
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { pin: TEST_PIN } });
  const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const addr = app.server.address() as { port: number };
  return { app, cookie, url: `http://127.0.0.1:${addr.port}` };
}

const latest = new WeakMap<Socket, unknown>();

function socket(url: string, auth: object, cookie?: string) {
  const headers: Record<string, string> = { origin: url };
  if (cookie) headers.cookie = cookie;
  const s = connect(url, { auth, extraHeaders: headers, transports: ["websocket"], forceNew: true });
  s.on("view", (v: unknown) => latest.set(s, v));
  sockets.push(s);
  return s;
}

/** Resolves with the latest or next view matching `pred`. */
function nextView<T>(s: Socket, pred: (v: T) => boolean = () => true): Promise<T> {
  const current = latest.get(s) as T | undefined;
  if (current !== undefined && pred(current)) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`no matching view; last: ${JSON.stringify(latest.get(s))?.slice(0, 300)}`)), 3000);
    const h = (v: T) => {
      if (pred(v)) {
        clearTimeout(timeout);
        s.off("view", h);
        resolve(v);
      }
    };
    s.on("view", h);
  });
}

const send = (s: Socket, intent: object) => s.emitWithAck("intent", intent) as Promise<Ack>;

afterEach(async () => {
  for (const s of sockets.splice(0)) s.disconnect();
  for (const a of apps.splice(0)) await a.close();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("live game over sockets", () => {
  it("plays, syncs a team's answer across phones, and resumes after a restart", async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kwistig-"));
    let { app, cookie, url } = await start();
    const imp = await app.inject({ method: "POST", url: "/api/quizzes/import", payload: sample, headers: { cookie } });
    const quizId = imp.json<{ id: number }>().id;

    const host = socket(url, { role: "host" }, cookie);
    await nextView(host);
    expect(await send(host, { type: "startQuiz", quizId })).toEqual({ ok: true });
    const lobby = await nextView<HostView>(host, (v) => v.phase === "lobby");

    // Two phones in one team.
    const join1 = await app.inject({
      method: "POST",
      url: "/api/join",
      payload: { mode: "new", code: lobby.joinCode, name: "De Bollen", emoji: "🧠", color: "#3b82f6", nickname: "Sanne" },
    });
    expect(join1.statusCode).toBe(201);
    const p1 = join1.json<JoinResult>();
    const p2 = (
      await app.inject({
        method: "POST",
        url: "/api/join",
        payload: { mode: "existing", code: lobby.joinCode, teamId: p1.teamId, nickname: "Jip" },
      })
    ).json<JoinResult>();
    const dup = await app.inject({
      method: "POST",
      url: "/api/join",
      payload: { mode: "new", code: lobby.joinCode, name: "de bollen", emoji: "x", color: "#3b82f6" },
    });
    expect(dup.json()).toEqual({ error: "name_taken" });

    const phone1 = socket(url, { role: "player", token: p1.token });
    const phone2 = socket(url, { role: "player", token: p2.token });
    await nextView<TeamView>(phone1);
    await nextView<TeamView>(phone2);

    // Unauthenticated TV is refused, and so is a host cookie sent from another site.
    const rogue = connect(url, { auth: { role: "tv" }, extraHeaders: { origin: url }, transports: ["websocket"], forceNew: true });
    sockets.push(rogue);
    await new Promise<void>((resolve) => rogue.on("connect_error", (e) => (expect(e.message).toBe("pin_required"), resolve())));
    const crossSite = connect(url, {
      auth: { role: "host" },
      extraHeaders: { origin: "http://evil.example", cookie },
      transports: ["websocket"],
      forceNew: true,
    });
    sockets.push(crossSite);
    await new Promise<void>((resolve) => crossSite.on("connect_error", (e) => (expect(e.message).toBe("forbidden"), resolve())));

    await send(host, { type: "beginQuiz" });
    await send(host, { type: "next" }); // first question (MC)
    await send(host, { type: "open" });
    // Team voting: each phone votes; teammates see the tally with names live.
    expect(await send(phone1, { type: "vote", value: 0 })).toEqual({ ok: true });
    const seen = await nextView<TeamView>(phone2, (v) => v.ballot.length === 1);
    expect(seen.ballot[0]).toMatchObject({ value: 0, count: 1, voters: [{ nickname: "Sanne" }] });
    await send(phone2, { type: "vote", value: 2 });
    await nextView<TeamView>(phone1, (v) => v.ballot.length === 2);
    await send(phone1, { type: "vote", value: 2 }); // Sanne is convinced
    await nextView<TeamView>(phone2, (v) => v.ballot.length === 1 && v.ballot[0]!.count === 2);
    // Phones can't send host intents.
    expect(await send(phone1, { type: "reveal" })).toEqual({ ok: false, error: "invalid_answer" });

    // Restart mid-question: state comes back from SQLite.
    for (const s of sockets.splice(0)) s.disconnect();
    await app.close();
    apps.length = 0;
    ({ app, cookie, url } = await start());
    const host2 = socket(url, { role: "host" }, cookie);
    const resumed = await nextView<HostView>(host2);
    expect(resumed).toMatchObject({ phase: "item", step: "answering", item: { cursor: 1 } });
    expect(resumed.ballots).toEqual([{ teamId: p1.teamId, options: [expect.objectContaining({ value: 2, count: 2 })] }]);
    expect(resumed.teamsDetail[0]!.players.map((p) => p.nickname)).toEqual(["Sanne", "Jip"]);

    // The phone rejoins with its token, then the host locks and reveals.
    const phone1b = socket(url, { role: "player", token: p1.token });
    await nextView<TeamView>(phone1b, (v) => v.myVote === 2);
    await send(host2, { type: "reveal" });
    const revealed = await nextView<TeamView>(phone1b, (v) => v.step === "revealed");
    expect(revealed.answer).toEqual({ value: 2, votes: 2, totalVotes: 2, tieBreak: false });
    expect(revealed.result).toEqual({ verdict: "correct", points: 1 });
    expect(revealed.team.score).toBe(1);
    expect(await send(phone1b, { type: "vote", value: 1 })).toEqual({ ok: false, error: "locked" });

    // Removing a phone tells it so.
    const removed = new Promise((resolve) => phone1b.on("removed", resolve));
    await send(host2, { type: "removePlayer", playerId: p1.playerId });
    expect(await removed).toEqual({ reason: "removed" });
  });
});
