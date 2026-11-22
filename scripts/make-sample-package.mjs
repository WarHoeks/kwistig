// Packs samples/<name>.json plus samples/media/ into an importable Kwistig package.
// Usage: node scripts/make-sample-package.mjs [kitchen-sink] [out.zip]
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { strToU8, zipSync } from "fflate";

const samples = path.resolve(import.meta.dirname, "../samples");
const name = process.argv[2] ?? "kitchen-sink";
const out = path.resolve(process.argv[3] ?? path.join(samples, `${name}.zip`));
const sha = (b) => createHash("sha256").update(b).digest("hex");

const quiz = fs.readFileSync(path.join(samples, `${name}.json`));
const doc = JSON.parse(quiz.toString("utf8"));
const used = new Set(JSON.stringify(doc).match(/media\/[\w.-]+/g) ?? []);
const files = { "quiz.json": new Uint8Array(quiz) };
for (const ref of used) {
  const file = path.join(samples, ref);
  if (fs.existsSync(file)) files[ref] = new Uint8Array(fs.readFileSync(file));
}
const title = typeof doc.title === "string" ? doc.title : (doc.title.nl ?? doc.title.en);
const manifest = {
  format: 1,
  app: "kwistig",
  appVersion: "sample",
  quizId: `sample-${name}`,
  title,
  exportedAt: new Date().toISOString(),
  files: Object.fromEntries(Object.entries(files).map(([p, b]) => [p, sha(b)])),
};
fs.writeFileSync(out, zipSync({ "manifest.json": strToU8(JSON.stringify(manifest, null, 2)), ...files }));
console.log(`wrote ${out} (${Object.keys(files).length - 1} media files)`);
