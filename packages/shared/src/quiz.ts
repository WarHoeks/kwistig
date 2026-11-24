import { z } from "zod";

/**
 * The Kwistig quiz format. Single source of truth for import, export, the admin
 * editor and /api/schema/quiz.json.
 *
 * No `.default()` here on purpose: what is stored is exactly what was imported,
 * so export round-trips. Defaults are applied at game time by `resolve.ts`.
 */

export const Language = z.enum(["nl", "en"]);
export type Language = z.infer<typeof Language>;

/** A plain string (in the quiz language) or a per-language object. */
export const LocalizedText = z.union([
  z.string().min(1),
  z
    .strictObject({ nl: z.string().min(1).optional(), en: z.string().min(1).optional() })
    .refine((t) => t.nl !== undefined || t.en !== undefined, "needs nl or en"),
]);
export type LocalizedText = z.infer<typeof LocalizedText>;

/** Path inside a package (media/…) or an http(s) URL that the server downloads on import. */
export const MediaRef = z
  .string()
  .regex(/^(media\/[\w.\-/]+|https?:\/\/\S+)$/, "must be media/… or an http(s) URL");

const Sec = z.number().nonnegative();
const startEnd = (m: { startSec?: number | undefined; endSec?: number | undefined }) =>
  m.startSec === undefined || m.endSec === undefined || m.endSec > m.startSec;
const startEndIssue = { message: "endSec must be after startSec", path: ["endSec"] };

const mediaBase = {
  /** "before": media plays first, then the question appears. Default "with". */
  play: z.enum(["before", "with"]).optional(),
};

export const ImageMedia = z.strictObject({
  type: z.literal("image"),
  ...mediaBase,
  src: MediaRef,
  /** Reveal effect over the timer duration. Default "none". */
  reveal: z.enum(["none", "pixelate", "zoom", "blur"]).optional(),
  alt: LocalizedText.optional(),
});

export const YouTubeMedia = z
  .strictObject({
    type: z.literal("youtube"),
    ...mediaBase,
    /** 11-char video id or a youtube.com / youtu.be URL, kept as given. */
    videoId: z
      .string()
      .regex(
        /^([\w-]{11}|https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\/\S+)$/,
        "must be a YouTube video id or URL",
      ),
    startSec: Sec.optional(),
    endSec: Sec.optional(),
    /** Audio only behind a cover. */
    hideVideo: z.boolean().optional(),
  })
  .refine(startEnd, startEndIssue);

export const SpotifyMedia = z
  .strictObject({
    type: z.literal("spotify"),
    ...mediaBase,
    /** spotify:track:… URI or open.spotify.com track URL, kept as given. */
    uri: z
      .string()
      .regex(
        /^(spotify:track:[A-Za-z0-9]{22}|https:\/\/open\.spotify\.com\/(intl-[\w-]+\/)?track\/[A-Za-z0-9]{22}\S*)$/,
        "must be a Spotify track URI or URL",
      ),
    startSec: Sec.optional(),
    endSec: Sec.optional(),
  })
  .refine(startEnd, startEndIssue);

export const NewsMedia = z.strictObject({
  type: z.literal("news"),
  ...mediaBase,
  url: z.url(),
  /** Word blanked out of the fetched headline. */
  blankWord: z.string().min(1).optional(),
});

export const Media = z.discriminatedUnion("type", [ImageMedia, YouTubeMedia, SpotifyMedia, NewsMedia]);
export type Media = z.infer<typeof Media>;
export type MediaType = Media["type"];

const Points = z.number().positive();
const TimeLimit = z.number().int().min(5).max(600);

const questionCommon = {
  kind: z.literal("question"),
  prompt: LocalizedText,
  /** Host remote only. */
  hostNotes: z.string().min(1).optional(),
  /** Shown on the TV at reveal. */
  explanation: LocalizedText.optional(),
};

const questionBase = {
  ...questionCommon,
  /** Falls back to round.defaults.points, then 1. */
  points: Points.optional(),
  /** Falls back to round.defaults.timeLimitSec, then no timer. */
  timeLimitSec: TimeLimit.optional(),
  media: Media.optional(),
  /** Played at reveal, e.g. the full clip after a guess-the-song. */
  revealMedia: Media.optional(),
};

