import { describe, expect, it } from "vitest";
import { FixedStepClock } from "../../src/game/FixedStepClock";
import { QUALITY_PROFILES } from "../../src/config/settings";

describe("FixedStepClock", () => {
  it("advances in fixed-size steps", () => {
    const clock = new FixedStepClock(0.1);
    const deltas: number[] = [];

    expect(clock.advance(0.25, (delta) => deltas.push(delta))).toBe(2);
    expect(deltas).toEqual([0.1, 0.1]);
    expect(clock.advance(0.05, (delta) => deltas.push(delta))).toBe(1);
  });

  it("caps a long frame", () => {
    const clock = new FixedStepClock(0.1, 0.25);
    expect(clock.advance(2, () => undefined)).toBe(2);
  });

  it("keeps 30 Hz simulation time under every render cap", () => {
    for (const fps of [60, 90, 120]) {
      const clock = new FixedStepClock();
      let steps = 0;
      for (let frame = 0; frame < fps * 2; frame += 1) {
        clock.advance(1 / fps, () => steps += 1);
      }
      expect(steps).toBe(60);
    }
  });

  it("defines increasing detail and 60/90/120 FPS quality profiles", () => {
    expect([
      QUALITY_PROFILES.low.maxFps,
      QUALITY_PROFILES.medium.maxFps,
      QUALITY_PROFILES.high.maxFps,
    ]).toEqual([60, 90, 120]);
    expect(QUALITY_PROFILES.low.treeCount).toBeLessThan(QUALITY_PROFILES.medium.treeCount);
    expect(QUALITY_PROFILES.medium.treeCount).toBeLessThan(QUALITY_PROFILES.high.treeCount);
    expect(QUALITY_PROFILES.low.shrubCount).toBeLessThan(QUALITY_PROFILES.high.shrubCount);
  });
});
