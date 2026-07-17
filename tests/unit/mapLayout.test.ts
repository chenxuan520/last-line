import { describe, expect, it } from "vitest";
import {
  BUILDING_ROOF_CAP_HEIGHT,
  createMapLayout,
  getRampHeight,
  getTerrainHeight,
  MAP_POINTS,
} from "../../src/config/map";

const LOOT_POINTS_PER_POI = 18;

describe("map layouts", () => {
  it("caches deterministic serializable layouts", () => {
    const first = createMapLayout(2026);
    const second = createMapLayout(2026);
    const serialized = JSON.stringify(first);

    expect(second).toBe(first);
    expect(second).toEqual(first);
    expect(JSON.parse(serialized)).toEqual(first);
    expect(first.seed).toBe(2026);
  });

  it("bounds the layout cache across match restarts", () => {
    const first = createMapLayout(0xabc0_0000);
    for (let offset = 1; offset <= 8; offset += 1) {
      createMapLayout(0xabc0_0000 + offset);
    }
    const recreated = createMapLayout(0xabc0_0000);

    expect(recreated).not.toBe(first);
    expect(recreated).toEqual(first);
  });

  it("varies hills, building positions, and loot positions across seeds", () => {
    const first = createMapLayout(7);
    const second = createMapLayout(8);

    expect(second.terrainHills).not.toEqual(first.terrainHills);
    expect(second.obstacles.map((obstacle) => obstacle.center)).not.toEqual(
      first.obstacles.map((obstacle) => obstacle.center),
    );
    expect(second.lootSpawnPoints).not.toEqual(first.lootSpawnPoints);
  });

  it("keeps seeded buildings on non-overlapping POI grids with safe dimensions", () => {
    const layout = createMapLayout(0xffff_ffff);

    for (const [index, obstacle] of layout.obstacles.entries()) {
      expect(obstacle.width).toBeGreaterThanOrEqual(18);
      expect(obstacle.width).toBeLessThanOrEqual(32);
      expect(obstacle.depth).toBeGreaterThanOrEqual(16);
      expect(obstacle.depth).toBeLessThanOrEqual(32);
      expect(obstacle.height).toBeGreaterThanOrEqual(3.2);
      expect(obstacle.height).toBeLessThanOrEqual(4);

      for (const other of layout.obstacles.slice(index + 1)) {
        const overlapsX = Math.abs(obstacle.center.x - other.center.x) < (obstacle.width + other.width) / 2;
        const overlapsZ = Math.abs(obstacle.center.z - other.center.z) < (obstacle.depth + other.depth) / 2;
        expect(overlapsX && overlapsZ).toBe(false);
      }
    }
  });

  it("creates one matching ramp per building and uses layout terrain heights", () => {
    const layout = createMapLayout(314_159);

    expect(layout.roofRamps).toHaveLength(layout.obstacles.length);
    layout.roofRamps.forEach((ramp, index) => {
      const obstacle = layout.obstacles[index];
      if (!obstacle) throw new Error("ramp building missing");
      expect(ramp.id).toBe(`ramp-${obstacle.id}`);
      expect(ramp.centerX).toBe(obstacle.center.x);
      expect(ramp.topY).toBeCloseTo(obstacle.center.y + obstacle.height / 2 + BUILDING_ROOF_CAP_HEIGHT);
      expect(getRampHeight(ramp, ramp.centerX, (ramp.startZ + ramp.endZ) / 2)).toBeCloseTo(
        (ramp.bottomY + ramp.topY) / 2,
      );
    });

    const hill = layout.terrainHills[0];
    if (!hill) throw new Error("terrain hill missing");
    expect(getTerrainHeight(hill.x, hill.z, layout)).toBe(getTerrainHeight(hill.x, hill.z, layout.seed));
  });

  it("creates 18 clear, standable loot points per fixed POI", () => {
    const layout = createMapLayout(86_753_009);

    expect(layout.lootSpawnPoints).toHaveLength(MAP_POINTS.length * LOOT_POINTS_PER_POI);
    MAP_POINTS.forEach((poi, poiIndex) => {
      const points = layout.lootSpawnPoints.slice(
        poiIndex * LOOT_POINTS_PER_POI,
        (poiIndex + 1) * LOOT_POINTS_PER_POI,
      );
      expect(points).toHaveLength(LOOT_POINTS_PER_POI);
      for (const point of points) {
        expect(Math.hypot(point.x - poi.position.x, point.z - poi.position.z)).toBeLessThan(100);
        expect(point.y).toBeCloseTo(getTerrainHeight(point.x, point.z, layout) + 0.45, 3);
        for (const obstacle of layout.obstacles) {
          const clearX = Math.abs(point.x - obstacle.center.x) > obstacle.width / 2 + 0.5;
          const clearZ = Math.abs(point.z - obstacle.center.z) > obstacle.depth / 2 + 0.5;
          expect(clearX || clearZ).toBe(true);
        }
        for (const ramp of layout.roofRamps) {
          const clearX = Math.abs(point.x - ramp.centerX) > ramp.width / 2 + 0.5;
          const clearZ =
            point.z < Math.min(ramp.startZ, ramp.endZ) - 0.5 ||
            point.z > Math.max(ramp.startZ, ramp.endZ) + 0.5;
          expect(clearX || clearZ).toBe(true);
        }
      }
    });
  });

  it("keeps seeded ramps clear of neighboring buildings", () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const layout = createMapLayout(seed);
      for (const ramp of layout.roofRamps) {
        for (const obstacle of layout.obstacles) {
          if (ramp.id === `ramp-${obstacle.id}`) continue;
          const overlapsX = Math.abs(ramp.centerX - obstacle.center.x) < ramp.width / 2 + obstacle.width / 2;
          const rampMinimumZ = Math.min(ramp.startZ, ramp.endZ);
          const rampMaximumZ = Math.max(ramp.startZ, ramp.endZ);
          const overlapsZ =
            rampMaximumZ > obstacle.center.z - obstacle.depth / 2 &&
            rampMinimumZ < obstacle.center.z + obstacle.depth / 2;
          expect(overlapsX && overlapsZ).toBe(false);
        }
      }
    }
  });
});
