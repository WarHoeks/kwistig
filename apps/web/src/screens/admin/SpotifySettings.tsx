import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { SpotifyDevice, SpotifyDiagnoseStep, SpotifyStatus } from "@kwistig/shared";
import { api, errorKey, RequestError } from "../../lib/api";
import { IssueList } from "./IssueList";

/**
 * Spotify setup in admin: Client ID and redirect URI (saved values win over the
 * environment), connect/disconnect, the TV player's status, a fallback Connect
 * device and a diagnose run against the real API.
 */
export function SpotifySettings() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  const [clientId, setClientId] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [error, setError] = useState<{ message: string; issues: RequestError["issues"] }>();
  const [saved, setSaved] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [devices, setDevices] = useState<SpotifyDevice[] | null>(null);
  const [diagnose, setDiagnose] = useState<SpotifyDiagnoseStep[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const s = await api<SpotifyStatus>("/spotify/status");
    setStatus(s);
    return s;
  }, []);

  useEffect(() => {
    void load().then((s) => {
      setClientId(s.clientIdSource === "settings" ? (s.clientId ?? "") : "");
      setRedirectUri(s.redirectUriSource === "settings" ? s.redirectUri : "");
    });
  }, [load]);

  // While the Spotify tab is open, check every 2 s whether the connection landed.
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      void load().then((s) => s.connected && setWaiting(false));
    }, 2000);
    return () => clearInterval(timer);
  }, [waiting, load]);

  const patch = async (body: object) => {
    setError(undefined);
    setSaved(false);
    try {
      setStatus(await api<SpotifyStatus>("/spotify/config", { method: "PATCH", body }));
      setSaved(true);
    } catch (err) {
      setError({ message: t(errorKey(err)), issues: err instanceof RequestError ? err.issues : [] });
    }
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    void patch({ clientId: clientId.trim() || null, redirectUri: redirectUri.trim() || null });
  };

  const loadDevices = async () => {
    try {
      setDevices(await api<SpotifyDevice[]>("/spotify/devices"));
    } catch (err) {
      setError({ message: t(`spotify.errors.${err instanceof RequestError ? err.code : "api_error"}`, { defaultValue: t("errors.generic") }), issues: [] });
    }
  };

  const runDiagnose = async () => {
    setBusy(true);
    try {
      setDiagnose(await api<SpotifyDiagnoseStep[]>("/spotify/diagnose", { method: "POST" }));
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;
  const onLaptop = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname) || window.location.hostname.endsWith(".localhost");

  return (
    <section className="card space-y-5 p-5" aria-labelledby="spotify-title">
      <div className="flex items-center gap-3">
        <h2 id="spotify-title" className="text-lg font-bold">
          Spotify
        </h2>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${status.connected ? "bg-emerald-500 text-ink-950" : "bg-ink-700 text-ink-200"}`} data-testid="spotify-state">
          {status.connected ? t("spotify.connectedAs", { name: status.account?.displayName ?? status.account?.id ?? "" }) : t("spotify.notConnected")}
        </span>
      </div>

      <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-200">
        <li>
          {t("spotify.step1")}{" "}
          <a className="underline" href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">
            developer.spotify.com/dashboard
          </a>
        </li>
        <li>
          {t("spotify.step2")} <code className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-xs text-white">{status.redirectUri}</code>
        </li>
        <li>{t("spotify.step3")}</li>
        <li>{t("spotify.step4")}</li>
      </ol>

      <form onSubmit={save} className="grid gap-3">
        <div>
          <label htmlFor="sp-client" className="label">
            {t("spotify.clientId")}
          </label>
          <input
            id="sp-client"
            className="field font-mono"
            autoComplete="off"
            spellCheck={false}
            placeholder={status.clientIdSource === "env" ? `${status.clientId} (SPOTIFY_CLIENT_ID)` : "0123456789abcdef0123456789abcdef"}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="sp-redirect" className="label">
            {t("spotify.redirectUri")}
          </label>
          <input
            id="sp-redirect"
            className="field font-mono"
            inputMode="url"
            spellCheck={false}
            placeholder={status.redirectUriSource === "env" ? status.redirectUri : "http://127.0.0.1:8080/api/spotify/callback"}
            value={redirectUri}
            onChange={(e) => setRedirectUri(e.target.value)}
          />
          <p className="mt-1 text-xs text-ink-400">{t("spotify.redirectHint")}</p>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary">
            {t("common.save")}
          </button>
          {saved && <span className="text-sm text-emerald-300">{t("common.saved")}</span>}
        </div>
      </form>

      {error && <IssueList message={error.message} issues={error.issues} onClose={() => setError(undefined)} />}

      <div className="flex flex-wrap items-center gap-3 border-t border-ink-700 pt-4">
        {status.connected ? (
          <button type="button" className="btn-ghost" onClick={() => void api<SpotifyStatus>("/spotify/disconnect", { method: "POST" }).then(setStatus)}>
            {t("spotify.disconnect")}
          </button>
        ) : (
          <a
            className={`btn-primary ${status.clientId ? "" : "pointer-events-none opacity-50"}`}
            href="/api/spotify/login"
            target="_blank"
            rel="noopener"
            onClick={() => setWaiting(true)}
            aria-disabled={!status.clientId}
          >
            {t("spotify.connect")}
          </a>
        )}
        {waiting && !status.connected && <span className="text-sm text-ink-400">{t("spotify.waiting")}</span>}
        {!onLaptop && !status.connected && <p className="w-full text-sm text-gold-300">{t("spotify.laptopOnly")}</p>}
      </div>

      {status.connected && (
        <div className="space-y-3 border-t border-ink-700 pt-4">
          <p className="text-sm">
            <span className="font-semibold">{t("spotify.tvPlayer")}:</span>{" "}
            {status.tvDevice ? <span className="text-emerald-300">{t("spotify.tvOnline")}</span> : <span className="text-ink-400">{t("spotify.tvOffline")}</span>}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1">
              <label htmlFor="sp-device" className="label">
                {t("spotify.fallbackDevice")}
              </label>
              <select
                id="sp-device"
                className="field"
                value={status.fallbackDeviceId ?? ""}
                onFocus={() => devices === null && void loadDevices()}
                onChange={(e) => void patch({ fallbackDeviceId: e.target.value || null })}
              >
                <option value="">{t("spotify.noFallback")}</option>
                {status.fallbackDeviceId && !devices?.some((d) => d.id === status.fallbackDeviceId) && (
                  <option value={status.fallbackDeviceId}>{t("spotify.savedDevice")}</option>
                )}
                {devices?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.type})
                  </option>
                ))}
              </select>
            </div>
            <button type="button" className="btn-ghost" onClick={() => void loadDevices()}>
              {t("spotify.refreshDevices")}
            </button>
          </div>
          <p className="text-xs text-ink-400">{t("spotify.fallbackHint")}</p>

          <button type="button" className="btn-ghost" disabled={busy} onClick={() => void runDiagnose()}>
            {busy ? t("common.loading") : t("spotify.diagnose")}
          </button>
          {diagnose && (
            <ul className="space-y-1 text-sm" data-testid="spotify-diagnose">
              {diagnose.map((s) => (
                <li key={s.name} className="flex gap-2">
                  <span className={s.ok ? "text-emerald-300" : "text-red-300"}>{s.ok ? "✓" : "✗"}</span>
                  <span className="font-mono text-xs text-ink-400">{s.endpoint}</span>
                  <span className="min-w-0 flex-1 truncate">{s.ok ? s.detail : t(`spotify.errors.spotify_${s.detail}`, { defaultValue: s.detail })}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
