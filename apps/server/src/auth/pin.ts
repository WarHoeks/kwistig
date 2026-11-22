import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "../db/client.js";
import { getSetting, setSetting } from "../services/settings.js";

export const HOST_COOKIE = "kwistig_host";
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 180;

/** scrypt hash as "salt:hash" (hex). */
export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyHash(pin: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(pin, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * The PIN saved in admin settings wins; otherwise HOST_PIN from the environment.
 */
export class HostAuth {
  constructor(
    private readonly db: Db,
    private readonly envPin: string,
  ) {}

  /** Secret used to sign cookies; generated once and kept in SQLite. */
  cookieSecret(): string {
    let secret = getSetting(this.db, "cookie_secret");
    if (!secret) {
      secret = randomBytes(32).toString("hex");
      setSetting(this.db, "cookie_secret", secret);
    }
    return secret;
  }

  verify(pin: string): boolean {
    const stored = getSetting(this.db, "pin_hash");
    return stored ? verifyHash(pin, stored) : safeEqual(pin, this.envPin);
  }

  setPin(pin: string): void {
    setSetting(this.db, "pin_hash", hashPin(pin));
  }

  /** Cookie value bound to the current PIN, so changing the PIN signs everyone out. */
  private cookieValue(): string {
    const pinSource = getSetting(this.db, "pin_hash") ?? `env:${this.envPin}`;
    return `host.${createHash("sha256").update(pinSource).digest("hex").slice(0, 16)}`;
  }

  isHost(req: FastifyRequest): boolean {
    const raw = req.cookies[HOST_COOKIE];
    if (!raw) return false;
    const unsigned = req.unsignCookie(raw);
    return unsigned.valid && unsigned.value === this.cookieValue();
  }

  /** Same check for a raw Cookie header (Socket.IO handshake). */
  isHostCookieHeader(header: string | undefined, unsign: (v: string) => { valid: boolean; value: string | null }): boolean {
    if (!header) return false;
    const match = header.split(/;\s*/).find((c) => c.startsWith(`${HOST_COOKIE}=`));
    if (!match) return false;
    const unsigned = unsign(decodeURIComponent(match.slice(HOST_COOKIE.length + 1)));
    return unsigned.valid && unsigned.value === this.cookieValue();
  }

  signIn(reply: FastifyReply): void {
    reply.setCookie(HOST_COOKIE, this.cookieValue(), {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      signed: true,
      maxAge: COOKIE_MAX_AGE_SEC,
    });
  }

  signOut(reply: FastifyReply): void {
    reply.clearCookie(HOST_COOKIE, { path: "/" });
  }
}

/** Simple fixed-window limiter for PIN attempts per IP. */
export class AttemptLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private readonly max = 10,
    private readonly windowMs = 60_000,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.max;
  }
}
