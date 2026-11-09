import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  // Give each test room on a busy machine.
  test: { include: ["tests/**/*.test.ts"], environment: "node", testTimeout: 30_000 },
});
