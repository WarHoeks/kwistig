import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApiError } from "@kwistig/shared";
import { intlLocale } from "../i18n";

interface Preview {
  title: string;
  language: string;
  rounds: number;
  questions: number;
  slides: number;
  mediaFiles: number;
  sizeBytes: number;
  existing: { id: number; title: string } | null;
}

async function postZip<T>(url: string, file: File): Promise<T> {
  const res = await fetch(url, { method: "POST", body: file, headers: { "content-type": "application/zip" }, credentials: "same-origin" });
  const data = (await res.json().catch(() => ({}))) as T & Partial<ApiError>;
  if (!res.ok) throw Object.assign(new Error(data.error ?? "generic"), { issues: data.issues ?? [] });
  return data;
}

/**
 * Upload a quiz package: validate and preview first, then import as a new quiz
 * or replace the quiz with the same id.
 */
export function PackageUpload({ onImported, className = "btn-ghost" }: { onImported: (id: number) => void; className?: string }) {
  const { t, i18n } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<{ code: string; issues: { path: string; message: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const choose = async (f: File) => {
    setFile(f);
    setPreview(null);
    setError(null);
    setBusy(true);
    try {
      setPreview(await postZip<Preview>("/api/quizzes/package/preview", f));
    } catch (err) {
      setError({ code: (err as Error).message, issues: (err as { issues?: { path: string; message: string }[] }).issues ?? [] });
    } finally {
      setBusy(false);
    }
  };

  const importAs = async (mode: "new" | "replace") => {
    if (!file) return;
    setBusy(true);
    try {
      const q = await postZip<{ id: number }>(`/api/quizzes/package/import?mode=${mode}`, file);
      close();
      onImported(q.id);
    } catch (err) {
      setError({ code: (err as Error).message, issues: [] });
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setFile(null);
    setPreview(null);
    setError(null);
  };

  const size = (n: number) => new Intl.NumberFormat(intlLocale(i18n.language), { style: "unit", unit: "megabyte", maximumFractionDigits: 1 }).format(n / 1e6);

  return (
    <>
      <button type="button" className={className} onClick={() => input.current?.click()}>
        {t("packages.upload")}
      </button>
      <input
        ref={input}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        data-testid="package-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void choose(f);
          e.target.value = "";
        }}
      />
      {file && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={t("packages.upload")}>
          <div className="card w-full max-w-md space-y-4 p-5">
            <p className="truncate text-sm text-ink-400">{file.name}</p>
            {busy && !preview && <p>{t("common.loading")}</p>}
            {preview && (
              <>
                <h2 className="text-xl font-bold">{preview.title}</h2>
                <p className="text-sm text-ink-200">
                  {t("packages.summary", { rounds: preview.rounds, questions: preview.questions, slides: preview.slides, media: preview.mediaFiles })}
                  {" · "}
                  {size(preview.sizeBytes)}
                </p>
                {preview.existing && <p className="rounded-lg bg-gold-400/15 p-3 text-sm text-gold-300">{t("packages.exists", { title: preview.existing.title })}</p>}
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-primary" disabled={busy} onClick={() => void importAs("new")}>
                    {t("packages.importNew")}
                  </button>
                  {preview.existing && (
                    <button type="button" className="btn-ghost" disabled={busy} onClick={() => void importAs("replace")}>
                      {t("packages.replace")}
                    </button>
                  )}
                </div>
              </>
            )}
            {error && (
              <div role="alert" className="rounded-lg bg-red-500/10 p-3 text-sm text-red-200">
                <p className="font-semibold">{t(`packages.errors.${error.code}`, { defaultValue: t("errors.generic") })}</p>
                {error.issues.length > 0 && (
                  <ul className="mt-1 font-mono text-xs">
                    {error.issues.slice(0, 8).map((i, n) => (
                      <li key={n}>
                        {i.path}: {i.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <button type="button" className="btn-ghost w-full" onClick={close}>
              {t("common.close")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
