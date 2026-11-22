import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildRunOrder, Quiz, type GameState, type RunItem } from "@kwistig/shared";
import { GameError, initialState, reduce, type MachineIntent } from "../src/game/machine.js";
import { computeRanks, computeScores, judge } from "../src/game/scoring.js";
import { hostView, teamView, tvView } from "../src/game/project.js";

const samples = path.resolve(import.meta.dirname, "../../../samples");
const sample = Quiz.parse(JSON.parse(fs.readFileSync(path.join(samples, "kitchen-sink.json"), "utf8")));
const text10 = Quiz.parse(JSON.parse(fs.readFileSync(path.join(samples, "text-10.json"), "utf8")));

/** Small harness: a game with a clock you control. */
function game(quiz = text10) {
  const run = buildRunOrder(quiz);
  let now = 1_000_000;
  let rand = 0;
  let s = initialState({ sessionId: 1, quizId: 1, joinCode: "ABCD", quizTitle: quiz.title, quizLang: quiz.language });
  const g = {
    run,
    get s() {
      return s;
    },
    tick: (ms: number) => (now += ms),
    /** Fixes the next tie-break draw (0 ≤ r < 1). */
    setRandom: (r: number) => (rand = r),
    now: () => now,
    do: (intent: MachineIntent) => {
      s = reduce(s, intent, { now, run, random: () => rand });
      return g;
    },
    fails: (intent: MachineIntent) => {
      try {
        reduce(s, intent, { now, run, random: () => rand });
      } catch (e) {
        return (e as GameError).code;
      }
      return "no error";
    },
    teams: (...names: string[]) => {
      names.forEach((name, i) => {
        g.do({ type: "addTeam", team: { id: i + 1, name, emoji: "🦊", color: "#ef4444", photo: null } });
        g.do({ type: "addPlayer", player: { id: 100 + i, teamId: i + 1, nickname: `p${i}`, tokenHash: `h${i}` } });
      });
      return g;
    },
    /** Jump to the first item of the given answer type. */
    goTo: (pred: (ri: RunItem) => boolean) => {
      const ri = run.find(pred)!;
      if (s.phase === "lobby" || s.phase === "photos") g.do({ type: "beginQuiz" });
      return g.do({ type: "jump", cursor: ri.cursor });
    },
  };
  return g;
}

const isType = (t: string) => (ri: RunItem) => ri.item.kind === "question" && ri.item.answerType === t;
const cur = (s: GameState) => s.items[s.cursor]!;

describe("flow", () => {
  it("lobby → photos → items → finished", () => {
    const g = game().teams("A", "B");
    expect(g.s.phase).toBe("lobby");
    g.do({ type: "startPhotos" });
    expect(g.s.phase).toBe("photos");
    g.do({ type: "beginQuiz" });
    expect(g.s).toMatchObject({ phase: "item", cursor: 0 });
    expect(cur(g.s).step).toBe("shown");
    for (let i = 1; i < g.run.length; i++) g.do({ type: "next" });
    expect(g.s.cursor).toBe(g.run.length - 1);
    g.do({ type: "next" });
    expect(g.s.phase).toBe("finished");
    g.do({ type: "previous" });
    expect(g.s).toMatchObject({ phase: "item", cursor: g.run.length - 1 });
  });

  it("question steps: shown → answering → locked → revealed", () => {
    const g = game().teams("A").goTo(isType("multiple_choice"));
    expect(g.fails({ type: "lock" })).toBe("not_answering");
    g.do({ type: "open" });
    expect(cur(g.s).step).toBe("answering");
    g.do({ type: "lock" });
    expect(cur(g.s).step).toBe("locked");
    g.do({ type: "reveal" });
    expect(cur(g.s).step).toBe("revealed");
    expect(g.fails({ type: "open" })).toBe("wrong_phase");
  });

  it("previous restores an item's last state including answers", () => {
    const g = game().teams("A").goTo(isType("multiple_choice"));
    const c = g.s.cursor;
    g.do({ type: "open" }).do({ type: "vote", teamId: 1, playerId: 100, value: 1 }).do({ type: "reveal" });
    g.do({ type: "next" }).do({ type: "previous" });
    expect(g.s.cursor).toBe(c);
    expect(cur(g.s).step).toBe("revealed");
    expect(cur(g.s).answers[1]?.value).toBe(1);
  });

  it("navigating away while answering locks the question", () => {
    const g = game().teams("A").goTo(isType("multiple_choice"));
    const c = g.s.cursor;
    g.do({ type: "open" }).do({ type: "vote", teamId: 1, playerId: 100, value: 0 }).do({ type: "next" });
    expect(g.s.items[c]!.step).toBe("locked");
    expect(g.s.items[c]!.answers[1]!.verdict).not.toBe("pending");
  });

  it("slides cannot be opened", () => {
    const g = game().teams("A");
    g.do({ type: "beginQuiz" });
    expect(g.run[0]!.item.kind).toBe("slide");
    expect(g.fails({ type: "open" })).toBe("not_a_question");
  });
});

