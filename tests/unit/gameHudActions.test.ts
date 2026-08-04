import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hudRootClassName, leaderboardScrollPixels, pauseExitLabel } from "../../src/client/ui/GameHud";

describe("GameHud actions", () => {
  it("uses mode-specific pause exit labels", () => {
    expect(pauseExitLabel(false)).toBe("返回大厅");
    expect(pauseExitLabel(true)).toBe("返回联机大厅");
  });

  it("normalizes pixel, line, and page wheel deltas for leaderboard scrolling", () => {
    expect(leaderboardScrollPixels(12, 0, 400)).toBe(12);
    expect(leaderboardScrollPixels(3, 1, 400)).toBe(48);
    expect(leaderboardScrollPixels(-1, 2, 400)).toBe(-400);
  });

  it("adds the high-quality HUD layer only for high quality", () => {
    expect(hudRootClassName(false, "high")).toBe("is-playing is-high-quality-hud");
    expect(hudRootClassName(true, "high")).toBe("is-playing is-touch-input is-high-quality-hud");
    expect(hudRootClassName(false, "medium")).toBe("is-playing");
    expect(hudRootClassName(true, "low")).toBe("is-playing is-touch-input");
  });

  it("keeps native settings selects readable in dark menus", async () => {
    const stylesheet = await readFile(resolve(process.cwd(), "src/styles/main.css"), "utf8");
    expect(stylesheet).toMatch(/\.settings-grid select\s*\{[^}]*color-scheme:\s*dark;/s);
    const optionRule = stylesheet.match(/\.settings-grid select option\s*\{(?<body>[^}]*)\}/s)?.groups?.body;
    expect(optionRule).toMatch(/color:\s*var\(--ink\);/);
    expect(optionRule).toMatch(/background:\s*#111714;/);
  });
});
