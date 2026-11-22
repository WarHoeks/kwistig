import type { Language, LocalizedText } from "./quiz.js";

/**
 * Picks the text for `lang`, falling back to the quiz language, then to whichever
 * translation exists. A plain string is always in the quiz language.
 */
export function pickText(text: LocalizedText, lang: Language, quizLang: Language): string;
export function pickText(text: LocalizedText | undefined, lang: Language, quizLang: Language): string | undefined;
export function pickText(
  text: LocalizedText | undefined,
  lang: Language,
  quizLang: Language,
): string | undefined {
  if (text === undefined) return undefined;
  if (typeof text === "string") return text;
  return text[lang] ?? text[quizLang] ?? text.nl ?? text.en;
}

/** Editor helper: text in the quiz language, for display in lists. */
export function primaryText(text: LocalizedText | undefined, quizLang: Language): string {
  return pickText(text, quizLang, quizLang) ?? "";
}