describe("answers", () => {
  /** Team A with phones 100, 200, 201, 202 on the first multiple-choice question, opened. */
  function voting(type = "multiple_choice") {
    const g = game().teams("A").goTo(isType(type));
    for (const id of [200, 201, 202]) {
      g.do({ type: "addPlayer", player: { id, teamId: 1, nickname: `p${id}`, tokenHash: `t${id}` } });
    }
    return g.do({ type: "open" });
  }
  const vote = (playerId: number, value: number | boolean | string) =>
    ({ type: "vote", teamId: 1, playerId, value }) as MachineIntent;

  it("each phone votes; the option with most votes becomes the team answer", () => {
    const g = voting();
    g.do(vote(100, 0)).do(vote(200, 1)).do(vote(201, 1));
    expect(cur(g.s).answers).toEqual({}); // nothing decided until lock
    g.do({ type: "lock" });
    expect(cur(g.s).answers[1]).toMatchObject({ value: 1, votes: 2, totalVotes: 3, tieBreak: false, playerId: 200 });
  });

  it("a phone can change or take back its vote", () => {
    const g = voting();
    g.do(vote(100, 0)).do(vote(200, 0)).do(vote(201, 2));
    g.do(vote(200, 2)); // changes its mind
    g.do({ type: "retractVote", teamId: 1, playerId: 100 });
    g.do({ type: "lock" });
    expect(cur(g.s).answers[1]).toMatchObject({ value: 2, votes: 2, totalVotes: 2 });
  });

  it("a tie is broken by a random draw among the tied options", () => {
    const tied = (r: number) => {
      const g = voting();
      g.do(vote(100, 0)).do(vote(200, 0)).do(vote(201, 3)).do(vote(202, 3));
      g.setRandom(r);
      return g.do({ type: "lock" });
    };
    expect(cur(tied(0.1).s).answers[1]).toMatchObject({ value: 0, tieBreak: true, votes: 2, totalVotes: 4 });
    expect(cur(tied(0.9).s).answers[1]).toMatchObject({ value: 3, tieBreak: true });
  });

  it("re-locking keeps an earlier draw while that option is still tied", () => {
    const g = voting();
    g.do(vote(100, 0)).do(vote(200, 3));
    g.setRandom(0.9);
    g.do({ type: "lock" });
    expect(cur(g.s).answers[1]!.value).toBe(3);
    g.do({ type: "open" });
    g.setRandom(0.1);
    g.do({ type: "lock" });
    expect(cur(g.s).answers[1]!.value).toBe(3);
  });

  it("open answers: same answer in different spelling counts together", () => {
    const g = voting("open");
    g.do(vote(100, "Utrecht")).do(vote(200, "utrecht!")).do(vote(201, "Amersfoort"));
    g.do({ type: "lock" });
    expect(cur(g.s).answers[1]).toMatchObject({ value: "Utrecht", votes: 2, totalVotes: 3, verdict: "correct" });
  });

  it("number answers group by value", () => {
    const g = voting("number");
    g.do(vote(100, 12)).do(vote(200, 12.0)).do(vote(201, 13));
    g.do({ type: "lock" });
    expect(cur(g.s).answers[1]).toMatchObject({ value: 12, votes: 2 });
  });

  it("votes of a removed or moved phone no longer count", () => {
    const g = voting();
    g.do({ type: "addTeam", team: { id: 2, name: "B", emoji: "x", color: "#fff", photo: null } });
    g.do(vote(100, 0)).do(vote(200, 1)).do(vote(201, 1));
    g.do({ type: "removePlayer", playerId: 200 });
    g.do({ type: "movePlayer", playerId: 201, teamId: 2 });
    g.do({ type: "lock" });
    expect(cur(g.s).answers[1]).toMatchObject({ value: 0, votes: 1, totalVotes: 1 });
    expect(cur(g.s).answers[2]).toBeUndefined();
  });

  it("a manual verdict survives re-locking with the same answer", () => {
    const g = voting("open");
    g.do(vote(100, "Amersfoort")).do({ type: "lock" }).do({ type: "mark", teamId: 1, verdict: "half" });
    g.do({ type: "open" }).do({ type: "lock" });
    expect(cur(g.s).answers[1]).toMatchObject({ verdict: "half", manual: true });
  });

  it("rejects answers after lock, before open and after the timer", () => {
    const g = game().teams("A").goTo(isType("multiple_choice"));
    const answer: MachineIntent = { type: "vote", teamId: 1, playerId: 100, value: 0 };
    expect(g.fails(answer)).toBe("not_answering");
    g.do({ type: "open" });
    expect(cur(g.s).timer).not.toBeNull();
    g.tick(cur(g.s).timer!.durationMs + 1000);
    expect(g.fails(answer)).toBe("locked");
    g.do({ type: "lock" });
    expect(g.fails(answer)).toBe("locked");
  });

  it("validates answer values per type", () => {
    const g = game().teams("A").goTo(isType("multiple_choice")).do({ type: "open" });
    expect(g.fails({ type: "vote", teamId: 1, playerId: 100, value: 9 })).toBe("invalid_answer");
    expect(g.fails({ type: "vote", teamId: 1, playerId: 100, value: "B" })).toBe("invalid_answer");
    expect(g.fails({ type: "vote", teamId: 7, playerId: 100, value: 0 })).toBe("unknown_team");
  });
});

