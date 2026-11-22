import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "../db/client.js";
import { getSetting, setSetting } from "../services/settings.js";

export const HOST_COOKIE = "kwistig_host";
export const DEFAULT_PIN = "change-me";
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 180;

/** scrypt hash as "salt:hash" (hex). */
export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyHash(pin: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(pin, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

/**
 * Host authentication. The PIN saved in admin settings wins; otherwise HOST_PIN.
 *
 * The cookie carries a random "auth generation" token, never anything derived from
 * the PIN. The generation rotates whenever the effective PIN changes (admin setting
 * or a new HOST_PIN in the environment), which signs out every device.
 */
export class HostAuth {
  private generation: string;

  constructor(
    private readonly db: Db,
    private readonly envPin: string,
  ) {
    // Store a hash of the env PIN so a changed HOST_PIN is detected on boot.
    const envHash = getSetting(db, "env_pin_hash");
    const gen = getSetting(db, "auth_generation");
    if (!gen || !envHash || !verifyHash(envPin, envHash)) {
      setSetting(db, "env_pin_hash", hashPin(envPin));
      if (!getSetting(db, "pin_hash") || !gen) this.rotate();
    }
    this.generation = getSetting(db, "auth_generation")!;
  }

  private rotate() {
    this.generation = randomBytes(24).toString("base64url");
    setSetting(this.db, "auth_generation", this.generation);
  }

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
    const stored = getSetting(this.db, "pin_hash") ?? getSetting(this.db, "env_pin_hash")!;
    return verifyHash(pin, stored);
  }

  /** True while the effective PIN is still the shipped default. */
  usingDefaultPin(): boolean {
    return !getSetting(this.db, "pin_hash") && this.envPin === DEFAULT_PIN;
  }

  setPin(pin: string): void {
    setSetting(this.db, "pin_hash", hashPin(pin));
    this.rotate();
  }

  private cookieValue(): string {
    return `host.${this.generation}`;
  }

  private matches(value: string | null): boolean {
    if (!value) return false;
    const a = Buffer.from(value);
    const b = Buffer.from(this.cookieValue());
    return a.length === b.length && timingSafeEqual(a, b);
  }

  isHost(req: FastifyRequest): boolean {
    const raw = req.cookies[HOST_COOKIE];
    if (!raw) return false;
    const unsigned = req.unsignCookie(raw);
    return unsigned.valid && this.matches(unsigned.value);
  }

  /** Same check for a raw Cookie header (Socket.IO handshake). */
  isHostCookieHeader(
    header: string | undefined,
    unsign: (v: string) => { valid: boolean; value: string | null },
  ): boolean {
    if (!header) return false;
    const match = header.split(/;\s*/).find((c) => c.startsWith(`${HOST_COOKIE}=`));
    if (!match) return false;
    const unsigned = unsign(decodeURIComponent(match.slice(HOST_COOKIE.length + 1)));
    return unsigned.valid && this.matches(unsigned.value);
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

/**
 * Failed-PIN limiter: per client (IPv6 keyed by /64) and globally, so a LAN guest
 * can't brute-force a short PIN by rotating addresses.
 */
export class AttemptLimiter {
  private readonly perClient = new Map<string, { count: number; resetAt: number }>();
  private global = { count: 0, resetAt: 0 };

  constructor(
    private readonly maxPerClient = 10,
    private readonly maxGlobal = 50,
    private readonly windowMs = 10 * 60_000,
  ) {}

  /** IPv4 as-is; IPv6 expanded and cut to its /64 prefix. */
  static key(ip: string): string {
    if (!ip.includes(":")) return ip;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (mapped) return mapped[1]!;
    const [head = "", tail = ""] = ip.split("%")[0]!.split("::");
    const h = head ? head.split(":") : [];
    const t = ip.includes("::") ? (tail ? tail.split(":") : []) : [];
    const groups = ip.includes("::") ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
    return groups
      .slice(0, 4)
      .map((g) => g.toLowerCase().replace(/^0+(?=.)/, ""))
      .join(":");
  }

  /** Hard block for one client that keeps guessing. */
  blocked(ip: string, now = Date.now()): boolean {
    const c = this.perClient.get(AttemptLimiter.key(ip));
    return !!c && c.resetAt > now && c.count >= this.maxPerClient;
  }

  /**
   * Many failures across all clients slow every attempt down instead of blocking,
   * so a guest can't lock the real host out.
   */
  delayMs(now = Date.now()): number {
    return this.global.resetAt > now && this.global.count >= this.maxGlobal ? 2000 : 0;
  }

  fail(ip: string, now = Date.now()): void {
    const key = AttemptLimiter.key(ip);
    const c = this.perClient.get(key);
    if (!c || c.resetAt <= now) this.perClient.set(key, { count: 1, resetAt: now + this.windowMs });
    else c.count += 1;
    if (this.global.resetAt <= now) this.global = { count: 1, resetAt: now + this.windowMs };
    else this.global.count += 1;
  }
}
