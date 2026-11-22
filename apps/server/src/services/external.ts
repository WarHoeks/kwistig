import type { NewsInfo } from "@kwistig/shared";
import { FetchError, safeFetch } from "./safe-fetch.js";
import type { MediaStore } from "./media.js";

/** YouTube's oEmbed answers 401/403 for videos whose owner disabled embedding. */
export type YouTubeCheck = { ok: true; title: string; thumbnail: string | null } | { ok: false; error: "embed_blocked" | "not_found" | "unreachable" };

export async function checkYouTube(media: MediaStore, videoId: string): Promise<YouTubeCheck> {
  const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
  try {
    const res = await safeFetch(url, { maxBytes: 64 * 1024, accept: "application/json" });
    const data = JSON.parse(res.buffer.toString("utf8")) as { title?: string; thumbnail_url?: string };
    const out = { ok: true as const, title: data.title ?? "", thumbnail: data.thumbnail_url ?? null };
    media.setMeta("youtube", videoId, { title: out.title, thumbnail: out.thumbnail, checkedAt: new Date().toISOString() });
    return out;
  } catch (err) {
    const code = err instanceof FetchError ? err.message : "";
    if (code === "http_401" || code === "http_403") return { ok: false, error: "embed_blocked" };
    if (code === "http_404" || code === "http_400") return { ok: false, error: "not_found" };
    return { ok: false, error: "unreachable" };
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Reads <meta property|name="key" content="…"> in either attribute order. */
export function metaContent(html: string, key: string): string | null {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${k}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m?.[1]) return decodeEntities(m[1]).trim();
  }
  return null;
}

export function parseArticle(html: string): { headline: string | null; image: string | null } {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1];
  const headline = metaContent(html, "og:title") ?? metaContent(html, "twitter:title") ?? (title ? decodeEntities(title).trim() : null);
  const image = metaContent(html, "og:image") ?? metaContent(html, "twitter:image");
  return { headline: headline || null, image: image || null };
}

/** Fetches a news article's headline and og:image once and caches both locally. */
export async function fetchNews(media: MediaStore, url: string, refresh = false): Promise<NewsInfo> {
  if (!refresh) {
    const cached = media.getMeta<NewsInfo>("news", url);
    if (cached?.headline) return cached;
  }
  const page = await safeFetch(url, { maxBytes: 3 * 1024 * 1024, accept: "text/html" });
  const { headline, image } = parseArticle(page.buffer.toString("utf8"));
  let stored: string | null = null;
  if (image) {
    try {
      stored = await media.fetchImage(new URL(image, page.finalUrl).toString());
    } catch {
      stored = null; // a headline without picture is still useful
    }
  }
  const info: NewsInfo = { headline, image: stored };
  media.setMeta("news", url, { ...info, fetchedAt: new Date().toISOString() });
  return info;
}
