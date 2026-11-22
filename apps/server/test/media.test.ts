import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { blankHeadline, buildRunOrder, collectImageRefs, mapImageRefs, Quiz, youTubeId, type GameState } from "@kwistig/shared";
import { openDb } from "../src/db/client.js";
import { initialState, pressIndex, reduce, SEQUENCE_LEAD_MS, type MachineIntent } from "../src/game/machine.js";
import { publicItem, tvView, teamView } from "../src/game/project.js";
import { MediaStore } from "../src/services/media.js";
import { prepareQuizMedia } from "../src/services/quiz-media.js";
import { _test as fetchInternals, safeFetch, setExternalFetch } from "../src/services/safe-fetch.js";

// Tests never reach out to the internet.
setExternalFetch(false);

const root = path.resolve(import.meta.dirname, "../../..");
const sample = Quiz.parse(JSON.parse(fs.readFileSync(path.join(root, "samples/kitchen-sink.json"), "utf8")));
const png = fs.readFileSync(path.join(root, "samples/media/trap.png"));

let tmp: string | undefined;
afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

function store() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kwistig-media-"));
  const db = openDb(":memory:", path.resolve(import.meta.dirname, "../drizzle"));
  return new MediaStore(db, tmp);
}

describe("shared media helpers", () => {
  it("parses YouTube ids from ids and URLs", () => {
    expect(youTubeId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42")).toBe("dQw4w9WgXcQ");
    expect(youTubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youTubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youTubeId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });

  it("blanks a whole word, case-insensitively", () => {
    expect(blankHeadline("Hond redt kat uit boom; hondenbaas blij", "hond")).toBe("_____ redt kat uit boom; hondenbaas blij");
    expect(blankHeadline("Geen woord", undefined)).toBe("Geen woord");
  });

  it("finds every image reference", () => {
    expect(collectImageRefs(sample).sort()).toEqual(
      ["media/persoon1.png", "media/persoon2.png", "media/persoon3.png", "media/persoon4.png", "media/persoon5.png", "media/podium.png", "media/trap.png", "media/zelfportret.png"].sort(),
    );
    const renamed = mapImageRefs(sample, (r) => r.toUpperCase());
    expect(collectImageRefs(renamed).every((r) => r === r.toUpperCase())).toBe(true);
  });
});

describe("media store and import", () => {
  it("stores images by content hash, once", () => {
    const s = store();
    const a = s.storeImage(png);
    expect(a).toMatch(/^media\/[a-f0-9]{64}\.png$/);
    expect(s.storeImage(png)).toBe(a);
    expect(fs.readdirSync(s.dir)).toHaveLength(1);
  });

  it("refuses non-images, including SVG", () => {
    const s = store();
    expect(() => s.storeImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toThrow(
      "unsupported_image",
    );
  });

  it("stores package files under their hash, and reports missing ones", async () => {
    const s = store();
    const files = new Map([["media/trap.png", png]]);
    const { doc, warnings } = await prepareQuizMedia(s, sample, files);
    const refs = collectImageRefs(doc);
    expect(refs.filter((r) => /^media\/[a-f0-9]{64}\.png$/.test(r))).toHaveLength(1);
    expect(refs).not.toContain("media/trap.png");
    const missing = warnings.filter((w) => w.message === "missing_media").map((w) => w.ref);
    expect(missing.sort()).toEqual(
      ["media/persoon1.png", "media/persoon2.png", "media/persoon3.png", "media/persoon4.png", "media/persoon5.png", "media/podium.png", "media/zelfportret.png"].sort(),
    );
    // The news article can't be fetched with external fetching off.
    expect(warnings).toContainEqual({ ref: "https://nos.nl/artikel/2500000-voorbeeld", message: "offline" });
  });

  it("never fetches from the local network", async () => {
    const { isPublicIp } = fetchInternals;
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.1.36", "172.20.0.1", "169.254.1.1", "100.114.164.75", "::1", "fd00::1", "fe80::1", "::ffff:192.168.1.1"]) {
      expect(isPublicIp(ip), ip).toBe(false);
    }
    expect(isPublicIp("142.250.180.14")).toBe(true);
    expect(isPublicIp("2a00:1450:4001:82a::200e")).toBe(true);
    // Encodings of internal addresses that string checks miss.
    for (const ip of ["::ffff:7f00:1", "::ffff:c0a8:101", "::7f00:1", "64:ff9b::7f00:1", "2002:7f00:1::", "0.0.0.0", "100.64.0.1", "ff02::1"]) {
      expect(isPublicIp(ip), ip).toBe(false);
    }
    await expect(safeFetch("http://127.0.0.1:8080/api/health")).rejects.toThrow("private_address");
    // The URL parser turns this into [::ffff:7f00:1]; it must still be refused.
    await expect(safeFetch("http://[::ffff:127.0.0.1]:8080/")).rejects.toThrow("private_address");
    await expect(safeFetch("http://user:pass@example.com/")).rejects.toThrow("unsupported_url");
    await expect(safeFetch("file:///etc/passwd")).rejects.toThrow("unsupported_url");
  });

  it("checks names inside the connection's own lookup, so rebinding can't swap the address", async () => {
    const { guardedLookup } = fetchInternals;
    const lookup = (host: string) =>
      new Promise<string>((resolve) =>
        guardedLookup(host, { all: false }, (err, address) => resolve(err ? err.message : String(address))),
      );
    expect(await lookup("localhost")).toBe("private_address");
  });
});

// ---------------------------------------------------------------- game: media and flitsreeks

function game() {
  const run = buildRunOrder(sample);
  let now = 5_000_000;
  let s: GameState = initialState({ sessionId: 1, quizId: 1, joinCode: "ABCD", quizTitle: sample.title, quizLang: "nl" });
  const g = {
    run,
    get s() {
      return s;
    },
    tick: (ms: number) => (now += ms),
    at: (t: number) => ((now = t), g),
    now: () => now,
    do: (i: MachineIntent) => ((s = reduce(s, i, { now, run, random: () => 0 })), g),
    fails: (i: MachineIntent) => {
      try {
        reduce(s, i, { now, run, random: () => 0 });
        return "no error";
      } catch (e) {
        return (e as { code: string }).code;
      }
    },
  };
  for (const [id, name] of [[1, "A"], [2, "B"]] as const) {
    g.do({ type: "addTeam", team: { id, name, emoji: "x", color: "#fff", photo: null } });
    g.do({ type: "addPlayer", player: { id: 100 + id, teamId: id, nickname: name, tokenHash: `h${id}` } });
  }
  g.do({ type: "beginQuiz" });
  return g;
}
const cursorOf = (pred: (i: (typeof sample.rounds)[number]["items"][number]) => boolean) =>
  buildRunOrder(sample).find((r) => pred(r.item))!.cursor;

describe("media playback", () => {
  const ytCursor = cursorOf((i) => i.kind === "question" && i.media?.type === "youtube" && i.media.play === "before");

  it("host plays, pauses, resumes and replays; the TV reports the end", () => {
    const g = game().do({ type: "jump", cursor: ytCursor });
    expect(g.s.media).toMatchObject({ cursor: ytCursor, slot: "question", status: "idle" });
    const seq0 = g.s.media!.seq;
    g.do({ type: "mediaPlay" });
    expect(g.s.media).toMatchObject({ status: "playing", seq: seq0 + 1 });
    g.do({ type: "mediaPause" }).do({ type: "mediaPlay" });
    expect(g.s.media).toMatchObject({ status: "playing", seq: seq0 + 1 }); // resume, not restart
    g.do({ type: "mediaEnded", seq: seq0 + 1 });
    expect(g.s.media!.status).toBe("ended");
    g.do({ type: "mediaReplay" });
    expect(g.s.media).toMatchObject({ status: "playing", seq: seq0 + 2 });
    g.do({ type: "mediaEnded", seq: seq0 + 1 }); // stale report from the first run
    expect(g.s.media!.status).toBe("playing");
    g.do({ type: "mediaMute", on: true });
    expect(g.s.media!.muted).toBe(true);
  });

  it("errors are recorded; items without audio/video refuse media commands", () => {
    const g = game().do({ type: "jump", cursor: ytCursor }).do({ type: "mediaPlay" });
    g.do({ type: "mediaError", seq: g.s.media!.seq, code: "embed_blocked" });
    expect(g.s.media).toMatchObject({ status: "error", error: "embed_blocked" });
    g.do({ type: "jump", cursor: 0 });
    expect(g.s.media).toBeUndefined();
    expect(g.fails({ type: "mediaPlay" })).toBe("no_media");
  });

  it("reveal media takes over the player at reveal", () => {
    const c = cursorOf((i) => i.kind === "question" && !!i.revealMedia);
    const g = game().do({ type: "jump", cursor: c }).do({ type: "reveal" });
    expect(g.s.media).toMatchObject({ cursor: c, slot: "reveal", status: "idle" });
    expect(tvView(g.s, g.run, 0).reveal?.revealMedia).toMatchObject({ type: "youtube", videoId: "dQw4w9WgXcQ", startSec: 43 });
  });

  it("the TV gets media without secrets: no Spotify URI, no blanked word", () => {
    const run = buildRunOrder(sample);
    const json = JSON.stringify(run.map((r) => publicItem(r, 10, { "https://nos.nl/artikel/2500000-voorbeeld": { headline: "Hond redt kat", image: null } })));
    expect(json).not.toContain("spotify:track");
    expect(json).toContain("_____ redt kat");
    expect(json).not.toContain("blankWord");
    expect(json).not.toContain("Hond redt");
  });
});

describe("flitsreeks", () => {
  const c = cursorOf((i) => i.kind === "question" && i.answerType === "rapid_sequence");
  const press = (teamId: number): MachineIntent => ({ type: "press", teamId, playerId: 100 + teamId });

  it("server timing decides the image, with a grace window after each switch", () => {
    const seq = { startAt: 1000, ms: 3000, count: 5, graceMs: 300 };
    expect(pressIndex(seq, 999, {})).toBeNull();
    expect(pressIndex(seq, 1000, {})).toBe(0);
    expect(pressIndex(seq, 4100, {})).toBe(0); // 100 ms into image 1: counts for image 0
    expect(pressIndex(seq, 4100, { 0: {} })).toBe(1); // already pressed image 0
    expect(pressIndex(seq, 4400, {})).toBe(1);
    expect(pressIndex(seq, 16_100, {})).toBe(4); // grace after the last image
    expect(pressIndex(seq, 16_400, {})).toBeNull();
  });

  it("plays a full sequence and scores yes/no per image with speed bonus", () => {
    const g = game().do({ type: "jump", cursor: c });
    const t0 = g.now();
    g.do({ type: "open" });
    expect(g.s.items[c]!.seq).toMatchObject({ startAt: t0 + SEQUENCE_LEAD_MS, ms: 3000, count: 5 });
    expect(g.fails(press(1))).toBe("not_running"); // still counting down
    const start = t0 + SEQUENCE_LEAD_MS;
    // Images: yes, no, yes, no, yes. Team A presses 0 fast, 2 slowly, and 3 (wrong).
    g.at(start + 200).do(press(1));
    expect(g.fails(press(1))).toBe("already_pressed");
    g.at(start + 2 * 3000 + 2000).do(press(1));
    g.at(start + 3 * 3000 + 500).do(press(1));
    // Team B never presses.
    g.at(start + 5 * 3000 + 300 + 1);
    g.do({ type: "timerExpired" });
    const run = g.s.items[c]!;
    expect(run.step).toBe("locked");
    // A: images 0,2 right (+bonus 0.8 on image 0), 1 right (no press), 3 wrong, 4 wrong (missed) → 3 right.
    expect(run.answers[1]).toMatchObject({ value: "10110", verdict: "half", points: 3.8 });
    // B: right on the two "no" images only.
    expect(run.answers[2]).toMatchObject({ value: "00000", verdict: "half", points: 2 });
  });

  it("teams only see their own presses; the TV sees none until the reveal grid", () => {
    const g = game().do({ type: "jump", cursor: c });
    const t0 = g.now();
    g.do({ type: "open" }).at(t0 + SEQUENCE_LEAD_MS + 10);
    g.do(press(1));
    expect(teamView(g.s, g.run, 0, 101)!.pressed).toEqual([0]);
    expect(teamView(g.s, g.run, 0, 102)!.pressed).toEqual([]);
    const tv = JSON.stringify(tvView(g.s, g.run, 0));
    expect(tv).not.toContain('"yes"');
    expect(tv).not.toContain("Won het EK");
    g.do({ type: "reveal" });
    const reveal = tvView(g.s, g.run, 0).reveal!;
    expect(reveal.images![0]).toMatchObject({ yes: true, caption: "Won het EK", presses: 1 });
    g.do({ type: "spotlight", index: 2 });
    expect(tvView(g.s, g.run, 0).spotlight).toBe(2);
  });
});
