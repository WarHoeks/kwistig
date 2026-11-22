import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ANSWER_TYPES, formatIssues, pickText, Quiz, type Item } from "../src/index.js";

const samplesDir = path.resolve(import.meta.dirname, "../../../samples");
const loadSample = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(samplesDir, name), "utf8"));

function issuesFor(doc: unknown) {
  const res = Quiz.safeParse(doc);
  if (res.success) return [];
  return formatIssues(res.error).map((i) => `${i.path}: ${i.message}`);
}

describe("sample quizzes", () => {
  for (const file of fs.readdirSync(samplesDir).filter((f) => f.endsWith(".json"))) {
    it(`${file} is valid`, () => {
      expect(issuesFor(loadSample(file))).toEqual([]);
    });
  }

  it("kitchen-sink covers every answer type and media type", () => {
    const quiz = Quiz.parse(loadSample("kitchen-sink.json"));
    const items: Item[] = quiz.rounds.flatMap((r) => r.items);
    const answerTypes = new Set(items.flatMap((i) => (i.kind === "question" ? [i.answerType] : [])));
    expect([...answerTypes].sort()).toEqual([...ANSWER_TYPES].sort());
    const mediaTypes = new Set(
      items.flatMap((i) => ("media" in i && i.media ? [i.media.type] : [])),
    );
    expect([...mediaTypes].sort()).toEqual(["image", "news", "spotify", "youtube"]);
    expect(items.some((i) => i.kind === "slide")).toBe(true);
  });

  it("parsing does not add or drop fields (round-trip safe)", () => {
    const raw = loadSample("kitchen-sink.json");
    expect(Quiz.parse(raw)).toEqual(raw);
  });
});

describe("validation messages", () => {
  const base = (item: unknown) => ({
    version: 1,
    title: "T",
    language: "nl",
    rounds: [{ title: "R", items: [{ kind: "slide", title: "S" }, { kind: "slide", title: "S" }, item] }],
  });

  it("reports option count with exact path", () => {
    expect(
      issuesFor(base({ kind: "question", answerType: "multiple_choice", prompt: "p", options: ["a"], correct: 0 })),
    ).toEqual(["rounds[0].items[2].options: needs 2 to 6 entries"]);
  });

  it("rejects a correct index outside the options", () => {
    expect(
      issuesFor(base({ kind: "question", answerType: "multiple_choice", prompt: "p", options: ["a", "b"], correct: 2 })),
    ).toEqual(["rounds[0].items[2].correct: must point at an option"]);
  });

  it("rejects unknown fields such as typos", () => {
    expect(
      issuesFor(base({ kind: "question", answerType: "open", prompt: "p", acceptedAnswer: ["x"] })),
    ).toContain('rounds[0].items[2]: unknown field "acceptedAnswer"');
  });

  it("rejects an unknown answer type", () => {
    const msgs = issuesFor(base({ kind: "question", answerType: "essay", prompt: "p" }));
    expect(msgs[0]).toMatch(/^rounds\[0\]\.items\[2\]\.answerType: /);
  });

  it("rejects endSec before startSec", () => {
    expect(
      issuesFor(
        base({
          kind: "question",
          answerType: "true_false",
          prompt: "p",
          correct: true,
          media: { type: "youtube", videoId: "dQw4w9WgXcQ", startSec: 30, endSec: 10 },
        }),
      ),
    ).toEqual(["rounds[0].items[2].media.endSec: endSec must be after startSec"]);
  });

  it("requires 5 to 20 flitsreeks images", () => {
    expect(
      issuesFor(
        base({
          kind: "question",
          answerType: "rapid_sequence",
          prompt: "p",
          buttonLabel: "JA",
          images: [{ src: "media/a.png", yes: true }],
        }),
      ),
    ).toEqual(["rounds[0].items[2].images: needs 5 to 20 images"]);
  });

  it("rejects an empty localized object", () => {
    expect(issuesFor({ version: 1, title: {}, language: "nl", rounds: [{ title: "R", items: [{ kind: "slide", title: "S" }] }] }))
      .toEqual(["title: needs nl or en"]);
  });
});

describe("pickText", () => {
  it("falls back to the quiz language", () => {
    expect(pickText({ nl: "Hallo" }, "en", "nl")).toBe("Hallo");
    expect(pickText({ nl: "Hallo", en: "Hello" }, "en", "nl")).toBe("Hello");
    expect(pickText("Hallo", "en", "nl")).toBe("Hallo");
  });
});
