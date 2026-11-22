import { createHash, randomBytes } from "node:crypto";
import {
  SPOTIFY_CALLBACK_PATH,
  SPOTIFY_SCOPES,
  type SpotifyDevice,
  type SpotifyDiagnoseStep,
  type SpotifyPlaylist,
  type SpotifyStatus,
  type SpotifyTrack,
} from "@kwistig/shared";
import type { Db } from "../db/client.js";
import { deleteSetting, getSetting, setSetting } from "./settings.js";

/**
 * Spotify for one host: Authorization Code with PKCE (no client secret), tokens
 * kept in SQLite and refreshed by the server, and thin wrappers around the Web
 * API endpoints that Development Mode apps can still use (see docs/PLAN.md).
 */

const ACCOUNTS = "https://accounts.spotify.com";
const API = "https://api.spotify.com/v1";

export class SpotifyError extends Error {
  constructor(
    readonly code:
      | "not_configured"
      | "not_connected"
      | "auth_failed"
      | "invalid_state"
      | "premium_required"
      | "no_device"
      | "quota"
      | "not_found"
      | "forbidden"
      | "api_error",
    readonly status: number | null = null,
  ) {
    super(code);
  }
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
  scope: string;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const b64url = (b: Buffer) => b.toString("base64url");

export class SpotifyService {
  /** state → PKCE verifier, for logins in progress (10 minutes). */
  private readonly pending = new Map<string, { verifier: string; redirectUri: string; expires: number }>();
  private refreshing: Promise<Tokens> | null = null;
  /** The TV page's SDK player, while it's online. Not persisted: it changes per page load. */
  tvDevice: { id: string; name: string } | null = null;

  constructor(
    private readonly db: Db,
    private readonly env: { clientId: string | undefined; redirectUri: string },
    private readonly fetchImpl: FetchLike = (u, i) => fetch(u, i),
    private readonly now: () => number = Date.now,
  ) {}

  // ---------------------------------------------------------------- configuration

  /** The admin's saved value wins over the environment. */
  clientId(): { value: string | null; source: SpotifyStatus["clientIdSource"] } {
    const saved = getSetting(this.db, "spotify_client_id");
    if (saved) return { value: saved, source: "settings" };
    return this.env.clientId ? { value: this.env.clientId, source: "env" } : { value: null, source: null };
  }

  redirectUri(): { value: string; source: SpotifyStatus["redirectUriSource"] } {
    const saved = getSetting(this.db, "spotify_redirect_uri");
    return saved ? { value: saved, source: "settings" } : { value: this.env.redirectUri, source: "env" };
  }

  configure(patch: { clientId?: string | null; redirectUri?: string | null; fallbackDeviceId?: string | null }) {
    const before = this.clientId().value;
    for (const [key, setting] of [
      ["clientId", "spotify_client_id"],
      ["redirectUri", "spotify_redirect_uri"],
      ["fallbackDeviceId", "spotify_fallback_device"],
    ] as const) {
      const v = patch[key];
      if (v === undefined) continue;
      if (v === null) deleteSetting(this.db, setting);
      else setSetting(this.db, setting, v);
    }
    // Tokens belong to one app: a different Client ID means connecting again.
    if (this.clientId().value !== before) this.disconnect();
  }

  fallbackDeviceId(): string | null {
    return getSetting(this.db, "spotify_fallback_device") ?? null;
  }

  status(): SpotifyStatus {
    const c = this.clientId();
    const r = this.redirectUri();
    const account = getSetting(this.db, "spotify_account");
    return {
      clientId: c.value,
      clientIdSource: c.source,
      redirectUri: r.value,
      redirectUriSource: r.source,
      connected: !!this.tokens(),
      account: account ? (JSON.parse(account) as SpotifyStatus["account"]) : null,
      tvDevice: this.tvDevice,
      fallbackDeviceId: this.fallbackDeviceId(),
    };
  }

  // ---------------------------------------------------------------- PKCE login

