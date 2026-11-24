import { blankHeadline, mediaUrl, youTubeId } from "./media.js";
import type { Media } from "./quiz.js";
import type { RunItem } from "./run.js";
import type { AnswerValue, NewsInfo, PublicItem, PublicMedia, RevealInfo } from "./state.js";

/**
 * What the TV may see of an item. Used by the server's projections (the security
 * boundary) and by the editor's live TV preview, so both render the same thing.
 */

/**
 * Media as the TV may see it. News headlines are blanked here; the blanked word
 * and Spotify track details never leave the server before reveal.
 */
export function publicMedia(m: Media, news: Record<string, NewsInfo> | undefined): PublicMedia {
  const play = m.play ?? "with";
  switch (m.type) {
    case "image":
      return { type: "image", src: mediaUrl(m.src), reveal: m.reveal ?? "none", play };
    case "youtube":
      return {
        type: "youtube",
        videoId: youTubeId(m.videoId),
        ...(m.startSec !== undefined ? { startSec: m.startSec } : {}),
        ...(m.endSec !== undefined ? { endSec: m.endSec } : {}),
        hideVideo: m.hideVideo ?? false,
        play,
      };
    case "spotify":
      return {
        type: "spotify",
        ...(m.startSec !== undefined ? { startSec: m.startSec } : {}),
        ...(m.endSec !== undefined ? { endSec: m.endSec } : {}),
        play,
      };
    case "news": {
      const info = news?.[m.url];
      return {
        type: "news",
        headline: info?.headline ? blankHeadline(info.headline, m.blankWord) : null,
        image: info?.image ? mediaUrl(info.image) : null,
        play,
      };
    }
  }
}

export function publicItem(ri: RunItem, qCount: number, news: Record<string, NewsInfo> | undefined = {}): PublicItem {
  const base = { cursor: ri.cursor, roundIndex: ri.roundIndex, roundTitle: ri.roundTitle };
  const item = ri.item;
  if (item.kind === "slide") {
    const bg = item.background;
    return {
      kind: "slide",
      ...base,
      title: item.title,
      ...(item.body !== undefined ? { body: item.body } : {}),
      ...(bg !== undefined ? { background: "image" in bg ? { image: mediaUrl(bg.image) } : bg } : {}),
      ...(item.media !== undefined ? { media: publicMedia(item.media, news) } : {}),
      show: item.show ?? "content",
      ...(item.countdownSec !== undefined ? { countdownSec: item.countdownSec } : {}),
    };
  }
  return {
    kind: "question",
    ...base,
    questionNumber: ri.questionNumber ?? 0,
    questionCount: qCount,
    answerType: item.answerType,
    prompt: item.prompt,
    ...(item.answerType === "multiple_choice" ? { options: item.options } : {}),
    ...(item.answerType === "number" && item.unit !== undefined ? { unit: item.unit } : {}),
    points: ri.points,
    ...(ri.timeLimitSec !== undefined ? { timeLimitSec: ri.timeLimitSec } : {}),
    ...(item.answerType !== "rapid_sequence" && item.media ? { media: publicMedia(item.media, news) } : {}),
    ...(item.answerType === "rapid_sequence"
      ? {
          sequence: {
            images: item.images.map((img) => mediaUrl(img.src)),
            ...(item.showCaptions ? { captions: item.images.map((img) => img.caption ?? null) } : {}),
            secondsPerImage: item.secondsPerImage ?? 5,
            buttonLabel: item.buttonLabel,
          },
        }
      : {}),
  };
}

/** The correct answer as shown at reveal and to the host. */
export function correctValue(run: RunItem): AnswerValue | null {
  const item = run.item;
  if (item.kind !== "question") return null;
  switch (item.answerType) {
    case "multiple_choice":
    case "true_false":
    case "number":
      return item.correct;
    case "open":
      return item.acceptedAnswers[0] ?? null;
    case "rapid_sequence":
      // One character per image: "1" = yes (press), "0" = no.
      return item.images.map((img) => (img.yes ? "1" : "0")).join("");
    case "buzzer":
      // The answer as text in the quiz language (the TV shows answerText per language).
      return typeof item.answer === "string" ? item.answer : (item.answer.nl ?? item.answer.en ?? "");
  }
}

/** The reveal as the TV shows it, without any team results: for the editor's preview. */
export function previewReveal(ri: RunItem): RevealInfo | null {
  const item = ri.item;
  const correct = correctValue(ri);
  if (item.kind !== "question" || correct === null) return null;
  const rm = item.answerType !== "rapid_sequence" ? item.revealMedia : undefined;
  return {
    correct,
    ...(item.answerType === "open" ? { acceptedAnswers: item.acceptedAnswers } : {}),
    ...(item.explanation !== undefined ? { explanation: item.explanation } : {}),
    ...(item.answerType === "buzzer" ? { answerText: item.answer } : {}),
    ...(rm ? { revealMedia: publicMedia(rm, {}) } : {}),
    ...(item.answerType === "rapid_sequence"
      ? {
          images: item.images.map((img) => ({
            src: mediaUrl(img.src),
            yes: img.yes,
            ...(img.caption !== undefined ? { caption: img.caption } : {}),
            presses: 0,
          })),
        }
      : {}),
    results: [],
  };
}
