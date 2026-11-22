import { collectNewsUrls, mapImageRefs, type Quiz } from "@kwistig/shared";
import { FetchError, MediaError, type MediaStore } from "./media.js";
import { fetchNews } from "./external.js";

export interface MediaWarning {
  ref: string;
  message: string;
}

/**
 * Makes a quiz's image references point into the media store:
 * - http(s) URLs are downloaded and replaced by "media/<sha>.<ext>";
 * - "media/<name>" files supplied by a package are stored and renamed the same way;
 * - references already in the store are kept;
 * - anything else is kept as-is and reported, so the TV shows a placeholder.
 */
export async function prepareQuizMedia(
  store: MediaStore,
  doc: Quiz,
  files: ReadonlyMap<string, Buffer> = new Map(),
): Promise<{ doc: Quiz; warnings: MediaWarning[] }> {
  const warnings: MediaWarning[] = [];
  const resolved = new Map<string, string>();

  const refs = new Set<string>();
  mapImageRefs(doc, (r) => (refs.add(r), r));

  for (const ref of refs) {
    try {
      if (/^https?:\/\//.test(ref)) {
        resolved.set(ref, await store.fetchImage(ref));
      } else if (files.has(ref)) {
        resolved.set(ref, store.storeImage(files.get(ref)!));
      } else if (!store.fileFor(ref)) {
        warnings.push({ ref, message: "missing_media" });
      }
    } catch (err) {
      const code = err instanceof FetchError || err instanceof MediaError ? err.message : "fetch_failed";
      warnings.push({ ref, message: code });
    }
  }

  // News articles are fetched once; later saves and game sessions use the cache.
  for (const url of collectNewsUrls(doc)) {
    try {
      const info = await fetchNews(store, url);
      if (!info.headline) warnings.push({ ref: url, message: "no_headline" });
    } catch (err) {
      warnings.push({ ref: url, message: err instanceof FetchError ? err.message : "fetch_failed" });
    }
  }

  return { doc: resolved.size ? mapImageRefs(doc, (r) => resolved.get(r) ?? r) : doc, warnings };
}
