import {
  matchAnswer,
  type AnswerRec,
  type AnswerValue,
  type GameState,
  type ItemRun,
  type RunItem,
  type Verdict,
} from "@kwistig/shared";

export function pointsFor(verdict: Verdict, itemPoints: number): number {
  if (verdict === "correct") return itemPoints;
  if (verdict === "half") return itemPoints / 2;
  return 0;
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
    default:
      return null;
  }
}

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
