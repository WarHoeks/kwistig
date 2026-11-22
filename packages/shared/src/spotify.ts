import { z } from "zod";
import type { Language, Round } from "./quiz.js";

/** Spotify settings and API shapes shared by server and admin. */

export const SPOTIFY_CALLBACK_PATH = "/api/spotify/callback";

/** Everything Kwistig asks for: the TV player, playback control and your own playlists. */
export const SPOTIFY_SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "playlist-read-private",
  "playlist-read-collaborative",
] as const;

export const SpotifyConfigPatch = z.strictObject({
  /** From the Spotify developer dashboard; null clears the saved value (falls back to SPOTIFY_CLIENT_ID). */
  clientId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{32}$/, "must be the 32-character Client ID from the Spotify dashboard")
    .nullable()
    .optional(),
  /** Must be registered in the Spotify app exactly like this; null clears it (falls back to SPOTIFY_REDIRECT_URI). */
  redirectUri: z
    .url({ protocol: /^https?$/, error: "must be a URL such as http://127.0.0.1:8080/api/spotify/callback" })
    .refine((u) => new URL(u).pathname === SPOTIFY_CALLBACK_PATH, `must end with ${SPOTIFY_CALLBACK_PATH}`)
    .refine((u) => {
      const { protocol, hostname } = new URL(u);
      return protocol === "https:" || hostname === "127.0.0.1" || hostname === "[::1]";
    }, "Spotify only accepts https, or http on 127.0.0.1 / [::1] (not localhost)")
    .nullable()
    .optional(),
  /** Spotify Connect device to use when the TV page isn't a player (speaker, phone, Chromecast). */
  fallbackDeviceId: z.string().trim().min(1).max(100).nullable().optional(),
});
export type SpotifyConfigPatch = z.infer<typeof SpotifyConfigPatch>;

export interface SpotifyStatus {
  clientId: string | null;
  clientIdSource: "settings" | "env" | null;
  redirectUri: string;
  redirectUriSource: "settings" | "env";
  connected: boolean;
  account: { displayName: string | null; id: string } | null;
  /** The TV page's Web Playback SDK device, when it's online. */
  tvDevice: { id: string; name: string } | null;
  fallbackDeviceId: string | null;
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

export interface SpotifyDiagnoseStep {
  name: string;
  endpoint: string;
  ok: boolean;
  status: number | null;
  detail: string;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  owner: string;
  /** False for playlists you neither own nor collaborate on: Spotify won't list their tracks. */
  importable: boolean;
  trackCount: number | null;
  image: string | null;
}

export interface SpotifyTrack {
  uri: string;
  name: string;
  artists: string[];
  durationMs: number;
}

export const SPOTIFY_CLIP_SEC = 20;

/** "Wie is de artiest?" per quiz language; the host can edit every question afterwards. */
const ARTIST_PROMPT: Record<Language, string> = { nl: "Wie is de artiest?", en: "Who is the artist?" };

/** A random 20-second fragment, away from the intro and the last 15 seconds where possible. */
export function randomStart(durationMs: number, random: () => number = Math.random): number {
  const dur = durationMs / 1000;
  const lo = Math.min(30, Math.max(0, dur - SPOTIFY_CLIP_SEC));
  const hi = Math.max(lo, dur - SPOTIFY_CLIP_SEC - 15);
  return Math.floor(lo + random() * (hi - lo));
}

/** A music round from playlist tracks: one "who is the artist?" question per track. */
export function roundFromTracks(name: string, tracks: SpotifyTrack[], language: Language, random: () => number = Math.random): Round {
  return {
    title: name,
    defaults: { points: 1, timeLimitSec: 30 },
    items: tracks.map((tr) => {
      const startSec = randomStart(tr.durationMs, random);
      const accepted = [tr.artists[0] ?? tr.name];
      if (tr.artists.length > 1) accepted.push(tr.artists.join(" & "));
      return {
        kind: "question" as const,
        answerType: "open" as const,
        prompt: ARTIST_PROMPT[language],
        acceptedAnswers: accepted,
        hostNotes: `${tr.artists.join(", ")} — ${tr.name}`,
        media: { type: "spotify" as const, uri: tr.uri, startSec, endSec: startSec + SPOTIFY_CLIP_SEC, play: "before" as const },
      };
    }),
  };
}

/** Extracts the track id from spotify:track:… or an open.spotify.com/track/… URL. */
export function spotifyTrackId(ref: string): string | null {
  const m = /^spotify:track:([A-Za-z0-9]{22})$/.exec(ref) ?? /open\.spotify\.com\/(?:intl-[\w-]+\/)?track\/([A-Za-z0-9]{22})/.exec(ref);
  return m ? m[1]! : null;
}
