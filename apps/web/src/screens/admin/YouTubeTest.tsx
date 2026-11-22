import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { loadYouTubeApi } from "../../components/media/YouTubePlayer";

/** A record-label music video: these are the strictest about where they may be embedded. */
const TEST_VIDEO = "dQw4w9WgXcQ";

type Result = "idle" | "loading" | "playing" | { error: number };

/**
 * Plays a music video in this browser the way the TV does. Run it in the TV's
 * Chrome before guests arrive: it shows whether embedding works on this address,
 * and whether an ad plays first (YouTube doesn't let a page detect ads itself).
 */
export function YouTubeTest() {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<{ destroy(): void } | null>(null);
  const [result, setResult] = useState<Result>("idle");

  useEffect(() => () => player.current?.destroy(), []);

  const start = async () => {
    player.current?.destroy();
    setResult("loading");
    try {
      const YT = await loadYouTubeApi();
      const el = document.createElement("div");
      host.current?.replaceChildren(el);
      player.current = new YT.Player(el, {
        width: "100%",
        height: "100%",
        videoId: TEST_VIDEO,
        playerVars: { start: 43, playsinline: 1, rel: 0, origin: window.location.origin },
        events: {
          onReady: (e: { target: { playVideo(): void } }) => e.target.playVideo(),
          onStateChange: (e: { data: number }) => e.data === 1 && setResult("playing"),
          onError: (e: { data: number }) => setResult({ error: e.data }),
        },
      });
    } catch {
      setResult({ error: -1 });
    }
  };

  const onIp = /^(\d+\.){3}\d+$/.test(window.location.hostname);
  return (
    <section className="card space-y-3 p-5" aria-labelledby="yt-test-title">
      <h2 id="yt-test-title" className="text-lg font-bold">
        {t("ytTest.title")}
      </h2>
      <p className="text-sm text-ink-400">{t("ytTest.hint")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-ghost" onClick={() => void start()}>
          ▶ {t("ytTest.run")}
        </button>
        <span className="text-sm" data-testid="yt-test-result">
          {result === "loading" && <span className="text-ink-400">{t("common.loading")}</span>}
          {result === "playing" && <span className="text-emerald-300">✓ {t("ytTest.playing")}</span>}
          {typeof result === "object" && (
            <span className="text-red-300">
              ✗ {result.error === 150 || result.error === 101 ? (onIp ? t("ytTest.blockedIp") : t("ytTest.blocked")) : t("ytTest.failed", { code: result.error })}
            </span>
          )}
        </span>
      </div>
      {/* One container for the player's whole life; only its visibility changes. */}
      <div ref={host} className={`aspect-video w-full max-w-md overflow-hidden rounded-lg bg-black ${result === "idle" ? "hidden" : ""}`} />
      {result === "playing" && <p className="text-sm text-ink-200">{t("ytTest.adHint")}</p>}
    </section>
  );
}
