import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { AuthStatus } from "@kwistig/shared";
import { api, errorKey } from "../lib/api";
import { LanguageToggle } from "./LanguageToggle";

/** Shows a PIN form until the host cookie is set, then renders children. */
export function PinGate({ children }: { children: (logout: () => void) => ReactNode }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<"checking" | "in" | "out">("checking");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<AuthStatus>("/auth/status")
      .then((s) => setStatus(s.authenticated ? "in" : "out"))
      .catch(() => setStatus("out"));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api<AuthStatus>("/auth/login", { method: "POST", body: { pin } });
      setPin("");
      setStatus("in");
    } catch (err) {
      setError(t(errorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const logout = () => {
    void api("/auth/logout", { method: "POST" }).finally(() => setStatus("out"));
  };

  if (status === "checking") {
    return <p className="p-8 text-center text-ink-400">{t("common.loading")}</p>;
  }
  if (status === "in") return <>{children(logout)}</>;

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-5 p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-display text-3xl text-gold-400">{t("app.name")}</p>
            <h1 className="text-ink-200">{t("auth.title")}</h1>
          </div>
          <LanguageToggle />
        </div>
        <div>
          <label htmlFor="pin" className="label">
            {t("auth.pinLabel")}
          </label>
          <input
            id="pin"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            autoFocus
            className="field text-lg tracking-widest"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
        <button type="submit" className="btn-primary w-full" disabled={busy || pin === ""}>
          {t("auth.submit")}
        </button>
      </form>
    </main>
  );
}
