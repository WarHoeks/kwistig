import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SessionSummary } from "@kwistig/shared";
import { api, errorKey } from "../../lib/api";
import { intlLocale } from "../../i18n";
import { formatScore } from "../../lib/text";
import { TeamAvatar } from "../../components/TeamAvatar";
import { useConfirm } from "../../components/ConfirmDialog";

/** Past quiz nights with their final standings; finished ones can be deleted with their photos. */
export function SessionsPage() {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<SessionSummary[]>("/sessions")
      .then(setSessions)
      .catch((err) => setError(t(errorKey(err))));
  }, [t]);
  useEffect(load, [load]);

  const remove = async (s: SessionSummary) => {
    if (!(await confirm(t("sessions.confirmDelete", { title: s.quizTitle }), { confirmLabel: t("common.delete"), danger: true }))) return;
    await api(`/sessions/${s.id}`, { method: "DELETE" }).catch((err) => setError(t(errorKey(err))));
    load();
  };

  const fmt = new Intl.DateTimeFormat(intlLocale(i18n.language), { dateStyle: "full", timeStyle: "short" });

  return (
    <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <h1 className="text-2xl font-bold">{t("sessions.title")}</h1>
      {error && <p className="text-red-300">{error}</p>}
      {sessions === null && !error && <p className="text-ink-400">{t("common.loading")}</p>}
      {sessions?.length === 0 && <p className="card p-8 text-center text-ink-400">{t("sessions.empty")}</p>}
      <ul className="space-y-3">
        {sessions?.map((s) => (
          <li key={s.id} className="card space-y-3 p-4" data-testid={`session-${s.id}`}>
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-lg font-semibold">{s.quizTitle}</p>
                <p className="text-sm text-ink-400">{fmt.format(new Date(s.startedAt))}</p>
              </div>
              {s.active ? (
                <span className="rounded-full bg-emerald-500 px-2.5 py-0.5 text-xs font-bold text-ink-950">{t("sessions.running")}</span>
              ) : (
                <button type="button" className="btn-danger btn-sm" onClick={() => void remove(s)}>
                  {t("common.delete")}
                </button>
              )}
            </div>
            {s.teams.length === 0 ? (
              <p className="text-sm text-ink-400">{t("sessions.noTeams")}</p>
            ) : (
              <ol className="grid gap-1.5 sm:grid-cols-2">
                {s.teams.map((tm, i) => (
                  <li key={i} className={`flex items-center gap-3 rounded-lg px-2 py-1.5 ${tm.rank === 1 ? "bg-gold-400/15" : "bg-ink-800/60"}`}>
                    <span className="w-6 text-center font-bold text-ink-400">{tm.rank}</span>
                    <TeamAvatar team={tm} size={32} rounded="rounded-lg" />
                    <span className="min-w-0 flex-1 truncate">
                      {tm.name}
                      {tm.rank === 1 && " 🏆"}
                    </span>
                    <span className="font-bold tabular-nums">{formatScore(tm.score, i18n.language)}</span>
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