const optionsCount = "needs 2 to 6 entries";
export const MultipleChoice = z
  .strictObject({
    ...questionBase,
    answerType: z.literal("multiple_choice"),
    options: z.array(LocalizedText).min(2, optionsCount).max(6, optionsCount),
    /** 0-based index into options. */
    correct: z.number().int().min(0),
  })
  .refine((q) => q.correct < q.options.length, { message: "must point at an option", path: ["correct"] });

export const TrueFalse = z.strictObject({
  ...questionBase,
  answerType: z.literal("true_false"),
  correct: z.boolean(),
});

export const Open = z.strictObject({
  ...questionBase,
  answerType: z.literal("open"),
  acceptedAnswers: z.array(z.string().min(1)).min(1, "needs at least 1 entry"),
});

export const NumberScoring = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("closest") }),
  z.strictObject({ mode: z.literal("tolerance"), tolerance: z.number().nonnegative() }),
]);

export const NumberQuestion = z.strictObject({
  ...questionBase,
  answerType: z.literal("number"),
  correct: z.number(),
  unit: LocalizedText.optional(),
  /** Default: closest. */
  scoring: NumberScoring.optional(),
});

export const Buzzer = z.strictObject({
  ...questionBase,
  answerType: z.literal("buzzer"),
  /** Shown to the host; revealed on the TV. */
  answer: LocalizedText,
});

const imagesCount = "needs 5 to 20 images";
export const RapidSequence = z.strictObject({
  ...questionCommon,
  answerType: z.literal("rapid_sequence"),
  buttonLabel: LocalizedText,
  /** Default 5. */
  secondsPerImage: z.number().min(1).max(30).optional(),
  /** Grace window after each image switch. Default 300. */
  graceMs: z.number().int().min(0).max(2000).optional(),
  /** Show each image's caption under it while the sequence runs. Default false (captions only at reveal). */
  showCaptions: z.boolean().optional(),
  scoring: z
    .strictObject({
      /** Default 1. */
      pointsPerImage: Points.optional(),
      /** Up to 1 extra point for a correct press in the first second. Default false. */
      speedBonus: z.boolean().optional(),
      /** Points subtracted for pressing on a "no" image. Default 0. */
      wrongPressPenalty: z.number().nonnegative().optional(),
    })
    .optional(),
  images: z
    .array(
      z.strictObject({
        src: MediaRef,
        yes: z.boolean(),
        /** Shown at reveal, and during the sequence when showCaptions is on. */
        caption: LocalizedText.optional(),
      }),
    )
    .min(5, imagesCount)
    .max(20, imagesCount),
});

export const Question = z.discriminatedUnion("answerType", [
  MultipleChoice,
  TrueFalse,
  Open,
  NumberQuestion,
  Buzzer,
  RapidSequence,
]);
export type Question = z.infer<typeof Question>;
export type AnswerType = Question["answerType"];
export const ANSWER_TYPES = [
  "multiple_choice",
  "true_false",
  "open",
  "number",
  "buzzer",
  "rapid_sequence",
] as const satisfies readonly AnswerType[];

export const Slide = z.strictObject({
  kind: z.literal("slide"),
  title: LocalizedText,
  /** Short Markdown. */
  body: LocalizedText.optional(),
  background: z
    .union([
      z.strictObject({ color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be #rrggbb") }),
      z.strictObject({ image: MediaRef }),
    ])
    .optional(),
  media: Media.optional(),
  /** e.g. "Pauze — 10 minuten". */
  countdownSec: z.number().int().positive().optional(),
  /** "scoreboard" makes the TV show the current standings. Default "content". */
  show: z.enum(["content", "scoreboard"]).optional(),
});
export type Slide = z.infer<typeof Slide>;

export const Item = z.discriminatedUnion("kind", [Slide, Question]);
export type Item = z.infer<typeof Item>;

export const RoundDefaults = z.strictObject({
  points: Points.optional(),
  timeLimitSec: TimeLimit.optional(),
});

export const Round = z.strictObject({
  title: LocalizedText,
  defaults: RoundDefaults.optional(),
  items: z.array(Item).min(1, "needs at least 1 item"),
});
export type Round = z.infer<typeof Round>;

export const QUIZ_FORMAT_VERSION = 1;

export const Quiz = z.strictObject({
  version: z.literal(QUIZ_FORMAT_VERSION),
  title: LocalizedText,
  language: Language,
  description: LocalizedText.optional(),
  rounds: z.array(Round).min(1, "needs at least 1 round"),
});
export type Quiz = z.infer<typeof Quiz>;
