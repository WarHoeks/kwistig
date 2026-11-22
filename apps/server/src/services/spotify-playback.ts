import { spotifyTrackId, type GameState, type MediaPlayback, type RunItem } from "@kwistig/shared";
import type { FastifyBaseLogger } from "fastify";
import type { MachineIntent } from "../game/machine.js";
import { SpotifyError, type SpotifyService } from "./spotify.js";

/**
 * Turns the game's media playback state into Spotify Web API calls when the
 * current clip is a Spotify track: play from startSec on the TV's device, pause
 * at endSec (a server timer), resume, pause, mute. Results go back into the game
 * as mediaEnded / mediaError, exactly like the TV's YouTube player reports.
 */
export class SpotifyPlayback {
  private last: { key: string; seq: number; status: MediaPlayback["status"]; muted: boolean } | null = null;
  private endTimer: NodeJS.Timeout | null = null;
  /** Where the clip will stop, and how much was left when it was paused. */
  private clip: { endAt: number | null; remainingMs: number | null; device: string } | null = null;

  constructor(
    private readonly spotify: SpotifyService,
    private readonly dispatch: (intent: MachineIntent) => void,
    private readonly log: FastifyBaseLogger,
    private readonly now: () => number = Date.now,
  ) {}

  /** Called after every committed game change. */
  sync(state: GameState | null, run: readonly RunItem[]) {
    const m = state?.media;
    const ri = m ? run[m.cursor] : undefined;
    const item = ri?.item;
    const media =
      m && item && item.kind === "question" && item.answerType !== "rapid_sequence"
        ? m.slot === "question"
          ? item.media
          : item.revealMedia
        : m && item?.kind === "slide"
          ? item.media
          : undefined;
    const onScreen = state?.phase === "item" && m && m.cursor === state.cursor && media?.type === "spotify";

    if (!onScreen || !m || media?.type !== "spotify") {
      // The Spotify clip left the screen: stop it.
      if (this.last && this.last.status === "playing") void this.stop();
      this.last = null;
      return;
    }

    const key = `${state!.sessionId}:${m.cursor}:${m.slot}`;
    const prev = this.last?.key === key ? this.last : null;
    this.last = { key, seq: m.seq, status: m.status, muted: m.muted };

    if (m.status === "playing" && (!prev || prev.seq !== m.seq)) {
      void this.start(m.seq, media.uri, media.startSec ?? 0, media.endSec, m.muted);
    } else if (m.status === "playing" && prev?.status === "paused") {
      void this.resume(m.seq);
    } else if (m.status === "paused" && prev?.status === "playing") {
      void this.pause();
    } else if (m.status === "ended" && prev?.status === "playing") {
      this.clearTimer();
    }
    if (prev && prev.muted !== m.muted && this.clip) void this.setMuted(m.muted);
  }

  private fail(seq: number, err: unknown) {
    const code = err instanceof SpotifyError ? `spotify_${err.code}` : "spotify_api_error";
    this.log.warn({ err }, "spotify playback failed");
    this.dispatch({ type: "mediaError", seq, code });
  }

  private clearTimer() {
    if (this.endTimer) clearTimeout(this.endTimer);
    this.endTimer = null;
  }

  private armEnd(seq: number, ms: number) {
    this.clearTimer();
    this.endTimer = setTimeout(() => {
      this.endTimer = null;
      const device = this.clip?.device;
      if (device) void this.spotify.pause(device).catch(() => undefined);
      this.clip = null;
      this.dispatch({ type: "mediaEnded", seq });
    }, ms);
  }

  private async start(seq: number, ref: string, startSec: number, endSec: number | undefined, muted: boolean) {
    this.clearTimer();
    const id = spotifyTrackId(ref);
    const device = this.spotify.playbackDevice();
    if (!id) return this.fail(seq, new SpotifyError("not_found"));
    if (!device) return this.fail(seq, new SpotifyError("no_device"));
    try {
      if (muted) await this.spotify.volume(device, 0).catch(() => undefined);
      await this.spotify.play(device, `spotify:track:${id}`, startSec * 1000);
      // The clip runs from the moment Spotify accepted the command.
      const lengthMs = endSec !== undefined ? (endSec - startSec) * 1000 : null;
      this.clip = { endAt: lengthMs !== null ? this.now() + lengthMs : null, remainingMs: null, device };
      if (lengthMs !== null) this.armEnd(seq, lengthMs);
    } catch (err) {
      this.fail(seq, err);
    }
  }

  private async pause() {
    const clip = this.clip;
    this.clearTimer();
    if (!clip) return;
    clip.remainingMs = clip.endAt !== null ? Math.max(0, clip.endAt - this.now()) : null;
    await this.spotify.pause(clip.device).catch((err) => this.log.warn({ err }, "spotify pause failed"));
  }

  private async resume(seq: number) {
    const clip = this.clip;
    if (!clip) return;
    try {
      await this.spotify.resume(clip.device);
      if (clip.remainingMs !== null) {
        clip.endAt = this.now() + clip.remainingMs;
        this.armEnd(seq, clip.remainingMs);
      }
      clip.remainingMs = null;
    } catch (err) {
      this.fail(seq, err);
    }
  }

  private async setMuted(muted: boolean) {
    if (!this.clip) return;
    await this.spotify.volume(this.clip.device, muted ? 0 : 100).catch((err) => this.log.warn({ err }, "spotify volume failed"));
  }

  private async stop() {
    this.clearTimer();
    const clip = this.clip;
    this.clip = null;
    if (clip) await this.spotify.pause(clip.device).catch(() => undefined);
  }

  close() {
    this.clearTimer();
  }
}
