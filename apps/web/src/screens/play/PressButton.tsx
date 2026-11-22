import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PublicItem, TeamView } from "@kwistig/shared";
import { useNow } from "../../lib/socket";
import { useQuizText } from "../../lib/text";
import { sequencePosition } from "../tv/TvSequence";

type Question = Extract<PublicItem, { kind: "question" }>;

/**
 * The flitsreeks button. The server decides which image a press counts for (by
 * its own receive time); the phone only shows where the sequence is and whether
 * the team already pressed on the current image.
 */
export function PressButton({
  item,
  view,
  clockOffset,
  onPress,
}: {
  item: Question;
  view: TeamView;
  clockOffset: number;
  onPress: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const text = useQuizText(view.quizLang);
  const seq = view.sequence;
  const now = useNow(!!seq && view.step === "answering") + clockOffset;
  const [flash, setFlash] = useState(0);

  if (!seq || view.step !== "answering") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <p className="text-2xl font-bold">{view.step === "locked" ? t("play.sequenceDone") : t("play.lookAtTv")}</p>
        {view.step === "locked" && <p className="text-ink-200">{t("play.pressedCount", { count: view.pressed.length })}</p>}
      </div>
    );
  }

  const pos = sequencePosition(seq, now);
  const pressedNow = pos.phase === "running" && view.pressed.includes(pos.index);
  const disabled = pos.phase !== "running" || pressedNow;

  return (
    <div className="flex flex-1 flex-col items-center gap-4">
      <p className="text-center text-sm text-ink-400" data-testid="press-status">
        {pos.phase === "countdown" ? t("play.sequenceStartsIn", { n: pos.countdown }) : pos.phase === "running" ? `${pos.index + 1} / ${seq.count}` : t("play.sequenceDone")}
      </p>
      <button
        type="button"
        disabled={disabled}
        data-testid="press-button"
        onClick={async () => {
          if (await onPress()) setFlash((n) => n + 1);
        }}
        className={`flex aspect-square w-full max-w-sm items-center justify-center rounded-full font-display text-4xl shadow-2xl transition-transform active:scale-95 ${
          pressedNow ? "bg-emerald-500 text-ink-950" : disabled ? "bg-ink-700 text-ink-400" : "bg-gold-400 text-ink-950"
        }`}
        key={flash}
      >
        {pressedNow ? `✓ ${t("play.pressed")}` : text(item.sequence?.buttonLabel)}
      </button>
      <p className="text-center text-sm text-ink-400">{t("play.pressHint")}</p>
    </div>
  );
}
