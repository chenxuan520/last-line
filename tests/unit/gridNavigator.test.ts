import { describe, expect, it } from "vitest";
import { GridNavigator } from "../../src/ai/navigation/GridNavigator";
import { BUILDING_ROOF_CAP_HEIGHT, createMapLayout, getTerrainHeight, type MapLayout } from "../../src/config/map";

describe("GridNavigator spatial index", () => {
  it("routes grounded actors around authoritative tree trunks", () => {
    const layout = createMapLayout(0);
    const tree = layout.treeTrunks[0];
    if (!tree) throw new Error("tree navigation fixture missing");
    const start = {
      x: tree.center.x - tree.width / 2 - 5,
      y: getTerrainHeight(tree.center.x - tree.width / 2 - 5, tree.center.z, layout) + 1.76,
      z: tree.center.z,
    };
    const target = {
      x: tree.center.x + tree.width / 2 + 5,
      y: getTerrainHeight(tree.center.x + tree.width / 2 + 5, tree.center.z, layout) + 1.76,
      z: tree.center.z,
    };

    const path = new GridNavigator(layout).findPath(start, target);

    expect(path[0]).toEqual(start);
    expect(path.at(-1)).toEqual(target);
    expect(path.length).toBeGreaterThan(2);
  });

  it("keeps elevated mountain trees blocking a path that starts far above their base", () => {
    const layout = createMapLayout(0);
    const tree = layout.treeTrunks[0];
    const mountain = tree && layout.terrainHills.find((hill) =>
      hill.height >= 24 && Math.hypot(tree.center.x - hill.x, tree.center.z - hill.z) < hill.radius
    );
    if (!tree || !mountain) throw new Error("mountain tree fixture missing");
    const distance = Math.hypot(mountain.x - tree.center.x, mountain.z - tree.center.z);
    const directionX = (mountain.x - tree.center.x) / distance;
    const directionZ = (mountain.z - tree.center.z) / distance;
    const start = {
      x: tree.center.x + directionX * 30,
      y: getTerrainHeight(tree.center.x + directionX * 30, tree.center.z + directionZ * 30, layout) + 1.76,
      z: tree.center.z + directionZ * 30,
    };
    const target = {
      x: tree.center.x - directionX * 30,
      y: getTerrainHeight(tree.center.x - directionX * 30, tree.center.z - directionZ * 30, layout) + 1.76,
      z: tree.center.z - directionZ * 30,
    };

    const path = new GridNavigator(layout).findPath(start, target);

    expect(path.length).toBeGreaterThan(2);
    expect(path.slice(1, -1).some((point) =>
      Math.hypot(point.x - tree.center.x, point.z - tree.center.z) > Math.max(tree.width, tree.depth)
    )).toBe(true);
  });

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
    [...layout.wallSegments, ...layout.rockObstacles, ...layout.coverObstacles, ...layout.treeTrunks],
    0.4,
    false,
  );
}
