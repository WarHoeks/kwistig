import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@kwistig/shared": path.resolve(import.meta.dirname, "packages/shared/src/index.ts"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/server/test/**/*.test.ts"],
    environment: "node",
  },
});
