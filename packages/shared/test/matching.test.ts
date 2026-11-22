import { describe, expect, it } from "vitest";
import { editDistance, matchAnswer, normalizeAnswer, parseNumberInput } from "../src/index.js";

describe("normalizeAnswer", () => {
  it("ignores case, accents, punctuation and leading articles", () => {
    expect(normalizeAnswer("  De Wolga! ")).toBe("wolga");
    expect(normalizeAnswer("The Beatles")).toBe("beatles");
    expect(normalizeAnswer("Het Concertgebouw")).toBe("concertgebouw");
    expect(normalizeAnswer("Een")).toBe("een"); // a lone article stays
    expect(normalizeAnswer("Céline Dion")).toBe("celine dion");
    expect(normalizeAnswer("Simon & Garfunkel")).toBe("simon en garfunkel");
    expect(normalizeAnswer("'t Hooft")).toBe("hooft");
  });
});

describe("editDistance", () => {
  it("counts transpositions as one edit", () => {
    expect(editDistance("gogh", "gohg")).toBe(1);
    expect(editDistance("kitten", "sitting")).toBe(3);
  });
});

describe("matchAnswer", () => {
  const accepted = ["Vincent van Gogh", "Van Gogh"];
  it("matches exactly after normalisation", () => {
    expect(matchAnswer("van gogh", accepted)).toEqual({ result: "exact", matched: "Van Gogh" });
    expect(matchAnswer("VINCENT VAN GOGH.", accepted).result).toBe("exact");
    expect(matchAnswer("vangogh", accepted).result).toBe("exact");
  });
  it("allows small typos", () => {
    expect(matchAnswer("van goch", accepted)).toEqual({ result: "fuzzy", matched: "Van Gogh" });
    expect(matchAnswer("Vincent van Gohg", accepted).result).toBe("fuzzy");
  });
  it("rejects different answers", () => {
    expect(matchAnswer("Rembrandt", accepted).result).toBe("none");
    expect(matchAnswer("", accepted).result).toBe("none");
  });
  it("is strict for short answers", () => {
    expect(matchAnswer("ABA", ["ABBA"]).result).toBe("fuzzy");
    expect(matchAnswer("U3", ["U2"]).result).toBe("none");
  });
  it("handles articles in both languages", () => {
    expect(matchAnswer("Wolga", ["De Wolga"]).result).toBe("exact");
    expect(matchAnswer("the volga", ["Volga"]).result).toBe("exact");
  });
});

describe("parseNumberInput", () => {
  it("parses Dutch and English formats", () => {
    expect(parseNumberInput("128")).toBe(128);
    expect(parseNumberInput("3,5")).toBe(3.5);
    expect(parseNumberInput("3.5")).toBe(3.5);
    expect(parseNumberInput("1.234,5")).toBe(1234.5);
    expect(parseNumberInput("1,234.5")).toBe(1234.5);
    expect(parseNumberInput("1.000.000")).toBe(1000000);
    expect(parseNumberInput("1 989")).toBe(1989);
    expect(parseNumberInput("-12")).toBe(-12);
    expect(parseNumberInput("abc")).toBeUndefined();
    expect(parseNumberInput("")).toBeUndefined();
  });
});
