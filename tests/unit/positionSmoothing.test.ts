import { describe, expect, it } from "vitest";
import {
  advancePositionTransition,
  createCorrectionTransition,
  createPositionTransition,
  createRemotePositionTransition,
  positionTransitionComplete,
  samplePositionTransition,
  snapshotElapsedSeconds,
  snapshotInterpolationSeconds,
} from "../../src/network/PositionSmoothing";
import { createActorState } from "../../src/game/state/types";

describe("multiplayer position smoothing", () => {
  it("uses server tick gaps to smooth dropped snapshots without unbounded delay", () => {
    expect(snapshotInterpolationSeconds(30, 33)).toBeCloseTo(0.12);
    expect(snapshotInterpolationSeconds(30, 36)).toBeCloseTo(0.2);
    expect(snapshotInterpolationSeconds(30, 60)).toBe(0.25);
    expect(snapshotInterpolationSeconds(-1, 0)).toBeCloseTo(0.12);
    expect(snapshotElapsedSeconds(30, 33)).toBeCloseTo(0.1);
    expect(snapshotElapsedSeconds(30, 36)).toBeCloseTo(0.2);
  });

  it("advances a new transition only with time after that snapshot", () => {
    const transition = createPositionTransition(
      { x: 0, y: 2, z: 0 },
      { x: 10, y: 4, z: -2 },
      0.1,
    );

    expect(samplePositionTransition(transition)).toEqual({ x: 0, y: 2, z: 0 });
    advancePositionTransition(transition, 0.05);
    expect(samplePositionTransition(transition)).toEqual({ x: 5, y: 3, z: -1 });
    expect(positionTransitionComplete(transition)).toBe(false);
    advancePositionTransition(transition, 0.2);
    expect(samplePositionTransition(transition)).toEqual({ x: 10, y: 4, z: -2 });
    expect(positionTransitionComplete(transition)).toBe(true);
  });

  it("smooths ordinary prediction corrections but snaps real teleports", () => {
    const correction = createCorrectionTransition(
      { x: 12, y: 2, z: 4 },
      { x: 10, y: 2, z: 4 },
      0.12,
      6,
    );
    if (!correction) throw new Error("correction missing");
    expect(samplePositionTransition(correction)).toEqual({ x: 2, y: 0, z: 0 });
    advancePositionTransition(correction, 0.06);
    expect(samplePositionTransition(correction)).toEqual({ x: 1, y: 0, z: 0 });
    expect(createCorrectionTransition(
      { x: 20, y: 2, z: 4 },
      { x: 10, y: 2, z: 4 },
      0.12,
      6,
    )).toBeNull();
  });

  it("snaps remote teleport and lifecycle boundaries while smoothing valid movement", () => {
    const previous = createActorState("remote", "bot", { x: 0, y: 1.76, z: 0 });
    const next = createActorState("remote", "bot", { x: 2, y: 1.76, z: 0 });
    const ordinary = createRemotePositionTransition(previous.position, previous, next, 0.12, 0.1, 65, false);
    expect(ordinary.durationSeconds).toBe(0.12);
    expect(samplePositionTransition(ordinary)).toEqual(previous.position);

    next.position.x = 10;
    const teleport = createRemotePositionTransition(previous.position, previous, next, 0.12, 0.1, 65, false);
    expect(teleport.durationSeconds).toBe(0);
    expect(samplePositionTransition(teleport)).toEqual(next.position);

    next.position.x = 2;
    next.deployment = "parachuting";
    expect(createRemotePositionTransition(previous.position, previous, next, 0.12, 0.1, 65, false).durationSeconds).toBe(0);
    next.deployment = "grounded";
    next.alive = false;
    expect(createRemotePositionTransition(previous.position, previous, next, 0.12, 0.1, 65, false).durationSeconds).toBe(0);
    next.alive = true;
    expect(createRemotePositionTransition(previous.position, previous, next, 0.12, 0.1, 65, true).durationSeconds).toBe(0);
  });

  it("keeps plausible high-speed parachuting movement smooth", () => {
    const previous = createActorState("remote", "bot", { x: 0, y: 120, z: 0 });
    const next = createActorState("remote", "bot", { x: 10, y: 119.5, z: 0 });
    previous.deployment = "parachuting";
    next.deployment = "parachuting";

    expect(createRemotePositionTransition(previous.position, previous, next, 0.2, 0.2, 65, false).durationSeconds).toBe(0.2);

    next.position = { x: 17, y: 119.5, z: 0 };
    expect(createRemotePositionTransition(previous.position, previous, next, 0.12, 0.1, 65, false).durationSeconds).toBe(0);

    next.position = { x: 16, y: 119.5, z: 0 };
    expect(createRemotePositionTransition(previous.position, previous, next, 0.25, 0.25, 65, false).durationSeconds).toBe(0.25);

    next.position = { x: 19, y: 119.5, z: 0 };
    expect(createRemotePositionTransition(previous.position, previous, next, 0.25, 0.3, 65, false).durationSeconds).toBe(0);
  });
});
