import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
      reportsDirectory: "node_modules/.cache/coverage/unit",
      reporter: ["text", "json-summary"],
      thresholds: {
        statements: 73,
        branches: 67,
        functions: 75,
        lines: 76,
      },
    },
  },
});