describe("timer", () => {
  it("auto-locks when it expires, and add/stop work", () => {
    const g = game().teams("A").goTo(isType("multiple_choice")).do({ type: "open" });
    const t = cur(g.s).timer!;
    g.do({ type: "timerAdd", seconds: 15 });
    expect(cur(g.s).timer!.endsAt).toBe(t.endsAt + 15_000);
    g.do({ type: "timerExpired" }); // too early: ignored
    expect(cur(g.s).step).toBe("answering");
    g.tick(t.durationMs + 15_000);
    g.do({ type: "timerExpired" });
    expect(cur(g.s).step).toBe("locked");
  });

  it("does not lock when auto-lock is off", () => {
    const g = game().teams("A").goTo(isType("multiple_choice"));
    g.do({ type: "setAutoLock", on: false }).do({ type: "open" });
    g.tick(cur(g.s).timer!.durationMs + 1);
    g.do({ type: "timerExpired" });
    expect(cur(g.s).step).toBe("answering");
    g.do({ type: "timerStop" });
    expect(cur(g.s).timer).toBeNull();
  });
});

describe("scoring", () => {
  const run = buildRunOrder(sample);
  const find = (pred: (ri: RunItem) => boolean) => run.find(pred)!;
  const ans = (value: number | boolean | string) => ({ value, playerId: 1, at: 0, verdict: "pending" as const, points: 0 });

  it("multiple choice and true/false", () => {
    const mc = find(isType("multiple_choice"));
    expect(judge(mc, { 1: ans(2), 2: ans(0) })).toMatchObject({ 1: { verdict: "correct", points: 1 }, 2: { verdict: "wrong", points: 0 } });
    const tf = find(isType("true_false"));
    expect(tf.points).toBe(2);
    expect(judge(tf, { 1: ans(true) })[1]).toMatchObject({ verdict: "correct", points: 2 });
  });

  it("open answers auto-match with typos", () => {
    const open = find(isType("open"));
    const r = judge(open, { 1: ans("van goch"), 2: ans("Picasso"), 3: ans("Vincent van Gogh") });
    expect(r[1]).toMatchObject({ verdict: "correct", match: "fuzzy" });
    expect(r[2]).toMatchObject({ verdict: "wrong", match: "none" });
    expect(r[3]).toMatchObject({ verdict: "correct", match: "exact" });
  });

  it("number: closest wins, ties share", () => {
    const n = find((ri) => ri.item.kind === "question" && ri.item.answerType === "number" && ri.item.correct === 128);
    const r = judge(n, { 1: ans(120), 2: ans(136), 3: ans(100) });
    expect(r[1]!.verdict).toBe("correct");
    expect(r[2]!.verdict).toBe("correct");
    expect(r[3]!.verdict).toBe("wrong");
  });

  it("number: tolerance", () => {
    const n = find((ri) => ri.item.kind === "question" && ri.item.answerType === "number" && ri.item.correct === 1989);
    const r = judge(n, { 1: ans(1990), 2: ans(1987) });
    expect(r[1]!.verdict).toBe("correct");
    expect(r[2]!.verdict).toBe("wrong");
  });

  it("keeps manual verdicts when re-judging", () => {
    const mc = find(isType("multiple_choice"));
    const r = judge(mc, { 1: { ...ans(0), verdict: "half", points: 0.5, manual: true } });
    expect(r[1]).toMatchObject({ verdict: "half", points: 0.5 });
  });

  it("scores count only revealed items plus adjustments; marking updates them", () => {
    const g = game().teams("A", "B").goTo(isType("open")).do({ type: "open" });
    g.do({ type: "vote", teamId: 1, playerId: 100, value: "utrecht" });
    g.do({ type: "vote", teamId: 2, playerId: 101, value: "Rotterdam" });
    g.do({ type: "lock" });
    expect([...computeScores(g.s).values()]).toEqual([0, 0]);
    g.do({ type: "reveal" });
    expect(computeScores(g.s).get(1)).toBe(1);
    g.do({ type: "mark", teamId: 2, verdict: "half" });
    expect(computeScores(g.s).get(2)).toBe(0.5);
    g.do({ type: "adjustScore", teamId: 2, delta: 2 });
    expect(computeScores(g.s).get(2)).toBe(2.5);
  });

  it("ranks ties together", () => {
    expect([...computeRanks(new Map([[1, 5], [2, 7], [3, 5], [4, 1]])).entries()]).toEqual([
      [2, 1],
      [1, 2],
      [3, 2],
      [4, 4],
    ]);
  });
});

