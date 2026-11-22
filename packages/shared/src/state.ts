import type { Item, Language, LocalizedText } from "./quiz.js";

/**
 * Game state as the server stores it, and the per-role views it sends.
 * The views are the security boundary: TvView and TeamView never contain correct
 * answers, accepted answers or host notes before the item is revealed.
 */

export type Phase = "lobby" | "photos" | "item" | "finished";
export type Step = "shown" | "answering" | "locked" | "revealed";
export type Verdict = "correct" | "half" | "wrong" | "pending";
export type AnswerValue = number | boolean | string;
export type MatchKind = "exact" | "fuzzy" | "none";

export interface TimerState {
  /** Server epoch ms when time runs out. */
  endsAt: number;
  durationMs: number;
}

export interface TeamRec {
  id: number;
  name: string;
  emoji: string;
  color: string;
  /** File name under the session folder; bumped on retake. */
  photo: string | null;
}

export interface PlayerRec {
  id: number;
  teamId: number;
  nickname: string | null;
  tokenHash: string;
}

/** One phone's vote for its team's answer. */
export interface Vote {
  value: AnswerValue;
  at: number;
}

/**
 * A team's answer, decided at lock time from its phones' votes: the option with
 * the most votes wins; a tie is broken by a random draw.
 */
export interface AnswerRec {
  value: AnswerValue;
  /** The phone that first proposed the winning option. */
  playerId: number;
  at: number;
  verdict: Verdict;
  points: number;
  /** Votes for the winning option, and all votes the team cast. */
  votes: number;
  totalVotes: number;
  /** True when the winning option was drawn from a tie. */
  tieBreak: boolean;
  /** For open answers: how the auto-match went. */
  match?: MatchKind;
  /** True once the host set the verdict by hand. */
  manual?: boolean;
}

export interface ItemRun {
  step: Step;
  /** Votes while answering: team id → player id → vote. */
  votes: Record<string, Record<string, Vote>>;
  /** Resolved team answers, keyed by team id. Filled at lock. */
  answers: Record<string, AnswerRec>;
  timer: TimerState | null;
  /** Flitsreeks: timing once started. */
  seq?: SequenceState;
  /** Flitsreeks: first press per team per image, judged by server receive time. */
  presses?: Record<string, Record<string, { playerId: number; at: number }>>;
  /** Flitsreeks reveal: image the host spotlights on the TV. */
  spotlight?: number | null;
}

/**
 * Playback of the current item's audio/video. The host sends commands, the TV
 * plays and reports "ended"/"error" back. `seq` increases on every (re)start so
 * the TV knows to load the clip from its start marker again.
 */
export interface MediaPlayback {
  cursor: number;
  slot: "question" | "reveal";
  status: "idle" | "playing" | "paused" | "ended" | "error";
  seq: number;
  muted: boolean;
  error?: string;
}

/** Fetched once per news URL when the session starts. */
export interface NewsInfo {
  headline: string | null;
  image: string | null;
}

export interface Overlay {
  scoreboard: boolean;
  message: { text: string; style: "slide" | "banner" } | null;
}

export interface GameState {
  v: 1;
  sessionId: number;
  quizId: number | null;
  joinCode: string;
  quizTitle: LocalizedText;
  quizLang: Language;
  phase: Phase;
  /** Index into the run order; meaningful in phase "item". */
  cursor: number;
  /** Per-item state, keyed by cursor, so "previous" restores it. */
  items: Record<string, ItemRun>;
  teams: TeamRec[];
  players: PlayerRec[];
  /** Manual score adjustments per team id. */
  adjustments: Record<string, number>;
  overlay: Overlay;
  autoLock: boolean;
  /** Playback state of the current item's media; absent in older snapshots. */
  media?: MediaPlayback;
  /** Cached news headlines and images by URL; absent in older snapshots. */
  news?: Record<string, NewsInfo>;
}

// ---------------------------------------------------------------- views

export interface PublicTeam {
  id: number;
  name: string;
  emoji: string;
  color: string;
  photoUrl: string | null;
  score: number;
  rank: number;
}

/**
 * Media as the TV may see it before reveal: image URLs and effects, a YouTube id
 * with its markers, a news headline with the word blanked. Never Spotify track
 * info, never the blanked word.
 */
export type PublicMedia =
  | { type: "image"; src: string; reveal: "none" | "pixelate" | "zoom" | "blur"; play: "before" | "with" }
  | {
      type: "youtube";
      videoId: string | null;
      startSec?: number;
      endSec?: number;
      hideVideo: boolean;
      play: "before" | "with";
    }
  | { type: "spotify"; startSec?: number; endSec?: number; play: "before" | "with" }
  | { type: "news"; headline: string | null; image: string | null; play: "before" | "with" };

