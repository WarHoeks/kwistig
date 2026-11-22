import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AnswerValue, TeamView } from "@kwistig/shared";
import { CountdownBar } from "../../components/Countdown";
import { LanguageToggle } from "../../components/LanguageToggle";
import { TeamAvatar } from "../../components/TeamAvatar";
import { clearPlayer, loadPlayer, squareJpeg } from "../../lib/player";
import { useGameSocket } from "../../lib/socket";
import { formatScore, useQuizText } from "../../lib/text";
import { TeamDecision, TeamVote } from "./Voting";
import { setLanguage } from "../../i18n";

export function PlayScreen() {
  const { t } = useTranslation();
  const [stored] = useState(loadPlayer);
  const game = useGameSocket<TeamView>(stored ? { role: "player", token: stored.token } : null);
  const view = game.view;

  // Phones start in the quiz language unless the player picked one before.
  const quizLang = view?.quizLang;
  useEffect(() => {
    if (quizLang && !localStorage.getItem("kwistig.lang")) setLanguage(quizLang, false);
  }, [quizLang]);

  useEffect(() => {
    if (game.removed) clearPlayer();
  }, [game.removed]);

  if (!stored || game.removed) {
    const msg = !stored ? t("play.noToken") : game.removed === "removed" ? t("play.removed") : t("play.sessionEnded");
    return (
      <Shell>
        <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
          <p className="text-xl">{msg}</p>
          {stored && game.removed === "removed" && (
            <a className="btn-primary px-6 py-3 text-lg" href={`/join/${stored.code}`}>
              {t("play.rejoin")}
            </a>
          )}
        </div>
      </Shell>
    );
  }

  if (!view) {
    return (
      <Shell>
        <p className="m-auto text-ink-400">{t("common.loading")}</p>
      </Shell>
    );
  }

  return (
    <Shell view={view} connected={game.connected}>
      <PlayBody view={view} send={game.send} clockOffset={game.clockOffset} token={stored.token} />
    </Shell>
  );
}

function Shell({ children, view, connected = true }: { children: React.ReactNode; view?: TeamView; connected?: boolean }) {
  const { t, i18n } = useTranslation();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-6 pt-3">
      <header className="mb-4 flex items-center gap-3">
        {view ? (
          <>
            <TeamAvatar team={view.team} size={44} rounded="rounded-xl" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold leading-tight" data-testid="play-team-name">
                {view.team.name}
              </p>
              <p className="text-xs text-ink-400">
                {formatScore(view.team.score, i18n.language)} · #{view.team.rank}
                {view.me.nickname ? ` · ${view.me.nickname}` : ""}
              </p>
            </div>
          </>
        ) : (
          <span className="flex-1 font-display text-xl text-gold-400">{t("app.name")}</span>
        )}
        {!connected && <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold">{t("play.offline")}</span>}
        <LanguageToggle />
      </header>
      {children}
    </main>
  );
}

function PlayBody({
  view,
  send,
  clockOffset,
  token,
}: {
  view: TeamView;
  send: (i: object) => Promise<{ ok: boolean; error?: string }>;
  clockOffset: number;
  token: string;
}) {
  const { t, i18n } = useTranslation();
  const text = useQuizText(view.quizLang);
  const [error, setError] = useState<string | null>(null);

  /** Vote for a value, or take this phone's vote back with null. */
  const answer = async (value: AnswerValue | null) => {
    setError(null);
    const ack = await send(value === null ? { type: "retractVote" } : { type: "vote", value });
    if (!ack.ok) setError(t(`game.errors.${ack.error}`, { defaultValue: t("errors.generic") }));
  };

  if (view.phase === "lobby") {
    return (
      <Centered>
        <TeamAvatar team={view.team} size={160} rounded="rounded-3xl" />
        <p className="text-ink-200">{t("play.inTeam")}</p>
        <p className="text-3xl font-bold">{view.team.name}</p>
        <Teammates view={view} />
        <p className="mt-4 animate-pulse text-ink-400">{t("play.waitStart")}</p>
      </Centered>
    );
  }

  if (view.phase === "photos") return <PhotoStep view={view} token={token} />;

  if (view.phase === "finished") {
    return (
      <Centered>
        <TeamAvatar team={view.team} size={160} rounded="rounded-3xl" />
        <p className="text-lg text-ink-200">{t("play.finished")}</p>
        <p className="font-display text-7xl text-gold-400">#{view.team.rank}</p>
        <p className="text-xl">
          {t("play.score")}: {formatScore(view.team.score, i18n.language)}
        </p>
      </Centered>
    );
  }

  const item = view.item;
  if (!item || item.kind === "slide" || view.step === "shown") {
    return (
      <Centered>
        <p className="text-6xl" aria-hidden>
          📺
        </p>
        <p className="text-2xl font-bold">{t("play.lookAtTv")}</p>
        {item?.kind === "question" && <p className="text-ink-400">{t("play.waitOpen")}</p>}
      </Centered>
    );
  }

  if (view.step === "revealed") return <Result view={view} />;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-baseline justify-between text-sm text-ink-400">
        <span>{text(item.roundTitle)}</span>
        <span>
          {item.questionNumber} / {item.questionCount}
        </span>
      </div>
      {view.step === "answering" && <CountdownBar timer={view.timer} clockOffset={clockOffset} className="h-3" />}
      {item.answerType === "open" && <p className="text-xl font-semibold">{text(item.prompt)}</p>}

      <TeamVote item={item} view={view} onVote={(v) => void answer(v)} />
      {error && (
        <p role="alert" className="rounded-xl bg-red-500/15 px-4 py-3 text-red-200">
          {error}
        </p>
      )}
    </div>
  );
}

