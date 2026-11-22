import type { Item, Media, Quiz } from "./quiz.js";

/**
 * Every place a quiz references an image file (media/… or a URL): image media,
 * slide background images and flitsreeks images. `fn` returns the new reference.
 * Returns a new quiz; the input is not changed.
 */
export function mapImageRefs(quiz: Quiz, fn: (ref: string) => string): Quiz {
  const mapMedia = <M extends Media | undefined>(m: M): M =>
    m && m.type === "image" ? ({ ...m, src: fn(m.src) } as M) : m;
  const mapItem = (item: Item): Item => {
    if (item.kind === "slide") {
      const out = { ...item };
      if (item.background && "image" in item.background) out.background = { image: fn(item.background.image) };
      if (item.media) out.media = mapMedia(item.media);
      return out;
    }
    if (item.answerType === "rapid_sequence") {
      return { ...item, images: item.images.map((img) => ({ ...img, src: fn(img.src) })) };
    }
    const out = { ...item };
    if (item.media) out.media = mapMedia(item.media);
    if (item.revealMedia) out.revealMedia = mapMedia(item.revealMedia);
    return out;
  };
  return { ...quiz, rounds: quiz.rounds.map((r) => ({ ...r, items: r.items.map(mapItem) })) };
}

export function collectImageRefs(quiz: Quiz): string[] {
  const refs = new Set<string>();
  mapImageRefs(quiz, (r) => (refs.add(r), r));
  return [...refs];
}

/** All news URLs in a quiz (question media, reveal media and slide media). */
export function collectNewsUrls(quiz: Quiz): string[] {
  const urls = new Set<string>();
  for (const round of quiz.rounds) {
    for (const item of round.items) {
      const ms = [
        "media" in item ? item.media : undefined,
        "revealMedia" in item ? item.revealMedia : undefined,
      ];
      for (const m of ms) if (m?.type === "news") urls.add(m.url);
    }
  }
  return [...urls];
}

/** All YouTube video ids in a quiz, normalised. */
export function collectYouTubeIds(quiz: Quiz): string[] {
  const ids = new Set<string>();
  for (const round of quiz.rounds) {
    for (const item of round.items) {
      for (const m of ["media" in item ? item.media : undefined, "revealMedia" in item ? item.revealMedia : undefined]) {
        if (m?.type === "youtube") {
          const id = youTubeId(m.videoId);
          if (id) ids.add(id);
        }
      }
    }
  }
  return [...ids];
}

/** Extracts the 11-character id from an id or any common YouTube URL form. */
export function youTubeId(ref: string): string | null {
  if (/^[\w-]{11}$/.test(ref)) return ref;
  try {
    const u = new URL(ref);
    const host = u.hostname.replace(/^(www\.|m\.|music\.)/, "");
    let id: string | null = null;
    if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0] ?? null;
    else if (host === "youtube.com" || host === "youtube-nocookie.com") {
      id = u.searchParams.get("v");
      const m = /^\/(embed|shorts|live|v)\/([\w-]{11})/.exec(u.pathname);
      if (!id && m) id = m[2]!;
    }
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Browser URL for a stored media reference ("media/abc.png" → "/media/abc.png"). */
export function mediaUrl(ref: string): string {
  return /^https?:\/\//.test(ref) ? ref : `/${ref.replace(/^\/+/, "")}`;
}

/** Replaces a word in a headline with a blank, keeping the rest. Case-insensitive, whole word. */
export function blankHeadline(headline: string, word: string | undefined): string {
  if (!word) return headline;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return headline.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu"), "_____");
}
