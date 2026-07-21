import { describe, expect, it } from "vitest";
import { GridNavigator } from "../../src/ai/navigation/GridNavigator";
import { BUILDING_ROOF_CAP_HEIGHT, createMapLayout, getTerrainHeight, type MapLayout } from "../../src/config/map";

describe("GridNavigator spatial index", () => {
  it("keeps deterministic ground paths identical to the complete blocker scan", () => {
    for (const seed of [0, 42]) {
      const layout = createMapLayout(seed);
      const indexed = new GridNavigator(layout);
      const complete = completeScanNavigator(layout);
      for (let index = 0; index < 30; index += 1) {
        const startPoint = layout.lootSpawnPoints[(index * 17) % layout.lootSpawnPoints.length];
        const targetPoint = layout.lootSpawnPoints[(index * 47 + 83) % layout.lootSpawnPoints.length];
        if (!startPoint || !targetPoint) throw new Error("navigation corpus point missing");
        const start = {
          x: startPoint.x,
          y: getTerrainHeight(startPoint.x, startPoint.z, layout) + 1.76,
          z: startPoint.z,
        };
        const target = {
          x: targetPoint.x,
          y: getTerrainHeight(targetPoint.x, targetPoint.z, layout) + 1.76,
          z: targetPoint.z,
        };
        expect(indexed.findPath(start, target), `${seed}:${index}`).toEqual(complete.findPath(start, target));
      }
    }
  }, 30_000);

  it("keeps multistory ramp paths identical to the complete blocker scan", () => {
    const layout = createMapLayout(0);
    const building = layout.obstacles.find((candidate) => candidate.storyCount === 3);
    const ramp = layout.roofRamps.find((candidate) =>
      candidate.obstacleId === building?.id && candidate.fromLevel === 0
    );
    if (!building || !ramp) throw new Error("three-story navigation fixture missing");
    const ground = {
      x: ramp.centerX,
      y: getTerrainHeight(ramp.centerX, ramp.startZ, layout) + 1.76,
      z: ramp.startZ,
    };
    const roof = {
      x: building.center.x,
      y: building.baseY + building.storyHeight * building.storyCount + BUILDING_ROOF_CAP_HEIGHT + 1.76,
      z: building.center.z,
    };
    const indexed = new GridNavigator(layout);
    const complete = completeScanNavigator(layout);

    expect(indexed.findPath(ground, roof)).toEqual(complete.findPath(ground, roof));
    expect(indexed.findPath(roof, ground)).toEqual(complete.findPath(roof, ground));
  });
});

function completeScanNavigator(layout: MapLayout): GridNavigator {
  return new GridNavigator(
    layout,
    layout.roofRamps,
    [...layout.wallSegments, ...layout.rockObstacles, ...layout.coverObstacles],
    0.4,
    false,
  );
}
