import { describe, expect, it } from "vitest";
import { leaderboardScrollPixels, pauseExitLabel } from "../../src/client/ui/GameHud";

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
});
