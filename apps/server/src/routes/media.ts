import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError, parse } from "../http.js";
import { mediaUrl } from "@kwistig/shared";
import { FetchError, MAX_IMAGE_BYTES, MediaError, mimeForExt, STORED_NAME } from "../services/media.js";
import { checkYouTube, fetchNews } from "../services/external.js";
import { requireHost } from "./auth.js";

/** Image upload for the editor (host only). Body is the raw image. */
export async function mediaApiRoutes(app: FastifyInstance) {
  app.addContentTypeParser(
    ["image/png", "image/jpeg", "image/gif", "image/webp"],
    { parseAs: "buffer", bodyLimit: MAX_IMAGE_BYTES },
    (_req, body, done) => done(null, body),
  );

  app.post("/youtube/check", { preHandler: requireHost(app) }, async (req) => {
    const { videoId } = parse(z.strictObject({ videoId: z.string().regex(/^[\w-]{11}$/) }), req.body);
    return checkYouTube(app.media, videoId);
  });

  app.post("/news", { preHandler: requireHost(app) }, async (req) => {
    const { url, refresh } = parse(z.strictObject({ url: z.url(), refresh: z.boolean().optional() }), req.body);
    try {
      const info = await fetchNews(app.media, url, refresh);
      return { ...info, image: info.image ? mediaUrl(info.image) : null };
    } catch (err) {
      throw new HttpError(422, err instanceof FetchError ? err.message : "fetch_failed");
    }
  });

  app.post("/upload", { preHandler: requireHost(app) }, async (req, reply) => {
    if (!Buffer.isBuffer(req.body)) throw new HttpError(415, "unsupported_image");
    try {
      const src = app.media.storeImage(req.body);
      return reply.status(201).send({ src });
    } catch (err) {
      if (err instanceof MediaError) throw new HttpError(400, err.message);
      throw err;
    }
  });
}

/**
 * Serves stored images at /media/<sha256>.<ext>. Public: the TV needs them, and
 * names are content hashes, so they can't be guessed or enumerated.
 */
export async function mediaFileRoutes(app: FastifyInstance) {
  app.get("/media/:file", async (req, reply) => {
    const { file } = parse(z.object({ file: z.string().regex(STORED_NAME) }), req.params);
    const full = path.join(app.media.dir, file);
    if (!fs.existsSync(full)) throw new HttpError(404, "not_found");
    return reply
      .header("content-type", mimeForExt(file.split(".").pop()!))
      .header("cache-control", "public, max-age=31536000, immutable")
      .header("x-content-type-options", "nosniff")
      .send(fs.createReadStream(full));
  });
}
