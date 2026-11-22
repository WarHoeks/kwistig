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

  it("keys IPv6 by expanded /64", () => {
    expect(AttemptLimiter.key("2001:db8::1")).toBe("2001:db8:0:0");
    expect(AttemptLimiter.key("2001:0db8:0000:0000:1::")).toBe("2001:db8:0:0");
    expect(AttemptLimiter.key("::ffff:192.168.1.4")).toBe("192.168.1.4");
    const l = new AttemptLimiter(10, 50);
    for (let i = 0; i < 10; i++) l.fail(`2001:db8:1:2::${i}`, 0);
    expect(l.blocked("2001:db8:1:2:0:0:0:ffff", 1)).toBe(true);
  });

  it("parallel attempts from one client can't exceed the limit", async () => {
    const l = new AttemptLimiter(10, 1000);
    let checks = 0;
    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        l.attempt("192.168.1.9", () => {
          checks++;
          return false;
        }),
      ),
    );
    // Never more than the per-client cap of checks; the rest are refused unchecked.
    expect(checks).toBe(10);
    expect(results.filter((r) => r === "blocked").length).toBe(20);
    for (let i = 0; i < 20; i++) await l.attempt("192.168.1.9", () => (checks++, false));
    expect(checks).toBe(10);
    // Another client is unaffected.
    expect(await l.attempt("192.168.1.10", () => true)).toBe("ok");
  });

  it("while slowed down, a client gets one attempt in flight at a time", async () => {
    const l = new AttemptLimiter(10, 1);
    l.fail("10.0.0.1"); // trips the global slowdown
    let checks = 0;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => l.attempt("10.0.0.2", () => (checks++, false))),
    );
    expect(checks).toBe(1);
    expect(results.filter((r) => r === "blocked")).toHaveLength(4);
  }, 10_000);

  it("global failures slow attempts down but never block another client", () => {
    const l = new AttemptLimiter(10, 50);
    for (let i = 0; i < 50; i++) l.fail(`10.0.0.${i}`, 0);
    expect(l.blocked("10.9.9.9", 1)).toBe(false);
    expect(l.delayMs(1)).toBe(2000);
    expect(l.delayMs(10 * 60_000 + 1)).toBe(0);
  });
});
