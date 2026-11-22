import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { collectImageRefs, type Quiz } from "@kwistig/shared";
import { testApp } from "./helpers.js";

const samples = path.resolve(import.meta.dirname, "../../../samples");
const sampleJson = fs.readFileSync(path.join(samples, "kitchen-sink.json"));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** Builds a package zip the way an export does, from the sample quiz and images. */
function samplePackage(mutate?: (files: Record<string, Uint8Array>) => void) {
  const files: Record<string, Uint8Array> = { "quiz.json": new Uint8Array(sampleJson) };
  for (const f of fs.readdirSync(path.join(samples, "media"))) files[`media/${f}`] = new Uint8Array(fs.readFileSync(path.join(samples, "media", f)));
  const manifest = {
    format: 1,
    app: "kwistig",
    appVersion: "test",
    quizId: "sample-kitchen-sink",
    title: "Kwistig proefquiz",
    exportedAt: new Date(0).toISOString(),
    files: Object.fromEntries(Object.entries(files).map(([p, b]) => [p, sha(b)])),
  };
  mutate?.(files);
  const zip: Zippable = { "manifest.json": strToU8(JSON.stringify(manifest)), ...files };
  return Buffer.from(zipSync(zip));
}

let app: FastifyInstance;
afterEach(async () => app?.close());

const post = (url: string, body: Buffer, cookie: string) =>
  app.inject({ method: "POST", url, payload: body, headers: { cookie, "content-type": "application/zip" } });

describe("quiz packages", () => {
  it("previews, imports with media, exports and round-trips", async () => {
    let cookie: string;
    ({ app, cookie } = await testApp());
    const zip = samplePackage();

    const preview = await post("/api/quizzes/package/preview", zip, cookie);
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ title: "Kwistig proefquiz", rounds: 3, questions: 11, slides: 5, mediaFiles: 8, existing: null });

    const imported = await post("/api/quizzes/package/import?mode=new", zip, cookie);
    expect(imported.statusCode).toBe(201);
    const q = imported.json<Quiz & { id: number; uid: string; warnings: { ref: string; message: string }[] }>();
    expect(q.uid).toBe("sample-kitchen-sink");
    // Every image now lives in the media store under its hash.
    const refs = collectImageRefs(q);
    expect(refs.every((r) => /^media\/[a-f0-9]{64}\.png$/.test(r))).toBe(true);
    expect(q.warnings.filter((w) => w.message === "missing_media")).toEqual([]);
    const img = await app.inject(`/${refs[0]}`);
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");

    // Export: the package carries the same quiz and every image, with checksums.
    const exp = await app.inject({ url: `/api/quizzes/${q.id}/package`, headers: { cookie } });
    expect(exp.headers["content-disposition"]).toContain("kwistig-kwistig-proefquiz.zip");
    const unzipped = unzipSync(new Uint8Array(exp.rawPayload));
    const manifest = JSON.parse(strFromU8(unzipped["manifest.json"]!)) as { quizId: string; files: Record<string, string> };
    expect(manifest.quizId).toBe("sample-kitchen-sink");
    expect(Object.keys(manifest.files).filter((f) => f.startsWith("media/"))).toHaveLength(8);
    const { id: _i, uid: _u, warnings: _w, ...doc } = q;
    expect(JSON.parse(strFromU8(unzipped["quiz.json"]!))).toEqual(doc);

    // Uploading the export again: preview finds the existing quiz; "new" makes a copy, "replace" overwrites.
    expect((await post("/api/quizzes/package/preview", exp.rawPayload, cookie)).json()).toMatchObject({ existing: { id: q.id } });
    const copy = (await post("/api/quizzes/package/import?mode=new", exp.rawPayload, cookie)).json<{ id: number; uid: string }>();
    expect(copy.id).not.toBe(q.id);
    expect(copy.uid).not.toBe(q.uid);
    const replaced = await post("/api/quizzes/package/import?mode=replace", exp.rawPayload, cookie);
    expect(replaced.json<{ id: number }>().id).toBe(q.id);
    // Shared images are stored once.
    expect(fs.readdirSync(app.media.dir)).toHaveLength(8);
  });

  it("refuses tampered, broken and unsafe packages", async () => {
    let cookie: string;
    ({ app, cookie } = await testApp());
    const tampered = samplePackage((f) => (f["media/trap.png"] = new Uint8Array([1, 2, 3])));
    expect((await post("/api/quizzes/package/preview", tampered, cookie)).json()).toMatchObject({
      error: "checksum_mismatch",
      issues: [{ path: "media/trap.png" }],
    });

    const invalid = samplePackage((f) => {
      const doc = JSON.parse(strFromU8(f["quiz.json"]!)) as { rounds: { items: Record<string, unknown>[] }[] };
      doc.rounds[0]!.items[1]!.correct = 9;
      f["quiz.json"] = strToU8(JSON.stringify(doc));
    });
    // The checksum catches it first; a package with a fresh manifest gets schema errors.
    expect((await post("/api/quizzes/package/preview", invalid, cookie)).json<{ error: string }>().error).toBe("checksum_mismatch");

    const traversal = Buffer.from(zipSync({ "manifest.json": strToU8("{}"), "../evil.txt": strToU8("x") }));
    expect((await post("/api/quizzes/package/preview", traversal, cookie)).json<{ error: string }>().error).toBe("invalid_path");

    expect((await post("/api/quizzes/package/preview", Buffer.from("not a zip"), cookie)).json<{ error: string }>().error).toBe("not_a_zip");
    expect((await app.inject({ method: "POST", url: "/api/quizzes/package/preview", payload: samplePackage(), headers: { "content-type": "application/zip" } })).statusCode).toBe(401);
  });

  it("schema errors in quiz.json are reported with paths", async () => {
    let cookie: string;
    ({ app, cookie } = await testApp());
    const doc = JSON.parse(sampleJson.toString("utf8")) as { rounds: { items: Record<string, unknown>[] }[] };
    doc.rounds[0]!.items[1]!.options = ["one"];
    const quizJson = strToU8(JSON.stringify(doc));
    const manifest = { format: 1, app: "kwistig", appVersion: "t", quizId: "x", title: "x", exportedAt: "", files: { "quiz.json": sha(quizJson) } };
    const zip = Buffer.from(zipSync({ "manifest.json": strToU8(JSON.stringify(manifest)), "quiz.json": quizJson }));
    expect((await post("/api/quizzes/package/preview", zip, cookie)).json()).toMatchObject({
      error: "invalid_quiz",
      issues: expect.arrayContaining([{ path: "rounds[0].items[1].options", message: "needs 2 to 6 entries" }]),
    });
  });
});

describe("full backup", () => {
  it("zips a consistent database copy plus media", async () => {
    let cookie: string;
    ({ app, cookie } = await testApp());
    await post("/api/quizzes/package/import", samplePackage(), cookie);
    const res = await app.inject({ url: "/api/settings/backup", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/kwistig-backup-.*\.zip/);
    const files = unzipSync(new Uint8Array(res.rawPayload));
    expect(Object.keys(files).filter((f) => f.startsWith("media/"))).toHaveLength(8);
    // The database copy is a real SQLite file.
    expect(strFromU8(files["kwistig.db"]!.subarray(0, 15))).toBe("SQLite format 3");
    expect(fs.readdirSync(app.config.DATA_DIR).some((f) => f.endsWith(".tmp"))).toBe(false);
  });
});
