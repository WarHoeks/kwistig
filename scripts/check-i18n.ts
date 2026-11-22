/**
 * Fails when the nl and en UI message files don't have exactly the same keys.
 * Run with: npm run i18n:check
 */
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(import.meta.dirname, "../apps/web/src/i18n");
const load = (lang: string) => JSON.parse(fs.readFileSync(path.join(dir, `${lang}.json`), "utf8")) as unknown;

function keys(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

const nl = new Set(keys(load("nl")));
const en = new Set(keys(load("en")));
const missingEn = [...nl].filter((k) => !en.has(k));
const missingNl = [...en].filter((k) => !nl.has(k));

if (missingEn.length || missingNl.length) {
  for (const k of missingEn) console.error(`missing in en.json: ${k}`);
  for (const k of missingNl) console.error(`missing in nl.json: ${k}`);
  process.exit(1);
}
console.log(`i18n ok: ${nl.size} keys in nl and en`);
