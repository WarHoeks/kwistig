import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Round, TriviaCategory, TriviaRequest } from "@kwistig/shared";
import { api, RequestError } from "../../lib/api";

/** "Add a trivia round": multiple-choice / true-false questions from Open Trivia DB (in English). */
export function TriviaImportButton({ onAdd }: { onAdd: (round: Round) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [cats, setCats] = useState<TriviaCategory[] | null>(null);
  const [req, setReq] = useState<TriviaRequest>({ amount: 10, type: "multiple" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = (err: unknown) =>
    setError(t(`trivia.errors.${err instanceof RequestError ? err.code : "generic"}`, { defaultValue: t("errors.generic") }));

  const start = () => {
    setOpen(true);
    setError(null);
    if (!cats) api<TriviaCategory[]>("/trivia/categories").then(setCats).catch(fail);
  };

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      onAdd(await api<Round>("/trivia/round", { method: "POST", body: req }));
      setOpen(false);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const set = <K extends keyof TriviaRequest>(k: K, v: TriviaRequest[K] | undefined) =>
    setReq((r) => {
      const next = { ...r };
      if (v === undefined) delete next[k];
      else next[k] = v;
      return next;
    });

  return (
    <>
      <button type="button" className="btn-ghost w-full" onClick={start} data-testid="trivia-open">
        + {t("trivia.addRound")}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={t("trivia.addRound")}>
          <div className="card flex w-full max-w-md flex-col gap-4 p-5">
            <h2 className="text-lg font-bold">{t("trivia.addRound")}</h2>
            <p className="text-sm text-ink-300">{t("trivia.hint")}</p>
            {error && <p className="text-sm text-red-300">{error}</p>}

            <label className="block">
              <span className="label">{t("trivia.category")}</span>
              <select
                className="field"
                value={req.category ?? ""}
                onChange={(e) => set("category", e.target.value ? Number(e.target.value) : undefined)}
                disabled={!cats}
              >
                <option value="">{cats ? t("trivia.anyCategory") : t("common.loading")}</option>
                {cats?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="label">{t("trivia.difficulty")}</span>
                <select
                  className="field"
                  value={req.difficulty ?? ""}
                  onChange={(e) => set("difficulty", (e.target.value || undefined) as TriviaRequest["difficulty"])}
                >
                  <option value="">{t("trivia.anyDifficulty")}</option>
                  {(["easy", "medium", "hard"] as const).map((d) => (
                    <option key={d} value={d}>
                      {t(`trivia.difficulties.${d}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="label">{t("trivia.amount")}</span>
                <input
                  type="number"
                  className="field"
                  min={1}
                  max={30}
                  value={req.amount}
                  onChange={(e) => set("amount", Math.max(1, Math.min(30, Math.round(Number(e.target.value) || 1))))}
                />
              </label>
            </div>
            <label className="block">
              <span className="label">{t("trivia.type")}</span>
              <select
                className="field"
                value={req.type ?? ""}
                onChange={(e) => set("type", (e.target.value || undefined) as TriviaRequest["type"])}
              >
                <option value="multiple">{t("editor.answerTypes.multiple_choice")}</option>
                <option value="boolean">{t("editor.answerTypes.true_false")}</option>
                <option value="">{t("trivia.mixed")}</option>
              </select>
            </label>

            <div className="flex gap-2">
              <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
                {t("common.close")}
              </button>
              <button type="button" className="btn-primary ml-auto" disabled={busy} onClick={() => void add()} data-testid="trivia-add">
                {busy ? t("common.loading") : t("trivia.fetch", { count: req.amount })}
              </button>
            </div>
            <p className="text-xs text-ink-500">{t("trivia.credit")}</p>
          </div>
        </div>
      )}
    </>
  );
}
