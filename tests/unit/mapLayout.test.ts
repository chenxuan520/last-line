import { describe, expect, it } from "vitest";
import { GridNavigator } from "../../src/ai/navigation/GridNavigator";
import {
  BUILDING_ROOF_CAP_HEIGHT,
  BASE_LOOT_POINTS,
  createMapRoadSegments,
  createMapLayout,
  getRampHeight,
  getTerrainHeight,
  LANDING_ZONE_COUNT,
  MAP_POINT_COUNT,
  MAP_HALF_SIZE,
  TOTAL_LOOT_POINTS,
} from "../../src/config/map";

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
  }, 30_000);

  it.each([832, 859])("generates the former coverage failure seed %i", (seed) => {
    const layout = createMapLayout(seed);
    expect(layout.mapPoints).toHaveLength(MAP_POINT_COUNT);
    expect(layout.landingZones).toHaveLength(LANDING_ZONE_COUNT);
  });

  it("varies hills, building positions, and loot positions across seeds", () => {
    const first = createMapLayout(7);
    const second = createMapLayout(8);

    expect(second.terrainHills).not.toEqual(first.terrainHills);
    expect(second.mapPoints).not.toEqual(first.mapPoints);
    expect(second.obstacles.map((obstacle) => obstacle.center)).not.toEqual(
      first.obstacles.map((obstacle) => obstacle.center),
    );
    expect(second.rockObstacles.map((obstacle) => obstacle.center)).not.toEqual(
      first.rockObstacles.map((obstacle) => obstacle.center),
    );
    expect(second.lootSpawnPoints).not.toEqual(first.lootSpawnPoints);
  });

  it("creates stable full-height rock cover clear of buildings and loot", () => {
    for (const seed of [1, 7, 19, 42, 99]) {
      const layout = createMapLayout(seed);
      expect(layout.rockObstacles).toHaveLength(64);
      expect(new Set(layout.rockObstacles.map((rock) => rock.id)).size).toBe(64);
      for (const [index, rock] of layout.rockObstacles.entries()) {
        expect(rock.id).toBe(`cover-rock-${index}`);
        expect(rock.width).toBeGreaterThanOrEqual(5.5);
        expect(rock.depth).toBeGreaterThanOrEqual(5);
        expect(rock.height).toBeGreaterThanOrEqual(3.4);
        expect(layout.obstacles.every((obstacle) =>
          Math.abs(rock.center.x - obstacle.center.x) >= (rock.width + obstacle.width) / 2 + 8 ||
          Math.abs(rock.center.z - obstacle.center.z) >= (rock.depth + obstacle.depth) / 2 + 8
        )).toBe(true);
        expect(layout.lootSpawnPoints.every((loot) =>
          Math.abs(loot.x - rock.center.x) > rock.width / 2 + 0.5 ||
          Math.abs(loot.z - rock.center.z) > rock.depth / 2 + 0.5
        )).toBe(true);
      }
    }
  });

  it("adds deterministic fence and hay cover around denser settlements", () => {
    for (const seed of [1, 7, 19, 42, 99]) {
      const layout = createMapLayout(seed);
      const fences = layout.coverObstacles.filter((cover) => cover.kind === "fence");
      const hay = layout.coverObstacles.filter((cover) => cover.kind === "hay");
      expect(fences).toHaveLength(96);
      expect(hay).toHaveLength(72);
      expect(new Set(layout.coverObstacles.map((cover) => cover.id)).size).toBe(168);
      for (const cover of layout.coverObstacles) {
        expect(cover.height).toBeGreaterThanOrEqual(1.25);
        expect(layout.obstacles.every((building) =>
          Math.abs(cover.center.x - building.center.x) >= (cover.width + building.width) / 2 + 3 ||
          Math.abs(cover.center.z - building.center.z) >= (cover.depth + building.depth) / 2 + 3
        )).toBe(true);
        expect(layout.lootSpawnPoints.every((loot) =>
          Math.abs(loot.x - cover.center.x) > cover.width / 2 + 0.5 ||
          Math.abs(loot.z - cover.center.z) > cover.depth / 2 + 0.5
        )).toBe(true);
      }
    }
  });

  it("creates prominent mountains while keeping generated settlements in buildable valleys", () => {
    for (const seed of [1, 7, 19, 42, 99]) {
      const layout = createMapLayout(seed);
      const mountains = layout.terrainHills.filter((hill) => hill.height >= 24);
      expect(mountains).toHaveLength(16);
      expect(Math.max(...mountains.map((hill) => hill.height))).toBeGreaterThan(30);
      for (const point of layout.landingZones) {
        expect(getTerrainHeight(point.position.x, point.position.z, layout)).toBeLessThanOrEqual(8);
      }
    }
  });

  it("keeps seeded buildings on non-overlapping POI grids with safe dimensions", () => {
    const layout = createMapLayout(0xffff_ffff);

    for (const [index, obstacle] of layout.obstacles.entries()) {
      expect(obstacle.width).toBeGreaterThanOrEqual(18);
      expect(obstacle.width).toBeLessThanOrEqual(34);
      expect(obstacle.depth).toBeGreaterThanOrEqual(16);
      expect(obstacle.depth).toBeLessThanOrEqual(33);
      expect(obstacle.storyHeight).toBeGreaterThanOrEqual(4.28);
      expect(obstacle.storyHeight).toBeLessThanOrEqual(5.48);
      expect([1, 2, 3]).toContain(obstacle.storyCount);
      expect(obstacle.height).toBeCloseTo(obstacle.storyHeight * obstacle.storyCount, 3);

      for (const other of layout.obstacles.slice(index + 1)) {
        const overlapsX = Math.abs(obstacle.center.x - other.center.x) < (obstacle.width + other.width) / 2;
        const overlapsZ = Math.abs(obstacle.center.z - other.center.z) < (obstacle.depth + other.depth) / 2;
        expect(overlapsX && overlapsZ).toBe(false);
      }
    }
    expect(layout.obstacles.filter((obstacle) => obstacle.storyCount > 1)).toHaveLength(
      Math.round(layout.obstacles.length * 0.2),
    );
  });

  it("randomizes building positions beyond fixed grid slots", () => {
    const layout = createMapLayout(12_345);
    const xs = new Set(layout.obstacles.map((obstacle) => Math.round(obstacle.center.x)));
    const zs = new Set(layout.obstacles.map((obstacle) => Math.round(obstacle.center.z)));

    expect(layout.obstacles.length).toBeGreaterThanOrEqual(188);
    expect(xs.size).toBeGreaterThan(18);
    expect(zs.size).toBeGreaterThan(18);
  });

  it("spreads each POI building set across a broad seeded area", () => {
    for (const seed of [1, 7, 19, 42, 99]) {
      const layout = createMapLayout(seed);
      layout.mapPoints.forEach((poi, poiIndex) => {
        const buildings = layout.obstacles.filter((obstacle) => obstacle.id.startsWith(`building-${poiIndex}-`));
        const distances = buildings.map((obstacle) => Math.hypot(
          obstacle.center.x - poi.position.x,
          obstacle.center.z - poi.position.z,
        ));
        const angles = new Set(buildings.map((obstacle) => Math.floor(
          (Math.atan2(obstacle.center.z - poi.position.z, obstacle.center.x - poi.position.x) + Math.PI) /
          (Math.PI * 2) * 8,
        )));
        expect(Math.min(...distances)).toBeGreaterThan(45);
        expect(Math.max(...distances)).toBeGreaterThan(150);
        expect(angles.size).toBeGreaterThanOrEqual(2);
      });
    }
  });

  it("generates irregular named point layouts instead of a perimeter polygon", () => {
    for (const seed of [1, 7, 19, 42, 99]) {
      const points = createMapLayout(seed).mapPoints;
      const radii = points.map((point) => Math.hypot(point.position.x, point.position.z));
      const angles = points
        .map((point) => Math.atan2(point.position.z, point.position.x))
        .sort((left, right) => left - right);
      const gaps = angles.map((angle, index) => {
        const next = angles[(index + 1) % angles.length] ?? angle;
        return index === angles.length - 1 ? next + Math.PI * 2 - angle : next - angle;
      });

      expect(points).toHaveLength(MAP_POINT_COUNT);
      expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(250);
      expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(0.2);
    }
  });

  it("keeps generated roads connected and avoids kilometer-scale building gaps", () => {
    for (const seed of [0, 33, 237, 358]) {
      const layout = createMapLayout(seed);
      const roads = createMapRoadSegments(layout.landingZones);
      const adjacency = new Map<number, Set<number>>();
      layout.landingZones.forEach((_, index) => adjacency.set(index, new Set()));
      for (const [startX, startZ, endX, endZ] of roads) {
        const start = layout.landingZones.findIndex((point) => point.position.x === startX && point.position.z === startZ);
        const end = layout.landingZones.findIndex((point) => point.position.x === endX && point.position.z === endZ);
        if (start >= 0 && end >= 0) {
          adjacency.get(start)?.add(end);
          adjacency.get(end)?.add(start);
        }
      }
      const visited = new Set<number>([0]);
      const queue = [0];
      while (queue.length > 0) {
        const current = queue.shift();
        if (current === undefined) continue;
        for (const next of adjacency.get(current) ?? []) {
          if (visited.has(next)) continue;
          visited.add(next);
          queue.push(next);
        }
      }
      expect(visited.size, `disconnected roads for seed ${seed}`).toBe(layout.landingZones.length);

      let maximumGap = 0;
      for (let x = -1_100; x <= 1_100; x += 220) {
        for (let z = -1_100; z <= 1_100; z += 220) {
          const nearest = Math.min(...layout.obstacles.map((obstacle) =>
            Math.hypot(x - obstacle.center.x, z - obstacle.center.z)
          ));
          maximumGap = Math.max(maximumGap, nearest);
        }
      }
      expect(maximumGap, `building gap for seed ${seed}`).toBeLessThan(720);
    }
  }, 60_000);

  it("creates connected ramps and opened floor slabs for every building level", () => {
    const layout = createMapLayout(314_159);

    for (const obstacle of layout.obstacles) {
      const ramps = layout.roofRamps.filter((ramp) => ramp.obstacleId === obstacle.id);
      const slabs = layout.floorSlabs.filter((slab) => slab.obstacleId === obstacle.id);
      expect(ramps).toHaveLength(obstacle.storyCount);
      expect(new Set(ramps.map((ramp) => ramp.fromLevel))).toEqual(
        new Set(Array.from({ length: obstacle.storyCount }, (_, level) => level)),
      );
      for (const ramp of ramps) {
        expect(ramp.toLevel).toBe(ramp.fromLevel + 1);
        expect(getRampHeight(ramp, ramp.centerX, (ramp.startZ + ramp.endZ) / 2)).toBeCloseTo(
          (ramp.bottomY + ramp.topY) / 2,
        );
      }
      expect(ramps.at(-1)?.topY).toBeCloseTo(
        obstacle.baseY + obstacle.storyHeight * obstacle.storyCount + BUILDING_ROOF_CAP_HEIGHT,
      );
      expect(layout.wallOpenings.filter((opening) => opening.obstacleId === obstacle.id)).toHaveLength(
        obstacle.storyCount * 4,
      );
      expect(layout.wallOpenings
        .filter((opening) => opening.obstacleId === obstacle.id && opening.kind === "window")
        .every((opening) => opening.height >= 1.8)).toBe(true);
      for (const opening of layout.wallOpenings.filter((entry) =>
        entry.obstacleId === obstacle.id && entry.kind === "window"
      )) {
        const supportY = opening.storyIndex === 0
          ? getTerrainHeight(opening.center.x, opening.center.z, layout)
          : obstacle.baseY + opening.storyIndex * obstacle.storyHeight + BUILDING_ROOF_CAP_HEIGHT;
        expect(Math.abs(opening.center.y - opening.height / 2 - supportY - 1.5)).toBeLessThanOrEqual(0.001);
      }
      if (obstacle.storyCount === 1) {
        expect(ramps[0]?.id).toBe(`ramp-${obstacle.id}`);
        expect(slabs).toHaveLength(1);
      } else {
        expect(obstacle.stairwell).not.toBeNull();
        expect(slabs).toHaveLength(obstacle.storyCount * 4);
        for (const slab of slabs.filter((entry) => entry.kind === "floor")) {
          expect(slab.center.x - slab.width / 2).toBeGreaterThanOrEqual(obstacle.center.x - obstacle.width / 2 + 0.3);
          expect(slab.center.x + slab.width / 2).toBeLessThanOrEqual(obstacle.center.x + obstacle.width / 2 - 0.3);
          expect(slab.center.z - slab.depth / 2).toBeGreaterThanOrEqual(obstacle.center.z - obstacle.depth / 2 + 0.3);
          expect(slab.center.z + slab.depth / 2).toBeLessThanOrEqual(obstacle.center.z + obstacle.depth / 2 - 0.3);
        }
      }
    }

    const hill = layout.terrainHills[0];
    if (!hill) throw new Error("terrain hill missing");
    expect(getTerrainHeight(hill.x, hill.z, layout)).toBe(getTerrainHeight(hill.x, hill.z, layout.seed));
  });

  it("creates varied-density, standable loot across every generated landing zone", () => {
    const layout = createMapLayout(86_753_009);

    expect(layout.lootSpawnPoints).toHaveLength(TOTAL_LOOT_POINTS);
    expect(layout.lootZoneCounts).toHaveLength(LANDING_ZONE_COUNT);
    expect(new Set(layout.lootZoneCounts).size).toBeGreaterThanOrEqual(8);
    expect(Math.min(...layout.lootZoneCounts)).toBe(10);
    expect(Math.max(...layout.lootZoneCounts)).toBe(20);
    let zoneStart = 0;
    layout.landingZones.forEach((poi, poiIndex) => {
      const zoneCount = layout.lootZoneCounts[poiIndex] ?? 0;
      const points = layout.lootSpawnPoints.slice(
        zoneStart,
        zoneStart + zoneCount,
      );
      expect(points).toHaveLength(zoneCount);
      for (const point of points) {
        expect(Math.hypot(point.x - poi.position.x, point.z - poi.position.z)).toBeLessThan(460);
        expect(point.y).toBeCloseTo(getTerrainHeight(point.x, point.z, layout) + 0.45, 3);
        for (const obstacle of layout.wallSegments) {
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
      const indoorCount = points.filter((point) =>
        layout.obstacles.some(
          (obstacle) =>
            obstacle.id.startsWith(`building-${poiIndex}-`) &&
            Math.abs(point.x - obstacle.center.x) < obstacle.width / 2 - 1 &&
            Math.abs(point.z - obstacle.center.z) < obstacle.depth / 2 - 1,
        ),
      ).length;
      const fieldCount = points.filter((point) =>
        Math.hypot(point.x - poi.position.x, point.z - poi.position.z) >= 200
      ).length;
      expect(indoorCount).toBeGreaterThanOrEqual(1);
      expect(fieldCount).toBeGreaterThanOrEqual(6);
      const minimumSpacing = 38 - (zoneCount - 10) * 2;
      for (let index = 0; index < points.length; index += 1) {
        for (const other of points.slice(index + 1)) {
          expect(Math.hypot((points[index]?.x ?? 0) - other.x, (points[index]?.z ?? 0) - other.z))
            .toBeGreaterThanOrEqual(minimumSpacing - 0.1);
        }
      }
      zoneStart += zoneCount;
    });
    for (let index = 0; index < layout.lootSpawnPoints.length; index += 1) {
      for (const other of layout.lootSpawnPoints.slice(index + 1)) {
        expect(Math.hypot(
          (layout.lootSpawnPoints[index]?.x ?? 0) - other.x,
          (layout.lootSpawnPoints[index]?.z ?? 0) - other.z,
        )).toBeGreaterThanOrEqual(11.9);
      }
    }
  }, 30_000);

  it("adds scattered wilderness houses and loot outside named POI clusters", () => {
    const layout = createMapLayout(20_260_718);
    const wildernessBuildings = layout.obstacles.filter((obstacle) => Number(obstacle.id.split("-")[1]) >= MAP_POINT_COUNT);
    const wildernessStart = layout.lootZoneCounts.slice(0, MAP_POINT_COUNT).reduce((total, count) => total + count, 0);
    const wildernessLoot = layout.lootSpawnPoints.slice(wildernessStart, BASE_LOOT_POINTS);

    expect(wildernessBuildings.length).toBeGreaterThanOrEqual(16);
    expect(wildernessLoot).toHaveLength(
      layout.lootZoneCounts.slice(MAP_POINT_COUNT).reduce((total, count) => total + count, 0),
    );
    expect(wildernessLoot.filter((point) =>
      layout.mapPoints.every((poi) => Math.hypot(point.x - poi.position.x, point.z - poi.position.z) > 180),
    ).length).toBeGreaterThanOrEqual(40);
  });

  it("keeps seeded ramps clear of neighboring buildings", () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const layout = createMapLayout(seed);
      for (const ramp of layout.roofRamps) {
        for (const obstacle of layout.obstacles) {
          if (ramp.obstacleId === obstacle.id) continue;
          const overlapsX = Math.abs(ramp.centerX - obstacle.center.x) < ramp.width / 2 + obstacle.width / 2;
          const rampMinimumZ = Math.min(ramp.startZ, ramp.endZ);
          const rampMaximumZ = Math.max(ramp.startZ, ramp.endZ);
          const overlapsZ =
            rampMaximumZ > obstacle.center.z - obstacle.depth / 2 &&
            rampMinimumZ < obstacle.center.z + obstacle.depth / 2;
          expect(overlapsX && overlapsZ, `${seed}:${ramp.id}:${obstacle.id}`).toBe(false);
        }
      }
    }
  }, 120_000);

  it("keeps buildings and ramps inside the map and above terrain across seeds", () => {
    for (let seed = 0; seed <= 400; seed += 1) {
      const layout = createMapLayout(seed);
      let maximumGap = 0;
      let maximumEnvironmentGap = 0;
      for (let x = -1_100; x <= 1_100; x += 220) {
        for (let z = -1_100; z <= 1_100; z += 220) {
          const nearestBuilding = Math.min(...layout.obstacles.map((obstacle) =>
            Math.hypot(x - obstacle.center.x, z - obstacle.center.z)
          ));
          const nearestMountainEdge = Math.min(...layout.terrainHills
            .filter((hill) => hill.height >= 24)
            .map((hill) => Math.max(0, Math.hypot(x - hill.x, z - hill.z) - hill.radius)));
          maximumGap = Math.max(maximumGap, nearestBuilding);
          maximumEnvironmentGap = Math.max(maximumEnvironmentGap, Math.min(nearestBuilding, nearestMountainEdge));
        }
      }
      expect(maximumGap, `building gap for seed ${seed}`).toBeLessThan(1_050);
      expect(maximumEnvironmentGap, `environment gap for seed ${seed}`).toBeLessThan(450);
      for (const obstacle of layout.obstacles) {
        const roofY = obstacle.center.y + obstacle.height / 2 + BUILDING_ROOF_CAP_HEIGHT;
        expect(Math.abs(obstacle.center.x) + obstacle.width / 2).toBeLessThan(MAP_HALF_SIZE);
        expect(Math.abs(obstacle.center.z) + obstacle.depth / 2).toBeLessThan(MAP_HALF_SIZE);
        for (let xStep = 0; xStep <= 4; xStep += 1) {
          for (let zStep = 0; zStep <= 4; zStep += 1) {
            const x = obstacle.center.x - obstacle.width / 2 + obstacle.width * xStep / 4;
            const z = obstacle.center.z - obstacle.depth / 2 + obstacle.depth * zStep / 4;
            expect(getTerrainHeight(x, z, layout)).toBeLessThan(roofY - 1.7);
          }
        }
      }
      for (const ramp of layout.roofRamps) {
        expect(Math.abs(ramp.centerX) + ramp.width / 2).toBeLessThan(MAP_HALF_SIZE);
        expect(Math.abs(ramp.startZ)).toBeLessThan(MAP_HALF_SIZE);
        expect(Math.abs(ramp.endZ)).toBeLessThan(MAP_HALF_SIZE);
        for (let step = 0; step <= 16; step += 1) {
          const progress = step / 16;
          const z = ramp.startZ + (ramp.endZ - ramp.startZ) * progress;
          const rampY = ramp.bottomY + (ramp.topY - ramp.bottomY) * progress;
          expect(getTerrainHeight(ramp.centerX, z, layout)).toBeLessThanOrEqual(rampY + 0.081);
        }
      }
    }
  }, 240_000);

  it("keeps every ramp navigable for the former out-of-bounds regression seed", () => {
    const layout = createMapLayout(331);
    const navigator = new GridNavigator(layout);
    layout.obstacles.forEach((obstacle) => {
      const ramp = layout.roofRamps.find((entry) => entry.obstacleId === obstacle.id && entry.fromLevel === 0);
      if (!ramp) throw new Error("ramp building missing");
      const ground = {
        x: ramp.centerX,
        y: getTerrainHeight(ramp.centerX, ramp.startZ, layout) + 1.76,
        z: ramp.startZ,
      };
      const roof = {
        x: obstacle.center.x,
        y: obstacle.center.y + obstacle.height / 2 + BUILDING_ROOF_CAP_HEIGHT + 1.76,
        z: obstacle.center.z,
      };
      expect(navigator.findPath(ground, roof), ramp.id).not.toHaveLength(0);
      expect(navigator.findPath(roof, ground), ramp.id).not.toHaveLength(0);
    });
  });
});
