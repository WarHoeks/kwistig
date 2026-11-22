import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { AttemptLimiter } from "../src/auth/pin.js";
import { TEST_PIN, testApp } from "./helpers.js";

let app: FastifyInstance;
afterEach(async () => app?.close());

describe("host cookie", () => {
  it("does not contain anything derived from the PIN", async () => {
    let cookie: string;
    ({ app, cookie } = await testApp());
    expect(cookie).not.toContain(TEST_PIN);
    const value = decodeURIComponent(cookie.split("=")[1]!).split(".")[1]!;
    // A random 24-byte generation token, base64url.
    expect(value).toMatch(/^[\w-]{32}$/);
  });

  it("reports the default PIN so admin can warn", async () => {
    ({ app } = await testApp());
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { pin: TEST_PIN } });
    expect(res.json()).toEqual({ authenticated: true, defaultPin: false });
  });
});

describe("AttemptLimiter", () => {
  it("blocks a client after 10 failures", () => {
    const l = new AttemptLimiter();
    for (let i = 0; i < 10; i++) l.fail("192.168.1.5", 0);
    expect(l.blocked("192.168.1.5", 1)).toBe(true);
    expect(l.blocked("192.168.1.6", 1)).toBe(false);
    expect(l.blocked("192.168.1.5", 10 * 60_000 + 1)).toBe(false);
  });

  it("keys IPv6 by /64 and has a global cap", () => {
    const l = new AttemptLimiter(10, 50);
    for (let i = 0; i < 10; i++) l.fail(`2001:db8:1:2::${i}`, 0);
    expect(l.blocked("2001:db8:1:2::ffff", 1)).toBe(true);
    for (let i = 0; i < 40; i++) l.fail(`10.0.0.${i}`, 0);
    expect(l.blocked("10.9.9.9", 1)).toBe(true);
  });
});
