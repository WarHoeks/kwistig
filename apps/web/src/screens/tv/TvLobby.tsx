import { useTranslation } from "react-i18next";
import type { TvJoinInfo, TvView } from "@kwistig/shared";
import { TeamAvatar } from "../../components/TeamAvatar";
import { useQuizText } from "../../lib/text";

export function Lobby({ view, join }: { view: TvView; join: TvJoinInfo | null }) {
  const { t } = useTranslation();
  const text = useQuizText(view.quizLang);
  return (
    <div className="flex h-full gap-16 p-20">
      <div className="flex w-[720px] shrink-0 flex-col">
        <p className="text-[40px] font-semibold uppercase tracking-[0.2em] text-gold-400">{t("tv.joinTitle")}</p>
        <h1 className="mt-4 font-display text-[88px] leading-[1.05]">{text(view.quizTitle)}</h1>
        {join?.qrSvg ? (
          <>
            <img
              className="mt-12 w-[440px] rounded-3xl bg-white p-6"
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(join.qrSvg)}`}
              alt={join.joinUrl ?? ""}
              data-testid="join-qr"
            />
            <p className="mt-8 text-[34px] text-ink-200">{t("tv.orGoTo")}</p>
            <p className="whitespace-nowrap font-mono text-[40px] font-semibold tracking-tight" data-testid="join-url">
              {join.joinUrl?.replace(/^https?:\/\//, "")}
            </p>
          </>
        ) : (
          <div className="mt-12 rounded-3xl border-4 border-dashed border-red-400/70 bg-red-500/10 p-10">
            <p className="text-[44px] font-bold text-red-200">{t("tv.noJoinUrl")}</p>
            <p className="mt-4 text-[30px] leading-snug text-red-100">{t("tv.noJoinUrlHelp")}</p>
            <p className="mt-6 text-[34px]">
              {t("tv.code")}: <span className="font-mono font-bold tracking-[0.2em]">{view.joinCode}</span>
            </p>
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <p className="text-[40px] font-semibold text-ink-200">{t("tv.teamsJoined", { count: view.teams.length })}</p>
        {view.teams.length === 0 ? (
          <p className="mt-16 text-[48px] text-ink-400">{t("tv.noTeams")}</p>
        ) : (
          <ul className="mt-8 grid grid-cols-2 gap-6">
            {view.teams.map((team) => (
              <li
                key={team.id}
                className="flex animate-[pop_400ms_ease-out] items-center gap-6 rounded-3xl bg-white/5 p-5"
                style={{ borderLeft: `12px solid ${team.color}` }}
              >
                <TeamAvatar team={team} size={96} />
                <span className="truncate text-[48px] font-bold">{team.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function PhotoGrid({ view }: { view: TvView }) {
  const { t } = useTranslation();
  const n = view.teams.length;
  const cols = n <= 4 ? Math.max(n, 1) : n <= 8 ? 4 : 5;
  const size = cols <= 4 ? 300 : 260;
  return (
    <div className="flex h-full flex-col items-center p-16">
      <h1 className="font-display text-[100px] text-gold-400">{t("tv.photosTitle")}</h1>
      <p className="text-[40px] text-ink-200">{t("tv.photosHint")}</p>
      <ul className="mt-14 grid gap-10" style={{ gridTemplateColumns: `repeat(${cols}, ${size}px)` }}>
        {view.teams.map((team) => (
          <li key={team.id} className="flex flex-col items-center gap-4">
            {team.photoUrl ? (
              <TeamAvatar team={team} size={size} rounded="rounded-[32px]" className="animate-[pop_500ms_ease-out]" />
            ) : (
              <div
                className="flex flex-col items-center justify-center gap-3 rounded-[32px] border-4 border-dashed text-ink-400"
                style={{ width: size, height: size, borderColor: team.color }}
              >
                <span className="text-[96px] opacity-60">{team.emoji}</span>
                <span className="text-[28px]">{t("tv.waitingPhoto")}</span>
              </div>
            )}
            <span className="max-w-full truncate text-[40px] font-bold">{team.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
