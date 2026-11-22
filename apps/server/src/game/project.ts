import {
  blankHeadline,
  mediaUrl,
  questionCount,
  youTubeId,
  type Media,
  type PublicMedia,
  type BallotOption,
  type ItemRun,
  type Vote,
  type CommonView,
  type GameState,
  type HostView,
  type Item,
  type PublicItem,
  type PublicTeam,
  type RevealInfo,
  type RunItem,
  type TeamView,
  type TvView,
} from "@kwistig/shared";
import { computeRanks, computeScores, correctValue, tally } from "./scoring.js";

/**
 * Per-role projections of the game state. TV and team views are built from an
 * explicit whitelist of fields, so correct answers, accepted answers, host notes
 * and explanations can only reach them through `revealInfo`, which is only
 * called once the item is revealed.
 */

export const photoUrl = (sessionId: number, photo: string | null) =>
  photo ? `/api/sessions/${sessionId}/photos/${photo}` : null;

export function publicTeams(s: GameState): PublicTeam[] {
  const scores = computeScores(s);
  const ranks = computeRanks(scores);
  return s.teams.map((t) => ({
    id: t.id,
    name: t.name,
    emoji: t.emoji,
    color: t.color,
    photoUrl: photoUrl(s.sessionId, t.photo),
    score: scores.get(t.id) ?? 0,
    rank: ranks.get(t.id) ?? 1,
  }));
}

/**
 * Media as the TV may see it. News headlines are blanked here; the blanked word
 * and Spotify track details never leave the server before reveal.
 */
export function publicMedia(m: Media, news: GameState["news"]): PublicMedia {
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

export function publicItem(ri: RunItem, qCount: number, news: GameState["news"] = {}): PublicItem {
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
            secondsPerImage: item.secondsPerImage ?? 5,
            buttonLabel: item.buttonLabel,
          },
        }
      : {}),
  };
}

export function revealInfo(s: GameState, ri: RunItem): RevealInfo | null {
  const run = s.items[ri.cursor];
  const item = ri.item;
  if (!run || run.step !== "revealed" || item.kind !== "question") return null;
  const correct = correctValue(ri);
  if (correct === null) return null;
  const media = item.answerType !== "rapid_sequence" ? item.media : undefined;
  const revealMedia = item.answerType !== "rapid_sequence" ? item.revealMedia : undefined;
  const headline = media?.type === "news" ? s.news?.[media.url]?.headline : undefined;
  return {
    correct,
    ...(item.answerType === "open" ? { acceptedAnswers: item.acceptedAnswers } : {}),
    ...(item.explanation !== undefined ? { explanation: item.explanation } : {}),
    ...(revealMedia ? { revealMedia: publicMedia(revealMedia, s.news) } : {}),
    ...(headline ? { headline } : {}),
    ...(item.answerType === "rapid_sequence"
      ? {
          images: item.images.map((img, i) => ({
            src: mediaUrl(img.src),
            yes: img.yes,
            ...(img.caption !== undefined ? { caption: img.caption } : {}),
            presses: Object.values(run.presses ?? {}).filter((p) => p[i] !== undefined).length,
          })),
        }
      : {}),
    results: s.teams.map((t) => {
      const a = run.answers[t.id];
      return { teamId: t.id, value: a?.value ?? null, verdict: a?.verdict ?? "wrong", points: a?.points ?? 0 };
    }),
  };
}

function common(s: GameState, run: readonly RunItem[], now: number): CommonView {
  const ri = s.phase === "item" ? run[s.cursor] : undefined;
  const ir = ri ? s.items[ri.cursor] : undefined;
  return {
    serverNow: now,
    phase: s.phase,
    sessionId: s.sessionId,
    joinCode: s.joinCode,
    quizTitle: s.quizTitle,
    quizLang: s.quizLang,
    teams: publicTeams(s),
    step: ir?.step ?? null,
    item: ri ? publicItem(ri, questionCount(run), s.news) : null,
    timer: ir?.step === "answering" ? ir.timer : null,
    reveal: ri ? revealInfo(s, ri) : null,
    overlay: s.overlay,
    answered: ir ? answeredTeams(ir) : [],
    totalItems: run.length,
    media: ri && s.media?.cursor === ri.cursor ? s.media : null,
    continuation: ri && ir ? continuation(s, ri, ir) : null,
    sequence: ir?.seq ?? null,
    spotlight: ir?.step === "revealed" ? (ir.spotlight ?? null) : null,
  };
}

export function tvView(s: GameState, run: readonly RunItem[], now: number): TvView {
  return common(s, run, now);
}

