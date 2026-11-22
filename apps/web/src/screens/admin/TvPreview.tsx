import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { buildRunOrder, previewReveal, publicItem, type Item, type Language, type LocalizedText, type Round, type TvView } from "@kwistig/shared";
import { QuestionView, SlideView } from "../tv/TvItem";
import { SequenceView } from "../tv/TvSequence";
import { Scoreboard } from "../tv/TvScoreboard";

const W = 1920;
const H = 1080;

/** Two example teams so the TV's team row and scoreboard look like the real thing. */
const TEAMS: TvView["teams"] = [
  { id: 1, name: "De Bollen", emoji: "🧠", color: "#3b82f6", photoUrl: null, score: 3, rank: 1 },
  { id: 2, name: "Quizzers", emoji: "🦊", color: "#f97316", photoUrl: null, score: 2, rank: 2 },
];

/**
 * The real TV components, rendered from the item being edited and scaled into
 * the editor. Questions can be previewed as asked or with the answer revealed.
 */
export function TvPreview({ item, round, quizTitle, quizLang }: { item: Item; round: Round; quizTitle: LocalizedText; quizLang: Language }) {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  const [mode, setMode] = useState<"question" | "answer">("question");

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const view = useMemo((): TvView | null => {
    const quiz = { version: 1 as const, title: quizTitle, language: quizLang, rounds: [{ ...round, items: [item] }] };
    const ri = buildRunOrder(quiz)[0];
    if (!ri) return null;
    const revealed = mode === "answer" && item.kind === "question";
    return {
      serverNow: Date.now(),
      phase: "item",
      sessionId: 0,
      joinCode: "",
      quizTitle,
      quizLang,
      teams: TEAMS,
      step: item.kind === "slide" ? "shown" : revealed ? "revealed" : "answering",
      item: publicItem(ri, 10),
      timer: null,
      reveal: revealed ? previewReveal(ri) : null,
      overlay: { scoreboard: false, message: null },
      answered: revealed ? [] : [1],
      totalItems: 1,
      media: null,
      continuation: null,
      sequence: null,
      spotlight: null,
    };
  }, [item, round, quizTitle, quizLang, mode]);

  if (!view) return null;
  const noop = () => undefined;
  let body;
  if (item.kind === "slide") {
    body = item.show === "scoreboard" ? <Scoreboard view={view} /> : <SlideView view={view} sendTv={noop} />;
  } else if (item.answerType === "rapid_sequence") {
    body = <SequenceView view={view} clockOffset={0} />;
  } else {
    body = <QuestionView view={view} clockOffset={0} sendTv={noop} />;
  }

  return (
    <div className="space-y-2" data-testid="tv-preview">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-ink-200">{t("editor.preview")}</span>
        {item.kind === "question" && (
          <div className="ml-auto inline-flex rounded-lg bg-ink-800 p-0.5" role="group">
            {(["question", "answer"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={`rounded-md px-3 py-1 text-xs font-semibold ${mode === m ? "bg-ink-600 text-white" : "text-ink-200"}`}
              >
                {m === "question" ? t("editor.previewQuestion") : t("editor.previewAnswer")}
              </button>
            ))}
          </div>
        )}
      </div>
      <div ref={box} className="relative w-full overflow-hidden rounded-lg border border-ink-700 bg-black" style={{ height: H * scale }}>
        {/* The TV is laid out at 1920×1080 and scaled down; clicks are off so the preview is just a picture. */}
        <div
          className="pointer-events-none absolute left-0 top-0 origin-top-left text-white"
          style={{
            width: W,
            height: H,
            transform: `scale(${scale})`,
            background:
              "radial-gradient(1200px 800px at 15% 10%, #2d2952 0%, transparent 60%), radial-gradient(1000px 700px at 90% 100%, #3b1d4a 0%, transparent 55%), #0d0b1f",
          }}
        >
          {body}
        </div>
      </div>
    </div>
  );
}