describe("teams", () => {
  it("rejects duplicate names case-insensitively", () => {
    const g = game().teams("De Bollen");
    expect(g.fails({ type: "addTeam", team: { id: 9, name: "de bollen", emoji: "x", color: "#fff", photo: null } })).toBe("name_taken");
  });

  it("merge moves phones, keeps target answers, adds adjustments", () => {
    const g = game().teams("A", "B").goTo(isType("multiple_choice")).do({ type: "open" });
    g.do({ type: "vote", teamId: 2, playerId: 101, value: 2 }).do({ type: "adjustScore", teamId: 2, delta: 3 });
    g.do({ type: "mergeTeams", fromId: 2, intoId: 1 });
    expect(g.s.teams.map((t) => t.id)).toEqual([1]);
    expect(g.s.players.every((p) => p.teamId === 1)).toBe(true);
    g.do({ type: "lock" });
    expect(cur(g.s).answers[1]!.value).toBe(2); // the merged team's vote now counts
    expect(g.s.adjustments[1]).toBe(3);
  });

  it("move and remove phones", () => {
    const g = game().teams("A", "B");
    g.do({ type: "movePlayer", playerId: 100, teamId: 2 });
    expect(g.s.players.find((p) => p.id === 100)!.teamId).toBe(2);
    g.do({ type: "removePlayer", playerId: 100 });
    expect(g.s.players.map((p) => p.id)).toEqual([101]);
    g.do({ type: "removeTeam", teamId: 2 });
    expect(g.s.players).toEqual([]);
  });
});

