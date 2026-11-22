import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { FetchLike } from "../src/services/spotify.js";
import { TEST_PIN } from "./helpers.js";

/** A fake Spotify: accounts service (PKCE) and the Web API endpoints Kwistig uses. */
class FakeSpotify {
  challenge = "";
  codes = new Map<string, string>(); // code → challenge
  tokenCalls: Record<string, string>[] = [];
  calls: { method: string; path: string; body?: unknown }[] = [];
  accessExpiresIn = 3600;
  nextAccess = 1;
  refresh = "refresh-1";
  deviceOnline = true;
  premium = true;
  /** Answer the next API call with 401, as Spotify does for a revoked or expired token. */
  fail401Once = false;

  fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    const json = (status: number, body?: unknown) =>
      new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

    if (u.host === "accounts.spotify.com" && u.pathname === "/api/token") {
      const form = Object.fromEntries(new URLSearchParams(String(init?.body)));
      this.tokenCalls.push(form);
      if (form.grant_type === "authorization_code") {
        const challenge = this.codes.get(form.code!);
        const computed = createHash("sha256").update(form.code_verifier!).digest("base64url");
        if (!challenge || challenge !== computed) return json(400, { error: "invalid_grant" });
      } else if (form.grant_type === "refresh_token") {
        if (form.refresh_token !== this.refresh) return json(400, { error: "invalid_grant" });
        this.refresh = `refresh-${this.nextAccess + 1}`; // rotate
      }
      return json(200, { access_token: `access-${this.nextAccess++}`, refresh_token: this.refresh, expires_in: this.accessExpiresIn, scope: "streaming" });
    }

