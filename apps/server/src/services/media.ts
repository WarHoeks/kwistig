import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { mediaAsset } from "../db/schema.js";
import { FetchError, safeFetch } from "./safe-fetch.js";

/**
 * Content-addressed image store: files live in DATA_DIR/media/<sha256>.<ext> and
 * quizzes reference them as "media/<sha256>.<ext>", so identical images are
 * stored once and package round-trips keep the same names.
 */

export const STORED_NAME = /^[a-f0-9]{64}\.(png|jpg|gif|webp)$/;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

const TYPES = [
  { ext: "png", mime: "image/png", magic: (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: "jpg", mime: "image/jpeg", magic: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "gif", mime: "image/gif", magic: (b: Buffer) => b.subarray(0, 4).toString("latin1") === "GIF8" },
  {
    ext: "webp",
    mime: "image/webp",
    magic: (b: Buffer) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  },
] as const;

export const mimeForExt = (ext: string) => TYPES.find((t) => t.ext === ext)?.mime ?? "application/octet-stream";

export class MediaError extends Error {}

export class MediaStore {
  readonly dir: string;

  constructor(
    private readonly db: Db,
    dataDir: string,
  ) {
    this.dir = path.join(dataDir, "media");
    fs.mkdirSync(this.dir, { recursive: true });
  }

  /** Detects the image type from its bytes. SVG and anything else is refused. */
  static detect(buf: Buffer) {
    return TYPES.find((t) => t.magic(buf));
  }

  /** Stores an image (once per content) and returns its quiz reference "media/<sha>.<ext>". */
  storeImage(buf: Buffer, quizId: number | null = null): string {
    if (buf.length > MAX_IMAGE_BYTES) throw new MediaError("too_large");
    const type = MediaStore.detect(buf);
    if (!type) throw new MediaError("unsupported_image");
    const sha = createHash("sha256").update(buf).digest("hex");
    const name = `${sha}.${type.ext}`;
    const file = path.join(this.dir, name);
    if (!fs.existsSync(file)) {
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, file);
    }
    const exists = this.db.select({ id: mediaAsset.id }).from(mediaAsset).where(eq(mediaAsset.sha256, sha)).get();
    if (!exists) this.db.insert(mediaAsset).values({ kind: "image", path: name, sha256: sha, quizId }).run();
    return `media/${name}`;
  }

  async fetchImage(url: string): Promise<string> {
    const res = await safeFetch(url, { maxBytes: MAX_IMAGE_BYTES, accept: "image/*" });
    return this.storeImage(res.buffer);
  }

  /** Absolute path of a stored reference, or null if it isn't in the store. */
  fileFor(ref: string): string | null {
    const name = ref.replace(/^media\//, "");
    if (!STORED_NAME.test(name)) return null;
    const file = path.join(this.dir, name);
    return fs.existsSync(file) ? file : null;
  }

  // ---------------------------------------------------------------- metadata cache (news, YouTube)

  getMeta<T>(kind: "news" | "youtube", externalId: string): T | null {
    const row = this.db
      .select({ meta: mediaAsset.meta })
      .from(mediaAsset)
      .where(and(eq(mediaAsset.kind, kind), eq(mediaAsset.externalId, externalId)))
      .get();
    return (row?.meta as T | undefined) ?? null;
  }

  setMeta(kind: "news" | "youtube", externalId: string, meta: Record<string, unknown>) {
    const row = this.db
      .select({ id: mediaAsset.id })
      .from(mediaAsset)
      .where(and(eq(mediaAsset.kind, kind), eq(mediaAsset.externalId, externalId)))
      .get();
    if (row) this.db.update(mediaAsset).set({ meta }).where(eq(mediaAsset.id, row.id)).run();
    else this.db.insert(mediaAsset).values({ kind, externalId, meta }).run();
  }
}

export { FetchError };
