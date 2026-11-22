import path from "node:path";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

export const TEST_PIN = "1234";

export async function testApp() {
  const config = loadConfig({
    HOST_PIN: TEST_PIN,
    LOG_LEVEL: "silent",
    MIGRATIONS_DIR: path.resolve(import.meta.dirname, "../drizzle"),
    WEB_DIST: path.resolve(import.meta.dirname, "__no_web__"),
  });
  const app = await buildApp({ config, dbFile: ":memory:" });
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { pin: TEST_PIN } });
  const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  return { app, cookie };
}
