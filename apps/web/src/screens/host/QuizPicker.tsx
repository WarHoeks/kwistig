import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { QuizSummary } from "@kwistig/shared";
import { api } from "../../lib/api";
import { useHost } from "./HostScreen";
import { PackageUpload } from "../../components/PackageUpload";
import { useConfirm } from "../../components/ConfirmDialog";

export function QuizPicker({ onStarted }: { onStarted: () => void }) {
  const { t } = useTranslation();
  const { send, view } = useHost();
  const confirm = useConfirm();
  const [quizzes, setQuizzes] = useState<QuizSummary[] | null>(null);

  useEffect(() => {
    api<QuizSummary[]>("/quizzes").then(setQuizzes).catch(() => setQuizzes([]));
  }, []);

  const start = async (q: QuizSummary) => {
    if (view && view.phase !== "finished" && !(await confirm(t("host.confirmStart", { title: q.title }), { confirmLabel: t("host.start") }))) return;
    if (await send({ type: "startQuiz", quizId: q.id })) onStarted();
  };

  const end = async () => {
    if (await confirm(t("host.confirmEnd"), { confirmLabel: t("host.endSession"), danger: true })) await send({ type: "endSession" });
  };

  return (
    <div className="space-y-3">
      <PackageUpload className="btn-ghost w-full" onImported={() => api<QuizSummary[]>("/quizzes").then(setQuizzes)} />
      {quizzes === null && <p className="text-ink-400">{t("common.loading")}</p>}
      {quizzes?.length === 0 && <p className="text-ink-400">{t("admin.empty")}</p>}
      <ul className="space-y-2">
        {quizzes?.map((q) => (
          <li key={q.id} className="card flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{q.title}</p>
              <p className="text-sm text-ink-400">{t("admin.stats", { rounds: q.roundCount, items: q.itemCount })}</p>
            </div>
            <a href={`/api/quizzes/${q.id}/package`} className="btn-ghost btn-sm" download aria-label={t("packages.download")} title={t("packages.download")}>
              ⬇
            </a>
            <button type="button" className="btn-primary" onClick={() => void start(q)}>
              {t("host.start")}
            </button>
          </li>
        ))}
      </ul>
      {view && (
        <button type="button" className="btn-danger w-full" onClick={() => void end()}>
          {t("host.endSession")}
        </button>
      )}
    </div>
  );
}