export function teamView(s: GameState, run: readonly RunItem[], now: number, playerId: number): TeamView | null {
  const me = s.players.find((p) => p.id === playerId);
  if (!me) return null;
  const c = common(s, run, now);
  const team = c.teams.find((t) => t.id === me.teamId);
  if (!team) return null;
  const ir = s.phase === "item" ? s.items[s.cursor] : undefined;
  const ri = s.phase === "item" ? run[s.cursor] : undefined;
  const a = ir?.answers[me.teamId];
  const decided = ir?.step === "locked" || ir?.step === "revealed";
  return {
    ...c,
    me: { playerId: me.id, nickname: me.nickname, teamId: me.teamId },
    team: {
      ...team,
      players: s.players.filter((p) => p.teamId === me.teamId).map((p) => ({ id: p.id, nickname: p.nickname })),
    },
    ballot: ri && ir ? ballot(s, ri, ir.votes?.[me.teamId]) : [],
    myVote: ir?.votes?.[me.teamId]?.[me.id]?.value ?? null,
    answer: a && decided ? { value: a.value, votes: a.votes, totalVotes: a.totalVotes, tieBreak: a.tieBreak } : null,
    pressed: Object.keys(ir?.presses?.[me.teamId] ?? {}).map(Number),
    result: ir?.step === "revealed" ? { verdict: a?.verdict ?? "wrong", points: a?.points ?? 0 } : null,
  };
}

/** The reveal clip, once the TV may have it: at lock when it plays before the answer, else at reveal. */
function continuation(s: GameState, ri: RunItem, ir: ItemRun): PublicMedia | null {
  const rm = ri.item.kind === "question" && ri.item.answerType !== "rapid_sequence" ? ri.item.revealMedia : undefined;
  if (!rm) return null;
  if (ir.step === "revealed" || (ir.step === "locked" && rm.play === "before")) return publicMedia(rm, s.news);
  return null;
}

/** Teams with at least one vote, or an answer, on this item. */
function answeredTeams(ir: ItemRun): number[] {
  const ids = new Set(Object.keys(ir.answers).map(Number));
  for (const [teamId, v] of Object.entries(ir.votes ?? {})) if (Object.keys(v).length > 0) ids.add(Number(teamId));
  return [...ids];
}

/** A team's votes as options with voter names. Only ever sent to that team and the host. */
function ballot(s: GameState, ri: RunItem, teamVotes: Record<string, Vote> | undefined): BallotOption[] {
  return tally(ri, teamVotes).map((g) => ({
    value: g.value,
    count: g.count,
    voters: g.voters.map((id) => ({ id, nickname: s.players.find((p) => p.id === id)?.nickname ?? null })),
  }));
}

function label(item: Item) {
  return item.kind === "slide" ? item.title : item.prompt;
}

export function hostView(
  s: GameState,
  run: readonly RunItem[],
  now: number,
  online: ReadonlySet<number>,
): HostView {
  const c = common(s, run, now);
  const ri = s.phase === "item" || s.phase === "finished" ? run[s.cursor] : undefined;
  const ir = ri ? s.items[ri.cursor] : undefined;
  const nextRi = s.phase === "item" ? run[s.cursor + 1] : s.phase === "photos" || s.phase === "lobby" ? run[0] : undefined;
  const fullReveal = ri && s.phase === "item" ? revealInfo(s, ri) : null;
  return {
    ...c,
    fullItem: s.phase === "item" && ri ? ri.item : null,
    nextItem: nextRi ? { cursor: nextRi.cursor, item: nextRi.item } : null,
    outline: run.map((r) => ({
      cursor: r.cursor,
      roundIndex: r.roundIndex,
      kind: r.item.kind,
      label: label(r.item),
      ...(r.item.kind === "question" ? { answerType: r.item.answerType } : {}),
      step: s.items[r.cursor]?.step ?? null,
    })),
    answers:
      s.phase === "item" && ir && ir.step !== "answering"
        ? Object.entries(ir.answers).map(([teamId, a]) => ({
            ...a,
            teamId: Number(teamId),
            byNickname: s.players.find((p) => p.id === a.playerId)?.nickname ?? null,
          }))
        : [],
    ballots:
      s.phase === "item" && ri && ir
        ? Object.entries(ir.votes ?? {})
            .map(([teamId, v]) => ({ teamId: Number(teamId), options: ballot(s, ri, v) }))
            .filter((b) => b.options.length > 0)
        : [],
    reveal: fullReveal,
    correct: s.phase === "item" && ri ? correctValue(ri) : null,
    teamsDetail: c.teams.map((t) => ({
      ...t,
      adjustment: s.adjustments[t.id] ?? 0,
      players: s.players
        .filter((p) => p.teamId === t.id)
        .map((p) => ({ id: p.id, nickname: p.nickname, online: online.has(p.id) })),
    })),
    autoLock: s.autoLock,
  };
}