describe("projections never leak answers before reveal", () => {
  const SECRET_KEYS = ["correct", "acceptedAnswers", "hostNotes", "explanation", "answer", "caption"];

  function leaks(view: unknown, secrets: string[]): string[] {
    // A team's own pick lives under "answer"; it is not secret, so strip it first.
    const { answer: _own, ...rest } = view as Record<string, unknown>;
    const json = JSON.stringify(rest);
    const found = SECRET_KEYS.filter((k) => json.includes(`"${k}"`));
    return [...found, ...secrets.filter((x) => json.includes(x))];
  }

  it("for every item in the sample quiz, at every step before reveal", () => {
    const g = game(sample).teams("A", "B");
    g.do({ type: "beginQuiz" });
    for (const ri of g.run) {
      g.do({ type: "jump", cursor: ri.cursor });
      const item = ri.item;
      const secrets: string[] = [];
      if (item.kind === "question") {
        if (item.hostNotes) secrets.push(item.hostNotes);
        if (item.answerType === "open") secrets.push(...item.acceptedAnswers);
      }
      const steps: (MachineIntent | null)[] =
        item.kind === "question" && ["multiple_choice", "true_false", "open", "number"].includes(item.answerType)
          ? [null, { type: "open" }, { type: "lock" }]
          : [null];
      for (const step of steps) {
        if (step) g.do(step);
        const ctx = `item ${ri.cursor} (${item.kind === "question" ? item.answerType : "slide"}) at ${cur(g.s).step}`;
        expect(leaks(tvView(g.s, g.run, 0), secrets), `TV ${ctx}`).toEqual([]);
        expect(leaks(teamView(g.s, g.run, 0, 100), secrets), `team ${ctx}`).toEqual([]);
      }
    }
  });

  it("reveal sends the answer to TV and teams; host always has it", () => {
    const g = game().teams("A").goTo(isType("multiple_choice"));
    expect(hostView(g.s, g.run, 0, new Set()).correct).not.toBeNull();
    expect(tvView(g.s, g.run, 0).reveal).toBeNull();
    g.do({ type: "reveal" });
    expect(tvView(g.s, g.run, 0).reveal?.correct).toBeDefined();
    expect(teamView(g.s, g.run, 0, 100)?.result).toEqual({ verdict: "wrong", points: 0 });
  });

  it("team view shows the team's ballot with voter names; TV and other teams don't see it", () => {
    const g = game().teams("A", "B").goTo(isType("multiple_choice")).do({ type: "open" });
    g.do({ type: "addPlayer", player: { id: 200, teamId: 1, nickname: "Sanne", tokenHash: "x" } });
    g.do({ type: "vote", teamId: 1, playerId: 200, value: 1 });
    g.tick(300);
    g.do({ type: "vote", teamId: 1, playerId: 100, value: 1 });
    const mine = teamView(g.s, g.run, 0, 100)!;
    expect(mine.ballot).toEqual([
      { value: 1, count: 2, voters: [{ id: 200, nickname: "Sanne" }, { id: 100, nickname: "p0" }] },
    ]);
    expect(mine.myVote).toBe(1);
    expect(mine.answer).toBeNull(); // not decided until lock
    expect(teamView(g.s, g.run, 0, 101)!.ballot).toEqual([]);
    expect(JSON.stringify(tvView(g.s, g.run, 0))).not.toContain("Sanne");
    expect(tvView(g.s, g.run, 0).answered).toEqual([1]);
    g.do({ type: "lock" });
    expect(teamView(g.s, g.run, 0, 100)!.answer).toEqual({ value: 1, votes: 2, totalVotes: 2, tieBreak: false });
  });
});
