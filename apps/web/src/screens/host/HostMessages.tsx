import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Settings } from "@kwistig/shared";
import { api } from "../../lib/api";
import { useHost } from "./HostScreen";

export function HostMessages() {
  const { t } = useTranslation();
  const { view, send } = useHost();
  const [text, setText] = useState("");
  const [quick, setQuick] = useState<string[]>([]);

  useEffect(() => {
    api<Settings>("/settings")
      .then((s) => setQuick(s.quickMessages))
      .catch(() => setQuick([]));
  }, []);

  const saveQuick = async (list: string[]) => {
    setQuick(list);
    await api("/settings", { method: "PATCH", body: { quickMessages: list } }).catch(() => undefined);
  };

  const push = (msg: string, style: "slide" | "banner") => void send({ type: "message", text: msg, style });
  const active = view?.overlay.message;

  return (
    <div className="space-y-5">
      {active && (
        <section className="card space-y-3 border-gold-400 p-4">
          <p className="text-sm text-ink-400">{t("host.onTv")}</p>
          <p className="text-lg font-semibold">{active.text}</p>
          <button type="button" className="btn-primary w-full" onClick={() => void send({ type: "dismissMessage" })}>
            {t("host.dismiss")}
          </button>
        </section>
      )}

      <section className="space-y-2">
        <label htmlFor="msg" className="label">
          {t("host.messageText")}
        </label>
        <textarea id="msg" className="field text-lg" rows={3} maxLength={280} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn-primary" disabled={!text.trim()} onClick={() => push(text.trim(), "slide")}>
            {t("host.sendSlide")}
          </button>
          <button type="button" className="btn-ghost" disabled={!text.trim()} onClick={() => push(text.trim(), "banner")}>
            {t("host.sendBanner")}
          </button>
        </div>
        <button
          type="button"
          className="text-sm text-ink-400 underline disabled:opacity-40"
          disabled={!text.trim() || quick.includes(text.trim())}
          onClick={() => void saveQuick([...quick, text.trim()])}
        >
          {t("host.saveQuick")}
        </button>
      </section>

      <section>
        <p className="label">{t("host.quickMessages")}</p>
        <ul className="space-y-2">
          {quick.map((q) => (
            <li key={q} className="card flex items-center gap-2 p-2">
              <span className="min-w-0 flex-1 truncate pl-1">{q}</span>
              <button type="button" className="btn-ghost btn-sm" onClick={() => push(q, "slide")}>
                {t("host.sendSlide")}
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => push(q, "banner")}>
                {t("host.sendBanner")}
              </button>
              <button
                type="button"
                className="px-1 text-red-300"
                aria-label={t("host.removeQuick")}
                onClick={() => void saveQuick(quick.filter((x) => x !== q))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
