import type { FastifyInstance } from "fastify";
import { Server, type Socket } from "socket.io";
import { HostIntent, TeamIntent, type Ack, type IdleView } from "@kwistig/shared";
import { formatIssues } from "@kwistig/shared";
import { GameError } from "./machine.js";
import { hostView, teamView, tvView } from "./project.js";
import type { GameRunner } from "./runner.js";

type Role = "tv" | "host" | "player";
interface SocketData {
  role: Role;
  token?: string;
  playerId?: number;
}

/**
 * Socket.IO hub. Rooms: "tv", "host" and "player:<id>". Each role receives only
 * its own projection on the "view" event; every client message is a Zod-validated
 * intent answered with an ack.
 */
export function attachHub(app: FastifyInstance, runner: GameRunner) {
  const io = new Server<Record<string, (...args: never[]) => void>, Record<string, (...args: never[]) => void>, Record<string, never>, SocketData>(
    app.server,
    { serveClient: false, pingInterval: 10_000, pingTimeout: 8_000 },
  );
  /** Open sockets per player id, for the host's "online" dots. */
  const online = new Map<number, number>();
  const onlineSet = () => new Set([...online.entries()].filter(([, n]) => n > 0).map(([id]) => id));

  const idle = (): IdleView => ({ serverNow: Date.now(), phase: "idle" });

  const emitTo = (room: string, event: string, payload: unknown) =>
    (io.to(room) as unknown as { emit: (e: string, p: unknown) => void }).emit(event, payload);

  function broadcast() {
    const s = runner.state;
    const now = Date.now();
    if (!s) {
      emitTo("tv", "view", idle());
      emitTo("host", "view", idle());
      return;
    }
    emitTo("tv", "view", tvView(s, runner.run, now));
    emitTo("host", "view", hostView(s, runner.run, now, onlineSet()));
    for (const p of s.players) emitTo(`player:${p.id}`, "view", teamView(s, runner.run, now, p.id));
  }

  function sendHost() {
    const s = runner.state;
    emitTo("host", "view", s ? hostView(s, runner.run, Date.now(), onlineSet()) : idle());
  }

  runner.setListener({
    changed: broadcast,
    playersRemoved(ids, reason) {
      for (const id of ids) {
        emitTo(`player:${id}`, "removed", { reason });
        io.in(`player:${id}`).socketsLeave(`player:${id}`);
        online.delete(id);
      }
    },
  });

  io.use((socket, next) => {
    const auth = (socket.handshake.auth ?? {}) as { role?: unknown; token?: unknown };
    if (auth.role === "tv" || auth.role === "host") {
      const ok = app.auth.isHostCookieHeader(socket.handshake.headers.cookie, (v) => app.unsignCookie(v));
      if (!ok) return next(new Error("pin_required"));
      socket.data.role = auth.role;
      return next();
    }
    if (auth.role === "player" && typeof auth.token === "string" && auth.token.length < 200) {
      socket.data.role = "player";
      socket.data.token = auth.token;
      return next();
    }
    next(new Error("forbidden"));
  });

  io.on("connection", (socket: Socket) => {
    const data = socket.data as SocketData;

    if (data.role === "player") {
      const p = runner.findPlayerByToken(data.token!);
      if (!p) {
        socket.emit("removed", { reason: "unknown" });
        socket.disconnect(true);
        return;
      }
      data.playerId = p.id;
      void socket.join(`player:${p.id}`);
      online.set(p.id, (online.get(p.id) ?? 0) + 1);
      const s = runner.state!;
      socket.emit("view", teamView(s, runner.run, Date.now(), p.id));
      sendHost();
      socket.on("disconnect", () => {
        online.set(p.id, Math.max(0, (online.get(p.id) ?? 1) - 1));
        sendHost();
      });
    } else {
      void socket.join(data.role);
      const s = runner.state;
      const now = Date.now();
      socket.emit(
        "view",
        !s ? idle() : data.role === "tv" ? tvView(s, runner.run, now) : hostView(s, runner.run, now, onlineSet()),
      );
    }

    socket.on("intent", (raw: unknown, ack?: unknown) => {
      const reply = (a: Ack) => {
        if (typeof ack === "function") (ack as (a: Ack) => void)(a);
      };
      try {
        handleIntent(data, raw);
        reply({ ok: true });
      } catch (err) {
        if (err instanceof GameError) return reply({ ok: false, error: err.code });
        app.log.error({ err }, "intent failed");
        reply({ ok: false, error: "internal_error" });
      }
    });
  });

  function handleIntent(data: SocketData, raw: unknown) {
    if (data.role === "host") {
      const parsed = HostIntent.safeParse(raw);
      if (!parsed.success) {
        app.log.warn({ issues: formatIssues(parsed.error) }, "invalid host intent");
        throw new GameError("invalid_intent");
      }
      const intent = parsed.data;
      if (intent.type === "startQuiz") return runner.startQuiz(intent.quizId);
      if (intent.type === "endSession") return runner.endSession();
      runner.dispatch(intent);
      return;
    }
    if (data.role === "player") {
      const parsed = TeamIntent.safeParse(raw);
      if (!parsed.success) throw new GameError("invalid_answer");
      const p = data.token ? runner.findPlayerByToken(data.token) : undefined;
      if (!p) throw new GameError("unknown_player");
      runner.dispatch({ type: "setAnswer", teamId: p.teamId, playerId: p.id, value: parsed.data.value });
      return;
    }
    throw new GameError("forbidden");
  }

  app.addHook("onClose", async () => {
    runner.close();
    await io.close();
  });

  return { io, broadcast };
}
