import { useEffect, useRef, useState } from "react";
import { useSpotifyTvPlayer } from "../../components/media/SpotifyTvPlayer";
import { useTranslation } from "react-i18next";
import { isIdle, type ServerView, type Settings, type TvJoinInfo, type TvView } from "@kwistig/shared";
import { setCalmMode } from "../../lib/effects";
import { setSoundsEnabled, sounds, startThinkingMusic, unlockAudio } from "../../lib/sounds";
import { PinGate } from "../../components/PinGate";
import { Stage } from "../../components/Stage";
import { api } from "../../lib/api";
import { useGameSocket } from "../../lib/socket";
import { setLanguage } from "../../i18n";
import { useQuizText } from "../../lib/text";
import { Lobby, PhotoGrid } from "./TvLobby";
import { QuestionView, SlideView, type SendTv } from "./TvItem";
import { SequenceView } from "./TvSequence";
import { Scoreboard } from "./TvScoreboard";

export function TvScreen() {
  return <PinGate>{() => <TvLive />}</PinGate>;
}

function TvLive() {
  const { t } = useTranslation();
  const { view, connected, clockOffset, send } = useGameSocket<ServerView<TvView>>({ role: "tv" });
  const sendTv: SendTv = (intent) => void send(intent);
  const live = view && !isIdle(view) ? view : null;
  const music = useTvSettings();
  useGameSounds(live);
  useThinkingMusic(live, music, clockOffset);
  const activated = useUserActivation();

  // Spotify: this page is the "Kwistig TV" player. Its device id is re-sent after
  // every reconnect, since the server only keeps it in memory.
  const spotifyDevice = useRef<string | null>(null);
  const spotify = useSpotifyTvPlayer(!!view, (deviceId, error) => {
    spotifyDevice.current = deviceId;
    void send({ type: "spotifyDevice", deviceId, ...(error ? { error } : {}) });
  });
  useEffect(() => {
    if (connected && spotifyDevice.current) void send({ type: "spotifyDevice", deviceId: spotifyDevice.current });
  }, [connected, send]);
  const text = useQuizText(live?.quizLang);
  const [join, setJoin] = useState<TvJoinInfo | null>(null);

  // The TV always shows the quiz language.
  useEffect(() => {
    if (live) setLanguage(live.quizLang, false);
  }, [live?.quizLang]); // eslint-disable-line react-hooks/exhaustive-deps

  // Join URL + QR for the current session (resolved server-side from settings/env/origin).
  const sessionId = live?.sessionId;
  useEffect(() => {
    if (!sessionId) return;
    api<TvJoinInfo>(`/tv/join-info?origin=${encodeURIComponent(window.location.origin)}`)
      .then(setJoin)
      .catch(() => setJoin(null));
  }, [sessionId]);

  let body;
  if (!view) {
    body = <Centered title={t("tv.connecting")} />;
  } else if (!live) {
    body = <Centered title={t("tv.idleTitle")} hint={t("tv.idleHint")} />;
  } else if (live.phase === "lobby") {
    body = <Lobby view={live} join={join} />;
  } else if (live.phase === "photos") {
    body = <PhotoGrid view={live} />;
  } else if (live.phase === "finished") {
    body = <Scoreboard view={live} final />;
  } else if (live.item?.kind === "slide") {
    body =
      live.item.show === "scoreboard" ? <Scoreboard view={live} title={text(live.item.title)} /> : <SlideView view={live} sendTv={sendTv} />;
  } else if (live.item?.answerType === "rapid_sequence") {
    body = <SequenceView view={live} clockOffset={clockOffset} />;
  } else {
    body = <QuestionView view={live} clockOffset={clockOffset} sendTv={sendTv} />;
  }

  const message = live?.overlay.message;
  const showScoreboard = live?.overlay.scoreboard && live.phase !== "finished";

  return (
    <Stage>
      {body}
      <IpAddressHint view={live} />
      {/* Browsers only play sound (YouTube, Spotify, effects) after one click on the page. */}
      {!activated ? (
        <div className="absolute bottom-6 left-1/2 z-40 -translate-x-1/2 animate-pulse rounded-full bg-gold-400 px-10 py-4 text-[30px] font-semibold text-ink-950" data-testid="tv-click-for-sound">
          🔊 {t("tv.clickForSound")}
        </div>
      ) : (
        spotify.state === "ready" &&
        spotify.needsClick && (
          <div className="absolute bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full bg-black/80 px-8 py-3 text-[26px] text-gold-300">
            {t("tv.spotifyClick")}
          </div>
        )
      )}
      {spotify.state === "error" && spotify.error && spotifyOnScreen(live) && (
        <div className="absolute bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full bg-red-700/90 px-8 py-3 text-[26px] text-white">
          {t(`spotify.errors.spotify_${spotify.error}`, { defaultValue: t("tv.mediaError") })}
        </div>
      )}
      {showScoreboard && (
        <div className="absolute inset-0 z-20 bg-ink-950/95">
          <Scoreboard view={live} />
        </div>
      )}
      {message?.style === "slide" && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink-950 p-32 text-center">
          <p className="font-display text-[120px] leading-tight text-gold-400">{message.text}</p>
        </div>
      )}
      {message?.style === "banner" && (
        <div className="absolute inset-x-0 bottom-0 z-30 bg-gold-400 px-16 py-8 text-center text-[56px] font-bold text-ink-950 shadow-2xl">
          {message.text}
        </div>
      )}
      {!connected && view && (
        <div className="absolute right-6 top-6 z-40 rounded-full bg-red-600 px-5 py-2 text-2xl font-semibold">
          {t("tv.reconnecting")}
        </div>
      )}
    </Stage>
  );
}

