import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/standalone/**/*.test.ts"],
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      include: ["standalone/**/*.ts"],
      exclude: ["standalone/**/*.d.ts"],
      reportsDirectory: "node_modules/.cache/coverage/standalone",
      reporter: ["text", "json-summary"],
      thresholds: {
        statements: 76,
        branches: 61,
        functions: 86,
        lines: 79,
      },
    },
  },
});
