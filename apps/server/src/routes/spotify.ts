import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SpotifyConfigPatch } from "@kwistig/shared";
import { HttpError, parse } from "../http.js";
import { SpotifyError } from "../services/spotify.js";
import { requireHost } from "./auth.js";

const asHttp = (err: unknown): never => {
  if (err instanceof SpotifyError) {
    const status = err.code === "not_configured" || err.code === "not_connected" ? 409 : err.code === "quota" ? 429 : 502;
    throw new HttpError(status, `spotify_${err.code}`);
  }
  throw err;
};

/** Small standalone page for the end of the connect flow (it runs on 127.0.0.1, outside the app's login). */
function resultPage(ok: boolean, detail: string) {
  const title = ok ? "Spotify gekoppeld" : "Spotify koppelen mislukt";
  const body = ok
    ? "Kwistig kan nu Spotify afspelen. Je kunt dit tabblad sluiten en teruggaan naar Beheer → Instellingen."
    : `Er ging iets mis (${detail}). Probeer het opnieuw vanuit Beheer → Instellingen.`;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;background:#0d0b1f;color:#f5f4ff;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:28rem;padding:2rem;text-align:center}h1{color:${ok ? "#fbbf24" : "#fca5a5"}}</style></head>
<body><main><h1>${esc(title)}</h1><p>${esc(body)}</p></main></body></html>`;
}

export async function spotifyRoutes(app: FastifyInstance) {
  const spotify = app.spotify;
  const host = { preHandler: requireHost(app) };

  app.get("/status", host, async () => spotify.status());

  app.patch("/config", host, async (req) => {
    spotify.configure(parse(SpotifyConfigPatch, req.body));
    return spotify.status();
  });

  /** Starts the PKCE flow: redirects the browser to Spotify. */
  app.get("/login", host, async (_req, reply) => {
    try {
      return reply.redirect(spotify.authorizeUrl());
    } catch (err) {
      return asHttp(err);
    }
  });

  /**
   * Spotify redirects here (on 127.0.0.1, so without the host cookie). The
   * single-use state value ties it to a login the host started.
   */
  app.get("/callback", async (req, reply) => {
    const q = parse(z.object({ code: z.string().max(2000).optional(), state: z.string().max(200).optional(), error: z.string().max(200).optional() }), req.query);
    reply.header("content-type", "text/html; charset=utf-8").header("cache-control", "no-store");
    if (q.error || !q.code || !q.state) return reply.status(400).send(resultPage(false, q.error ?? "missing_code"));
    try {
      await spotify.completeLogin(q.code, q.state);
      return reply.send(resultPage(true, ""));
    } catch (err) {
      req.log.warn({ err }, "spotify login failed");
      return reply.status(400).send(resultPage(false, err instanceof SpotifyError ? err.code : "error"));
    }
  });

  app.post("/disconnect", host, async () => {
    spotify.disconnect();
    return spotify.status();
  });

  /** Access token for the TV's Web Playback SDK player. */
  app.get("/token", host, async (_req, reply) => {
    reply.header("cache-control", "no-store");
    try {
      const t = await spotify.accessToken();
      return { accessToken: t.token, expiresAt: t.expiresAt };
    } catch (err) {
      return asHttp(err);
    }
  });

  app.get("/devices", host, async () => spotify.devices().catch(asHttp));
  app.get("/tracks/:id", host, async (req) => {
    const { id } = parse(z.object({ id: z.string().regex(/^[A-Za-z0-9]{22}$/) }), req.params);
    return spotify.track(id).catch(asHttp);
  });
  app.post("/diagnose", host, async () => spotify.diagnose());
  app.get("/playlists", host, async () => spotify.playlists().catch(asHttp));
  app.get("/playlists/:id/tracks", host, async (req) => {
    const { id } = parse(z.object({ id: z.string().regex(/^[A-Za-z0-9]{10,40}$/) }), req.params);
    return spotify.playlistTracks(id).catch(asHttp);
  });
}
