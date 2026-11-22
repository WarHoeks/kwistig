import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { parseNumberInput, type AnswerValue, type PublicItem, type TeamView } from "@kwistig/shared";
import { CountdownBar } from "../../components/Countdown";
import { LanguageToggle } from "../../components/LanguageToggle";
import { TeamAvatar } from "../../components/TeamAvatar";
import { clearPlayer, loadPlayer, squareJpeg } from "../../lib/player";
import { useGameSocket } from "../../lib/socket";
import { formatScore, OPTION_COLORS, OPTION_LETTERS, useQuizText } from "../../lib/text";
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

  const answer = async (value: AnswerValue) => {
    setError(null);
    const ack = await send({ type: "setAnswer", value });
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

  const locked = view.step === "locked";
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

      <AnswerInput item={item} view={view} locked={locked} onAnswer={answer} />

      <ChosenBy view={view} />
      {locked && (
        <p className="rounded-xl bg-emerald-500/15 py-3 text-center text-lg font-semibold text-emerald-200" data-testid="play-locked">
          ✓ {t("play.submitted")}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-xl bg-red-500/15 px-4 py-3 text-red-200">
          {error}
        </p>
      )}
    </div>
  );
}

function AnswerInput({
  item,
  view,
  locked,
  onAnswer,
}: {
  item: Extract<PublicItem, { kind: "question" }>;
  view: TeamView;
  locked: boolean;
  onAnswer: (v: AnswerValue) => void;
}) {
  const { t } = useTranslation();
  const text = useQuizText(view.quizLang);
  const current = view.answer?.value;

  if (item.answerType === "multiple_choice" || item.answerType === "true_false") {
    const labels = item.answerType === "true_false" ? [t("play.true"), t("play.false")] : (item.options ?? []).map(text);
    const valueOf = (i: number): AnswerValue => (item.answerType === "true_false" ? i === 0 : i);
    return (
      <div className={`grid gap-3 ${labels.length > 4 ? "grid-cols-2" : "grid-cols-1"}`}>
        {labels.map((label, i) => {
          const selected = current === valueOf(i);
          return (
            <button
              key={i}
              type="button"
              disabled={locked}
              aria-pressed={selected}
              onClick={() => onAnswer(valueOf(i))}
              className={`flex min-h-16 items-center gap-3 rounded-2xl px-4 py-3 text-left text-lg font-bold text-ink-950 transition-transform active:scale-[0.98] disabled:active:scale-100 ${
                selected ? "ring-4 ring-white" : current !== undefined ? "opacity-50" : ""
              }`}
              style={{ background: OPTION_COLORS[i] }}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ink-950/25 font-display text-xl text-white">
                {OPTION_LETTERS[i]}
              </span>
              <span className="flex-1">{label}</span>
              {selected && <span aria-hidden>✓</span>}
            </button>
          );
        })}
      </div>
    );
  }

  return <TextAnswer kind={item.answerType === "number" ? "number" : "text"} current={current} locked={locked} onAnswer={onAnswer} unit={text(item.unit)} />;
}

/** Text or number field. Shows the team's shared answer and lets anyone change it. */
function TextAnswer({
  kind,
  current,
  locked,
  onAnswer,
  unit,
}: {
  kind: "text" | "number";
  current: AnswerValue | undefined;
  locked: boolean;
  onAnswer: (v: AnswerValue) => void;
  unit: string;
}) {
  const { t, i18n } = useTranslation();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(current === undefined);
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // A teammate's change replaces our view of the answer unless we're typing.
  useEffect(() => {
    if (current !== undefined && document.activeElement !== input.current) setEditing(false);
  }, [current]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (kind === "number") {
      const n = parseNumberInput(draft);
      if (n === undefined) {
        setInvalid(true);
        return;
      }
      onAnswer(n);
    } else {
      if (!draft.trim()) return;
      onAnswer(draft.trim());
    }
    setInvalid(false);
    setEditing(false);
    input.current?.blur();
  };

  const shown =
    current === undefined
      ? ""
      : typeof current === "number"
        ? new Intl.NumberFormat(i18n.language === "en" ? "en-GB" : "nl-NL").format(current)
        : String(current);

  if (!editing || locked) {
    return (
      <div className="rounded-2xl bg-white/5 p-4">
        <p className="text-sm text-ink-400">{t("play.yourAnswer")}</p>
        <p className="break-words text-2xl font-bold" data-testid="play-answer">
          {shown || "—"} {shown && unit}
        </p>
        {!locked && (
          <button
            type="button"
            className="btn-ghost mt-3 w-full"
            onClick={() => {
              setDraft(current === undefined ? "" : String(current));
              setEditing(true);
              setTimeout(() => input.current?.focus(), 0);
            }}
          >
            {t("play.change")}
          </button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <input
          ref={input}
          className="field py-4 text-xl"
          inputMode={kind === "number" ? "decimal" : "text"}
          autoComplete="off"
          autoCapitalize={kind === "number" ? "off" : "sentences"}
          enterKeyHint="send"
          maxLength={200}
          placeholder={kind === "number" ? t("play.typeNumber") : t("play.typeAnswer")}
          aria-invalid={invalid}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setInvalid(false);
          }}
        />
        {unit && <span className="text-ink-200">{unit}</span>}
      </div>
      {invalid && <p className="text-sm text-red-300">{t("play.notANumber")}</p>}
      <button type="submit" className="btn-primary py-4 text-lg" disabled={!draft.trim()}>
        {t("play.submit")}
      </button>
    </form>
  );
}

/** "Sanne koos B" — who in the team set the current answer. */
function ChosenBy({ view }: { view: TeamView }) {
  const { t } = useTranslation();
  const a = view.answer;
  if (!a) return null;
  const isMe = a.byPlayerId === view.me.playerId;
  const name = isMe ? t("play.you") : (a.byNickname ?? t("play.someone"));
  let label = String(a.value);
  if (view.item?.kind === "question" && view.item.answerType === "multiple_choice" && typeof a.value === "number") {
    label = OPTION_LETTERS[a.value] ?? label;
  } else if (typeof a.value === "boolean") {
    label = a.value ? t("play.true") : t("play.false");
  }
  const sentence = t("play.chose", { name });
  return (
    <p className="text-center text-ink-200" data-testid="play-chosen-by">
      {sentence.charAt(0).toLocaleUpperCase() + sentence.slice(1)} <strong className="text-white">{label}</strong>
    </p>
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
      <TeamAvatar team={view.team} size={140} rounded="rounded-3xl" />
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
