import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const PORT = 8181;
const root = path.resolve(import.meta.dirname, "..");

export default defineConfig({
  testDir: ".",
  timeout: 120_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: path.join(root, "test-results"),
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    // Runs the production build: `npm run build` first.
    command: "node apps/server/dist/index.js",
    cwd: root,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      PORT: String(PORT),
      HOST: "127.0.0.1",
      HOST_PIN: "e2e-pin-4321",
      PUBLIC_BASE_URL: `http://127.0.0.1:${PORT}`,
      DATA_DIR: path.join(os.tmpdir(), `kwistig-e2e-${Date.now()}`),
      LOG_LEVEL: "warn",
      EXTERNAL_FETCH: "false",
    },
  },
});
