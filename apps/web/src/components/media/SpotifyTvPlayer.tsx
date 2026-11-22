import { useEffect, useRef, useState } from "react";
import type { SpotifyStatus } from "@kwistig/shared";
import { api } from "../../lib/api";

// Minimal typing of the Web Playback SDK we use.
interface SpotifyPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  activateElement(): Promise<void>;
  addListener(event: string, cb: (e: { device_id?: string; message?: string }) => void): void;
}
declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: { Player: new (opts: { name: string; getOAuthToken: (cb: (token: string) => void) => void; volume?: number }) => SpotifyPlayer };
  }
}

let sdkPromise: Promise<void> | null = null;
function loadSdk(): Promise<void> {
  if (window.Spotify) return Promise.resolve();
  sdkPromise ??= new Promise((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const s = document.createElement("script");
    s.src = "https://sdk.scdn.co/spotify-player.js";
    s.onerror = () => {
      sdkPromise = null;
      reject(new Error("sdk_unavailable"));
    };
    document.head.appendChild(s);
  });
  return sdkPromise;
}

export type SpotifyPlayerState = "off" | "loading" | "ready" | "error";

/**
 * Turns the TV page into the Spotify Connect device "Kwistig TV" (Web Playback
 * SDK). The server tells Spotify to play on this device; this component only has
 * to exist, report its device id, and be activated by one click (autoplay rules).
 */
export function useSpotifyTvPlayer(
  enabled: boolean,
  report: (deviceId: string | null, error?: string) => void,
): { state: SpotifyPlayerState; error: string | null; needsClick: boolean } {
  const [state, setState] = useState<SpotifyPlayerState>("off");
  const [error, setError] = useState<string | null>(null);
  const [needsClick, setNeedsClick] = useState(true);
  const player = useRef<SpotifyPlayer | null>(null);
  const reportRef = useRef(report);
  reportRef.current = report;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState("loading");
    void (async () => {
      const status = await api<SpotifyStatus>("/spotify/status").catch(() => null);
      if (!status?.connected || cancelled) {
        setState("off");
        return;
      }
      try {
        await loadSdk();
      } catch {
        setState("error");
        setError("sdk_unavailable");
        return;
      }
      if (cancelled || !window.Spotify) return;
      const p = new window.Spotify.Player({
        name: "Kwistig TV",
        volume: 1,
        getOAuthToken: (cb) => {
          void api<{ accessToken: string }>("/spotify/token").then((t) => cb(t.accessToken));
        },
      });
      const fail = (code: string) => (e: { message?: string }) => {
        setState("error");
        setError(code);
        reportRef.current(null, code);
        console.warn("Spotify player:", code, e.message);
      };
      p.addListener("ready", (e) => {
        setState("ready");
        setError(null);
        reportRef.current(e.device_id ?? null);
      });
      p.addListener("not_ready", () => reportRef.current(null));
      // Common causes: no Premium, or a browser without DRM (Widevine) support.
      p.addListener("account_error", fail("premium_required"));
      p.addListener("initialization_error", fail("player_unsupported"));
      p.addListener("authentication_error", fail("not_connected"));
      p.addListener("playback_error", (e) => console.warn("Spotify playback error", e.message));
      player.current = p;
      await p.connect();
    })();
    return () => {
      cancelled = true;
      player.current?.disconnect();
      player.current = null;
      reportRef.current(null);
      setState("off");
    };
  }, [enabled]);

  // Browsers only allow audio after a user gesture: the first click on the TV page activates the player.
  useEffect(() => {
    if (!needsClick) return;
    const h = () => {
      void player.current?.activateElement().catch(() => undefined);
      setNeedsClick(false);
    };
    window.addEventListener("pointerdown", h, { once: true });
    window.addEventListener("keydown", h, { once: true });
    return () => {
      window.removeEventListener("pointerdown", h);
      window.removeEventListener("keydown", h);
    };
  }, [needsClick]);

  return { state, error, needsClick };
}
