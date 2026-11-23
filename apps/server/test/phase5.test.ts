import { describe, expect, it } from "vitest";
import { buildRunOrder, Quiz, type GameState } from "@kwistig/shared";
import { initialState, reduce, type MachineIntent } from "../src/game/machine.js";
import { teamView, tvView } from "../src/game/project.js";
import { computeScores } from "../src/game/scoring.js";

/** A game over `items` (all in one round unless split), with teams A, B, C. */
function game(rounds: unknown[][]) {
  const quiz = Quiz.parse({
    version: 1,
    title: "T",
    language: "nl",
    rounds: rounds.map((items, i) => ({ title: `R${i + 1}`, items })),
  });
  const run = buildRunOrder(quiz);
  let now = 1000;
  let s: GameState = initialState({ sessionId: 1, quizId: 1, joinCode: "ABCD", quizTitle: "T", quizLang: "nl" });
  const go = (i: MachineIntent) => (s = reduce(s, i, { now, run, random: () => 0 }));
  for (const [id, name] of [[1, "A"], [2, "B"], [3, "C"]] as const) {
    go({ type: "addTeam", team: { id, name, emoji: "x", color: "#fff", photo: null } });
    go({ type: "addPlayer", player: { id: 100 + id, teamId: id, nickname: name, tokenHash: `h${id}` } });
  }
  go({ type: "beginQuiz" });
  return { run, go, tick: (ms: number) => (now += ms), get s() { return s; } };
}

const buzzer = { kind: "question", answerType: "buzzer", prompt: "Langste rivier van Europa?", answer: { nl: "De Wolga", en: "The Volga" }, points: 3, timeLimitSec: 30 };
const tf = (correct: boolean) => ({ kind: "question", answerType: "true_false", prompt: "?", correct });

describe("buzzer", () => {
  it("first press gets the turn; wrong locks the team out and reopens; right reveals", () => {
    const g = game([[buzzer]]);
    g.go({ type: "open" });
    expect(g.s.items[0]!.buzz).toEqual({ current: null, at: null, lockedOut: [] });

    g.go({ type: "buzz", teamId: 2, playerId: 102 });
    g.tick(5);
    expect(() => g.go({ type: "buzz", teamId: 1, playerId: 101 })).toThrow("buzzer_taken");
    expect(g.s.items[0]!.buzz).toMatchObject({ current: 2 });
    expect(g.s.items[0]!.timer).toBeNull(); // the clock stops while B answers

    g.go({ type: "buzzVerdict", verdict: "wrong" });
    expect(g.s.items[0]!.buzz).toMatchObject({ current: null, lockedOut: [2] });
    expect(() => g.go({ type: "buzz", teamId: 2, playerId: 102 })).toThrow("locked_out");

    g.go({ type: "buzz", teamId: 3, playerId: 103 });
    g.go({ type: "buzzVerdict", verdict: "correct" });
    expect(g.s.items[0]!.step).toBe("revealed");
    expect(computeScores(g.s).get(3)).toBe(3);
    expect(computeScores(g.s).get(2)).toBe(0);
    expect(tvView(g.s, g.run, 0).reveal).toMatchObject({ answerText: { nl: "De Wolga" } });
  });

  it("the TV and phones see who has the turn, never the answer before reveal", () => {
    const g = game([[buzzer]]);
    g.go({ type: "open" });
    g.go({ type: "buzz", teamId: 1, playerId: 101 });
    const tv = tvView(g.s, g.run, 0);
    expect(tv.buzz).toMatchObject({ current: 1 });
    expect(JSON.stringify(tv)).not.toContain("Wolga");
    expect(JSON.stringify(teamView(g.s, g.run, 0, 102))).not.toContain("Wolga");
  });

  it("when every team is out, the buzzer closes", () => {
    const g = game([[buzzer]]);
    g.go({ type: "open" });
    for (const id of [1, 2, 3]) {
      g.go({ type: "buzz", teamId: id, playerId: 100 + id });
      g.go({ type: "buzzVerdict", verdict: "wrong" });
    }
    expect(g.s.items[0]!.step).toBe("locked");
  });
});

describe("standings", () => {
  /** Opens question `i`, lets `right` teams vote correctly and the rest wrongly, reveals. */
  function play(g: ReturnType<typeof game>, cursor: number, correct: boolean, right: number[]) {
    g.go({ type: "jump", cursor });
    g.go({ type: "open" });
    for (const id of [1, 2, 3]) g.go({ type: "vote", teamId: id, playerId: 100 + id, value: right.includes(id) ? correct : !correct });
    g.go({ type: "reveal" });
    return new Map(g.s.standings!.teams.map((t) => [t.teamId, t]));
  }

  it("leader, last place with deepening cracks, dethroned, comeback, round winner", () => {
    const g = game([[tf(true), tf(true), tf(true)], [tf(false)]]);
    // Q1: A right → A leads; B and C tie for last.
    let st = play(g, 0, true, [1]);
    expect(st.get(1)).toMatchObject({ leader: true, event: "gainedLead", last: false });
    expect(st.get(2)).toMatchObject({ last: true, crack: 1, event: "enteredLast" });
    const seq = g.s.standings!.seq;

    // Q2: A and B right → C stays last, crack deepens; no new events for A.
    st = play(g, 1, true, [1, 2]);
    expect(g.s.standings!.seq).toBe(seq + 1);
    expect(st.get(1)).toMatchObject({ leader: true, event: null });
    expect(st.get(2)).toMatchObject({ last: false, event: "comeback" });
    expect(st.get(3)).toMatchObject({ last: true, crack: 2, event: null });

    // Q3 (last of round 1): only B right → A and B tie for the lead; C at 0, crack 3.
    st = play(g, 2, true, [2]);
    expect(st.get(1)).toMatchObject({ leader: true, event: null });
    expect(st.get(2)).toMatchObject({ leader: true, event: "gainedLead" });
    expect(st.get(3)).toMatchObject({ crack: 3 });
    expect(g.s.standings!.roundIndex).toBe(0);
    // Round 1: A 2 points, B 2 points → both round winners.
    expect([...st.values()].filter((t) => t.roundWinner).map((t) => t.teamId)).toEqual([1, 2]);

    // Round 2: only C right → A 2, B 2, C 1. C wins the round but is still last (crack stays at 3).
    st = play(g, 3, false, [3]);
    expect(st.get(3)).toMatchObject({ last: true, crack: 3, event: null, roundWinner: true });
    expect(st.get(1)).toMatchObject({ leader: true, roundWinner: false });
    expect(g.s.standings!.roundIndex).toBe(1);
  });

  it("a leader that loses first place is dethroned", () => {
    const g = game([[tf(true), tf(true), tf(true)]]);
    play(g, 0, true, [1]); // A 1
    play(g, 1, true, [2]); // A 1, B 1: both lead
    const st = play(g, 2, true, [2]); // B 2, A 1
    expect(st.get(1)).toMatchObject({ leader: false, event: "dethroned" });
    expect(st.get(2)).toMatchObject({ leader: true, event: null }); // was already (co-)leader
  });

  it("no last place with fewer than three teams' worth of difference", () => {
    const g = game([[tf(true)]]);
    const st = play(g, 0, true, [1, 2, 3]); // everyone right: all tied
    expect([...st.values()].every((t) => t.leader && !t.last)).toBe(true);
  });
});
