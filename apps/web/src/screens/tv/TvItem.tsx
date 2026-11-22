import { useTranslation } from "react-i18next";
import type { AnswerValue, MediaPlayback, PublicItem, PublicMedia, TvView } from "@kwistig/shared";
import { CountdownBar, CountdownNumber } from "../../components/Countdown";
import { Markdown } from "../../components/Markdown";
import { TvMediaPanel, useRevealProgress } from "../../components/media/TvMedia";
import { YouTubePlayer } from "../../components/media/YouTubePlayer";
import { TeamAvatar } from "../../components/TeamAvatar";
import { formatScore, OPTION_COLORS, OPTION_LETTERS, useQuizText } from "../../lib/text";

type Question = Extract<PublicItem, { kind: "question" }>;

/** Sends TV playback reports (ended/error) to the server. */
export type SendTv = (intent: { type: "mediaEnded"; seq: number } | { type: "mediaError"; seq: number; code: string }) => void;

/** Renders a media item, mounting the YouTube player for video media. */
function MediaSlot({
  media,
  playback,
  progress,
  sendTv,
  className,
  headline,
}: {
  media: PublicMedia;
  playback: MediaPlayback | null;
  progress: number;
  sendTv: SendTv;
  className: string;
  headline?: string;
}) {
  const shown = media.type === "news" && headline ? { ...media, headline } : media;
  return (
    <TvMediaPanel
      media={shown}
      progress={progress}
      className={className}
      playerSlot={
        media.type === "youtube" ? (
          <YouTubePlayer
            media={media}
            playback={playback}
            onEnded={(seq) => sendTv({ type: "mediaEnded", seq })}
            onError={(seq, code) => sendTv({ type: "mediaError", seq, code })}
          />
        ) : undefined
      }
    />
  );
}

export function SlideView({ view, sendTv }: { view: TvView; sendTv: SendTv }) {
  const text = useQuizText(view.quizLang);
  const item = view.item as Extract<PublicItem, { kind: "slide" }>;
  const bg = item.background;
  const style = bg ? ("color" in bg ? { background: bg.color } : { backgroundImage: `linear-gradient(rgba(13,11,31,.55),rgba(13,11,31,.75)), url("${bg.image}")`, backgroundSize: "cover", backgroundPosition: "center" }) : undefined;
  return (
    <div className="flex h-full items-center gap-16 px-32" style={style}>
      <div className="flex min-w-0 flex-1 flex-col items-center text-center">
        <p className="text-[36px] font-semibold uppercase tracking-[0.2em] text-gold-300/80">{text(item.roundTitle)}</p>
        <h1 className="mt-6 font-display text-[128px] leading-[1.05]">{text(item.title)}</h1>
        {item.body && <Markdown text={text(item.body)} className="mt-10 max-w-[1500px] text-[52px] leading-snug text-ink-200 [&_strong]:text-white" />}
        {item.countdownSec && <p className="mt-12 text-[48px] text-gold-300">⏱ {Math.round(item.countdownSec / 60)} min</p>}
      </div>
      {item.media && (
        <MediaSlot media={item.media} playback={view.media} progress={1} sendTv={sendTv} className="h-[720px] w-[900px] shrink-0" />
      )}
    </div>
  );
}

export function QuestionView({ view, clockOffset, sendTv }: { view: TvView; clockOffset: number; sendTv: SendTv }) {
  const { t, i18n } = useTranslation();
  const text = useQuizText(view.quizLang);
  const q = view.item as Question;
  const reveal = view.reveal;
  const answering = view.step === "answering";
  const progress = useRevealProgress(view.step, view.timer, clockOffset);

  // At reveal the reveal media (if any) replaces the question media once the host plays it.
  const useReveal = !!reveal?.revealMedia && view.media?.slot === "reveal";
  const media = useReveal ? reveal!.revealMedia! : q.media;
  const playback = view.media && view.media.slot === (useReveal ? "reveal" : "question") ? view.media : null;
  // "before": the clip or image fills the screen until it ends or the host opens the question.
  const before = q.media?.play === "before" && view.step === "shown" && view.media?.status !== "ended";

  if (before && q.media) {
    return (
      <div className="flex h-full flex-col px-20 pb-10 pt-14">
        <Header view={view} q={q} clockOffset={clockOffset} />
        <MediaSlot media={q.media} playback={playback} progress={1} sendTv={sendTv} className="mt-10 min-h-0 flex-1" />
      </div>
    );
  }

  const answers = (
    <>
      {q.answerType === "multiple_choice" && q.options && (
        <Options options={q.options.map(text)} correct={reveal ? (reveal.correct as number) : null} compact={!!media} />
      )}
      {q.answerType === "true_false" && (
        <Options options={[t("tv.true"), t("tv.false")]} correct={reveal ? (reveal.correct ? 0 : 1) : null} compact={!!media} />
      )}
      {(q.answerType === "open" || q.answerType === "number") && reveal && (
        <div className="inline-block animate-[pop_400ms_ease-out] rounded-[40px] bg-emerald-500 px-16 py-10 text-ink-950">
          <p className="text-[36px] font-semibold uppercase tracking-[0.15em]">{t("tv.answer")}</p>
          <p className={`font-display leading-none ${media ? "text-[84px]" : "text-[110px]"}`}>
            {formatAnswer(reveal.correct, i18n.language)}
            {q.unit ? ` ${text(q.unit)}` : ""}
          </p>
        </div>
      )}
      {(q.answerType === "open" || q.answerType === "number") && !reveal && (
        <p className="text-[52px] text-ink-200">
          {view.step === "answering" ? t("tv.answerOnPhone") : view.step === "locked" ? t("tv.locked") : ""}
        </p>
      )}
      {reveal?.explanation && <p className="mt-10 max-w-[1600px] text-[44px] leading-snug text-ink-200">{text(reveal.explanation)}</p>}
    </>
  );

  return (
    <div className="flex h-full flex-col px-20 pb-10 pt-14">
      <Header view={view} q={q} clockOffset={clockOffset} />

      <h1
        className={`mt-8 font-display leading-[1.1] ${media ? (text(q.prompt).length > 70 ? "text-[60px]" : "text-[76px]") : text(q.prompt).length > 90 ? "text-[76px]" : "text-[96px]"}`}
      >
        {text(q.prompt)}
      </h1>

      {media ? (
        <div className="mt-8 flex min-h-0 flex-1 gap-12">
          <MediaSlot
            media={media}
            playback={playback}
            progress={progress}
            sendTv={sendTv}
            className="h-full w-[1000px] shrink-0"
            {...(reveal?.headline ? { headline: reveal.headline } : {})}
          />
          <div className="min-w-0 flex-1 overflow-hidden">{answers}</div>
        </div>
      ) : (
        <div className="mt-12 flex-1">{answers}</div>
      )}

      <div className="mt-6">
        <TeamRow view={view} />
      </div>
      {answering && <CountdownBar timer={view.timer} clockOffset={clockOffset} className="mt-6 h-5" />}
    </div>
  );
}

