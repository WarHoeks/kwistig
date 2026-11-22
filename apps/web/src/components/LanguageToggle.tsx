import { useTranslation } from "react-i18next";
import { LANGS, setLanguage } from "../i18n";

export function LanguageToggle({ className = "" }: { className?: string }) {
  const { i18n, t } = useTranslation();
  return (
    <div role="group" aria-label={t("common.language")} className={`inline-flex rounded-lg bg-ink-800 p-0.5 ${className}`}>
      {LANGS.map((lang) => (
        <button
          key={lang}
          type="button"
          aria-pressed={i18n.language === lang}
          onClick={() => setLanguage(lang)}
          className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase ${
            i18n.language === lang ? "bg-gold-400 text-ink-950" : "text-ink-200 hover:text-white"
          }`}
        >
          {lang}
        </button>
      ))}
    </div>
  );
}
