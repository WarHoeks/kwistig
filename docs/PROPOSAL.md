# Kwistig — repo layout and quiz schema (proposal, for review)

## 1. Repo layout

npm workspaces monorepo. One `shared` package so the server and every screen use the same Zod schemas and types.

```
kwistig/
├─ package.json                 # workspaces, root scripts: dev, build, test, e2e, lint, i18n:check
├─ tsconfig.base.json
├─ Dockerfile                   # multi-stage: deps → build (shared, web, server) → runtime (node:22-slim)
├─ docker-compose.yml           # exactly as in PLAN.md
├─ .dockerignore  .gitignore    # data/ ignored
├─ README.md                    # setup: firewall, PUBLIC_BASE_URL, YouTube sign-in, Spotify app
├─ docs/PLAN.md
│
├─ packages/shared/             # pure TS, no Node/DOM deps; imported by server + web
│  └─ src/
│     ├─ quiz.ts                # Zod quiz schema (below) + inferred types
│     ├─ localized.ts           # LocalizedText helpers: pick(text, lang, fallbackLang)
│     ├─ errors.ts              # ZodError → "rounds[0].items[2].options: needs 2 to 6 entries"
│     ├─ protocol.ts            # Zod schemas for every socket intent + server event, per role
│     ├─ state.ts               # GameState type, phases, per-role projection types
│     └─ matching.ts            # open-answer normalise + fuzzy match (case/accents/articles/typos)
│
├─ apps/server/
│  ├─ drizzle.config.ts
│  ├─ drizzle/                  # generated SQL migrations, run at boot
│  └─ src/
│     ├─ index.ts               # Fastify + Socket.IO bootstrap, serves web/dist with SPA fallback
│     ├─ config.ts              # env parsed with Zod (PORT, HOST_PIN, PUBLIC_BASE_URL, …)
│     ├─ db/  schema.ts client.ts
│     ├─ auth/  pin.ts           # PIN hash in `setting`, signed httpOnly cookie
│     ├─ routes/  health quizzes import-export schema media settings sessions spotify
│     ├─ game/
│     │  ├─ machine.ts          # PURE reducer: (state, intent, now) → { state, effects }
│     │  ├─ scoring.ts          # pure: MC/TF/open/number/flitsreeks/buzzer, standings diff
│     │  ├─ project.ts          # pure: state → TV / host / team projection (strips answers pre-reveal)
│     │  ├─ runner.ts           # owns the active session: apply → persist (1 txn) → broadcast; timers
│     │  └─ hub.ts              # Socket.IO rooms (tv, host, team:<id>), Zod-validates every payload
│     └─ services/  qr.ts media-store.ts news.ts spotify.ts packages.ts backup.ts
│  └─ test/                     # Vitest: machine, scoring, matching, projection, import round-trip
│
├─ apps/web/
│  ├─ vite.config.ts  tailwind config
│  └─ src/
│     ├─ main.tsx  router.tsx   # /tv /host /play /join/:code /admin
│     ├─ i18n/  index.ts nl.json en.json
│     ├─ lib/  socket.ts (typed client, reconnect + token)  api.ts
│     ├─ components/            # shared UI: CountdownBar, TeamChip, MediaPlayer, Markdown…
│     └─ screens/  tv/ host/ play/ join/ admin/
│
├─ samples/
│  ├─ kitchen-sink.json         # every answer type × every media type, used by tests
│  ├─ text-10.json              # 10-question text quiz for the Phase 2 demo
│  └─ media/                    # small test images
├─ e2e/
│  ├─ playwright.config.ts
│  └─ full-game.spec.ts         # TV + host + 2 team contexts, full game
└─ scripts/check-i18n.ts        # fails if nl and en key sets differ
```

Design choices worth calling out:

