import { describe, expect, it } from "vitest";
import { GridNavigator } from "../../src/ai/navigation/GridNavigator";
import {
  BUILDING_ROOF_CAP_HEIGHT,
  createMapLayout,
  getBuildingRoofNavigationPoint,
  getTerrainHeight,
  isBuildingRoofNavigationPoint,
  type MapLayout,
} from "../../src/config/map";

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

  it("continues from every internal ramp midpoint toward ground and roof", () => {
    const layout = createMapLayout(0);
    const building = layout.obstacles.find((candidate) => candidate.storyCount === 3);
    const ramps = layout.roofRamps.filter((candidate) => candidate.obstacleId === building?.id);
    if (!building || ramps.length !== 3) throw new Error("three-story ramp fixtures missing");
    const groundRamp = ramps.find((ramp) => ramp.fromLevel === 0);
    if (!groundRamp) throw new Error("ground ramp missing");
    const ground = { x: groundRamp.centerX, y: groundRamp.bottomY + 1.76, z: groundRamp.startZ };
    const roof = {
      x: building.center.x,
      y: building.baseY + building.storyHeight * building.storyCount + BUILDING_ROOF_CAP_HEIGHT + 1.76,
      z: building.center.z,
    };
    const navigator = new GridNavigator(layout);

    for (const ramp of ramps) {
      const start = {
        x: ramp.centerX,
        y: (ramp.bottomY + ramp.topY) / 2 + 1.76,
        z: (ramp.startZ + ramp.endZ) / 2,
      };
      expect(navigator.findPath(start, ground), `${ramp.id}:ground`).not.toHaveLength(0);
      expect(navigator.findPath(start, roof), `${ramp.id}:roof`).not.toHaveLength(0);
    }
  });

  it("redirects polygon roof targets that lack clearance from a slanted edge", () => {
    const layout = createMapLayout(0);
    const building = layout.obstacles.find((candidate) => candidate.id === "building-0-0");
    if (!building || building.footprint === "rectangle") {
      throw new Error("polygon roof navigation fixture missing");
    }
    let unsafeTarget: { x: number; y: number; z: number } | null = null;
    for (let progress = 0.5; progress <= 1; progress += 0.01) {
      const x = building.center.x + (building.width / 2 - 0.05) * progress;
      const z = building.center.z + (building.depth / 2 - 0.05) * progress;
      if (
        isBuildingRoofNavigationPoint(layout, building, x, z, 0) &&
        !isBuildingRoofNavigationPoint(layout, building, x, z)
      ) {
        unsafeTarget = {
          x,
          y: building.baseY + building.storyHeight * building.storyCount + BUILDING_ROOF_CAP_HEIGHT + 1.76,
          z,
        };
      }
    }
    if (!unsafeTarget) throw new Error("unsafe polygon roof target missing");
    const safeStart = getBuildingRoofNavigationPoint(layout, building);
    if (!safeStart) throw new Error("safe polygon roof point missing");

    expect(isBuildingRoofNavigationPoint(layout, building, unsafeTarget.x, unsafeTarget.z)).toBe(false);
    const path = new GridNavigator(layout).findPath(safeStart, unsafeTarget);
    const redirectedTarget = path.at(-1);
    if (!redirectedTarget) throw new Error("redirected polygon roof path missing");
    expect(redirectedTarget).not.toEqual(unsafeTarget);
    expect(isBuildingRoofNavigationPoint(
      layout,
      building,
      redirectedTarget.x,
      redirectedTarget.z,
    )).toBe(true);
  });

  it("generates clear navigation points for polygon roofs across every map", () => {
    for (const mapId of ["island", "town", "mixed"] as const) {
      for (const seed of [0, 7, 42]) {
        const layout = createMapLayout(mapId, seed);
        const polygonBuildings = layout.obstacles.filter((building) =>
          building.footprint !== undefined && building.footprint !== "rectangle"
        );
        expect(polygonBuildings.length, `${mapId}:${seed}:fixtures`).toBeGreaterThan(0);
        for (const building of polygonBuildings) {
          const point = getBuildingRoofNavigationPoint(layout, building);
          expect(point, `${mapId}:${seed}:${building.id}:point`).not.toBeNull();
          if (!point) continue;
          expect(
            isBuildingRoofNavigationPoint(layout, building, point.x, point.z),
            `${mapId}:${seed}:${building.id}:clearance`,
          ).toBe(true);
        }
      }
    }
  }, 30_000);
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
