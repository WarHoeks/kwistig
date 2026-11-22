import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { isIdle, type ServerView, type TvJoinInfo, type TvView } from "@kwistig/shared";
import { PinGate } from "../../components/PinGate";
import { Stage } from "../../components/Stage";
import { api } from "../../lib/api";
import { useGameSocket } from "../../lib/socket";
import { setLanguage } from "../../i18n";
import { useQuizText } from "../../lib/text";
import { Lobby, PhotoGrid } from "./TvLobby";
import { QuestionView, SlideView } from "./TvItem";
import { Scoreboard } from "./TvScoreboard";

export function TvScreen() {
  return <PinGate>{() => <TvLive />}</PinGate>;
}

function TvLive() {
  const { t } = useTranslation();
  const { view, connected, clockOffset } = useGameSocket<ServerView<TvView>>({ role: "tv" });
  const live = view && !isIdle(view) ? view : null;
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
    body = live.item.show === "scoreboard" ? <Scoreboard view={live} title={text(live.item.title)} /> : <SlideView view={live} />;
  } else {
    body = <QuestionView view={live} clockOffset={clockOffset} />;
  }

  const message = live?.overlay.message;
  const showScoreboard = live?.overlay.scoreboard && live.phase !== "finished";

  return (
    <Stage>
      {body}
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
