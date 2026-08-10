import { describe, expect, it } from "vitest";
import {
  closestPointInsideConvexPolygon2D,
  pointInsideConvexPolygon2D,
} from "../../src/game/rules/obstacleGeometry";

describe("convex polygon clearance geometry", () => {
  const square = [
    { x: -2, z: -2 },
    { x: 2, z: -2 },
    { x: 2, z: 2 },
    { x: -2, z: 2 },
  ] as const;

  it("applies the same clearance for either winding and skips repeated vertices", () => {
    const clockwiseWithDuplicate = [
      square[0],
      square[3],
      square[2],
      square[2],
      square[1],
    ];

    expect(pointInsideConvexPolygon2D(0, 0, square, 0.5)).toBe(true);
    expect(pointInsideConvexPolygon2D(0, 0, clockwiseWithDuplicate, 0.5)).toBe(true);
    expect(pointInsideConvexPolygon2D(1.75, 0, square, 0.5)).toBe(false);
    expect(pointInsideConvexPolygon2D(1.75, 0, clockwiseWithDuplicate, 0.5)).toBe(false);
  });

  it("clamps candidates to the inset polygon instead of the outer boundary", () => {
    const clamped = closestPointInsideConvexPolygon2D(3, 1, square, 0.5);

    expect(clamped).not.toBeNull();
    expect(clamped?.x).toBeCloseTo(1.5, 7);
    expect(clamped?.z).toBeCloseTo(1, 7);
    expect(pointInsideConvexPolygon2D(clamped?.x ?? 0, clamped?.z ?? 0, square, 0.5)).toBe(true);
  });

  it("rejects degenerate polygons and impossible clearance", () => {
    expect(pointInsideConvexPolygon2D(0, 0, square.slice(0, 2), 0)).toBe(false);
    expect(closestPointInsideConvexPolygon2D(0, 0, square, 3)).toBeNull();
  });
});
