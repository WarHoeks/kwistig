import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MediaPlayback, PublicMedia } from "@kwistig/shared";
import { AudioCover } from "./TvMedia";

type YouTubeMedia = Extract<PublicMedia, { type: "youtube" }>;

// Minimal typing of the IFrame Player API we use.
interface YTPlayer {
  loadVideoById(opts: { videoId: string; startSeconds?: number; endSeconds?: number }): void;
  cueVideoById(opts: { videoId: string; startSeconds?: number; endSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  mute(): void;
  unMute(): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  destroy(): void;
}
interface YTNamespace {
  Player: new (el: HTMLElement, opts: object) => YTPlayer;
  PlayerState: { ENDED: 0; PLAYING: 1; PAUSED: 2; BUFFERING: 3; CUED: 5 };
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

/** Loads https://www.youtube.com/iframe_api once. */
export function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT!);
    };
    const s = document.createElement("script");
    // The normal youtube.com embed, so a Premium sign-in in this browser removes ads.
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => {
      apiPromise = null;
      reject(new Error("youtube_api_unavailable"));
    };
    document.head.appendChild(s);
  });
  return apiPromise;
}

/** YouTube player errors: 2 bad id, 5 HTML5 error, 100 not found, 101/150 embedding blocked. */
const ERROR_CODES: Record<number, string> = {
  2: "invalid_id",
  5: "player_error",
  100: "not_found",
  101: "embed_blocked",
  150: "embed_blocked",
};

/**
 * Plays a YouTube clip from startSec to endSec when the host says so. The server
 * owns playback state; this component follows it and reports "ended" (at the end
 * marker or the end of the video) and errors back.
 */
export function YouTubePlayer({
  media,
  playback,
  onEnded,
  onError,
}: {
  media: YouTubeMedia;
  playback: MediaPlayback | null;
  onEnded: (seq: number) => void;
  onError: (seq: number, code: string) => void;
}) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const reportedEnd = useRef(-1);
  const loadedSeq = useRef(-1);
  const latest = useRef({ playback, onEnded, onError });
  latest.current = { playback, onEnded, onError };

  const videoId = media.videoId;
  const clip = { videoId: videoId ?? "", startSeconds: media.startSec ?? 0, ...(media.endSec !== undefined ? { endSeconds: media.endSec } : {}) };

  // Create the player once per video.
  useEffect(() => {
    if (!videoId || !host.current) return;
    let cancelled = false;
    const el = document.createElement("div");
    host.current.appendChild(el);
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return;
        player.current = new YT.Player(el, {
          width: "100%",
          height: "100%",
          videoId,
          playerVars: {
            start: Math.floor(media.startSec ?? 0),
            controls: 0,
            disablekb: 1,
            fs: 0,
            iv_load_policy: 3,
            modestbranding: 1,
            playsinline: 1,
            rel: 0,
            origin: window.location.origin,
          },
          events: {
            onReady: () => setReady(true),
            onStateChange: (e: { data: number }) => {
              const pb = latest.current.playback;
              if (e.data === YT.PlayerState.PLAYING) setBlocked(false);
              if (e.data === YT.PlayerState.ENDED && pb && pb.status === "playing" && reportedEnd.current !== pb.seq) {
                reportedEnd.current = pb.seq;
                latest.current.onEnded(pb.seq);
              }
            },
            onError: (e: { data: number }) => {
              const pb = latest.current.playback;
              latest.current.onError(pb?.seq ?? 0, ERROR_CODES[e.data] ?? `yt_${e.data}`);
            },
          },
        });
      })
      .catch(() => latest.current.onError(latest.current.playback?.seq ?? 0, "youtube_api_unavailable"));
    return () => {
      cancelled = true;
      player.current?.destroy();
      player.current = null;
      setReady(false);
      el.remove();
    };
  }, [videoId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the host's commands.
  const status = playback?.status ?? "idle";
  const seq = playback?.seq ?? 0;
  useEffect(() => {
    const p = player.current;
    if (!ready || !p || !videoId) return;
    if (status === "playing") {
      if (loadedSeq.current !== seq) {
        loadedSeq.current = seq;
        reportedEnd.current = -1;
        p.loadVideoById(clip);
        // If the browser blocks autoplay with sound, nothing starts: ask for a click.
        const check = window.setTimeout(() => {
          if (player.current && player.current.getPlayerState() !== 1 && latest.current.playback?.status === "playing") setBlocked(true);
        }, 2500);
        return () => clearTimeout(check);
      }
      p.playVideo();
    } else if (status === "paused") {
      p.pauseVideo();
    } else if (status === "idle") {
      loadedSeq.current = -1;
      p.cueVideoById(clip);
    } else if (status === "ended") {
      p.pauseVideo();
    }
  }, [ready, status, seq, videoId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const p = player.current;
    if (!ready || !p) return;
    if (playback?.muted) p.mute();
    else p.unMute();
  }, [ready, playback?.muted]);

  // Enforce the end marker ourselves: endSeconds is not always honoured after seeks.
  // The playhead is also written to data-position, so tests can check the markers.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (status !== "playing") return;
    const timer = window.setInterval(() => {
      const p = player.current;
      if (!p || typeof p.getCurrentTime !== "function") return;
      const pos = p.getCurrentTime();
      // YouTube resets the playhead to 0 when it stops at endSeconds; keep the last real one.
      if (pos > 0) root.current?.setAttribute("data-position", pos.toFixed(2));
      if (media.endSec !== undefined && pos >= media.endSec - 0.05 && reportedEnd.current !== seq) {
        reportedEnd.current = seq;
        p.pauseVideo();
        latest.current.onEnded(seq);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [status, seq, media.endSec]);

  if (!videoId) {
    return <div className="flex h-full items-center justify-center text-[40px] text-red-300">{t("tv.mediaError")}</div>;
  }

  return (
    <div ref={root} className="relative h-full w-full" data-testid="tv-youtube" data-status={status} data-seq={seq}>
      <div ref={host} className="absolute inset-0 [&_iframe]:pointer-events-none" />
      {media.hideVideo && <AudioCover className="absolute inset-0 rounded-none" label={t("tv.listen")} />}
      {blocked && (
        <button
          type="button"
          className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 text-[56px] font-bold text-gold-400"
          onClick={() => {
            setBlocked(false);
            player.current?.playVideo();
          }}
        >
          ▶ {t("tv.clickToPlay")}
        </button>
      )}
      {playback?.status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-black/85 px-16 text-center text-[44px] text-red-200">
          <p>{t(`tv.mediaErrors.${playback.error}`, { defaultValue: t("tv.mediaError") })}</p>
          {/* Error 150 on an IP-address page is usually the address, not the video. */}
          {playback.error === "embed_blocked" && /^(\d+\.){3}\d+$/.test(window.location.hostname) && (
            <p className="text-[32px] text-amber-300">{t("tv.ipHintLoopback")}</p>
          )}
        </div>
      )}
    </div>
  );
}
