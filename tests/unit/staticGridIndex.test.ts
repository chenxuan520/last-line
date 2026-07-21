import { describe, expect, it } from "vitest";
import { StaticGridIndex, type StaticGridBounds } from "../../src/game/spatial/StaticGridIndex";

describe("StaticGridIndex", () => {
  it("keeps corner-crossing candidates complete, deduplicated, and in source order", () => {
    const items = [
      { id: "horizontal", bounds: bounds(31, 33, -1, 1) },
      { id: "vertical", bounds: bounds(-1, 1, 31, 33) },
      { id: "corner", bounds: bounds(31, 33, 31, 33) },
      { id: "wide", bounds: bounds(20, 70, 20, 70) },
    ];
    const index = new StaticGridIndex(items, 32, (item) => item.bounds);

    expect(index.querySegment(0, 0, 64, 64).map((item) => item.id)).toEqual([
      "horizontal",
      "vertical",
      "corner",
      "wide",
    ]);
    expect(index.queryPoint(32, 32).map((item) => item.id)).toEqual(["corner", "wide"]);
  });

  it("handles negative cells and generation wrap without losing candidates", () => {
    const items = [
      { id: "negative", bounds: bounds(-65, -31, -65, -31) },
      { id: "boundary", bounds: bounds(-32, 0, -32, 0) },
    ];
    const index = new StaticGridIndex(items, 32, (item) => item.bounds);
    const internals = index as unknown as { generation: number };
    internals.generation = 0xffff_ffff;

    expect(index.querySegment(-96, -96, 1e-12, 1e-12).map((item) => item.id)).toEqual([
      "negative",
      "boundary",
    ]);
    expect(index.queryPoint(-32, -32).map((item) => item.id)).toEqual([
      "negative",
      "boundary",
    ]);
  });
});

function bounds(minimumX: number, maximumX: number, minimumZ: number, maximumZ: number): StaticGridBounds {
  return { minimumX, maximumX, minimumZ, maximumZ };
}