/** Question/slide content that is safe to show before reveal. */
export type PublicItem =
  | {
      kind: "slide";
      cursor: number;
      roundIndex: number;
      roundTitle: LocalizedText;
      title: LocalizedText;
      body?: LocalizedText;
      /** Colour, or a browser URL for a background image. */
      background?: { color: string } | { image: string };
      media?: PublicMedia;
      show: "content" | "scoreboard";
      countdownSec?: number;
    }
  | {
      kind: "question";
      cursor: number;
      roundIndex: number;
      roundTitle: LocalizedText;
      questionNumber: number;
      questionCount: number;
      answerType: Extract<Item, { kind: "question" }>["answerType"];
      prompt: LocalizedText;
      options?: LocalizedText[];
      unit?: LocalizedText;
      points: number;
      timeLimitSec?: number;
      media?: PublicMedia;
      /** Flitsreeks only: the images in order (no yes/no, no captions). */
      sequence?: { images: string[]; secondsPerImage: number; buttonLabel: LocalizedText };
    };

/** Sent only once an item is revealed. */
export interface RevealInfo {
  /** MC index, true/false, number, or the first accepted answer. */
  correct: AnswerValue;
  acceptedAnswers?: string[];
  explanation?: LocalizedText;
  /** Media played at reveal, if any. */
  revealMedia?: PublicMedia;
  /** For a news question: the full headline. */
  headline?: string;
  /** Flitsreeks: every image with its answer and how many teams pressed. */
  images?: { src: string; yes: boolean; caption?: LocalizedText; presses: number }[];
  results: { teamId: number; value: AnswerValue | null; verdict: Verdict; points: number }[];
}

export interface CommonView {
  serverNow: number;
  phase: Phase;
  sessionId: number;
  joinCode: string;
  quizTitle: LocalizedText;
  quizLang: Language;
  teams: PublicTeam[];
  step: Step | null;
  item: PublicItem | null;
  timer: TimerState | null;
  reveal: RevealInfo | null;
  overlay: Overlay;
  /** Team ids that have at least one vote or an answer for the current item. */
  answered: number[];
  totalItems: number;
  /** Playback of the current item's audio/video, if it has any. */
  media: MediaPlayback | null;
  /**
   * The continuation clip ("what happens next"): sent once answers are locked
   * when it plays before the answer, otherwise at reveal.
   */
  continuation: PublicMedia | null;
  /** Flitsreeks timing, once the sequence has started. */
  sequence: SequenceState | null;
  /** Flitsreeks reveal: image the host is spotlighting, if any. */
  spotlight: number | null;
}

/** Server-timed flitsreeks: image i is on screen from startAt + i·ms to startAt + (i+1)·ms. */
export interface SequenceState {
  startAt: number;
  ms: number;
  count: number;
  graceMs: number;
}

export type TvView = CommonView;

/** One option in a team's vote, with who voted for it. Most votes first. */
export interface BallotOption {
  value: AnswerValue;
  count: number;
  voters: { id: number; nickname: string | null }[];
}

/** The team's resolved answer after lock. */
export interface TeamAnswerView {
  value: AnswerValue;
  votes: number;
  totalVotes: number;
  tieBreak: boolean;
}

export interface TeamView extends CommonView {
  me: { playerId: number; nickname: string | null; teamId: number };
  team: PublicTeam & { players: { id: number; nickname: string | null }[] };
  /** The team's votes on the current question (visible to this team only). */
  ballot: BallotOption[];
  /** This phone's own vote. */
  myVote: AnswerValue | null;
  /** Set once the question is locked. */
  answer: TeamAnswerView | null;
  /** Flitsreeks: images this team has pressed on. */
  pressed: number[];
  /** Only after reveal. */
  result: { verdict: Verdict; points: number } | null;
}

export interface HostAnswerView extends AnswerRec {
  teamId: number;
  byNickname: string | null;
}

export interface HostBallotView {
  teamId: number;
  options: BallotOption[];
}

export interface HostOutlineEntry {
  cursor: number;
  roundIndex: number;
  kind: "slide" | "question";
  label: LocalizedText;
  answerType?: string;
  step: Step | null;
}

export interface HostView extends Omit<CommonView, "reveal"> {
  /** Full item, including correct answers and host notes. */
  fullItem: Item | null;
  nextItem: { cursor: number; item: Item } | null;
  outline: HostOutlineEntry[];
  answers: HostAnswerView[];
  /** Live vote tallies per team while answering. */
  ballots: HostBallotView[];
  reveal: RevealInfo | null;
  /** Correct answer for the host, at any step. */
  correct: RevealInfo["correct"] | null;
  teamsDetail: (PublicTeam & {
    adjustment: number;
    players: { id: number; nickname: string | null; online: boolean }[];
  })[];
  autoLock: boolean;
}

/** What /tv and /host receive when no session is running. */
export interface IdleView {
  serverNow: number;
  phase: "idle";
}

export type ServerView<T> = T | IdleView;
export const isIdle = <T>(v: ServerView<T> | null | undefined): v is IdleView =>
  !!v && (v as IdleView).phase === "idle";
