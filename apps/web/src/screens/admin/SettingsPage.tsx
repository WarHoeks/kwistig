import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { Language, Settings } from "@kwistig/shared";
import { api, errorKey, RequestError } from "../../lib/api";
import { IssueList } from "./IssueList";
import { SpotifySettings } from "./SpotifySettings";
import { PinSettings } from "./PinSettings";
import { YouTubeTest } from "./YouTubeTest";

const isLoopback = (h: string) => h === "localhost" || h.startsWith("127.") || h === "[::1]";

export function SettingsPage() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [base, setBase] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<{ message: string; issues: RequestError["issues"] }>();

  useEffect(() => {
    api<Settings>("/settings").then((s) => {
      setSettings(s);
      setBase(s.joinBaseUrl ?? "");
    });
  }, []);

  const save = async (patch: Partial<Pick<Settings, "joinBaseUrl" | "defaultLocale" | "calmMode" | "tvSounds" | "tvMusic">>) => {
    setError(undefined);
    setSaved(false);
    try {
      const s = await api<Settings>("/settings", { method: "PATCH", body: patch });
      setSettings(s);
      setBase(s.joinBaseUrl ?? "");
      setSaved(true);
    } catch (err) {
      setError({ message: t(errorKey(err)), issues: err instanceof RequestError ? err.issues : [] });
    }
  };

  if (!settings) return <p className="p-6 text-ink-400">{t("common.loading")}</p>;

  const origin = window.location;
  const effective =
    settings.joinBaseUrl ?? settings.envBaseUrl ?? (isLoopback(origin.hostname) ? null : origin.origin);

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <h1 className="text-2xl font-bold">{t("settings.title")}</h1>

      <form
        className="card space-y-3 p-5"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void save({ joinBaseUrl: base.trim() === "" ? null : base.trim() });
        }}
      >
        <label htmlFor="base" className="label">
          {t("settings.joinBaseUrl")}
        </label>
        <div className="flex gap-2">
          <input
            id="base"
            className="field font-mono"
            inputMode="url"
            placeholder="http://192.168.1.23:8080"
            value={base}
            onChange={(e) => setBase(e.target.value)}
          />
          <button type="submit" className="btn-primary">
            {t("common.save")}
          </button>
        </div>
        <p className="text-sm text-ink-400">{t("settings.joinBaseUrlHint")}</p>
        <p className="text-sm text-ink-400">
          {settings.envBaseUrl ? t("settings.envBaseUrl", { url: settings.envBaseUrl }) : t("settings.envNotSet")}
        </p>
        {effective ? (
          <div className="rounded-lg bg-ink-800 p-3">
            <p className="text-sm text-ink-200">{t("settings.currentJoin")}</p>
            <p className="font-mono text-lg">{effective}/join/…</p>
            <p className="mt-1 text-sm text-ink-400">{t("settings.testHint")}</p>
          </div>
        ) : (
          <p className="rounded-lg bg-red-500/15 p-3 text-sm text-red-200">{t("tv.noJoinUrlHelp")}</p>
        )}
      </form>

      <div className="card space-y-2 p-5">
        <label htmlFor="locale" className="label">
          {t("settings.defaultLocale")}
        </label>
        <select
          id="locale"
          className="field max-w-xs"
          value={settings.defaultLocale}
          onChange={(e) => void save({ defaultLocale: e.target.value as Language })}
        >
          <option value="nl">{t("common.languages.nl")}</option>
          <option value="en">{t("common.languages.en")}</option>
        </select>
      </div>

      <div className="card space-y-3 p-5">
        <p className="label">{t("settings.tvEffects")}</p>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 accent-amber-400"
            checked={settings.calmMode}
            onChange={(e) => void save({ calmMode: e.target.checked })}
          />
          <span>
            <span className="block font-semibold">{t("settings.calmMode")}</span>
            <span className="block text-sm text-ink-400">{t("settings.calmModeHint")}</span>
          </span>
        </label>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1 accent-amber-400" checked={settings.tvSounds} onChange={(e) => void save({ tvSounds: e.target.checked })} />
          <span>
            <span className="block font-semibold">{t("settings.tvSounds")}</span>
            <span className="block text-sm text-ink-400">{t("settings.tvSoundsHint")}</span>
          </span>
        </label>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1 accent-amber-400" checked={settings.tvMusic} onChange={(e) => void save({ tvMusic: e.target.checked })} />
          <span>
            <span className="block font-semibold">{t("settings.tvMusic")}</span>
            <span className="block text-sm text-ink-400">{t("settings.tvMusicHint")}</span>
          </span>
        </label>
      </div>

      <PinSettings />

      <SpotifySettings />

      <YouTubeTest />

      <div className="card space-y-2 p-5">
        <p className="label">{t("settings.backup")}</p>
        <p className="text-sm text-ink-400">{t("settings.backupHint")}</p>
        <a href="/api/settings/backup" className="btn-ghost" download>
          {t("settings.backupDownload")}
        </a>
      </div>

      {saved && <p className="text-emerald-300">{t("common.saved")}</p>}
      {error && <IssueList message={error.message} issues={error.issues} onClose={() => setError(undefined)} />}
    </main>
  );
}