- **The state machine is a pure reducer.** `machine.ts` takes the current state, an intent and `now`, and returns the new state plus effects (start timer, play media…). No I/O, so it unit-tests without sockets or a DB. `runner.ts` does the impure part: write to SQLite in one transaction, *then* broadcast.
- **Projections are the security boundary.** `project.ts` builds what each role receives; TV/team projections are typed without `correct`, `acceptedAnswers` or `hostNotes` before `revealed`, and a unit test asserts that for every item in the sample quiz.
- **Persistence:** `game_session.state` holds a JSON snapshot of the machine state, and the `answer` / `team` / `player` tables hold the normalised rows from the plan. On boot the runner reloads the active session and re-arms timers from stored server timestamps.

## 2. Zod quiz schema (`packages/shared/src/quiz.ts`)

Zod 4, so `z.toJSONSchema(Quiz)` serves `/api/schema/quiz.json` directly.

```ts
import { z } from "zod";

export const Language = z.enum(["nl", "en"]);

/** A plain string (in the quiz language) or a per-language object. */
export const LocalizedText = z.union([
  z.string().min(1),
  z.strictObject({ nl: z.string().min(1).optional(), en: z.string().min(1).optional() })
    .refine((t) => t.nl || t.en, "needs nl or en"),
]);

/** Path inside a package (media/…) or an http(s) URL that the server downloads on import. */
const MediaRef = z.string().regex(/^(media\/[\w.\-/]+|https?:\/\/\S+)$/, "must be media/… or an http(s) URL");
const Sec = z.number().nonnegative();
const startEnd = (m: { startSec?: number; endSec?: number }) =>
  m.startSec === undefined || m.endSec === undefined || m.endSec > m.startSec;

const mediaBase = { play: z.enum(["before", "with"]).optional() }; // default "with"

export const ImageMedia = z.strictObject({
  type: z.literal("image"), ...mediaBase,
  src: MediaRef,
  reveal: z.enum(["none", "pixelate", "zoom", "blur"]).optional(),   // default "none"
  alt: LocalizedText.optional(),
});
export const YouTubeMedia = z.strictObject({
  type: z.literal("youtube"), ...mediaBase,
  videoId: z.string().regex(/^([\w-]{11}|https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/\S+)$/), // id or URL, kept as given
  startSec: Sec.optional(), endSec: Sec.optional(),
  hideVideo: z.boolean().optional(),
}).refine(startEnd, { message: "endSec must be after startSec", path: ["endSec"] });
export const SpotifyMedia = z.strictObject({
  type: z.literal("spotify"), ...mediaBase,
  uri: z.string().regex(/^(spotify:track:[A-Za-z0-9]{22}|https:\/\/open\.spotify\.com\/(intl-\w+\/)?track\/[A-Za-z0-9]{22}\S*)$/),
  startSec: Sec.optional(), endSec: Sec.optional(),
}).refine(startEnd, { message: "endSec must be after startSec", path: ["endSec"] });
export const NewsMedia = z.strictObject({
  type: z.literal("news"), ...mediaBase,
  url: z.url(),
  blankWord: z.string().optional(),        // word blanked out of the fetched headline
});
export const Media = z.discriminatedUnion("type", [ImageMedia, YouTubeMedia, SpotifyMedia, NewsMedia]);

const Points = z.number().positive();
const TimeLimit = z.number().int().min(5).max(600);

const questionBase = {
  kind: z.literal("question"),
  prompt: LocalizedText,
  points: Points.optional(),               // falls back to round.defaults, then 1
  timeLimitSec: TimeLimit.optional(),      // falls back to round.defaults, then no timer
  hostNotes: z.string().optional(),        // host remote only
  explanation: LocalizedText.optional(),   // TV at reveal
  media: Media.optional(),
  revealMedia: Media.optional(),           // e.g. the full clip after a guess-the-song
};

export const MultipleChoice = z.strictObject({
  ...questionBase, answerType: z.literal("multiple_choice"),
  options: z.array(LocalizedText).min(2, "needs 2 to 6 entries").max(6, "needs 2 to 6 entries"),
  correct: z.number().int().min(0),        // 0-based index into options
}).refine((q) => q.correct < q.options.length, { message: "must point at an option", path: ["correct"] });

export const TrueFalse = z.strictObject({
  ...questionBase, answerType: z.literal("true_false"),
  correct: z.boolean(),
});

export const Open = z.strictObject({
  ...questionBase, answerType: z.literal("open"),
  acceptedAnswers: z.array(z.string().min(1)).min(1),
});

export const NumberQ = z.strictObject({
  ...questionBase, answerType: z.literal("number"),
  correct: z.number(),
  unit: LocalizedText.optional(),
  scoring: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("closest") }),
    z.strictObject({ mode: z.literal("tolerance"), tolerance: z.number().nonnegative() }),
  ]).optional(),                           // default: see open decision 2
});

export const Buzzer = z.strictObject({
  ...questionBase, answerType: z.literal("buzzer"),
  answer: LocalizedText,                   // shown to host; revealed on TV
});

const { media: _m, revealMedia: _r, timeLimitSec: _t, points: _p, ...flitsBase } = questionBase;
export const RapidSequence = z.strictObject({
  ...flitsBase, answerType: z.literal("rapid_sequence"),
  buttonLabel: LocalizedText,
  secondsPerImage: z.number().min(1).max(30).optional(),        // default 5
  graceMs: z.number().int().min(0).max(2000).optional(),        // default 300
  scoring: z.strictObject({
    pointsPerImage: Points.optional(),                          // default 1
    speedBonus: z.boolean().optional(),                         // default false
    wrongPressPenalty: z.number().nonnegative().optional(),     // default 0
  }).optional(),
  images: z.array(z.strictObject({
    src: MediaRef, yes: z.boolean(), caption: LocalizedText.optional(),
  })).min(5, "needs 5 to 20 images").max(20, "needs 5 to 20 images"),
});

export const Question = z.discriminatedUnion("answerType",
  [MultipleChoice, TrueFalse, Open, NumberQ, Buzzer, RapidSequence]);

export const Slide = z.strictObject({
  kind: z.literal("slide"),
  title: LocalizedText,
  body: LocalizedText.optional(),          // short Markdown
  background: z.union([
    z.strictObject({ color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
    z.strictObject({ image: MediaRef }),
  ]).optional(),
  media: Media.optional(),
  countdownSec: z.number().int().positive().optional(),   // e.g. "Pauze — 10 minuten"
  show: z.enum(["content", "scoreboard"]).optional(),     // scoreboard slide
});

export const Item = z.discriminatedUnion("kind", [Slide, Question]);

export const Round = z.strictObject({
  title: LocalizedText,
  defaults: z.strictObject({ points: Points.optional(), timeLimitSec: TimeLimit.optional() }).optional(),
  items: z.array(Item).min(1),
});

export const Quiz = z.strictObject({
  version: z.literal(1),
  title: LocalizedText,
  language: Language,
  description: LocalizedText.optional(),
  rounds: z.array(Round).min(1),
});

export type Quiz = z.infer<typeof Quiz>;
export type Item = z.infer<typeof Item>;
export type Question = z.infer<typeof Question>;
export type Media = z.infer<typeof Media>;
```

Schema rules behind this:

- **No `.default()` in the import schema.** Defaults (points 1, 5 s per image, 300 ms grace, `play: "with"`…) are filled in by a `resolveItem(item, round)` at game time. That way what's stored is what was imported, and export is deep-equal to the input, which is the Phase 1 "Done when".
- **Strict objects everywhere**, so a typo like `acceptedAnswer` fails with its path instead of being silently dropped. This matters most for LLM-generated quizzes.
- **YouTube and Spotify accept an ID/URI or a full URL**, kept exactly as given and normalised when played, so round-trips stay identical. Images given as URLs are the one exception: they're downloaded on import and rewritten to `media/<sha256>.<ext>`.
- **IDs live in the database, not in `quiz.json`.** Rounds and items get DB ids for the editor and for answers. The package `manifest.json` carries the quiz id for "replace existing".
- The question kinds that need them have their own `points` and media fields. Flitsreeks drops `media`, `timeLimitSec` and `points` because its images and `pointsPerImage` replace them.