function Result({ view }: { view: TeamView }) {
  const { t, i18n } = useTranslation();
  const r = view.result;
  const verdict = view.answer ? (r?.verdict ?? "wrong") : null;
  const style =
    verdict === "correct" ? "bg-emerald-500 text-ink-950" : verdict === "half" ? "bg-amber-400 text-ink-950" : "bg-red-500/80";
  return (
    <Centered>
      <div className={`w-full rounded-3xl px-6 py-8 ${style}`} data-testid="play-result" data-verdict={verdict ?? "none"}>
        <p className="font-display text-4xl">
          {verdict === "correct" ? t("play.correct") : verdict === "half" ? t("play.half") : verdict === "wrong" ? t("play.wrong") : t("play.noAnswerGiven")}
        </p>
        {r && r.points > 0 && <p className="mt-2 text-2xl font-bold">{t("play.pointsEarned", { points: formatScore(r.points, i18n.language) })}</p>}
      </div>
      {view.answer && view.item?.kind === "question" && (
        <div className="w-full">
          <TeamDecision item={view.item} view={view} />
        </div>
      )}
      <TeamAvatar team={view.team} size={120} rounded="rounded-3xl" />
      <div className="grid w-full grid-cols-2 gap-3 text-center">
        <div className="card p-4">
          <p className="text-sm text-ink-400">{t("play.score")}</p>
          <p className="text-3xl font-bold" data-testid="play-score">
            {formatScore(view.team.score, i18n.language)}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-ink-400">{t("play.rank")}</p>
          <p className="text-3xl font-bold">{t("play.rankOf", { rank: view.team.rank, count: view.teams.length })}</p>
        </div>
      </div>
    </Centered>
  );
}

function PhotoStep({ view, token }: { view: TeamView; token: string }) {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );

  const pick = async (file: File) => {
    setError(null);
    try {
      const blob = await squareJpeg(file);
      setPreview({ blob, url: URL.createObjectURL(blob) });
    } catch {
      setError(t("game.errors.invalid_photo"));
    }
  };

  const upload = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/play/photo", {
        method: "POST",
        headers: { "content-type": "image/jpeg", "x-kwistig-token": token },
        body: preview.blob,
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "invalid_photo");
      setPreview(null);
    } catch (err) {
      setError(t(`game.errors.${(err as Error).message}`, { defaultValue: t("errors.generic") }));
    } finally {
      setBusy(false);
    }
  };

  const openCamera = () => fileInput.current?.click();

  return (
    <Centered>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        data-testid="photo-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pick(f);
          e.target.value = "";
        }}
      />
      {preview ? (
        <>
          <img src={preview.url} alt="" className="aspect-square w-full rounded-3xl object-cover" />
          <div className="grid w-full grid-cols-2 gap-3">
            <button type="button" className="btn-ghost py-4" onClick={openCamera} disabled={busy}>
              {t("play.retake")}
            </button>
            <button type="button" className="btn-primary py-4" onClick={() => void upload()} disabled={busy}>
              {busy ? t("play.uploading") : t("play.usePhoto")}
            </button>
          </div>
        </>
      ) : view.team.photoUrl ? (
        <>
          <img src={view.team.photoUrl} alt={view.team.name} className="aspect-square w-full rounded-3xl object-cover" />
          <p className="text-lg">{t("play.photoDone")}</p>
          <button type="button" className="btn-ghost w-full py-3" onClick={openCamera}>
            {t("play.retake")}
          </button>
        </>
      ) : (
        <>
          <p className="text-7xl" aria-hidden>
            📸
          </p>
          <p className="text-2xl font-bold">{t("play.photoTitle")}</p>
          <p className="text-ink-200">{t("play.photoHint")}</p>
          <button type="button" className="btn-primary w-full py-5 text-xl" onClick={openCamera}>
            {t("play.takePhoto")}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
    </Centered>
  );
}

function Teammates({ view }: { view: TeamView }) {
  const { t } = useTranslation();
  const names = view.team.players.map((p) => (p.id === view.me.playerId ? `${p.nickname ?? "?"} (${t("play.you")})` : (p.nickname ?? "?")));
  if (names.length < 2) return null;
  return (
    <p className="text-sm text-ink-400">
      {t("play.teammates")}: {names.join(", ")}
    </p>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">{children}</div>;
}
