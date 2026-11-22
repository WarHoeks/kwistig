import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import nl from "./nl.json";
import en from "./en.json";

export const LANGS = ["nl", "en"] as const;
export type Lang = (typeof LANGS)[number];

const STORAGE_KEY = "kwistig.lang";

function storedLang(): Lang | undefined {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "nl" || v === "en" ? v : undefined;
  } catch {
    return undefined;
  }
}

void i18n.use(initReactI18next).init({
  resources: { nl: { translation: nl }, en: { translation: en } },
  lng: storedLang() ?? "nl",
  fallbackLng: "nl",
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function setLanguage(lang: Lang, remember = true) {
  void i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
  if (remember) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* private mode: language just isn't remembered */
    }
  }
}

export const intlLocale = (lang: string) => (lang === "en" ? "en-GB" : "nl-NL");

export default i18n;
