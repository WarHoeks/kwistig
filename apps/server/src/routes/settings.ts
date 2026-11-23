import type { FastifyInstance } from "fastify";
import { Settings, SettingsPatch } from "@kwistig/shared";
import { parse } from "../http.js";
import { deleteSetting, getSetting, setSetting } from "../services/settings.js";
import { requireHost } from "./auth.js";
import { backupStream } from "../services/packages.js";

export const DEFAULT_QUICK_MESSAGES = {
  nl: ["Pauze! Tijd voor een drankje", "Laatste ronde!", "Nog 10 seconden!", "Telefoons weg, ogen op de tv"],
  en: ["Break! Time for a drink", "Last round!", "10 seconds left!", "Phones down, eyes on the TV"],
};

export function readSettings(app: FastifyInstance): Settings {
  const quick = getSetting(app.db, "quick_messages");
  const locale = (getSetting(app.db, "default_locale") ?? app.config.DEFAULT_LOCALE) as Settings["defaultLocale"];
  return {
    joinBaseUrl: getSetting(app.db, "join_base_url") ?? null,
    envBaseUrl: app.config.PUBLIC_BASE_URL ?? null,
    defaultLocale: locale,
    quickMessages: quick ? (JSON.parse(quick) as string[]) : DEFAULT_QUICK_MESSAGES[locale],
    calmMode: getSetting(app.db, "calm_mode") === "true",
    tvSounds: getSetting(app.db, "tv_sounds") !== "false",
    tvMusic: getSetting(app.db, "tv_music") !== "false",
  };
}

export async function settingsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireHost(app));

  app.get("/", async () => readSettings(app));

  /** Full backup of ./data: database (consistent copy), media and team photos. */
  app.get("/backup", async (_req, reply) => {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    return reply
      .header("content-type", "application/zip")
      .header("content-disposition", `attachment; filename="kwistig-backup-${stamp}.zip"`)
      .send(backupStream(app.db, app.config.DATA_DIR));
  });

  app.patch("/", async (req) => {
    const patch = parse(SettingsPatch, req.body);
    if (patch.joinBaseUrl !== undefined) {
      if (patch.joinBaseUrl === null) deleteSetting(app.db, "join_base_url");
      else setSetting(app.db, "join_base_url", patch.joinBaseUrl.replace(/\/+$/, ""));
    }
    if (patch.defaultLocale) setSetting(app.db, "default_locale", patch.defaultLocale);
    if (patch.quickMessages) setSetting(app.db, "quick_messages", JSON.stringify(patch.quickMessages));
    if (patch.calmMode !== undefined) setSetting(app.db, "calm_mode", String(patch.calmMode));
    if (patch.tvSounds !== undefined) setSetting(app.db, "tv_sounds", String(patch.tvSounds));
    if (patch.tvMusic !== undefined) setSetting(app.db, "tv_music", String(patch.tvMusic));
    return readSettings(app);
  });
}
