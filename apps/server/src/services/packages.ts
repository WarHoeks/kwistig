import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PassThrough, type Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { strFromU8, strToU8, unzipSync, Zip, ZipPassThrough, zipSync, type Zippable } from "fflate";
import { z } from "zod";
import {
  collectImageRefs,
  collectNewsUrls,
  collectYouTubeIds,
  formatIssues,
  primaryText,
  Quiz,
  type NewsInfo,
  type ValidationIssue,
} from "@kwistig/shared";
import { APP_VERSION } from "../config.js";
import type { Db } from "../db/client.js";
import { quiz as quizTable } from "../db/schema.js";
import { createQuiz, loadQuiz, replaceQuiz, toDocument } from "./quizzes.js";
import type { MediaStore } from "./media.js";
import { prepareQuizMedia, type MediaWarning } from "./quiz-media.js";

/**
 * Quiz packages: kwistig-<slug>.zip with manifest.json (checksums), quiz.json in
 * the import format, media/ with every image the quiz uses, and cache/ with
 * fetched news headlines and YouTube metadata. Sessions and team photos are never
 * included.
 */

export const PACKAGE_FORMAT = 1;
const MAX_ENTRIES = 2000;
const MAX_UNPACKED = 500 * 1024 * 1024;

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

export const Manifest = z.object({
  format: z.literal(PACKAGE_FORMAT),
  app: z.literal("kwistig"),
  appVersion: z.string(),
  quizId: z.string().min(1).max(100),
  title: z.string(),
  exportedAt: z.string(),
  files: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
});
export type Manifest = z.infer<typeof Manifest>;

export class PackageError extends Error {
  constructor(
    message: string,
    readonly issues: ValidationIssue[] = [],
  ) {
    super(message);
  }
}

export function slug(s: string): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "quiz"
  );
}

export function exportPackage(db: Db, media: MediaStore, quizId: number): { name: string; zip: Uint8Array } | null {
  const q = loadQuiz(db, quizId);
  if (!q) return null;
  const doc = toDocument(q);
  const entries: Record<string, Uint8Array> = {};
  // Images are already compressed: store them as-is.
  const stored: Zippable = {};

  const addMedia = (ref: string) => {
    const file = media.fileFor(ref);
    if (file && !entries[ref]) {
      entries[ref] = fs.readFileSync(file);
      stored[ref] = [entries[ref], { level: 0 }];
    }
  };
  for (const ref of collectImageRefs(doc)) addMedia(ref);

  const news: Record<string, NewsInfo> = {};
  for (const url of collectNewsUrls(doc)) {
    const info = media.getMeta<NewsInfo>("news", url);
    if (info) {
      news[url] = { headline: info.headline, image: info.image };
      if (info.image) addMedia(info.image);
    }
  }
  const youtube: Record<string, unknown> = {};
  for (const id of collectYouTubeIds(doc)) {
    const meta = media.getMeta("youtube", id);
    if (meta) youtube[id] = meta;
  }

  const json = (v: unknown) => strToU8(JSON.stringify(v, null, 2) + "\n");
  entries["quiz.json"] = json(doc);
  if (Object.keys(news).length) entries["cache/news.json"] = json(news);
  if (Object.keys(youtube).length) entries["cache/youtube.json"] = json(youtube);

  const manifest: Manifest = {
    format: PACKAGE_FORMAT,
    app: "kwistig",
    appVersion: APP_VERSION,
    quizId: q.uid,
    title: primaryText(doc.title, doc.language),
    exportedAt: new Date().toISOString(),
    files: Object.fromEntries(Object.entries(entries).map(([p, b]) => [p, sha256(b)])),
  };

  const zippable: Zippable = { "manifest.json": json(manifest) };
  for (const [p, b] of Object.entries(entries)) zippable[p] = stored[p] ?? b;
  return { name: `kwistig-${slug(manifest.title)}.zip`, zip: zipSync(zippable, { level: 6 }) };
}

export interface ReadPackage {
  manifest: Manifest;
  doc: Quiz;
  files: Map<string, Buffer>;
  news: Record<string, NewsInfo>;
  youtube: Record<string, Record<string, unknown>>;
  size: number;
}

