import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { Ack } from "@kwistig/shared";

export type SocketAuth = { role: "tv" | "host" } | { role: "player"; token: string };

export interface GameSocket<V> {
  view: V | null;
  connected: boolean;
  /** Server clock minus local clock, in ms. Add to Date.now() to get server time. */
  clockOffset: number;
  /** Set when the server says this phone no longer belongs to a game. */
  removed: string | null;
  /** Set when the handshake is refused (e.g. "pin_required"). */
  authError: string | null;
  send: (intent: object) => Promise<Ack>;
}

/**
 * One Socket.IO connection per screen. The server pushes the whole view for this
 * role on every change; the client only sends intents.
 */
export function useGameSocket<V extends { serverNow: number }>(auth: SocketAuth | null): GameSocket<V> {
  const [view, setView] = useState<V | null>(null);
  const [connected, setConnected] = useState(false);
  const [clockOffset, setClockOffset] = useState(0);
  const [removed, setRemoved] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const authKey = auth ? JSON.stringify(auth) : null;

  useEffect(() => {
    if (!authKey) return;
    const s = io({ auth: JSON.parse(authKey) as SocketAuth, transports: ["websocket", "polling"] });
    socketRef.current = s;
    s.on("connect", () => {
      setConnected(true);
      setAuthError(null);
    });
    s.on("disconnect", () => setConnected(false));
    s.on("connect_error", (err) => {
      if (err.message === "pin_required" || err.message === "forbidden") setAuthError(err.message);
    });
    s.on("view", (v: V) => {
      setClockOffset(v.serverNow - Date.now());
      setView(v);
    });
    s.on("removed", (p: { reason: string }) => {
      setRemoved(p.reason);
      s.disconnect();
    });
    return () => {
      s.removeAllListeners();
      s.disconnect();
      socketRef.current = null;
    };
  }, [authKey]);

  const send = useCallback(async (intent: object): Promise<Ack> => {
    const s = socketRef.current;
    if (!s || !s.connected) return { ok: false, error: "offline" };
    try {
      return (await s.timeout(5000).emitWithAck("intent", intent)) as Ack;
    } catch {
      return { ok: false, error: "offline" };
    }
  }, []);

  return { view, connected, clockOffset, removed, authError, send };
}

/** Re-renders every animation frame (or interval) while `active`. */
export function useNow(active: boolean, intervalMs = 0): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let timer: number | undefined;
    const tick = () => {
      setNow(Date.now());
      if (intervalMs) timer = window.setTimeout(tick, intervalMs);
      else raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
    };
  }, [active, intervalMs]);
  return now;
}
