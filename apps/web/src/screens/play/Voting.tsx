import { useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { parseNumberInput, voteKey, type AnswerValue, type BallotOption, type PublicItem, type TeamView } from "@kwistig/shared";
import { OPTION_COLORS, OPTION_LETTERS, useQuizText } from "../../lib/text";

type Question = Extract<PublicItem, { kind: "question" }>;
type Send = (value: AnswerValue | null) => void;

function useFormatValue(view: TeamView) {
  const { t, i18n } = useTranslation();
  const text = useQuizText(view.quizLang);
  return (item: Question, v: AnswerValue): string => {
    if (item.answerType === "multiple_choice" && typeof v === "number") return `${OPTION_LETTERS[v]}: ${text(item.options?.[v])}`;
    if (typeof v === "boolean") return v ? t("play.true") : t("play.false");
    if (typeof v === "number") return new Intl.NumberFormat(i18n.language === "en" ? "en-GB" : "nl-NL").format(v);
    return v;
  };
}

/** "Sanne, Jip" — with "jij"/"you" for this phone. */
function useVoterNames(view: TeamView) {
  const { t } = useTranslation();
  return (o: BallotOption) => {
    const s = o.voters.map((v) => (v.id === view.me.playerId ? t("play.you") : (v.nickname ?? "?"))).join(", ");
    return s.charAt(0).toLocaleUpperCase() + s.slice(1);
  };
}

/**
 * The team's vote. Every phone votes; the option with the most votes when answers
 * close is the team's answer, and a tie is drawn at random.
 */
export function TeamVote({ item, view, onVote }: { item: Question; view: TeamView; onVote: Send }) {
  const locked = view.step !== "answering";
  return (
    <div className="flex flex-col gap-3">
      {item.answerType === "multiple_choice" || item.answerType === "true_false" ? (
        <ChoiceVote item={item} view={view} locked={locked} onVote={onVote} />
      ) : (
        <ProposalVote item={item} view={view} locked={locked} onVote={onVote} />
      )}
      {locked ? <TeamDecision item={item} view={view} /> : <VoteStatus view={view} />}
    </div>
  );
}

function ChoiceVote({ item, view, locked, onVote }: { item: Question; view: TeamView; locked: boolean; onVote: Send }) {
  const { t } = useTranslation();
  const text = useQuizText(view.quizLang);
  const names = useVoterNames(view);
  const labels = item.answerType === "true_false" ? [t("play.true"), t("play.false")] : (item.options ?? []).map(text);
  const valueOf = (i: number): AnswerValue => (item.answerType === "true_false" ? i === 0 : i);
  const byValue = new Map(view.ballot.map((o) => [voteKey(item.answerType, o.value), o]));
  const decided = view.answer ? voteKey(item.answerType, view.answer.value) : null;

  return (
    <div className={`grid gap-3 ${labels.length > 4 ? "grid-cols-2" : "grid-cols-1"}`}>
      {labels.map((label, i) => {
        const value = valueOf(i);
        const key = voteKey(item.answerType, value);
        const option = byValue.get(key);
        const mine = view.myVote !== null && voteKey(item.answerType, view.myVote) === key;
        const dim = locked ? decided !== key : false;
        return (
          <button
            key={i}
            type="button"
            disabled={locked}
            aria-pressed={mine}
            onClick={() => onVote(mine ? null : value)}
            data-testid={`vote-option-${i}`}
            className={`flex min-h-16 items-center gap-3 rounded-2xl px-4 py-3 text-left text-ink-950 transition active:scale-[0.98] disabled:active:scale-100 ${
              mine ? "ring-4 ring-white" : ""
            } ${dim ? "opacity-40" : ""}`}
            style={{ background: OPTION_COLORS[i] }}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ink-950/25 font-display text-xl text-white">
              {OPTION_LETTERS[i]}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-lg font-bold leading-tight">{label}</span>
              {option && <span className="block truncate text-sm font-medium opacity-80">{names(option)}</span>}
            </span>
            {option && (
              <span className="flex h-9 min-w-9 items-center justify-center rounded-full bg-ink-950/80 px-2 text-lg font-bold text-white" aria-label={t("play.votes", { count: option.count })}>
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Open and number questions: type an answer and press Enter to propose it and vote
 * for it; teammates' proposals appear as options anyone can tap to vote for.
 */
function ProposalVote({ item, view, locked, onVote }: { item: Question; view: TeamView; locked: boolean; onVote: Send }) {
  const { t } = useTranslation();
  const text = useQuizText(view.quizLang);
  const names = useVoterNames(view);
  const format = useFormatValue(view);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const isNumber = item.answerType === "number";
  const unit = text(item.unit);
  const myKey = view.myVote !== null ? voteKey(item.answerType, view.myVote) : null;
  const decided = view.answer ? voteKey(item.answerType, view.answer.value) : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    let value: AnswerValue;
    if (isNumber) {
      const n = parseNumberInput(draft);
      if (n === undefined) {
        setInvalid(true);
        return;
      }
      value = n;
    } else {
      if (!draft.trim()) return;
      value = draft.trim();
    }
    onVote(value);
    setDraft("");
    setInvalid(false);
  };

  return (
    <div className="flex flex-col gap-3">
      {!locked && (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <input
              ref={input}
              className="field py-4 text-xl"
              inputMode={isNumber ? "decimal" : "text"}
              autoComplete="off"
              autoCapitalize={isNumber ? "off" : "sentences"}
              enterKeyHint="send"
              maxLength={200}
              placeholder={isNumber ? t("play.typeNumber") : t("play.typeAnswer")}
              aria-invalid={invalid}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setInvalid(false);
              }}
            />
            {unit && <span className="text-ink-200">{unit}</span>}
            <button type="submit" className="btn-primary px-5 py-4" disabled={!draft.trim()}>
              {t("play.vote")}
            </button>
          </div>
          {invalid && <p className="text-sm text-red-300">{t("play.notANumber")}</p>}
          {view.ballot.length === 0 && <p className="text-sm text-ink-400">{t("play.proposeHint")}</p>}
        </form>
      )}

      {view.ballot.length > 0 && (
        <ul className="flex flex-col gap-2" data-testid="proposals">
          {view.ballot.map((o) => {
            const key = voteKey(item.answerType, o.value);
            const mine = key === myKey;
            const dim = locked && decided !== key;
            return (
              <li key={key}>
                <button
                  type="button"
                  disabled={locked}
                  aria-pressed={mine}
                  onClick={() => onVote(mine ? null : o.value)}
                  className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition active:scale-[0.98] disabled:active:scale-100 ${
                    mine ? "bg-gold-400 text-ink-950" : "bg-ink-800 text-white"
                  } ${dim ? "opacity-40" : ""}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-lg font-bold leading-tight">
                      {format(item, o.value)} {unit}
                    </span>
                    <span className="block truncate text-sm opacity-75">{names(o)}</span>
                  </span>
                  <span className={`flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-lg font-bold ${mine ? "bg-ink-950 text-white" : "bg-white/15"}`}>
                    {o.count}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** While answering: how many phones have voted, and whether it's currently tied. */
function VoteStatus({ view }: { view: TeamView }) {
  const { t } = useTranslation();
  const total = view.ballot.reduce((n, o) => n + o.count, 0);
  const tied = view.ballot.length > 1 && view.ballot[0]!.count === view.ballot[1]!.count;
  return (
    <div className="text-center text-sm text-ink-400" data-testid="vote-status">
      <p>{t("play.votedCount", { count: total, phones: view.team.players.length })}</p>
      {tied && <p className="mt-1 font-semibold text-gold-300">{t("play.tieNow")}</p>}
      {view.myVote !== null && <p className="mt-1">{t("play.tapToRetract")}</p>}
    </div>
  );
}

/** After lock: the team's answer and how it was decided. */
export function TeamDecision({ item, view }: { item: Question; view: TeamView }) {
  const { t } = useTranslation();
  const text = useQuizText(view.quizLang);
  const format = useFormatValue(view);
  const a = view.answer;
  if (!a) {
    return <p className="rounded-xl bg-white/5 py-3 text-center text-ink-200">{t("play.noAnswerGiven")}</p>;
  }
  return (
    <div className="rounded-xl bg-emerald-500/15 px-4 py-3 text-center" data-testid="play-locked">
      <p className="text-sm text-emerald-200">✓ {t("play.teamAnswer")}</p>
      <p className="break-words text-xl font-bold" data-testid="play-team-answer">
        {format(item, a.value)} {text(item.unit)}
      </p>
      <p className="text-sm text-emerald-200/80">
        {a.tieBreak ? t("play.tieBreakDrawn") : t("play.voteSummary", { votes: a.votes, total: a.totalVotes })}
      </p>
    </div>
  );
}