function Header({ view, q, clockOffset }: { view: TvView; q: Question; clockOffset: number }) {
  const { t } = useTranslation();
  const text = useQuizText(view.quizLang);
  return (
    <div className="flex items-center gap-8 text-[36px] font-semibold text-ink-200">
      <span className="uppercase tracking-[0.15em] text-gold-300/90">{text(q.roundTitle)}</span>
      <span className="ml-auto">{t("tv.question", { n: q.questionNumber, total: q.questionCount })}</span>
      <span className="rounded-full bg-white/10 px-6 py-1">{t("tv.points", { count: q.points })}</span>
      {view.step === "answering" && view.timer && (
        <CountdownNumber timer={view.timer} clockOffset={clockOffset} className="w-[110px] text-right text-[64px] font-bold text-white" />
      )}
    </div>
  );
}

function formatAnswer(v: AnswerValue, lang: string): string {
  if (typeof v === "number") return new Intl.NumberFormat(lang === "en" ? "en-GB" : "nl-NL").format(v);
  return String(v);
}

/** Answer options; `compact` stacks them in one column next to media. */
function Options({ options, correct, compact = false }: { options: string[]; correct: number | null; compact?: boolean }) {
  const cols = compact ? 1 : options.length <= 4 ? 2 : 3;
  return (
    <ul className={`grid ${compact ? "gap-5" : "gap-8"}`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {options.map((label, i) => {
        const isCorrect = correct === i;
        const dim = correct !== null && !isCorrect;
        return (
          <li
            key={i}
            className={`flex items-center rounded-[32px] transition-all duration-500 ${compact ? "gap-6 px-8 py-5" : "gap-8 px-10 py-8"} ${
              isCorrect ? "scale-[1.03] ring-8 ring-white" : ""
            } ${dim ? "opacity-25" : ""}`}
            style={{ background: OPTION_COLORS[i] }}
          >
            <span
              className={`flex shrink-0 items-center justify-center rounded-2xl bg-ink-950/25 font-display text-white ${
                compact ? "h-[76px] w-[76px] text-[48px]" : "h-[96px] w-[96px] text-[64px]"
              }`}
            >
              {OPTION_LETTERS[i]}
            </span>
            <span className={`font-bold leading-tight text-ink-950 ${compact ? "text-[44px]" : "text-[56px]"}`}>{label}</span>
            {isCorrect && <span className="ml-auto text-[72px]">✓</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** Team chips: light up when a team has answered; show right/wrong and points at reveal. */
function TeamRow({ view }: { view: TvView }) {
  const { i18n } = useTranslation();
  const answered = new Set(view.answered);
  const results = new Map(view.reveal?.results.map((r) => [r.teamId, r]));
  return (
    <ul className="flex flex-wrap gap-4">
      {view.teams.map((team) => {
        const r = results.get(team.id);
        const has = answered.has(team.id);
        const state = r ? (r.verdict === "correct" ? "right" : r.verdict === "half" ? "half" : "wrong") : has ? "in" : "out";
        return (
          <li
            key={team.id}
            className={`flex items-center gap-4 rounded-full py-2 pl-2 pr-7 text-[34px] font-semibold transition-all duration-300 ${
              state === "out" ? "bg-white/5 text-ink-400 opacity-60" : ""
            } ${state === "in" ? "bg-white/15" : ""} ${state === "right" ? "bg-emerald-500 text-ink-950" : ""} ${
              state === "half" ? "bg-amber-400 text-ink-950" : ""
            } ${state === "wrong" ? "bg-red-500/80" : ""}`}
            data-testid={`tv-team-${team.id}`}
            data-state={state}
          >
            <TeamAvatar team={team} size={64} rounded="rounded-full" />
            <span className="max-w-[320px] truncate">{team.name}</span>
            {r && r.points > 0 && <span>+{formatScore(r.points, i18n.language)}</span>}
            {state === "in" && <span aria-hidden>✓</span>}
          </li>
        );
      })}
    </ul>
  );
}
