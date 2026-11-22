import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { pickText, type Language, type LocalizedText } from "@kwistig/shared";

/** Picks quiz content in the current UI language, falling back to the quiz language. */
export function useQuizText(quizLang: Language | undefined) {
  const { i18n } = useTranslation();
  const lang: Language = i18n.language === "en" ? "en" : "nl";
  return useCallback(
    (text: LocalizedText | undefined) => (text === undefined ? "" : pickText(text, lang, quizLang ?? lang)),
    [lang, quizLang],
  );
}

export const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"];

/** Option colours, chosen to stay distinct for common colour-vision deficiencies alongside the letter. */
export const OPTION_COLORS = ["#f59e0b", "#0ea5e9", "#ec4899", "#10b981", "#8b5cf6", "#f97316"];

export function formatScore(n: number, lang: string): string {
  return new Intl.NumberFormat(lang === "en" ? "en-GB" : "nl-NL", { maximumFractionDigits: 1 }).format(n);
}
