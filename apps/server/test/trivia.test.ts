import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Quiz, roundFromTrivia, type TriviaQuestion } from "@kwistig/shared";
import { testApp } from "./helpers.js";

const enc = encodeURIComponent;
const MC: TriviaQuestion = {
  type: "multiple",
  difficulty: "easy",
  category: "General Knowledge",
  question: 'What is the nickname of "California"?',
  correct_answer: "Golden State",
  incorrect_answers: ["Sunshine State", "Bay State", "Treasure State"],
};

describe("roundFromTrivia", () => {
  it("makes a valid round with the correct answer at a random spot, texts marked English", () => {
    const round = roundFromTrivia("General Knowledge", [MC, { ...MC, type: "boolean", question: "The sky is green.", correct_answer: "False", incorrect_answers: ["True"] }], () => 0.99);
    const quiz = Quiz.parse({ version: 1, title: "t", language: "nl", rounds: [round] });
    const [slide, mc, tf] = quiz.rounds[0]!.items;
    expect(slide).toMatchObject({ kind: "slide", title: { en: "General Knowledge" } });
    expect(mc).toMatchObject({ answerType: "multiple_choice", prompt: { en: MC.question }, correct: 3 });
    if (mc?.kind === "question" && mc.answerType === "multiple_choice") expect(mc.options[3]).toEqual({ en: "Golden State" });
    expect(tf).toMatchObject({ answerType: "true_false", correct: false });
    const first = roundFromTrivia("x", [MC], () => 0).items[1];
    expect(first).toMatchObject({ correct: 0, options: [{ en: "Golden State" }, { en: "Sunshine State" }, { en: "Bay State" }, { en: "Treasure State" }] });
  });
});

describe("trivia routes", () => {
  let app: FastifyInstance;
  afterEach(() => app?.close());

  it("decodes Open Trivia DB answers and returns a round; maps its error codes", async () => {
    const urls: string[] = [];
    let code = 0;
    const t = await testApp({
      triviaFetch: async (url) => {
        urls.push(url);
        if (url.includes("api_category")) return { trivia_categories: [{ id: 9, name: "General Knowledge" }] };
        return {
          response_code: code,
          results: [{ ...MC, question: enc(MC.question), correct_answer: enc(MC.correct_answer), incorrect_answers: MC.incorrect_answers.map(enc), category: enc(MC.category) }],
        };
      },
    });
    app = t.app;
    const headers = { cookie: t.cookie };

    expect((await app.inject({ method: "POST", url: "/api/trivia/round", payload: { amount: 1 } })).statusCode).toBe(401);
    const cats = await app.inject({ method: "GET", url: "/api/trivia/categories", headers });
    expect(cats.json()).toEqual([{ id: 9, name: "General Knowledge" }]);

    const res = await app.inject({ method: "POST", url: "/api/trivia/round", headers, payload: { amount: 5, category: 9, difficulty: "easy", type: "multiple" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toEqual({ en: "General Knowledge" });
    expect(res.json().items[1].prompt).toEqual({ en: MC.question });
    const api = new URL(urls.find((u) => u.includes("api.php"))!);
    expect(Object.fromEntries(api.searchParams)).toEqual({ amount: "5", encode: "url3986", category: "9", difficulty: "easy", type: "multiple" });

    expect((await app.inject({ method: "POST", url: "/api/trivia/round", headers, payload: { amount: 99 } })).statusCode).toBe(400);
    code = 1;
    expect((await app.inject({ method: "POST", url: "/api/trivia/round", headers, payload: { amount: 5 } })).json().error).toBe("trivia_not_enough");
    code = 5;
    expect((await app.inject({ method: "POST", url: "/api/trivia/round", headers, payload: { amount: 5 } })).statusCode).toBe(429);
  });

  it("reports unavailable when external fetches are off", async () => {
    const t = await testApp();
    app = t.app;
    const res = await app.inject({ method: "GET", url: "/api/trivia/categories", headers: { cookie: t.cookie } });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe("trivia_unavailable");
  });
});
