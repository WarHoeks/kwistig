/**
 * Open-answer matching: ignores case, accents, punctuation and leading articles
 * (de, het, een, the, a, an) and allows small typos.
 */

const ARTICLES = new Set(["de", "het", "een", "the", "a", "an", "'t"]);

export function normalizeAnswer(s: string): string {
  const words = s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " en ")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 1 && ARTICLES.has(words[0]!)) words.shift();
  return words.join(" ").replace(/'/g, "");
}

/** Optimal string alignment distance (Levenshtein plus adjacent transpositions). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

/** Typos allowed for an accepted answer of this (normalised) length. */
export function allowedTypos(length: number): number {
  if (length <= 3) return 0;
  if (length <= 6) return 1;
  if (length <= 12) return 2;
  return 3;
}

export type MatchResult = { result: "exact" | "fuzzy" | "none"; matched?: string };

export function matchAnswer(given: string, accepted: readonly string[]): MatchResult {
  const g = normalizeAnswer(given);
  if (!g) return { result: "none" };
  let best: { matched: string; dist: number } | undefined;
  for (const a of accepted) {
    const n = normalizeAnswer(a);
    if (!n) continue;
    if (n === g) return { result: "exact", matched: a };
    // Compare without spaces too, so "vangogh" matches "van gogh".
    const dist = Math.min(editDistance(g, n), editDistance(g.replace(/ /g, ""), n.replace(/ /g, "")));
    if (dist === 0) return { result: "exact", matched: a };
    if (dist <= allowedTypos(n.length) && (!best || dist < best.dist)) best = { matched: a, dist };
  }
  return best ? { result: "fuzzy", matched: best.matched } : { result: "none" };
}

/** Parses "3,5", "1.234" (Dutch thousands), "1 234", "-12". Returns undefined if not a number. */
export function parseNumberInput(s: string): number | undefined {
  let t = s.trim().replace(/[\s ']/g, "");
  if (!/^[-+]?[\d.,]+$/.test(t)) return undefined;
  const lastComma = t.lastIndexOf(",");
  const lastDot = t.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Whichever comes last is the decimal separator.
    t = lastComma > lastDot ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (lastComma >= 0) {
    t = /^[-+]?\d{1,3}(,\d{3})+$/.test(t) && t.split(",").length > 2 ? t.replace(/,/g, "") : t.replace(",", ".");
  } else if (/^[-+]?\d{1,3}(\.\d{3}){2,}$/.test(t)) {
    t = t.replace(/\./g, "");
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}
