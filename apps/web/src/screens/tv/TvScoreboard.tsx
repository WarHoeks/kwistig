import { useTranslation } from "react-i18next";
import type { TvView } from "@kwistig/shared";
import { TeamAvatar } from "../../components/TeamAvatar";
import { formatScore } from "../../lib/text";

/** Ranked standings, also used as the final result. Rank-change animations come in Phase 5. */
export function Scoreboard({ view, title, final = false }: { view: TvView; title?: string; final?: boolean }) {
  const { t, i18n } = useTranslation();
  const teams = [...view.teams].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  const many = teams.length > 8;
  const rowH = many ? 78 : 104;
  return (
    <div className="flex h-full flex-col px-32 py-14">
      <h1 className="text-center font-display text-[96px] text-gold-400">
        {title ?? (final ? t("tv.final") : t("tv.scoreboard"))}
      </h1>
      <ol className={`mx-auto mt-10 flex w-full max-w-[1400px] flex-col ${many ? "gap-3" : "gap-5"}`}>
        {teams.map((team) => {
          const winner = final && team.rank === 1;
          return (
            <li
              key={team.id}
              className={`flex items-center gap-8 rounded-[28px] px-8 ${winner ? "bg-gold-400 text-ink-950" : "bg-white/5"}`}
              style={{ height: rowH }}
            >
              <span className="w-[90px] text-center font-display text-[56px] tabular-nums">{team.rank}</span>
              <TeamAvatar team={team} size={rowH - 18} />
              <span className="min-w-0 flex-1 truncate text-[52px] font-bold">
                {team.name}
                {winner && <span className="ml-6 text-[44px]">🏆 {t("tv.winner")}</span>}
              </span>
              <span className="font-display text-[64px] tabular-nums">{formatScore(team.score, i18n.language)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
