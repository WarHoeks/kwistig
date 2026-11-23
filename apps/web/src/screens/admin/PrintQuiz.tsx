import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { youTubeId, type Item, type Media, type Quiz } from "@kwistig/shared";
import { api, errorKey } from "../../lib/api";
import { formatScore, OPTION_LETTERS, useQuizText } from "../../lib/text";

type Loaded = Quiz & { id: number };

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * A printable answer sheet for the host: every question with its answer, host
 * notes and media cues. Black on white; the admin header is hidden when printing.
 */
export function PrintQuiz() {
  const { t, i18n } = useTranslation();
  const { id } = useParams();
  const [quiz, setQuiz] = useState<Loaded>();
  const [error, setError] = useState<string>();
  const [withAnswers, setWithAnswers] = useState(true);
  const text = useQuizText(quiz?.language);

  useEffect(() => {
    api<Loaded>(`/quizzes/${id}`)
      .then(setQuiz)
      .catch((err) => setError(t(errorKey(err))));
  }, [id, t]);

  useEffect(() => {
    if (quiz) document.title = `${text(quiz.title)} · ${t("print.title")}`;
    return () => {
      document.title = "Kwistig";
    };
  }, [quiz, text, t]);

  if (error) return <p className="p-6 text-red-300">{error}</p>;
  if (!quiz) return <p className="p-6 text-ink-400">{t("common.loading")}</p>;

  const num = (n: number) => formatScore(n, i18n.language);

  const mediaCue = (m: Media, label: string) => {
    const range =
      "startSec" in m && (m.startSec !== undefined || m.endSec !== undefined)
        ? ` ${mmss(m.startSec ?? 0)}–${m.endSec !== undefined ? mmss(m.endSec) : "…"}`
        : "";
    const when = m.play === "before" ? ` · ${t("print.playBefore")}` : "";
    const what =
      m.type === "youtube"
        ? `YouTube ${youTubeId(m.videoId)}`
        : m.type === "spotify"
          ? `Spotify ${m.uri}`
          : m.type === "news"
            ? `${t("print.news")} ${m.url}${m.blankWord ? ` (${t("print.blank")}: ${m.blankWord})` : ""}`
            : `${t("print.image")}${m.reveal && m.reveal !== "none" ? ` (${m.reveal})` : ""}`;
    return (
      <p className="text-xs text-neutral-600">
        <span className="font-semibold">{label}:</span> {what}
        {range}
        {when}
      </p>
    );
  };

  const answer = (item: Extract<Item, { kind: "question" }>) => {
    switch (item.answerType) {
      case "multiple_choice":
        return null; // marked in the option list
      case "true_false":
        return t(item.correct ? "tv.true" : "tv.false");
      case "open":
        return item.acceptedAnswers.join(" · ");
      case "number": {
        const unit = item.unit ? ` ${text(item.unit)}` : "";
        const tol = item.scoring?.mode === "tolerance" ? ` (± ${num(item.scoring.tolerance)})` : ` (${t("print.closest")})`;
        return `${num(item.correct)}${unit}${tol}`;
      }
      case "buzzer":
        return text(item.answer);
      case "rapid_sequence":
        return null; // listed per image
    }
  };

  let qn = 0;
  return (
    <main className="print-sheet mx-auto max-w-4xl bg-white px-8 py-6 text-neutral-900 print:max-w-none print:p-0">
      <div className="mb-6 flex flex-wrap items-center gap-3 print:hidden">
        <Link to={`/admin/quiz/${quiz.id}`} className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100">
          ← {t("common.back")}
        </Link>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={withAnswers} onChange={(e) => setWithAnswers(e.target.checked)} />
          {t("print.withAnswers")}
        </label>
        <button
          type="button"
          className="ml-auto rounded bg-neutral-900 px-4 py-1.5 text-sm font-semibold text-white"
          onClick={() => window.print()}
          data-testid="print-button"
        >
          {t("print.print")}
        </button>
      </div>

      <header className="mb-6 border-b-2 border-neutral-900 pb-3">
        <h1 className="text-3xl font-bold">{text(quiz.title)}</h1>
        {quiz.description && <p className="mt-1 text-neutral-600">{text(quiz.description)}</p>}
        <p className="mt-1 text-sm text-neutral-500">{withAnswers ? t("print.hostCopy") : t("print.questionsOnly")}</p>
      </header>

      {quiz.rounds.map((round, r) => (
        <section key={r} className="mb-8 break-inside-avoid-page">
          <h2 className="mb-3 bg-neutral-900 px-3 py-1.5 text-lg font-bold text-white print:bg-neutral-200 print:text-neutral-900">
            {text(round.title) || t("editor.round", { n: r + 1 })}
          </h2>
          <ol className="space-y-4">
            {round.items.map((item, i) => {
              if (item.kind === "slide") {
                return (
                  <li key={i} className="border-l-4 border-neutral-300 pl-3 text-sm text-neutral-600">
                    <span className="font-semibold uppercase">{t("editor.kind.slide")}</span> · {text(item.title)}
                    {item.media && mediaCue(item.media, t("print.media"))}
                  </li>
                );
              }
              qn += 1;
              const points = ("points" in item ? item.points : undefined) ?? round.defaults?.points ?? 1;
              const time = ("timeLimitSec" in item ? item.timeLimitSec : undefined) ?? round.defaults?.timeLimitSec;
              const ans = withAnswers ? answer(item) : null;
              return (
                <li key={i} className="break-inside-avoid" data-testid="print-question">
                  <div className="flex items-baseline gap-3">
                    <span className="w-8 shrink-0 text-right text-lg font-bold">{qn}.</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{text(item.prompt)}</p>
                      <p className="text-xs text-neutral-500">
                        {t(`editor.answerTypes.${item.answerType}`)} · {t("tv.points", { count: points })}
                        {time ? ` · ${time} s` : ""}
                      </p>
                      {item.answerType === "multiple_choice" && (
                        <ul className="mt-1 grid gap-x-6 sm:grid-cols-2">
                          {item.options.map((o, k) => {
                            const right = withAnswers && k === item.correct;
                            return (
                              <li key={k} className={right ? "font-bold" : ""}>
                                {OPTION_LETTERS[k]}. {text(o)} {right && "✓"}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {item.answerType === "rapid_sequence" && (
                        <ol className="mt-1 text-sm">
                          {item.images.map((img, k) => (
                            <li key={k}>
                              {k + 1}. {img.caption ? text(img.caption) : t("print.image")}
                              {withAnswers && ` — ${img.yes ? t("tv.yes") : t("tv.no")}`}
                            </li>
                          ))}
                        </ol>
                      )}
                      {ans !== null && (
                        <p className="mt-1" data-testid="print-answer">
                          <span className="font-semibold">{t("tv.answer")}:</span> {ans}
                        </p>
                      )}
                      {withAnswers && item.explanation && <p className="text-sm italic text-neutral-600">{text(item.explanation)}</p>}
                      {withAnswers && item.hostNotes && (
                        <p className="mt-1 rounded bg-amber-100 px-2 py-1 text-sm">
                          <span className="font-semibold">{t("print.hostNotes")}:</span> {item.hostNotes}
                        </p>
                      )}
                      {item.answerType !== "rapid_sequence" && item.media && mediaCue(item.media, t("print.media"))}
                      {withAnswers && item.answerType !== "rapid_sequence" && item.revealMedia && mediaCue(item.revealMedia, t("print.revealMedia"))}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </main>
  );
}