  /** Starts a login: returns the Spotify authorize URL. */
  authorizeUrl(): string {
    const clientId = this.clientId().value;
    if (!clientId) throw new SpotifyError("not_configured");
    const redirectUri = this.redirectUri().value;
    const verifier = b64url(randomBytes(48));
    const challenge = b64url(createHash("sha256").update(verifier).digest());
    const state = b64url(randomBytes(18));
    const now = this.now();
    for (const [k, p] of this.pending) if (p.expires < now) this.pending.delete(k);
    this.pending.set(state, { verifier, redirectUri, expires: now + 10 * 60_000 });
    const q = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      code_challenge_method: "S256",
      code_challenge: challenge,
      state,
      scope: SPOTIFY_SCOPES.join(" "),
    });
    return `${ACCOUNTS}/authorize?${q}`;
  }

  /** Handles the redirect back from Spotify. The state is single-use. */
  async completeLogin(code: string, state: string): Promise<void> {
    const p = this.pending.get(state);
    this.pending.delete(state);
    if (!p || p.expires < this.now()) throw new SpotifyError("invalid_state");
    const clientId = this.clientId().value;
    if (!clientId) throw new SpotifyError("not_configured");
    const tokens = await this.tokenRequest(
      { grant_type: "authorization_code", code, redirect_uri: p.redirectUri, client_id: clientId, code_verifier: p.verifier },
      null,
    );
    this.saveTokens(tokens);
    const me = await this.api<{ id: string; display_name: string | null }>("GET", "/me");
    setSetting(this.db, "spotify_account", JSON.stringify({ id: me.id, displayName: me.display_name }));
  }

  disconnect() {
    deleteSetting(this.db, "spotify_tokens");
    deleteSetting(this.db, "spotify_account");
    this.tvDevice = null;
  }

  private tokens(): Tokens | null {
    const raw = getSetting(this.db, "spotify_tokens");
    return raw ? (JSON.parse(raw) as Tokens) : null;
  }

  private saveTokens(t: Tokens) {
    setSetting(this.db, "spotify_tokens", JSON.stringify(t));
  }

  private async tokenRequest(form: Record<string, string>, previousRefresh: string | null): Promise<Tokens> {
    const res = await this.fetchImpl(`${ACCOUNTS}/api/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
    const data = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      error?: string;
    };
    if (!res.ok || !data.access_token) {
      // A revoked or expired refresh token: the host has to connect again.
      if (data.error === "invalid_grant") this.disconnect();
      throw new SpotifyError("auth_failed", res.status);
    }
    return {
      accessToken: data.access_token,
      // Spotify may rotate the refresh token; keep the old one when it doesn't.
      refreshToken: data.refresh_token ?? previousRefresh ?? "",
      expiresAt: this.now() + (data.expires_in ?? 3600) * 1000,
      scope: data.scope ?? "",
    };
  }

  /** A valid access token, refreshed a minute before it expires. Concurrent callers share one refresh. */
  async accessToken(): Promise<{ token: string; expiresAt: number }> {
    let t = this.tokens();
    if (!t) throw new SpotifyError("not_connected");
    if (t.expiresAt - 60_000 <= this.now()) {
      const clientId = this.clientId().value;
      if (!clientId) throw new SpotifyError("not_configured");
      this.refreshing ??= this.tokenRequest(
        { grant_type: "refresh_token", refresh_token: t.refreshToken, client_id: clientId },
        t.refreshToken,
      ).finally(() => (this.refreshing = null));
      t = await this.refreshing;
      this.saveTokens(t);
    }
    return { token: t.accessToken, expiresAt: t.expiresAt };
  }

  // ---------------------------------------------------------------- Web API

  /** Calls the Web API; retries once after a 401 with a fresh token. */
  async api<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
    const { token } = await this.accessToken();
    const res = await this.fetchImpl(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 401 && !retried) {
      const t = this.tokens();
      if (t) this.saveTokens({ ...t, expiresAt: 0 }); // force a refresh
      return this.api<T>(method, path, body, true);
    }
    if (res.status === 204 || res.status === 202) return undefined as T;
    const text = await res.text();
    const data = text ? (JSON.parse(text) as unknown) : undefined;
    if (!res.ok) {
      const reason = (data as { error?: { reason?: string } } | undefined)?.error?.reason;
      if (res.status === 401) throw new SpotifyError("not_connected", 401);
      if (res.status === 429) throw new SpotifyError("quota", 429);
      if (reason === "PREMIUM_REQUIRED") throw new SpotifyError("premium_required", res.status);
      if (reason === "NO_ACTIVE_DEVICE" || (res.status === 404 && path.startsWith("/me/player"))) throw new SpotifyError("no_device", res.status);
      if (res.status === 404) throw new SpotifyError("not_found", 404);
      if (res.status === 403) throw new SpotifyError("forbidden", 403);
      throw new SpotifyError("api_error", res.status);
    }
    return data as T;
  }

  async devices(): Promise<SpotifyDevice[]> {
    const r = await this.api<{ devices: { id: string; name: string; type: string; is_active: boolean }[] }>("GET", "/me/player/devices");
    return r.devices.filter((d) => d.id).map((d) => ({ id: d.id, name: d.name, type: d.type, isActive: d.is_active }));
  }

  /** The device to play on: the TV page's player if it's online, else the chosen Connect device. */
  playbackDevice(): string | null {
    return this.tvDevice?.id ?? this.fallbackDeviceId();
  }

  async play(deviceId: string, uri: string, positionMs: number) {
    await this.api("PUT", `/me/player/play?device_id=${encodeURIComponent(deviceId)}`, { uris: [uri], position_ms: Math.max(0, Math.round(positionMs)) });
  }

  async resume(deviceId: string) {
    await this.api("PUT", `/me/player/play?device_id=${encodeURIComponent(deviceId)}`);
  }

  async pause(deviceId: string) {
    await this.api("PUT", `/me/player/pause?device_id=${encodeURIComponent(deviceId)}`);
  }

  async volume(deviceId: string, percent: number) {
    await this.api("PUT", `/me/player/volume?volume_percent=${Math.round(percent)}&device_id=${encodeURIComponent(deviceId)}`);
  }

  /** One track, for the editor's link check. */
  async track(id: string): Promise<SpotifyTrack> {
    const t = await this.api<RawTrack>("GET", `/tracks/${encodeURIComponent(id)}`);
    return { uri: t.uri, name: t.name, artists: t.artists.map((a) => a.name), durationMs: t.duration_ms };
  }

  // ---------------------------------------------------------------- playlists

  private accountId(): string | null {
    return this.status().account?.id ?? null;
  }

  async playlists(): Promise<SpotifyPlaylist[]> {
    const me = this.accountId();
    const out: SpotifyPlaylist[] = [];
    for (let offset = 0; offset < 500; offset += 50) {
      const page = await this.api<{
        items: {
          id: string;
          name: string;
          collaborative: boolean;
          owner: { id: string; display_name: string | null };
          images?: { url: string }[] | null;
          items?: { total: number } | null;
          tracks?: { total: number } | null;
        }[];
        next: string | null;
      }>("GET", `/me/playlists?limit=50&offset=${offset}`);
      for (const p of page.items) {
        if (!p) continue;
        out.push({
          id: p.id,
          name: p.name,
          owner: p.owner.display_name ?? p.owner.id,
          // Development Mode only lists tracks of playlists you own or collaborate on.
          importable: p.owner.id === me || p.collaborative,
          trackCount: p.items?.total ?? p.tracks?.total ?? null,
          image: p.images?.[0]?.url ?? null,
        });
      }
      if (!page.next) break;
    }
    return out;
  }

  /** Tracks of one of your own playlists, via GET /playlists/{id}/items. */
  async playlistTracks(id: string): Promise<SpotifyTrack[]> {
    const out: SpotifyTrack[] = [];
    for (let offset = 0; offset < 1000; offset += 50) {
      const page = await this.api<{
        items: { item?: RawTrack | null; track?: RawTrack | null }[];
        next: string | null;
      }>("GET", `/playlists/${encodeURIComponent(id)}/items?limit=50&offset=${offset}`);
      for (const entry of page.items) {
        const t = entry.item ?? entry.track;
        if (t && t.type === "track" && t.uri && !t.is_local) {
          out.push({ uri: t.uri, name: t.name, artists: t.artists.map((a) => a.name), durationMs: t.duration_ms });
        }
      }
      if (!page.next) break;
    }
    return out;
  }

  // ---------------------------------------------------------------- diagnose

  /** Tries each endpoint Kwistig uses once, so the host can see what their app may do. */
  async diagnose(): Promise<SpotifyDiagnoseStep[]> {
    const steps: SpotifyDiagnoseStep[] = [];
    const step = async (name: string, endpoint: string, fn: () => Promise<string>) => {
      try {
        steps.push({ name, endpoint, ok: true, status: 200, detail: await fn() });
      } catch (err) {
        const e = err instanceof SpotifyError ? err : new SpotifyError("api_error");
        steps.push({ name, endpoint, ok: false, status: e.status, detail: e.code });
      }
    };
    await step("token", "POST accounts /api/token (refresh)", async () => {
      const t = await this.accessToken();
      return `valid until ${new Date(t.expiresAt).toISOString()}`;
    });
    await step("profile", "GET /me", async () => {
      const me = await this.api<{ display_name: string | null; id: string }>("GET", "/me");
      return me.display_name ?? me.id;
    });
    await step("devices", "GET /me/player/devices", async () => {
      const d = await this.devices();
      return d.length ? d.map((x) => `${x.name} (${x.type})`).join(", ") : "no devices online";
    });
    await step("track", "GET /tracks/{id}", async () => {
      const t = await this.api<RawTrack>("GET", "/tracks/11dFghVXANMlKmJXsNCbNl");
      return `${t.name} — ${t.artists.map((a) => a.name).join(", ")}`;
    });
    let own: SpotifyPlaylist | undefined;
    await step("playlists", "GET /me/playlists", async () => {
      const lists = await this.playlists();
      own = lists.find((l) => l.importable);
      return `${lists.length} playlists, ${lists.filter((l) => l.importable).length} of your own`;
    });
    await step("playlistItems", "GET /playlists/{id}/items", async () => {
      if (!own) return "skipped: no playlist of your own to try";
      const tracks = await this.playlistTracks(own.id);
      return `“${own.name}”: ${tracks.length} tracks`;
    });
    return steps;
  }
}

interface RawTrack {
  type?: string;
  uri: string;
  name: string;
  duration_ms: number;
  is_local?: boolean;
  artists: { name: string }[];
}

export { SPOTIFY_CALLBACK_PATH };
