import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseSinglePlayerDebugArguments } from "../src/config/debug.ts";

const { enabled, viteArguments } = parseSinglePlayerDebugArguments(process.argv.slice(2));
const viteEntry = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const child = spawn(process.execPath, [viteEntry, ...viteArguments], {
  env: {
    ...process.env,
    VITE_SINGLE_PLAYER_DEBUG: enabled ? "true" : "false",
  },
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}

child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
