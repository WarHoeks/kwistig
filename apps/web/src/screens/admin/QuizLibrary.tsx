import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Language, QuizSummary } from "@kwistig/shared";
import { api, errorKey, RequestError } from "../../lib/api";
import { intlLocale } from "../../i18n";
import { IssueList } from "./IssueList";
import { PackageUpload } from "../../components/PackageUpload";
import { useConfirm } from "../../components/ConfirmDialog";
import { AiQuizButton } from "./AiQuizDialog";

export function QuizLibrary() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [quizzes, setQuizzes] = useState<QuizSummary[]>();
  const [error, setError] = useState<{ message: string; issues: RequestError["issues"] }>();
  const [notice, setNotice] = useState<string>();
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState<Language>(i18n.language === "en" ? "en" : "nl");
  const fileInput = useRef<HTMLInputElement>(null);

  const fail = (err: unknown) =>
    setError({ message: t(errorKey(err)), issues: err instanceof RequestError ? err.issues : [] });

  const load = useCallback(() => {
    api<QuizSummary[]>("/quizzes").then(setQuizzes).catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(load, [load]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const q = await api<{ id: number }>("/quizzes", { method: "POST", body: { title, language } });
      navigate(`/admin/quiz/${q.id}`);
    } catch (err) {
      fail(err);
    }
  };

  const importFile = async (file: File) => {
    setError(undefined);
    setNotice(undefined);
    let body: unknown;
    try {
      body = JSON.parse(await file.text());
    } catch {
      setError({ message: t("errors.invalid_json"), issues: [] });
      return;
    }
    try {
      await api("/quizzes/import", { method: "POST", body });
      setNotice(t("admin.importSuccess"));
      load();
    } catch (err) {
      fail(err);
    }
  };

  const duplicate = async (id: number) => {
    await api(`/quizzes/${id}/duplicate`, { method: "POST" }).catch(fail);
    load();
  };

  const remove = async (q: QuizSummary) => {
    if (!(await confirm(t("admin.confirmDelete", { title: q.title }), { confirmLabel: t("common.delete"), danger: true }))) return;
    await api(`/quizzes/${q.id}`, { method: "DELETE" }).catch(fail);
    load();
  };

  const dateFmt = new Intl.DateTimeFormat(intlLocale(i18n.language), { dateStyle: "medium", timeStyle: "short" });

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-end gap-4">
        <h1 className="text-2xl font-bold">{t("admin.library")}</h1>
        <div className="ml-auto flex flex-wrap gap-2">
          <AiQuizButton />
          <PackageUpload
            onImported={() => {
              setNotice(t("admin.importSuccess"));
              load();
            }}
          />
          <button type="button" className="btn-ghost" onClick={() => fileInput.current?.click()}>
            {t("admin.import")}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            data-testid="import-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <form onSubmit={create} className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-48 flex-1">
          <label htmlFor="new-title" className="label">
            {t("admin.newQuizTitle")}
          </label>
          <input id="new-title" className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label htmlFor="new-lang" className="label">
            {t("editor.quizLanguage")}
          </label>
          <select id="new-lang" className="field" value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
            <option value="nl">{t("common.languages.nl")}</option>
            <option value="en">{t("common.languages.en")}</option>
          </select>
        </div>
        <button type="submit" className="btn-primary" disabled={title.trim() === ""}>
          {t("admin.newQuiz")}
        </button>
      </form>

      {notice && <p className="rounded-lg bg-emerald-500/15 px-4 py-2 text-emerald-200">{notice}</p>}
      {error && <IssueList message={error.message} issues={error.issues} onClose={() => setError(undefined)} />}

      {quizzes === undefined ? (
        <p className="text-ink-400">{t("common.loading")}</p>
      ) : quizzes.length === 0 ? (
        <p className="card p-8 text-center text-ink-400">{t("admin.empty")}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {quizzes.map((q) => (
            <li key={q.id} className="card flex flex-col gap-3 p-4">
              <div className="flex items-start gap-2">
                <Link to={`/admin/quiz/${q.id}`} className="text-lg font-semibold hover:text-gold-300">
                  {q.title}
                </Link>
                <span className="ml-auto rounded bg-ink-700 px-1.5 py-0.5 text-xs font-bold uppercase text-ink-200">
                  {q.language}
                </span>
              </div>
              {q.description && <p className="line-clamp-2 text-sm text-ink-400">{q.description}</p>}
              <p className="text-sm text-ink-400">
                {t("admin.stats", { rounds: q.roundCount, items: q.itemCount })} ·{" "}
                {t("admin.updated", { date: dateFmt.format(new Date(q.updatedAt)) })}
              </p>
              <div className="mt-auto flex flex-wrap gap-2">
                <Link to={`/admin/quiz/${q.id}`} className="btn-primary btn-sm">
                  {t("admin.edit")}
                </Link>
                <a href={`/api/quizzes/${q.id}/package`} className="btn-ghost btn-sm" download>
                  {t("packages.download")}
                </a>
                <a href={`/api/quizzes/${q.id}/export`} className="btn-ghost btn-sm" download>
                  {t("admin.export")}
                </a>
                <button type="button" className="btn-ghost btn-sm" onClick={() => void duplicate(q.id)}>
                  {t("admin.duplicate")}
                </button>
                <button type="button" className="btn-danger btn-sm ml-auto" onClick={() => void remove(q)}>
                  {t("common.delete")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm text-ink-400">
        <a href="/api/schema/quiz.json" className="underline hover:text-white" target="_blank" rel="noreferrer">
          {t("admin.schemaLink")}
        </a>
      </p>
    </main>
  );
}
