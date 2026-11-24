import { describe, expect, it } from "vitest";
import { publicItem, type Item, type RunItem } from "../src/index.js";

function run(showCaptions?: boolean): RunItem {
  const item = {
    kind: "question",
    answerType: "rapid_sequence",
    prompt: "p",
    buttonLabel: "JA",
    ...(showCaptions !== undefined ? { showCaptions } : {}),
    images: [
      { src: "media/a.png", yes: true, caption: "Alpha" },
      { src: "media/b.png", yes: false },
    ],
  } as Item;
  return { cursor: 0, roundIndex: 0, roundTitle: "R", item, questionNumber: 1, points: 1 } as RunItem;
}

describe("flitsreeks public item", () => {
  it("keeps captions back by default", () => {
    const pub = publicItem(run(), 1);
    expect(pub.kind === "question" && pub.sequence?.captions).toBeUndefined();
  });

  it("sends captions in order when showCaptions is on", () => {
    const pub = publicItem(run(true), 1);
    expect(pub.kind === "question" && pub.sequence?.captions).toEqual(["Alpha", null]);
  });
});
