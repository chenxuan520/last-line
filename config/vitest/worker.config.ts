import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.worker.jsonc" },
      miniflare: {
        bindings: {
          ADMIN_BOOTSTRAP_TOKEN: "test-bootstrap-token",
          ADMIN_RESET_TOKEN: "test-reset-token",
          INTERNAL_ADMIN_TOKEN: "test-internal-admin-token",
        },
      },
    }),
  ],
  test: {
    include: ["tests/worker/**/*.test.ts"],
    coverage: {
      provider: "istanbul",
      include: ["worker/**/*.ts"],
      reportsDirectory: "node_modules/.cache/coverage/worker",
      reporter: ["text", "json-summary"],
      thresholds: {
        statements: 76,
        branches: 69,
        functions: 91,
        lines: 82,
      },
    },
  },
});
