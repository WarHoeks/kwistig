import type { TriviaCategory, TriviaQuestion, TriviaRequest } from "@kwistig/shared";
import { safeFetch } from "./safe-fetch.js";

/** Fetches JSON from a URL; injectable for tests. */
export type JsonFetch = (url: string) => Promise<unknown>;

const BASE = "https://opentdb.com";

export class TriviaError extends Error {
  constructor(readonly code: "unavailable" | "not_enough" | "rate_limited") {
    super(code);
  }
}

const defaultFetch: JsonFetch = async (url) => {
  const res = await safeFetch(url, { maxBytes: 512 * 1024, accept: "application/json" });
  return JSON.parse(res.buffer.toString("utf8"));
};

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Open Trivia DB client. Categories are cached for the life of the process. */
export class TriviaService {
  private categoryCache: TriviaCategory[] | null = null;

  constructor(private readonly fetchJson: JsonFetch = defaultFetch) {}

  private async get(url: string): Promise<Record<string, unknown>> {
    try {
      const body = await this.fetchJson(url);
      if (!body || typeof body !== "object") throw new Error("bad body");
      return body as Record<string, unknown>;
    } catch {
      throw new TriviaError("unavailable");
    }
  }

  async categories(): Promise<TriviaCategory[]> {
    if (this.categoryCache) return this.categoryCache;
    const body = await this.get(`${BASE}/api_category.php`);
    const list = Array.isArray(body.trivia_categories) ? body.trivia_categories : [];
    const cats = list
      .filter((c): c is TriviaCategory => typeof c?.id === "number" && typeof c?.name === "string")
      .map((c) => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (cats.length === 0) throw new TriviaError("unavailable");
    this.categoryCache = cats;
    return cats;
  }

  async questions(req: TriviaRequest): Promise<TriviaQuestion[]> {
    const q = new URLSearchParams({ amount: String(req.amount), encode: "url3986" });
    if (req.category) q.set("category", String(req.category));
    if (req.difficulty) q.set("difficulty", req.difficulty);
    if (req.type) q.set("type", req.type);
    const body = await this.get(`${BASE}/api.php?${q}`);
    // 0 = ok, 1 = not enough questions for this filter, 5 = rate limited (one call per 5 s).
    if (body.response_code === 1) throw new TriviaError("not_enough");
    if (body.response_code === 5) throw new TriviaError("rate_limited");
    if (body.response_code !== 0 || !Array.isArray(body.results)) throw new TriviaError("unavailable");
    return (body.results as Record<string, unknown>[])
      .filter(
        (r) =>
          (r.type === "multiple" || r.type === "boolean") &&
          typeof r.question === "string" &&
          typeof r.correct_answer === "string" &&
          Array.isArray(r.incorrect_answers),
      )
      .map((r) => ({
        type: r.type as TriviaQuestion["type"],
        difficulty: decode(String(r.difficulty ?? "")),
        category: decode(String(r.category ?? "")),
        question: decode(r.question as string),
        correct_answer: decode(r.correct_answer as string),
        incorrect_answers: (r.incorrect_answers as unknown[]).map((x) => decode(String(x))),
      }));
  }
}
