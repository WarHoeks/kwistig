import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, errorKey, RequestError } from "../../lib/api";
import { useConfirm } from "../../components/ConfirmDialog";
import { IssueList } from "./IssueList";

/** Change the host PIN. Other devices are signed out; this browser stays signed in. */
export function PinSettings() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [savedPin, setSavedPin] = useState<boolean | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<{ message: string; issues: RequestError["issues"] }>();

  useEffect(() => {
    api<{ savedPin: boolean }>("/auth/pin").then((r) => setSavedPin(r.savedPin));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setDone(false);
    setError(undefined);
    if (next !== repeat) {
      setError({ message: t("pin.mismatch"), issues: [] });
      return;
    }
    if (!(await confirm(t("pin.confirm"), { confirmLabel: t("pin.change") }))) return;
    try {
      await api("/auth/pin", { method: "POST", body: { current, next } });
      setCurrent("");
      setNext("");
      setRepeat("");
      setSavedPin(true);
      setDone(true);
    } catch (err) {
      setError({ message: t(errorKey(err)), issues: err instanceof RequestError ? err.issues : [] });
    }
  };

  const reset = async () => {
    if (!(await confirm(t("pin.resetConfirm"), { confirmLabel: t("pin.reset"), danger: true }))) return;
    await api("/auth/pin", { method: "DELETE" });
    setSavedPin(false);
    setDone(true);
  };

  return (
    <form onSubmit={submit} className="card space-y-3 p-5" aria-labelledby="pin-title">
      <h2 id="pin-title" className="text-lg font-bold">
        {t("pin.title")}
      </h2>
      <p className="text-sm text-ink-400">{savedPin ? t("pin.sourceSaved") : t("pin.sourceEnv")}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ["pin-current", "pin.current", current, setCurrent, "current-password"],
            ["pin-next", "pin.next", next, setNext, "new-password"],
            ["pin-repeat", "pin.repeat", repeat, setRepeat, "new-password"],
          ] as const
        ).map(([id, label, value, set, auto]) => (
          <div key={id}>
            <label htmlFor={id} className="label">
              {t(label)}
            </label>
            <input id={id} type="password" className="field" autoComplete={auto} value={value} onChange={(e) => set(e.target.value)} />
          </div>
        ))}
      </div>
      <p className="text-xs text-ink-400">{t("pin.hint")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={!current || next.length < 6}>
          {t("pin.change")}
        </button>
        {savedPin && (
          <button type="button" className="btn-ghost" onClick={() => void reset()}>
            {t("pin.reset")}
          </button>
        )}
        {done && <span className="text-sm text-emerald-300">{t("pin.done")}</span>}
      </div>
      {error && <IssueList message={error.message} issues={error.issues} onClose={() => setError(undefined)} />}
    </form>
  );
}
