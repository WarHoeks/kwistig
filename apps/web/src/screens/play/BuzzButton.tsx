import { useTranslation } from "react-i18next";
import type { TeamView } from "@kwistig/shared";

/** The buzzer on a team phone: one big button, and whose turn it is. */
export function BuzzButton({ view, onBuzz }: { view: TeamView; onBuzz: () => void }) {
  const { t } = useTranslation();
  const b = view.buzz;
  const me = view.me.teamId;
  const out = !!b?.lockedOut.includes(me);
  const current = b?.current ?? null;
  const other = current !== null && current !== me ? view.teams.find((tm) => tm.id === current) : undefined;

  let status: string;
  if (current === me) status = t("play.buzzYourTurn");
  else if (other) status = t("play.buzzOtherTurn", { team: other.name });
  else if (out) status = t("play.buzzOut");
  else status = t("play.buzzHint");

  const disabled = view.step !== "answering" || current !== null || out;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
      <button
        type="button"
        disabled={disabled}
        onClick={onBuzz}
        data-testid="buzz-button"
        className={`aspect-square w-full max-w-xs rounded-full font-display text-5xl shadow-2xl transition-transform active:scale-95 ${
          current === me ? "bg-emerald-500 text-ink-950" : disabled ? "bg-ink-700 text-ink-400" : "bg-red-600 text-white"
        }`}
      >
        {current === me ? "✓" : "BUZZ!"}
      </button>
      <p className={`text-xl font-semibold ${current === me ? "text-emerald-300" : "text-ink-200"}`} data-testid="buzz-status">
        {status}
      </p>
    </div>
  );
}
