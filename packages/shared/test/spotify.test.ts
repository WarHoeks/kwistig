import { describe, expect, it } from "vitest";
import { Quiz, randomStart, roundFromTracks, spotifyTrackId } from "../src/index.js";

describe("spotifyTrackId", () => {
  it("accepts URIs and share links", () => {
    expect(spotifyTrackId("spotify:track:11dFghVXANMlKmJXsNCbNl")).toBe("11dFghVXANMlKmJXsNCbNl");
    expect(spotifyTrackId("https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl?si=abc")).toBe("11dFghVXANMlKmJXsNCbNl");
    expect(spotifyTrackId("https://open.spotify.com/intl-nl/track/11dFghVXANMlKmJXsNCbNl")).toBe("11dFghVXANMlKmJXsNCbNl");
    expect(spotifyTrackId("spotify:album:11dFghVXANMlKmJXsNCbNl")).toBeNull();
  });
});

describe("playlist → music round", () => {
  it("picks a 20-second fragment inside the song, away from intro and ending", () => {
    for (const r of [0, 0.5, 0.999]) {
      const s = randomStart(210_000, () => r);
      expect(s).toBeGreaterThanOrEqual(30);
      expect(s + 20).toBeLessThanOrEqual(210 - 15);
    }
    expect(randomStart(25_000, () => 0.5)).toBe(5); // short track: still fits
  });

  it("makes one valid open question per track, with the artist pre-filled", () => {
    const round = roundFromTracks(
      "Kwistig hits",
      [
        { uri: "spotify:track:4uLU6hMCjMI75M1A2tKUQC", name: "Never Gonna Give You Up", artists: ["Rick Astley"], durationMs: 213573 },
        { uri: "spotify:track:11dFghVXANMlKmJXsNCbNl", name: "Under Pressure", artists: ["Queen", "David Bowie"], durationMs: 248000 },
      ],
      "nl",
      () => 0,
    );
    expect(round.items[1]).toMatchObject({
      prompt: "Wie is de artiest?",
      acceptedAnswers: ["Queen", "Queen & David Bowie"],
      hostNotes: "Queen, David Bowie — Under Pressure",
      media: { type: "spotify", startSec: 30, endSec: 50, play: "before" },
    });
    // The round imports cleanly into a quiz.
    expect(Quiz.safeParse({ version: 1, title: "Muziek", language: "nl", rounds: [round] }).success).toBe(true);
  });
});
