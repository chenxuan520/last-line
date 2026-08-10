import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/performance/**/*.test.ts"],
    execArgv: ["--max-old-space-size=6144"],
    maxWorkers: 1,
  },
});
