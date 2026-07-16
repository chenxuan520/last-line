import { describe, expect, it } from "vitest";
import { FixedStepClock } from "../../src/game/FixedStepClock";

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
});
