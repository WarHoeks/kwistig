import {
  correctValue,
  matchAnswer,
  voteKey,
  type AnswerRec,
  type AnswerValue,
  type GameState,
  type ItemRun,
  type RunItem,
  type Verdict,
  type Vote,
} from "@kwistig/shared";

export interface VoteGroup {
  key: string;
  /** The spelling of whoever proposed this option first. */
  value: AnswerValue;
  firstAt: number;
  firstPlayerId: number;
  /** Player ids in the order they voted. */
  voters: number[];
  count: number;
}

/** Groups one team's votes into options, most votes first, ties by who proposed first. */
export function tally(run: RunItem, teamVotes: Record<string, Vote> | undefined): VoteGroup[] {
  const item = run.item;
  if (item.kind !== "question" || !teamVotes) return [];
  const groups = new Map<string, VoteGroup>();
  const sorted = Object.entries(teamVotes).sort((a, b) => a[1].at - b[1].at);
  for (const [playerId, v] of sorted) {
    const key = voteKey(item.answerType, v.value);
    const g = groups.get(key);
    if (g) {
      g.voters.push(Number(playerId));
      g.count += 1;
    } else {
      groups.set(key, { key, value: v.value, firstAt: v.at, firstPlayerId: Number(playerId), voters: [Number(playerId)], count: 1 });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.firstAt - b.firstAt);
}

/**
 * Turns votes into one answer per team: most votes wins; a tie is drawn with
 * `random`. Re-locking keeps an earlier draw if that option is still tied for first,
 * and keeps the host's manual verdict if the answer didn't change.
 */
export function resolveVotes(run: RunItem, ir: ItemRun, random: () => number): ItemRun["answers"] {
  const item = run.item;
  if (item.kind !== "question") return ir.answers;
  const out: ItemRun["answers"] = {};
  for (const [teamId, teamVotes] of Object.entries(ir.votes ?? {})) {
    const groups = tally(run, teamVotes);
    if (groups.length === 0) continue;
    const top = groups.filter((g) => g.count === groups[0]!.count);
    const prev = ir.answers[teamId];
    const prevKey = prev ? voteKey(item.answerType, prev.value) : undefined;
    const pick =
      top.length === 1
        ? top[0]!
        : (top.find((g) => g.key === prevKey) ?? top[Math.min(top.length - 1, Math.floor(random() * top.length))]!);
    const totalVotes = groups.reduce((n, g) => n + g.count, 0);
    const lastAt = Math.max(...Object.values(teamVotes).map((v) => v.at));
    const base = {
      value: pick.value,
      playerId: pick.firstPlayerId,
      at: lastAt,
      votes: pick.count,
      totalVotes,
      tieBreak: top.length > 1,
    };
    out[teamId] =
      prev?.manual && prevKey === pick.key
        ? { ...prev, ...base }
        : { ...base, verdict: "pending", points: 0 };
  }
  return out;
}

export function pointsFor(verdict: Verdict, itemPoints: number): number {
  if (verdict === "correct") return itemPoints;
  if (verdict === "half") return itemPoints / 2;
  return 0;
}

export { correctValue };

/**
 * Judges every answer of a question at lock time. Manual verdicts from the host
 * are kept. Returns a new answers map.
 */
export function judge(run: RunItem, answers: ItemRun["answers"]): ItemRun["answers"] {
  const item = run.item;
  const out: ItemRun["answers"] = {};
  if (item.kind !== "question") return answers;

  const set = (teamId: string, a: AnswerRec, verdict: Verdict, extra: Partial<AnswerRec> = {}) => {
    out[teamId] = a.manual ? a : { ...a, ...extra, verdict, points: pointsFor(verdict, run.points) };
  };

  switch (item.answerType) {
    case "multiple_choice":
    case "true_false":
      for (const [t, a] of Object.entries(answers)) set(t, a, a.value === item.correct ? "correct" : "wrong");
      break;
    case "open":
      for (const [t, a] of Object.entries(answers)) {
        const m = matchAnswer(String(a.value), item.acceptedAnswers);
        set(t, a, m.result === "none" ? "wrong" : "correct", { match: m.result });
      }
      break;
    case "number": {
      const diffs = Object.entries(answers).map(([t, a]) => [t, a, Math.abs(Number(a.value) - item.correct)] as const);
      if (item.scoring?.mode === "tolerance") {
        const tol = item.scoring.tolerance;
        for (const [t, a, d] of diffs) set(t, a, d <= tol + 1e-9 ? "correct" : "wrong");
      } else {
        const best = Math.min(...diffs.map(([, , d]) => d));
        for (const [t, a, d] of diffs) set(t, a, Math.abs(d - best) < 1e-9 ? "correct" : "wrong");
      }
      break;
    }
    default:
      return answers;
  }
  return out;
}

/** Score per team: manual adjustments plus points of every revealed item. */
export function computeScores(state: GameState): Map<number, number> {
  const scores = new Map<number, number>(state.teams.map((t) => [t.id, state.adjustments[t.id] ?? 0]));
  for (const run of Object.values(state.items)) {
    if (run.step !== "revealed") continue;
    for (const [teamId, a] of Object.entries(run.answers)) {
      const id = Number(teamId);
      if (scores.has(id)) scores.set(id, scores.get(id)! + a.points);
    }
  }
  return scores;
}

/** Standard competition ranking: 1, 1, 3. */
export function computeRanks(scores: Map<number, number>): Map<number, number> {
  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const ranks = new Map<number, number>();
  sorted.forEach(([id, score], i) => {
    const prev = sorted[i - 1];
    ranks.set(id, prev && Math.abs(prev[1] - score) < 1e-9 ? ranks.get(prev[0])! : i + 1);
  });
  return ranks;
}