    if (u.host === "api.spotify.com") {
      const p = u.pathname.replace(/^\/v1/, "") + (u.search || "");
      this.calls.push({ method, path: p, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
      if (this.fail401Once) {
        this.fail401Once = false;
        return json(401, { error: { status: 401, message: "The access token expired" } });
      }
      const pathOnly = u.pathname.replace(/^\/v1/, "");
      if (pathOnly === "/me") return json(200, { id: "host-1", display_name: "Quizmaster" });
      if (pathOnly === "/me/player/devices")
        return json(200, { devices: this.deviceOnline ? [{ id: "tv-device", name: "Kwistig TV", type: "Computer", is_active: false }] : [] });
      if (pathOnly.startsWith("/me/player/")) {
        if (!this.premium) return json(403, { error: { status: 403, message: "Premium required", reason: "PREMIUM_REQUIRED" } });
        if (!this.deviceOnline) return json(404, { error: { status: 404, message: "Device not found", reason: "NO_ACTIVE_DEVICE" } });
        return new Response(null, { status: 204 });
      }
      if (pathOnly.startsWith("/tracks/")) return json(200, { type: "track", uri: "spotify:track:11dFghVXANMlKmJXsNCbNl", name: "Cut To The Feeling", duration_ms: 207959, artists: [{ name: "Carly Rae Jepsen" }] });
      if (pathOnly === "/me/playlists")
        return json(200, {
          items: [
            { id: "mine1234567", name: "Kwistig hits", collaborative: false, owner: { id: "host-1", display_name: "Quizmaster" }, items: { total: 2 } },
            { id: "editorial12", name: "Top 2000", collaborative: false, owner: { id: "spotify", display_name: "Spotify" }, items: { total: 2000 } },
          ],
          next: null,
        });
      if (pathOnly === "/playlists/mine1234567/items")
        return json(200, {
          items: [
            { item: { type: "track", uri: "spotify:track:4uLU6hMCjMI75M1A2tKUQC", name: "Never Gonna Give You Up", duration_ms: 213573, artists: [{ name: "Rick Astley" }] } },
            { item: { type: "episode", uri: "spotify:episode:x", name: "A podcast", duration_ms: 1, artists: [] } },
            { item: { type: "track", uri: "spotify:track:11dFghVXANMlKmJXsNCbNl", name: "Cut To The Feeling", duration_ms: 207959, artists: [{ name: "Carly Rae Jepsen" }] } },
          ],
          next: null,
        });
      return json(404, { error: { status: 404, message: "not found" } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
}

let app: FastifyInstance;
let dataDir: string;
afterEach(async () => {
  await app?.close();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

async function start(fake: FakeSpotify, env: Record<string, string> = {}) {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "kwistig-spotify-"));
  const config = loadConfig({
    HOST_PIN: TEST_PIN,
    LOG_LEVEL: "silent",
    EXTERNAL_FETCH: "false",
    DATA_DIR: dataDir,
    MIGRATIONS_DIR: path.resolve(import.meta.dirname, "../drizzle"),
    WEB_DIST: path.resolve(import.meta.dirname, "__no_web__"),
    ...env,
  });
  app = await buildApp({ config, dbFile: ":memory:", spotifyFetch: fake.fetch });
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { pin: TEST_PIN } });
  const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  return { cookie };
}

/** Runs the connect flow the way a browser would. */
async function connect(fake: FakeSpotify, cookie: string) {
  const login = await app.inject({ url: "/api/spotify/login", headers: { cookie } });
  expect(login.statusCode).toBe(302);
  const authorize = new URL(login.headers.location as string);
  fake.codes.set("the-code", authorize.searchParams.get("code_challenge")!);
  const cb = await app.inject(`/api/spotify/callback?code=the-code&state=${authorize.searchParams.get("state")}`);
  return { authorize, cb };
}

describe("Spotify settings", () => {
  it("admin values override the environment; bad redirect URIs are refused", async () => {
    const { cookie } = await start(new FakeSpotify(), { SPOTIFY_CLIENT_ID: "envclientid00000000000000000000aa" });
    let s = (await app.inject({ url: "/api/spotify/status", headers: { cookie } })).json();
    expect(s).toMatchObject({ clientId: "envclientid00000000000000000000aa", clientIdSource: "env", redirectUri: "http://127.0.0.1:8080/api/spotify/callback", connected: false });

    const patch = (body: object) => app.inject({ method: "PATCH", url: "/api/spotify/config", payload: body, headers: { cookie } });
    s = (await patch({ clientId: "0123456789abcdef0123456789abcdef", redirectUri: "http://127.0.0.1:8091/api/spotify/callback" })).json();
    expect(s).toMatchObject({ clientId: "0123456789abcdef0123456789abcdef", clientIdSource: "settings", redirectUri: "http://127.0.0.1:8091/api/spotify/callback", redirectUriSource: "settings" });

    expect((await patch({ redirectUri: "http://localhost:8080/api/spotify/callback" })).statusCode).toBe(400);
    expect((await patch({ redirectUri: "http://127.0.0.1:8080/wrong/path" })).statusCode).toBe(400);
    expect((await patch({ clientId: "too-short" })).statusCode).toBe(400);

    s = (await patch({ clientId: null, redirectUri: null })).json();
    expect(s).toMatchObject({ clientIdSource: "env", redirectUriSource: "env" });
    expect((await app.inject({ url: "/api/spotify/status" })).statusCode).toBe(401);
  });
});

describe("PKCE connect flow and tokens", () => {
  it("connects with S256 PKCE, stores tokens and refreshes them", async () => {
    const fake = new FakeSpotify();
    const { cookie } = await start(fake);
    await app.inject({ method: "PATCH", url: "/api/spotify/config", payload: { clientId: "0123456789abcdef0123456789abcdef" }, headers: { cookie } });

    const { authorize, cb } = await connect(fake, cookie);
    expect(authorize.origin + authorize.pathname).toBe("https://accounts.spotify.com/authorize");
    expect(Object.fromEntries(authorize.searchParams)).toMatchObject({
      client_id: "0123456789abcdef0123456789abcdef",
      response_type: "code",
      redirect_uri: "http://127.0.0.1:8080/api/spotify/callback",
      code_challenge_method: "S256",
    });
    expect(authorize.searchParams.get("scope")).toContain("streaming");
    expect(authorize.searchParams.get("scope")).toContain("playlist-read-private");
    expect(cb.statusCode).toBe(200);
    expect(cb.body).toContain("Spotify gekoppeld");
    // No client secret is ever sent.
    expect(fake.tokenCalls[0]).not.toHaveProperty("client_secret");

    const status = (await app.inject({ url: "/api/spotify/status", headers: { cookie } })).json();
    expect(status).toMatchObject({ connected: true, account: { displayName: "Quizmaster", id: "host-1" } });

    // A reused or unknown state is refused.
    const replay = await app.inject(`/api/spotify/callback?code=the-code&state=${authorize.searchParams.get("state")}`);
    expect(replay.statusCode).toBe(400);
    expect(replay.body).toContain("invalid_state");

    // Token for the TV; refreshed (once, even with parallel callers) when nearly expired.
    expect((await app.inject({ url: "/api/spotify/token", headers: { cookie } })).json()).toMatchObject({ accessToken: "access-1" });
    // A 401 makes the server refresh and retry the call once.
    fake.accessExpiresIn = 30; // and the refreshed token is already inside the refresh margin
    fake.fail401Once = true;
    expect(await app.spotify.api("GET", "/me")).toMatchObject({ id: "host-1" });
    expect(fake.tokenCalls.at(-1)).toMatchObject({ grant_type: "refresh_token", client_id: "0123456789abcdef0123456789abcdef" });
    // Parallel callers share one refresh, and the rotated refresh token is kept.
    const before = fake.tokenCalls.length;
    const tokens = await Promise.all([app.spotify.accessToken(), app.spotify.accessToken(), app.spotify.accessToken()]);
    expect(new Set(tokens.map((t) => t.token)).size).toBe(1);
    expect(fake.tokenCalls.length - before).toBe(1);
    // The fake rotates the refresh token on every refresh and rejects older ones,
    // so this second refresh only works if Kwistig stored the rotated token.
    const refreshes = fake.tokenCalls.filter((c) => c.grant_type === "refresh_token").map((c) => c.refresh_token);
    expect(refreshes).toHaveLength(2);
    expect(refreshes[1]).not.toBe(refreshes[0]);
  });

  it("changing the Client ID disconnects", async () => {
    const fake = new FakeSpotify();
    const { cookie } = await start(fake);
    await app.inject({ method: "PATCH", url: "/api/spotify/config", payload: { clientId: "0123456789abcdef0123456789abcdef" }, headers: { cookie } });
    await connect(fake, cookie);
    await app.inject({ method: "PATCH", url: "/api/spotify/config", payload: { clientId: "ffffffffffffffffffffffffffffffff" }, headers: { cookie } });
    expect((await app.inject({ url: "/api/spotify/status", headers: { cookie } })).json()).toMatchObject({ connected: false, account: null });
  });
});

describe("playback on the TV device", () => {
  const quiz = {
    version: 1,
    title: "Muziek",
    language: "nl",
    rounds: [
      {
        title: "Muziek",
        items: [
          {
            kind: "question",
            answerType: "open",
            prompt: "Wie is de artiest?",
            acceptedAnswers: ["Carly Rae Jepsen"],
            media: { type: "spotify", uri: "https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl?si=abc", startSec: 42, endSec: 42.3, play: "before" },
          },
        ],
      },
    ],
  };

  async function setup(fake: FakeSpotify) {
    const { cookie } = await start(fake);
    await app.inject({ method: "PATCH", url: "/api/spotify/config", payload: { clientId: "0123456789abcdef0123456789abcdef" }, headers: { cookie } });
    await connect(fake, cookie);
    const id = (await app.inject({ method: "POST", url: "/api/quizzes/import", payload: quiz, headers: { cookie } })).json<{ id: number }>().id;
    app.game.startQuiz(id);
    app.game.dispatch({ type: "beginQuiz" });
    fake.calls.length = 0;
  }
  const playCalls = (fake: FakeSpotify) => fake.calls.filter((c) => c.path.startsWith("/me/player/"));
  const settle = () => new Promise((r) => setTimeout(r, 30));

  it("plays from startSec on the TV device and pauses at endSec", async () => {
    const fake = new FakeSpotify();
    await setup(fake);
    app.spotify.tvDevice = { id: "tv-device", name: "Kwistig TV" };
    app.game.dispatch({ type: "mediaPlay" });
    await settle();
    expect(playCalls(fake)[0]).toEqual({
      method: "PUT",
      path: "/me/player/play?device_id=tv-device",
      body: { uris: ["spotify:track:11dFghVXANMlKmJXsNCbNl"], position_ms: 42000 },
    });
    expect(app.game.state!.media).toMatchObject({ status: "playing" });
    await new Promise((r) => setTimeout(r, 400)); // the 0.3 s clip runs out
    expect(playCalls(fake).at(-1)).toMatchObject({ method: "PUT", path: "/me/player/pause?device_id=tv-device" });
    expect(app.game.state!.media).toMatchObject({ status: "ended" });

    // Replay from the host starts again at the start marker.
    app.game.dispatch({ type: "mediaReplay" });
    await settle();
    expect(playCalls(fake).at(-1)).toMatchObject({ path: "/me/player/play?device_id=tv-device", body: { position_ms: 42000 } });
  });

  it("pause, resume and mute", async () => {
    const fake = new FakeSpotify();
    await setup(fake);
    app.spotify.tvDevice = { id: "tv-device", name: "Kwistig TV" };
    app.game.dispatch({ type: "mediaPlay" });
    await settle();
    app.game.dispatch({ type: "mediaPause" });
    await settle();
    expect(playCalls(fake).at(-1)).toMatchObject({ path: "/me/player/pause?device_id=tv-device" });
    await new Promise((r) => setTimeout(r, 400)); // paused: no end yet
    expect(app.game.state!.media!.status).toBe("paused");
    app.game.dispatch({ type: "mediaMute", on: true });
    await settle();
    expect(playCalls(fake).at(-1)).toMatchObject({ path: "/me/player/volume?volume_percent=0&device_id=tv-device" });
    app.game.dispatch({ type: "mediaPlay" });
    await settle();
    expect(playCalls(fake).at(-1)).toEqual({ method: "PUT", path: "/me/player/play?device_id=tv-device" }); // resume, no body
    await new Promise((r) => setTimeout(r, 400));
    expect(app.game.state!.media!.status).toBe("ended");
  });

  it("uses the fallback Connect device, and reports clear errors", async () => {
    const fake = new FakeSpotify();
    await setup(fake);
    // No TV player and no fallback device.
    app.game.dispatch({ type: "mediaPlay" });
    await settle();
    expect(app.game.state!.media).toMatchObject({ status: "error", error: "spotify_no_device" });

    app.spotify.configure({ fallbackDeviceId: "speaker-1" });
    app.game.dispatch({ type: "mediaReplay" });
    await settle();
    expect(playCalls(fake).at(-1)).toMatchObject({ path: "/me/player/play?device_id=speaker-1" });

    fake.premium = false;
    app.game.dispatch({ type: "mediaReplay" });
    await settle();
    expect(app.game.state!.media).toMatchObject({ status: "error", error: "spotify_premium_required" });
  });
});

describe("diagnose and playlist import", () => {
  it("diagnoses every endpoint and lists only your own playlists as importable", async () => {
    const fake = new FakeSpotify();
    const { cookie } = await start(fake);
    await app.inject({ method: "PATCH", url: "/api/spotify/config", payload: { clientId: "0123456789abcdef0123456789abcdef" }, headers: { cookie } });
    await connect(fake, cookie);

    const steps = (await app.inject({ method: "POST", url: "/api/spotify/diagnose", headers: { cookie } })).json<{ name: string; ok: boolean; detail: string }[]>();
    expect(steps.map((s) => [s.name, s.ok])).toEqual([
      ["token", true],
      ["profile", true],
      ["devices", true],
      ["track", true],
      ["playlists", true],
      ["playlistItems", true],
    ]);
    expect(steps.find((s) => s.name === "playlistItems")!.detail).toContain("2 tracks");

    const lists = (await app.inject({ url: "/api/spotify/playlists", headers: { cookie } })).json();
    expect(lists).toEqual([
      expect.objectContaining({ id: "mine1234567", importable: true, trackCount: 2 }),
      expect.objectContaining({ id: "editorial12", importable: false, owner: "Spotify" }),
    ]);
    const tracks = (await app.inject({ url: "/api/spotify/playlists/mine1234567/tracks", headers: { cookie } })).json();
    expect(tracks).toEqual([
      { uri: "spotify:track:4uLU6hMCjMI75M1A2tKUQC", name: "Never Gonna Give You Up", artists: ["Rick Astley"], durationMs: 213573 },
      { uri: "spotify:track:11dFghVXANMlKmJXsNCbNl", name: "Cut To The Feeling", artists: ["Carly Rae Jepsen"], durationMs: 207959 },
    ]);
  });
});
