import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import QRCode from "qrcode";
import { z } from "zod";
import { JoinBody, type JoinInfo, type JoinResult, type TvJoinInfo } from "@kwistig/shared";
import { HttpError, parse } from "../http.js";
import { GameError } from "../game/machine.js";
import { insertPlayerRow, insertTeamRow } from "../game/runner.js";
import { getSetting } from "../services/settings.js";
import { requireHost } from "./auth.js";

const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const PHOTO_FILE = /^team-\d+-\d+\.jpg$/;

function gameErrorToHttp(err: unknown): never {
  if (err instanceof GameError) {
    const status = err.code === "name_taken" || err.code === "wrong_phase" ? 409 : err.code === "no_session" ? 404 : 400;
    throw new HttpError(status, err.code);
  }
  throw err;
}

function isLoopback(hostname: string) {
  const h = hostname.replace(/^\[|\]$/g, "");
  return h === "localhost" || h.endsWith(".localhost") || h === "::1" || h.startsWith("127.");
}

/** Join URL base, in the order the plan specifies. */
export function resolveJoinBase(
  settingBase: string | undefined,
  envBase: string | undefined,
  origin: string | undefined,
): { base: string; source: TvJoinInfo["source"] } | null {
  if (settingBase) return { base: settingBase.replace(/\/+$/, ""), source: "settings" };
  if (envBase) return { base: envBase.replace(/\/+$/, ""), source: "env" };
  if (origin) {
    try {
      const u = new URL(origin);
      if ((u.protocol === "http:" || u.protocol === "https:") && !isLoopback(u.hostname)) {
        return { base: u.origin, source: "origin" };
      }
    } catch {
      /* not a URL */
    }
  }
  return null;
}

export async function playRoutes(app: FastifyInstance) {
  const runner = app.game;

  const activeSession = (code: string) => {
    const s = runner.state;
    if (!s || s.joinCode !== code.toUpperCase()) throw new HttpError(404, "session_not_found");
    return s;
  };

  app.get("/join/:code", async (req): Promise<JoinInfo> => {
    const { code } = parse(z.object({ code: z.string().max(8) }), req.params);
    const s = activeSession(code);
    return {
      code: s.joinCode,
      quizTitle: s.quizTitle,
      quizLang: s.quizLang,
      phase: s.phase,
      teams: s.teams.map((t) => ({
        id: t.id,
        name: t.name,
        emoji: t.emoji,
        color: t.color,
        players: s.players.filter((p) => p.teamId === t.id).length,
      })),
    };
  });

  app.post("/join", async (req, reply): Promise<JoinResult> => {
    const body = parse(JoinBody, req.body);
    const s = activeSession(body.code);
    if (s.phase === "finished") throw new HttpError(409, "wrong_phase");
    const { token, tokenHash } = runner.newToken();
    const nickname = body.nickname?.trim() || null;
    let ids = { playerId: 0, teamId: 0 };
    try {
      runner.transact((tx) => {
        if (body.mode === "new") {
          const teamId = insertTeamRow(tx, s.sessionId, { name: body.name, emoji: body.emoji, color: body.color });
          const playerId = insertPlayerRow(tx, teamId, nickname, tokenHash);
          ids = { playerId, teamId };
          return [
            { type: "addTeam", team: { id: teamId, name: body.name, emoji: body.emoji, color: body.color, photo: null } },
            { type: "addPlayer", player: { id: playerId, teamId, nickname, tokenHash } },
          ];
        }
        if (!s.teams.some((t) => t.id === body.teamId)) throw new GameError("unknown_team");
        const playerId = insertPlayerRow(tx, body.teamId, nickname, tokenHash);
        ids = { playerId, teamId: body.teamId };
        return [{ type: "addPlayer", player: { id: playerId, teamId: body.teamId, nickname, tokenHash } }];
      });
    } catch (err) {
      gameErrorToHttp(err);
    }
    reply.status(201);
    return { token, ...ids };
  });

  // Team photo: raw JPEG body, already resized to 800×800 by the phone.
  app.addContentTypeParser("image/jpeg", { parseAs: "buffer", bodyLimit: MAX_PHOTO_BYTES }, (_req, body, done) =>
    done(null, body),
  );

  app.post("/play/photo", async (req) => {
    const token = req.headers["x-kwistig-token"];
    const p = typeof token === "string" ? runner.findPlayerByToken(token) : undefined;
    if (!p || !runner.state) throw new HttpError(401, "unknown_player");
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
      throw new HttpError(400, "invalid_photo");
    }
    const s = runner.state;
    const dir = runner.sessionDir(s.sessionId);
    fs.mkdirSync(dir, { recursive: true });
    const file = `team-${p.teamId}-${Date.now()}.jpg`;
    fs.writeFileSync(path.join(dir, file), buf);
    const previous = s.teams.find((t) => t.id === p.teamId)?.photo;
    try {
      runner.dispatch({ type: "setPhoto", teamId: p.teamId, photo: file });
    } catch (err) {
      fs.rmSync(path.join(dir, file), { force: true });
      gameErrorToHttp(err);
    }
    if (previous && PHOTO_FILE.test(previous)) fs.rmSync(path.join(dir, previous), { force: true });
    return { photo: file };
  });

  app.get("/sessions/:id/photos/:file", async (req, reply) => {
    const { id, file } = parse(z.object({ id: z.coerce.number().int().positive(), file: z.string().regex(PHOTO_FILE) }), req.params);
    const full = path.join(runner.sessionDir(id), file);
    if (!fs.existsSync(full)) throw new HttpError(404, "not_found");
    return reply
      .header("content-type", "image/jpeg")
      .header("cache-control", "public, max-age=31536000, immutable")
      .send(fs.createReadStream(full));
  });

  // ---------------------------------------------------------------- host-only

  app.get("/tv/join-info", { preHandler: requireHost(app) }, async (req): Promise<TvJoinInfo> => {
    const { origin } = parse(z.object({ origin: z.string().max(200).optional() }), req.query);
    const s = runner.state;
    const resolved = resolveJoinBase(getSetting(app.db, "join_base_url"), app.config.PUBLIC_BASE_URL, origin);
    if (!s || !resolved) return { joinUrl: null, qrSvg: null, source: resolved?.source ?? null };
    const joinUrl = `${resolved.base}/join/${s.joinCode}`;
    const qrSvg = await QRCode.toString(joinUrl, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    return { joinUrl, qrSvg, source: resolved.source };
  });
}