/** Unpacks and fully validates a package; nothing is stored. */
export function readPackage(buf: Buffer): ReadPackage {
  let entryCount = 0;
  let unpacked = 0;
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(buf, {
      filter: (f) => {
        entryCount += 1;
        unpacked += f.originalSize;
        if (entryCount > MAX_ENTRIES || unpacked > MAX_UNPACKED) throw new PackageError("package_too_large");
        return !f.name.endsWith("/");
      },
    });
  } catch (err) {
    if (err instanceof PackageError) throw err;
    throw new PackageError("not_a_zip");
  }
  for (const name of Object.keys(raw)) {
    if (name.includes("..") || name.startsWith("/") || name.includes("\\")) throw new PackageError("invalid_path");
  }

  const readJson = (name: string): unknown => {
    const b = raw[name];
    if (!b) throw new PackageError(`missing_${name.replace(/\W/g, "_")}`);
    try {
      return JSON.parse(strFromU8(b));
    } catch {
      throw new PackageError("invalid_json", [{ path: name, message: "not valid JSON" }]);
    }
  };

  const manifestRes = Manifest.safeParse(readJson("manifest.json"));
  if (!manifestRes.success) throw new PackageError("invalid_manifest", formatIssues(manifestRes.error));
  const manifest = manifestRes.data;

  for (const [name, sum] of Object.entries(manifest.files)) {
    const b = raw[name];
    if (!b) throw new PackageError("missing_file", [{ path: name, message: "listed in manifest but not in the zip" }]);
    if (sha256(b) !== sum) throw new PackageError("checksum_mismatch", [{ path: name, message: "checksum does not match" }]);
  }

  const quizRes = Quiz.safeParse(readJson("quiz.json"));
  if (!quizRes.success) throw new PackageError("invalid_quiz", formatIssues(quizRes.error));

  const files = new Map<string, Buffer>();
  for (const [name, b] of Object.entries(raw)) if (name.startsWith("media/")) files.set(name, Buffer.from(b));
  const news = raw["cache/news.json"] ? (readJson("cache/news.json") as Record<string, NewsInfo>) : {};
  const youtube = raw["cache/youtube.json"] ? (readJson("cache/youtube.json") as Record<string, Record<string, unknown>>) : {};

  return { manifest, doc: quizRes.data, files, news, youtube, size: buf.length };
}

export function previewPackage(db: Db, pkg: ReadPackage) {
  const existing = db.select({ id: quizTable.id, title: quizTable.title }).from(quizTable).where(eq(quizTable.uid, pkg.manifest.quizId)).get();
  const items = pkg.doc.rounds.flatMap((r) => r.items);
  return {
    title: primaryText(pkg.doc.title, pkg.doc.language),
    language: pkg.doc.language,
    rounds: pkg.doc.rounds.length,
    questions: items.filter((i) => i.kind === "question").length,
    slides: items.filter((i) => i.kind === "slide").length,
    mediaFiles: pkg.files.size,
    sizeBytes: pkg.size,
    exportedAt: pkg.manifest.exportedAt,
    existing: existing ?? null,
  };
}

/** Stores a validated package as a new quiz or over the quiz with the same id. */
export async function importPackage(
  db: Db,
  media: MediaStore,
  pkg: ReadPackage,
  mode: "new" | "replace",
): Promise<{ id: number; warnings: MediaWarning[] }> {
  // Cached news: store their images and metadata so nothing needs fetching again.
  for (const [url, info] of Object.entries(pkg.news)) {
    let image: string | null = null;
    const file = info.image ? pkg.files.get(info.image) : undefined;
    if (file) image = media.storeImage(file);
    if (!media.getMeta("news", url)) media.setMeta("news", url, { headline: info.headline, image });
  }
  for (const [id, meta] of Object.entries(pkg.youtube)) if (!media.getMeta("youtube", id)) media.setMeta("youtube", id, meta);

  const { doc, warnings } = await prepareQuizMedia(media, pkg.doc, pkg.files);
  const existing = db.select({ id: quizTable.id }).from(quizTable).where(eq(quizTable.uid, pkg.manifest.quizId)).get();
  if (mode === "replace") {
    if (!existing) throw new PackageError("quiz_not_found");
    replaceQuiz(db, existing.id, doc);
    return { id: existing.id, warnings };
  }
  // As new: keep the package's id unless that quiz already exists here.
  const id = createQuiz(db, doc, existing ? randomUUID() : pkg.manifest.quizId);
  return { id, warnings };
}

// ---------------------------------------------------------------- full backup

function listFiles(dir: string, prefix: string): { name: string; file: string }[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    const name = `${prefix}/${e.name}`;
    if (e.isDirectory()) return listFiles(full, name);
    return e.isFile() && !e.name.endsWith(".tmp") ? [{ name, file: full }] : [];
  });
}

/**
 * Streams a zip of the whole data folder: a consistent copy of the database
 * (VACUUM INTO, safe while the app runs), all media and all session photos.
 */
export function backupStream(db: Db, dataDir: string): Readable {
  const out = new PassThrough();
  const tmp = path.join(dataDir, `backup-${Date.now()}.db.tmp`);
  db.$client.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);

  const zip = new Zip((err, chunk, final) => {
    if (err) {
      out.destroy(err);
      return;
    }
    out.write(Buffer.from(chunk));
    if (final) out.end();
  });

  const files = [
    { name: "kwistig.db", file: tmp },
    ...listFiles(path.join(dataDir, "media"), "media"),
    ...listFiles(path.join(dataDir, "sessions"), "sessions"),
  ];

  void (async () => {
    try {
      for (const { name, file } of files) {
        const entry = new ZipPassThrough(name);
        zip.add(entry);
        const stream = fs.createReadStream(file);
        for await (const chunk of stream) entry.push(chunk as Uint8Array);
        entry.push(new Uint8Array(0), true);
      }
      zip.end();
    } catch (err) {
      out.destroy(err as Error);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  })();
  return out;
}
