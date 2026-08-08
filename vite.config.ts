import { execFileSync } from "node:child_process";
import { env } from "node:process";
import { defineConfig } from "vite";

const appVersion = env.APP_VERSION?.trim() || gitVersion();
const singlePlayerDebug = env.VITE_SINGLE_PLAYER_DEBUG === "true";

export default defineConfig({
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __SINGLE_PLAYER_DEBUG__: JSON.stringify(singlePlayerDebug),
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
