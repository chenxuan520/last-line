import { execFileSync } from "node:child_process";
import { env } from "node:process";
import { defineConfig } from "vite";

const appVersion = env.APP_VERSION?.trim() || gitVersion();

export default defineConfig({
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    host: "127.0.0.1",
  },
});

function gitVersion(): string {
  try {
    return execFileSync("git", ["describe", "--tags", "--always"], { encoding: "utf8" }).trim() || "dev";
  } catch {
    return "dev";
  }
}
