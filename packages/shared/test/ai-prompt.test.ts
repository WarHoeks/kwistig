import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { aiExampleQuiz, buildAiFixPrompt, buildAiPrompt, DEFAULT_AI_PROMPT_OPTIONS, extractJson, Quiz } from "../src/index.js";

describe("AI prompt", () => {
  it("has an example that Kwistig accepts, in every language combination", () => {
    for (const language of ["nl", "en"] as const)
      for (const bilingual of [false, true]) expect(Quiz.safeParse(aiExampleQuiz(language, bilingual)).success).toBe(true);
  });

  it("embeds the example and only the chosen question types", () => {
    const p = buildAiPrompt({ ...DEFAULT_AI_PROMPT_OPTIONS, topic: "jaren 80", types: ["multiple_choice", "number"], audience: "familie" });
    expect(p).toContain("Topic: jaren 80");
    expect(p).toContain("Players: familie");
    expect(p).toContain('"answerType": "buzzer"'); // the example shows every type
    expect(p).toContain('- "number":');
    expect(p).not.toContain('- "buzzer":');
    const block = /```json\n([\s\S]*?)```/.exec(p)![1]!;
    expect(Quiz.safeParse(JSON.parse(block)).success).toBe(true);
  });

  it("pulls JSON out of a chatbot reply", () => {
    const quiz = aiExampleQuiz("nl", false);
    const json = JSON.stringify(quiz, null, 2);
    expect(extractJson(`Hier is je quiz!\n\n\`\`\`json\n${json}\n\`\`\`\n\nVeel plezier.`)).toEqual(quiz);
    expect(extractJson(`Sure: ${json} Enjoy`)).toEqual(quiz);
    expect(() => extractJson("Sorry, I can't do that.")).toThrow(SyntaxError);
  });

  it("writes a fix-up prompt from validation issues", () => {
    const p = buildAiFixPrompt([{ path: "rounds[0].items[2].correct", message: "must point at an option" }]);
    expect(p).toContain("- rounds[0].items[2].correct: must point at an option");
    expect(buildAiFixPrompt([], true)).toContain("valid JSON");
  });

  it("matches the copy in docs/AI-QUESTIONS.md", () => {
    const doc = fs.readFileSync(path.resolve(import.meta.dirname, "../../../docs/AI-QUESTIONS.md"), "utf8");
    expect(doc).toContain(buildAiPrompt(DEFAULT_AI_PROMPT_OPTIONS));
  });
});
