import { useTranslation } from "react-i18next";
import type { AnswerValue, HostAnswerView, HostView, Item } from "@kwistig/shared";
import { CountdownBar, CountdownNumber } from "../../components/Countdown";
import { TeamAvatar } from "../../components/TeamAvatar";
import { formatScore, OPTION_LETTERS, useQuizText } from "../../lib/text";
import { useHost } from "./HostScreen";

const PLAYABLE = ["multiple_choice", "true_false", "open", "number", "rapid_sequence", "buzzer"];

/** Play/pause, replay from the start marker and mute for the TV's audio/video, with its live status. */
function MediaControls({ view }: { view: HostView }) {
  const { t } = useTranslation();
  const { send } = useHost();
  const m = view.media;
  if (!m) return null;
  const playing = m.status === "playing";
  return (
    <section className="card space-y-3 p-4" data-testid="host-media">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-ink-200">
          {m.slot === "reveal" ? t("host.revealMedia") : t("host.media")}
        </span>
        <span
          className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-bold ${
            m.status === "playing" ? "bg-emerald-500 text-ink-950" : m.status === "error" ? "bg-red-500 text-white" : "bg-ink-700 text-ink-200"
          }`}
          data-testid="host-media-status"
        >
          {t(`host.mediaStatus.${m.status}`)}
        </span>
      </div>
      {m.status === "error" && (
        <p className="text-sm text-red-300">{t(`tv.mediaErrors.${m.error}`, { defaultValue: t("tv.mediaError") })}</p>
      )}
      <div className="grid grid-cols-3 gap-2">
        <button type="button" className="btn-primary" onClick={() => void send({ type: playing ? "mediaPause" : "mediaPlay" })}>
          {playing ? `❚❚ ${t("host.pause")}` : `▶ ${t("host.play")}`}
        </button>
        <button type="button" className="btn-ghost" onClick={() => void send({ type: "mediaReplay" })}>
          ↺ {t("host.replay")}
        </button>
        <button
          type="button"
          className={`btn-ghost ${m.muted ? "ring-2 ring-gold-400" : ""}`}
          aria-pressed={m.muted}
          onClick={() => void send({ type: "mediaMute", on: !m.muted })}
        >
          {m.muted ? `🔇 ${t("host.unmute")}` : `🔊 ${t("host.mute")}`}
        </button>
      </div>
    </section>
  );
}

/** Buzzer: who pressed first, and the host's verdict. Wrong reopens the buzzer for the others. */
function BuzzerHost({ view }: { view: HostView }) {
  const { t } = useTranslation();
  const { send } = useHost();
  const b = view.buzz;
  const team = b?.current ? view.teamsDetail.find((tm) => tm.id === b.current) : undefined;
  const out = view.teamsDetail.filter((tm) => b?.lockedOut.includes(tm.id));
  return (
    <section className="card space-y-3 p-4" data-testid="host-buzzer">
      {team ? (
        <>
          <div className="flex items-center gap-3">
            <TeamAvatar team={team} size={56} rounded="rounded-xl" />
            <div>
              <p className="text-sm text-ink-400">{t("host.buzzedFirst")}</p>
              <p className="text-2xl font-bold">{team.name}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn bg-emerald-500 py-4 text-lg text-ink-950" onClick={() => void send({ type: "buzzVerdict", verdict: "correct" })}>
              ✓ {t("host.verdict.correct")}
            </button>
            <button type="button" className="btn bg-red-500 py-4 text-lg text-white" onClick={() => void send({ type: "buzzVerdict", verdict: "wrong" })}>
              ✗ {t("host.verdict.wrong")}
            </button>
          </div>
        </>
      ) : (
        <p className="animate-pulse text-lg font-semibold text-gold-300">🔔 {t("host.waitingForBuzz")}</p>
      )}
      {out.length > 0 && <p className="text-sm text-ink-400">{t("host.buzzOut", { teams: out.map((tm) => tm.name).join(", ") })}</p>}
    </section>
  );
}

/** At a flitsreeks reveal: step through the images one by one, or show the grid. */
function SpotlightControls({ view, count }: { view: HostView; count: number }) {
  const { t } = useTranslation();
  const { send } = useHost();
  const cur = view.spotlight;
  return (
    <section className="card flex items-center gap-2 p-3">
      <button type="button" className="btn-ghost btn-sm" disabled={cur === 0} onClick={() => void send({ type: "spotlight", index: cur === null ? 0 : cur - 1 })}>
        ◀
      </button>
      <span className="flex-1 text-center text-sm">{cur === null ? t("host.grid") : `${cur + 1} / ${count}`}</span>
      <button
        type="button"
        className="btn-ghost btn-sm"
        disabled={cur === count - 1}
        onClick={() => void send({ type: "spotlight", index: cur === null ? 0 : cur + 1 })}
      >
        ▶
      </button>
      <button type="button" className="btn-ghost btn-sm" disabled={cur === null} onClick={() => void send({ type: "spotlight", index: null })}>
        {t("host.grid")}
      </button>
    </section>
  );
}

export function HostGame() {
  const { t } = useTranslation();
  const { view, send, clockOffset } = useHost();
  const text = useQuizText(view?.quizLang);
  if (!view) return null;

  const item = view.fullItem;
  const isQuestion = item?.kind === "question";
  const playable = isQuestion && PLAYABLE.includes(item.answerType);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-2 text-sm text-ink-400">
        <span className="font-semibold text-ink-200">{t(`host.phase.${view.phase}`)}</span>
        {view.step && <span>· {t(`host.step.${view.step}`)}</span>}
        {view.item && <span className="ml-auto">{t("host.item", { n: view.item.cursor + 1, total: view.totalItems })}</span>}
      </div>

      {/* Lobby & photos */}
      {(view.phase === "lobby" || view.phase === "photos") && <PreGame view={view} />}

      {/* Current item */}
      {view.phase === "item" && item && (
        <section className="card space-y-3 p-4" data-testid="host-current">
          <p className="text-xs uppercase tracking-widest text-ink-400">
            {view.item && text(view.item.roundTitle)} · {item.kind === "slide" ? t("host.slide") : t(`editor.answerTypes.${item.answerType}`)}
          </p>
          <p className="text-xl font-bold leading-snug">{text(item.kind === "slide" ? item.title : item.prompt)}</p>
          {isQuestion && <CorrectAnswer item={item} view={view} />}
          {isQuestion && item.hostNotes && (
            <p className="rounded-lg bg-gold-400/15 px-3 py-2 text-sm text-gold-300">
              <strong>{t("host.notes")}:</strong> {item.hostNotes}
            </p>
          )}
          {isQuestion && !playable && <p className="text-sm text-ink-400">{t("host.unsupported")}</p>}
        </section>
      )}

      {view.phase === "finished" && (
        <section className="card p-4 text-center">
          <p className="text-2xl font-bold">{t("tv.final")}</p>
        </section>
      )}

      {view.phase === "item" && item?.kind === "question" && item.answerType === "buzzer" && view.step === "answering" && <BuzzerHost view={view} />}

      <PrimaryAction view={view} playable={!!playable} />

      {view.phase === "item" && <MediaControls view={view} />}
      {view.phase === "item" && view.step === "revealed" && item?.kind === "question" && item.answerType === "rapid_sequence" && (
        <SpotlightControls view={view} count={item.images.length} />
      )}

      {/* Timer (a flitsreeks times itself) */}
      {view.phase === "item" && view.step === "answering" && !(item?.kind === "question" && item.answerType === "rapid_sequence") && (
        <section className="card space-y-3 p-4">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-ink-200">{t("host.timer")}</span>
            <CountdownNumber timer={view.timer} clockOffset={clockOffset} className="text-2xl font-bold" />
            <div className="ml-auto flex gap-2">
              {!view.timer && (
                <button type="button" className="btn-ghost btn-sm" onClick={() => void send({ type: "timerStart" })}>
                  {t("host.timerStart")}
                </button>
              )}
              <button type="button" className="btn-ghost btn-sm" onClick={() => void send({ type: "timerAdd", seconds: 15 })}>
                {t("host.timerAdd")}
              </button>
              {view.timer && (
                <button type="button" className="btn-ghost btn-sm" onClick={() => void send({ type: "timerStop" })}>
                  {t("host.timerStop")}
                </button>
              )}
            </div>
          </div>
          <CountdownBar timer={view.timer} clockOffset={clockOffset} className="h-2" />
          <label className="flex items-center gap-2 text-sm text-ink-200">
            <input type="checkbox" className="accent-amber-400" checked={view.autoLock} onChange={(e) => void send({ type: "setAutoLock", on: e.target.checked })} />
            {t("host.autoLock")}
          </label>
        </section>
      )}

      {/* Answers */}
      {view.phase === "item" &&
        playable &&
        view.step !== "shown" &&
        !(view.step === "answering" && item?.kind === "question" && item.answerType === "rapid_sequence") && <Answers view={view} />}

      {/* Navigation */}
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          className="btn-ghost"
          disabled={!(view.phase === "finished" || (view.phase === "item" && (view.item?.cursor ?? 0) > 0))}
          onClick={() => void send({ type: "previous" })}
        >
          ← {t("host.action.previous")}
        </button>
        <button
          type="button"
          className={`btn-ghost ${view.overlay.scoreboard ? "ring-2 ring-gold-400" : ""}`}
          onClick={() => void send({ type: "scoreboard", show: !view.overlay.scoreboard })}
        >
          {view.overlay.scoreboard ? t("host.hideScoreboard") : t("host.showScoreboard")}
        </button>
        <button type="button" className="btn-ghost" disabled={view.phase === "finished"} onClick={() => void send({ type: "next" })}>
          {t("host.action.next")} →
        </button>
      </div>

      {view.nextItem && view.phase !== "finished" && (
        <section className="rounded-xl border border-ink-800 p-3">
          <p className="text-xs uppercase tracking-widest text-ink-400">{t("host.nextUp")}</p>
          <p className="truncate">{text(view.nextItem.item.kind === "slide" ? view.nextItem.item.title : view.nextItem.item.prompt)}</p>
        </section>
      )}

      {(view.phase === "item" || view.phase === "finished") && <RunOrder view={view} />}
    </div>
  );
}

function PreGame({ view }: { view: HostView }) {
  const { t } = useTranslation();
  const missing = view.teamsDetail.filter((tm) => !tm.photoUrl).map((tm) => tm.name);
  return (
    <section className="card space-y-3 p-4">
      <p className="font-semibold">{t("host.teamsCount", { count: view.teamsDetail.length })}</p>
      <ul className="flex flex-wrap gap-2">
        {view.teamsDetail.map((tm) => (
          <li key={tm.id} className="flex items-center gap-2 rounded-full bg-ink-800 py-1 pl-1 pr-3 text-sm">
            <TeamAvatar team={tm} size={28} rounded="rounded-full" />
            {tm.name}
          </li>
        ))}
      </ul>
      {view.phase === "photos" && (
        <p className="text-sm text-ink-200">{missing.length ? t("host.photosMissing", { teams: missing.join(", ") }) : t("host.allPhotos")}</p>
      )}
    </section>
  );
}

/** The one big button that does the next logical step. */
function PrimaryAction({ view, playable }: { view: HostView; playable: boolean }) {
  const { t } = useTranslation();
  const { send } = useHost();
  const big = "btn-primary w-full py-5 text-xl";

  if (view.phase === "lobby") {
    return (
      <div className="grid gap-2">
        <button type="button" className={big} onClick={() => void send({ type: "startPhotos" })}>
          📸 {t("host.action.startPhotos")}
        </button>
        <button type="button" className="btn-ghost w-full" onClick={() => void send({ type: "beginQuiz" })}>
          {t("host.action.skipPhotos")}
        </button>
      </div>
    );
  }
  if (view.phase === "photos") {
    const allIn = view.teamsDetail.every((tm) => tm.photoUrl);
    return (
      <button type="button" className={big} onClick={() => void send({ type: "beginQuiz" })}>
        ▶ {allIn ? t("host.action.beginQuiz") : t("host.action.beginWithoutPhotos")}
      </button>
    );
  }
  if (view.phase !== "item") return null;

  const isLast = view.item ? view.item.cursor === view.totalItems - 1 : false;
  // A continuation clip is loaded and hasn't been played yet.
  const continuationReady = view.media?.slot === "reveal" && view.media.status === "idle";
  const nextLabel = isLast ? t("host.action.finish") : t("host.action.next");

  if (view.item?.kind === "slide" || !playable) {
    return (
      <button type="button" className={big} onClick={() => void send({ type: "next" })}>
        {nextLabel} →
      </button>
    );
  }
  switch (view.step) {
    case "shown": {
      const fi = view.fullItem;
      const rapid = fi?.kind === "question" && fi.answerType === "rapid_sequence";
      // "Play first" clips: start the clip; the question appears when it ends.
      const before = fi?.kind === "question" && fi.answerType !== "rapid_sequence" && fi.media?.play === "before";
      if (before && view.media && (view.media.status === "idle" || view.media.status === "paused")) {
        return (
          <div className="grid gap-2">
            <button type="button" className={big} onClick={() => void send({ type: "mediaPlay" })}>
              ▶ {t("host.action.playFirst")}
            </button>
            <button type="button" className="btn-ghost w-full" onClick={() => void send({ type: "open" })}>
              {t("host.action.open")}
            </button>
          </div>
        );
      }
      // A clip that goes with the question starts together with it (and the timer).
      const withClip = !!view.media && view.media.status === "idle" && fi?.kind === "question" && fi.answerType !== "rapid_sequence" && !!fi.media;
      return (
        <button type="button" className={big} onClick={() => void send({ type: "open" })}>
          ▶ {rapid ? t("host.action.startSequence") : withClip ? t("host.action.openWithClip") : t("host.action.open")}
        </button>
      );
    }
    case "answering":
      return (
        <button type="button" className={`${big} !bg-red-500 !text-white`} onClick={() => void send({ type: "lock" })}>
          ■ {t("host.action.lock")}
        </button>
      );
    case "locked":
      if (continuationReady) {
        return (
          <div className="grid gap-2">
            <button type="button" className={big} onClick={() => void send({ type: "mediaPlay" })}>
              ▶ {t("host.action.playContinuation")}
            </button>
            <button type="button" className="btn-ghost w-full !bg-emerald-600 !text-white" onClick={() => void send({ type: "reveal" })}>
              ★ {t("host.action.reveal")}
            </button>
          </div>
        );
      }
      return (
        <button type="button" className={`${big} !bg-emerald-500`} onClick={() => void send({ type: "reveal" })}>
          ★ {t("host.action.reveal")}
        </button>
      );
    default:
      if (continuationReady) {
        return (
          <div className="grid gap-2">
            <button type="button" className={big} onClick={() => void send({ type: "mediaPlay" })}>
              ▶ {t("host.action.playContinuation")}
            </button>
            <button type="button" className="btn-ghost w-full" onClick={() => void send({ type: "next" })}>
              {nextLabel} →
            </button>
          </div>
        );
      }
      return (
        <button type="button" className={big} onClick={() => void send({ type: "next" })}>
          {nextLabel} →
        </button>
      );
  }
}

function CorrectAnswer({ item, view }: { item: Extract<Item, { kind: "question" }>; view: HostView }) {
  const { t } = useTranslation();
  const text = useQuizText(view.quizLang);
  let shown: string | null = null;
  let extra: string | null = null;
  switch (item.answerType) {
    case "multiple_choice":
      shown = `${OPTION_LETTERS[item.correct]}: ${text(item.options[item.correct])}`;
      break;
    case "true_false":
      shown = item.correct ? t("play.true") : t("play.false");
      break;
    case "open":
      shown = item.acceptedAnswers[0] ?? "";
      if (item.acceptedAnswers.length > 1) extra = `${t("host.accepted")}: ${item.acceptedAnswers.join(" · ")}`;
      break;
    case "number":
      shown = `${item.correct}${item.unit ? ` ${text(item.unit)}` : ""}`;
      if (item.scoring?.mode === "tolerance") extra = `± ${item.scoring.tolerance}`;
      break;
    case "buzzer":
      shown = text(item.answer);
      break;
    case "rapid_sequence":
      shown = `${t("host.yesImages")}: ${item.images.flatMap((img, i) => (img.yes ? [i + 1] : [])).join(", ") || "–"}`;
      break;
  }
  return (
    <div className="rounded-lg bg-emerald-500/15 px-3 py-2" data-testid="host-correct">
      <p className="text-xs uppercase tracking-widest text-emerald-300">{t("host.correctAnswer")}</p>
      <p className="text-lg font-bold text-emerald-100">{shown}</p>
      {extra && <p className="text-sm text-emerald-200/80">{extra}</p>}
    </div>
  );
}

function Answers({ view }: { view: HostView }) {
  const { t, i18n } = useTranslation();
  const { send } = useHost();
  const text = useQuizText(view.quizLang);
  const item = view.fullItem;
  const byTeam = new Map<number, HostAnswerView>(view.answers.map((a) => [a.teamId, a]));
  const ballots = new Map(view.ballots.map((b) => [b.teamId, b.options]));
  const answering = view.step === "answering";
  const canMark = view.step === "locked" || view.step === "revealed";
  const answeredCount = answering ? view.ballots.length : view.answers.length;

  const show = (v: AnswerValue): string => {
    if (item?.kind === "question" && item.answerType === "buzzer") return t("host.buzzed");
    if (item?.kind === "question" && item.answerType === "rapid_sequence" && typeof v === "string") {
      // "10110" against the right answers: show how many images the team got right.
      const right = item.images.filter((img, i) => (v[i] === "1") === img.yes).length;
      return t("host.imagesRight", { right, total: item.images.length });
    }
    if (item?.kind === "question" && item.answerType === "multiple_choice" && typeof v === "number") {
      return `${OPTION_LETTERS[v]}: ${text(item.options[v])}`;
    }
    if (typeof v === "boolean") return v ? t("play.true") : t("play.false");
    if (typeof v === "number") return new Intl.NumberFormat(i18n.language === "en" ? "en-GB" : "nl-NL").format(v);
    return v;
  };

  return (
    <section className="card p-4" data-testid="host-answers">
      <p className="mb-3 text-sm font-semibold text-ink-200">
        {t("host.answered", { count: answeredCount, total: view.teamsDetail.length })}
      </p>
      <ul className="space-y-2">
        {view.teamsDetail.map((team) => {
          const a = answering ? undefined : byTeam.get(team.id);
          const options = ballots.get(team.id) ?? [];
          return (
            <li key={team.id} className="flex items-center gap-3 rounded-lg bg-ink-800/60 p-2" data-testid={`host-answer-${team.id}`}>
              <TeamAvatar team={team} size={36} rounded="rounded-lg" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{team.name}</p>
                {answering ? (
                  // Live tally while teams vote: "C: Amsterdam (2) · A: Rotterdam (1)".
                  <p className={`truncate text-sm ${options.length ? "" : "text-ink-400 italic"}`} data-testid="host-tally">
                    {options.length
                      ? options.map((o) => `${show(o.value)} (${o.count})`).join(" · ")
                      : t("host.noVotes")}
                  </p>
                ) : (
                  <p className={`truncate ${a ? "" : "text-ink-400 italic"}`}>
                    {a ? show(a.value) : t("host.noAnswer")}
                    {a?.match && a.match !== "exact" && (
                      <span className={`ml-2 rounded px-1.5 text-xs ${a.match === "fuzzy" ? "bg-gold-400/25 text-gold-300" : "bg-ink-700 text-ink-200"}`}>
                        {t(`host.match.${a.match}`)}
                      </span>
                    )}
                  </p>
                )}
                {a && (a.tieBreak || a.totalVotes > 0) && (
                  <p className="text-xs text-ink-400">
                    {a.tieBreak ? (
                      <span className="text-gold-300">{t("host.tieBreak")}</span>
                    ) : (
                      t("host.voteSummary", { votes: a.votes, total: a.totalVotes })
                    )}
                  </p>
                )}
              </div>
              {a && canMark ? (
                <div className="flex shrink-0 gap-1" role="group" aria-label={team.name}>
                  {(["correct", "half", "wrong"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={a.verdict === v}
                      aria-label={t(`host.verdict.${v}`)}
                      onClick={() => void send({ type: "mark", teamId: team.id, verdict: v })}
                      className={`h-9 w-9 rounded-lg text-lg font-bold ${
                        a.verdict === v
                          ? v === "correct"
                            ? "bg-emerald-500 text-ink-950"
                            : v === "half"
                              ? "bg-amber-400 text-ink-950"
                              : "bg-red-500 text-white"
                          : "bg-ink-700 text-ink-400"
                      }`}
                    >
                      {v === "correct" ? "✓" : v === "half" ? "½" : "✗"}
                    </button>
                  ))}
                </div>
              ) : null}
              {a && view.step === "revealed" && (
                <span className="w-10 text-right text-sm tabular-nums text-ink-200">+{formatScore(a.points, i18n.language)}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RunOrder({ view }: { view: HostView }) {
  const { t } = useTranslation();
  const { send } = useHost();
  const text = useQuizText(view.quizLang);
  const current = view.item?.cursor;
  return (
    <details className="rounded-xl border border-ink-800">
      <summary className="cursor-pointer px-4 py-3 font-semibold">{t("host.runOrder")}</summary>
      <ol className="max-h-96 overflow-y-auto border-t border-ink-800">
        {view.outline.map((o) => (
          <li key={o.cursor}>
            <button
              type="button"
              onClick={() => void send({ type: "jump", cursor: o.cursor })}
              className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm ${o.cursor === current ? "bg-ink-700" : "hover:bg-ink-800"}`}
            >
              <span className="w-6 text-right tabular-nums text-ink-400">{o.cursor + 1}</span>
              <span className={`h-2 w-2 shrink-0 rounded-full ${o.step === "revealed" ? "bg-emerald-400" : o.step ? "bg-gold-400" : "bg-ink-600"}`} />
              <span className="flex-1 truncate">{text(o.label)}</span>
              <span className="text-xs text-ink-400">
                {o.kind === "slide" ? t("host.slide") : t(`editor.answerTypes.${o.answerType}`)}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </details>
  );
}
