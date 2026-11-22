import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { HostView } from "@kwistig/shared";
import { TeamAvatar } from "../../components/TeamAvatar";
import { formatScore } from "../../lib/text";
import { useHost } from "./HostScreen";

type TeamDetail = HostView["teamsDetail"][number];

export function HostTeams() {
  const { t } = useTranslation();
  const { view } = useHost();
  if (!view) return null;
  if (view.teamsDetail.length === 0) return <p className="text-ink-400">{t("host.noTeams")}</p>;
  const teams = [...view.teamsDetail].sort((a, b) => a.rank - b.rank);
  return (
    <ul className="space-y-3">
      {teams.map((team) => (
        <TeamCard key={team.id} team={team} others={view.teamsDetail.filter((o) => o.id !== team.id)} />
      ))}
    </ul>
  );
}

function TeamCard({ team, others }: { team: TeamDetail; others: TeamDetail[] }) {
  const { t, i18n } = useTranslation();
  const { send } = useHost();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(team.name);

  const rename = async () => {
    if (name.trim() && name.trim() !== team.name) await send({ type: "renameTeam", teamId: team.id, name: name.trim() });
    setRenaming(false);
  };

  return (
    <li className="card space-y-3 p-4" data-testid={`host-team-${team.id}`}>
      <div className="flex items-center gap-3">
        <span className="w-6 text-center font-bold text-ink-400">{team.rank}</span>
        <TeamAvatar team={team} size={48} rounded="rounded-xl" />
        <div className="min-w-0 flex-1">
          {renaming ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void rename();
              }}
            >
              <input className="field py-1" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} onBlur={() => void rename()} />
            </form>
          ) : (
            <button type="button" className="truncate text-left text-lg font-bold" onClick={() => setRenaming(true)} title={t("host.rename")}>
              {team.name}
            </button>
          )}
          <p className="text-xs text-ink-400">{team.photoUrl ? "📸" : t("host.noPhoto")}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold tabular-nums">{formatScore(team.score, i18n.language)}</p>
          {team.adjustment !== 0 && (
            <p className="text-xs text-ink-400">
              ({team.adjustment > 0 ? "+" : ""}
              {formatScore(team.adjustment, i18n.language)})
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2" role="group" aria-label={t("host.adjust")}>
        <span className="text-sm text-ink-400">{t("host.adjust")}</span>
        {[-1, -0.5, 0.5, 1].map((d) => (
          <button key={d} type="button" className="btn-ghost btn-sm flex-1" onClick={() => void send({ type: "adjustScore", teamId: team.id, delta: d })}>
            {d > 0 ? `+${d}` : d}
          </button>
        ))}
      </div>

      <div>
        <p className="mb-1 text-sm font-semibold text-ink-200">{t("host.phones")}</p>
        <ul className="space-y-1">
          {team.players.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-sm">
              <span className={`h-2 w-2 rounded-full ${p.online ? "bg-emerald-400" : "bg-ink-600"}`} title={p.online ? t("host.online") : t("host.offline")} />
              <span className="flex-1 truncate">{p.nickname ?? `#${p.id}`}</span>
              {others.length > 0 && (
                <select
                  className="rounded bg-ink-800 px-1 py-0.5 text-xs"
                  value=""
                  aria-label={t("host.moveTo")}
                  onChange={(e) => e.target.value && void send({ type: "movePlayer", playerId: p.id, teamId: Number(e.target.value) })}
                >
                  <option value="">{t("host.moveTo")}</option>
                  {others.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                className="px-1 text-red-300"
                aria-label={t("host.removePhone")}
                onClick={() => confirm(t("host.confirmRemovePhone")) && void send({ type: "removePlayer", playerId: p.id })}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex gap-2">
        {others.length > 0 && (
          <select
            className="field flex-1 py-1.5 text-sm"
            value=""
            aria-label={t("host.mergeInto")}
            onChange={(e) => {
              const into = others.find((o) => o.id === Number(e.target.value));
              if (into && confirm(t("host.confirmMerge", { from: team.name, into: into.name }))) {
                void send({ type: "mergeTeams", fromId: team.id, intoId: into.id });
              }
            }}
          >
            <option value="">{t("host.mergeInto")}</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className="btn-danger btn-sm"
          onClick={() => confirm(t("host.confirmRemoveTeam", { name: team.name })) && void send({ type: "removeTeam", teamId: team.id })}
        >
          {t("host.removeTeam")}
        </button>
      </div>
    </li>
  );
}
