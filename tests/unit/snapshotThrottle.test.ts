import { describe, expect, it } from "vitest";
import { SnapshotThrottle } from "../../src/server/SnapshotThrottle";

describe("SnapshotThrottle", () => {
  it("allows regular snapshots while suppressing catch-up bursts", () => {
    const throttle = new SnapshotThrottle(80);
    throttle.reset(1_000);

    expect(throttle.consume(1_000)).toBe(true);
    expect(throttle.consume(1_001)).toBe(false);
    expect(throttle.consume(1_079)).toBe(false);
    expect(throttle.consume(1_080)).toBe(true);
    expect(throttle.consume(1_081)).toBe(false);
    expect(throttle.consume(1_200)).toBe(true);
  });

  it("recovers when the monotonic clock is reset", () => {
    const throttle = new SnapshotThrottle(80);
    throttle.reset(1_000);
    expect(throttle.consume(1_000)).toBe(true);
    expect(throttle.consume(10)).toBe(true);
  });
});
