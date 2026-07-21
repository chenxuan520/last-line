import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/standalone/**/*.test.ts"],
    maxWorkers: 1,
  },
});