/** Whether this page has had a click or key press, which browsers require before playing sound. */
function useUserActivation(): boolean {
  const [active, setActive] = useState(() => navigator.userActivation?.hasBeenActive ?? true);
  useEffect(() => {
    if (active) return;
    const on = () => {
      setActive(true);
      unlockAudio();
    };
    window.addEventListener("pointerdown", on, { once: true });
    window.addEventListener("keydown", on, { once: true });
    return () => {
      window.removeEventListener("pointerdown", on);
      window.removeEventListener("keydown", on);
    };
  }, [active]);
  return active;
}

/** Calm mode and sound effects from admin settings; re-read every minute. Returns the music switch. */
function useTvSettings(): boolean {
  const [music, setMusic] = useState(true);
  useEffect(() => {
    const load = () =>
      api<Settings>("/settings")
        .then((s) => {
          setCalmMode(s.calmMode);
          setSoundsEnabled(s.tvSounds);
          setMusic(s.tvMusic);
        })
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, []);
  return music;
}

/**
 * A quiet looping tune while teams answer a question without its own clip. It
 * stops when answers close, when a team buzzes, and for YouTube/Spotify questions.
 */
function useThinkingMusic(view: TvView | null, enabled: boolean, clockOffset: number) {
  const item = view?.item;
  const on =
    enabled &&
    view?.phase === "item" &&
    item?.kind === "question" &&
    view.step === "answering" &&
    item.answerType !== "rapid_sequence" &&
    item.media?.type !== "youtube" &&
    item.media?.type !== "spotify" &&
    !view.buzz?.current &&
    !view.overlay.scoreboard &&
    !view.overlay.message;
  const key = on ? `${view.sessionId}:${item.cursor}` : null;
  const endsAt = on ? (view.timer?.endsAt ?? null) : null;
  const offset = useRef(clockOffset);
  offset.current = clockOffset;
  useEffect(() => {
    if (!key) return;
    const music = startThinkingMusic();
    // In the last five seconds the tune speeds up, slowly at first: up to 1.6× at zero.
    const timer =
      endsAt === null
        ? undefined
        : window.setInterval(() => {
            const left = endsAt - (Date.now() + offset.current);
            const p = Math.min(1, Math.max(0, 1 - left / FINAL_MS));
            music.setTempo(1 + 0.6 * p * p);
          }, 100);
    return () => {
      clearInterval(timer);
      music.stop();
    };
  }, [key, endsAt]);
}

const FINAL_MS = 5000;

/** Sound effects on game events: a buzz, a wrong buzzer answer, a reveal. */
function useGameSounds(view: TvView | null) {
  const prev = useRef<{ key: string; step: string | null; buzz: number | null; out: number } | null>(null);
  useEffect(() => {
    if (!view) return;
    const key = `${view.sessionId}:${view.item?.cursor ?? -1}`;
    const now = { key, step: view.step, buzz: view.buzz?.current ?? null, out: view.buzz?.lockedOut.length ?? 0 };
    const p = prev.current;
    prev.current = now;
    if (!p || p.key !== key) return; // a new item: nothing to compare with
    if (now.buzz !== null && now.buzz !== p.buzz) sounds.buzz();
    if (now.out > p.out) sounds.wrong();
    if (now.step === "revealed" && p.step !== "revealed") sounds.reveal();
  }, [view]);
}

/** A Spotify clip is part of what's on screen now (question, continuation or slide). */
function spotifyOnScreen(view: TvView | null): boolean {
  const item = view?.item;
  return (
    (item?.kind === "question" && item.media?.type === "spotify") ||
    (item?.kind === "slide" && item.media?.type === "spotify") ||
    view?.continuation?.type === "spotify"
  );
}

/** True when the TV page was opened via a bare IP address (127.0.0.1, 192.168.x.y, …). */
export const openedViaIp = () => /^(\d+\.){3}\d+$|^\[/.test(window.location.hostname);

/**
 * Many music videos refuse to embed on pages served from a bare IP address (YouTube
 * error 150), while the same page via a host name works. On the laptop, localhost
 * is the fix; this offers the switch.
 */
function IpAddressHint({ view }: { view: TvView | null }) {
  const { t } = useTranslation();
  const [hidden, setHidden] = useState(false);
  // Only relevant while a YouTube clip is on screen.
  const item = view?.item;
  const hasYouTube =
    (item?.kind === "question" && item.media?.type === "youtube") ||
    (item?.kind === "slide" && item.media?.type === "youtube") ||
    view?.reveal?.revealMedia?.type === "youtube";
  if (hidden || !hasYouTube || !openedViaIp()) return null;
  const loopback = window.location.hostname.startsWith("127.");
  const target = `${window.location.protocol}//localhost:${window.location.port || "80"}${window.location.pathname}`;
  return (
    <div className="absolute inset-x-0 top-0 z-40 flex items-center gap-6 bg-amber-500 px-10 py-4 text-[26px] font-semibold text-ink-950">
      <span className="flex-1">{loopback ? t("tv.ipHintLoopback") : t("tv.ipHintLan")}</span>
      {loopback && (
        <a href={target} className="rounded-xl bg-ink-950 px-6 py-2 text-white">
          {t("tv.ipHintSwitch")}
        </a>
      )}
      <button type="button" className="px-3 text-[32px]" aria-label={t("common.close")} onClick={() => setHidden(true)}>
        ×
      </button>
    </div>
  );
}

function Centered({ title, hint }: { title: string; hint?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 text-center">
      <p className="font-display text-[160px] leading-none text-gold-400">{t("app.name")}</p>
      <p className="text-[56px] font-semibold">{title}</p>
      {hint && <p className="max-w-[1200px] text-[36px] text-ink-200">{hint}</p>}
    </div>
  );
}
