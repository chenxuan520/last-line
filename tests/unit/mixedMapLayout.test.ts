import { describe, expect, it } from "vitest";
import { GridNavigator } from "../../src/ai/navigation/GridNavigator";
import {
  AMMUNITION_DEPOT_LOOT_POINTS_PER_LEVEL,
  BUILDING_ROOF_CAP_HEIGHT,
  createMapLayout,
  GLOBAL_LOOT_POINTS,
  getTerrainHeight,
  HOSPITAL_WALL_COLOR,
  MAP_HALF_SIZE,
  MIXED_NATURAL_OBSTACLE_MAX_TERRAIN_DELTA,
  PRE_GRENADE_LOOT_POINTS,
} from "../../src/config/map";
import {
  createMixedMapBlueprint,
  createMixedRegionSpecs,
  FIXED_MIXED_REGION_NAMES,
  MIXED_REGION_COUNT,
  MIXED_TOWN_MINIMUM_OWNED_COVERAGE,
  mixedRegionBuildingCoverage,
  mixedFootprintClearsRoads,
  pointOwnedByMixedRegion,
  pointInMixedRegion,
} from "../../src/config/mixedMap";
import { createActorState, type MatchState } from "../../src/game/state/types";
import { SimulationCombatWorld } from "../../src/game/systems/SimulationCombatWorld";
import { getSupportHeight } from "../../src/game/systems/MovementSystem";

describe("mixed map layout", () => {
  it("creates six deterministic named regions with all fixed kinds", () => {
    const first = createMixedMapBlueprint(42);
    const second = createMixedMapBlueprint(42);

    expect(second).toEqual(first);
    expect(first.regions).toHaveLength(MIXED_REGION_COUNT);
    expect(first.mapPoints.map((point) => point.name)).toEqual(first.regions.map((region) => region.name));
    expect(new Set(first.regions.map((region) => region.name)).size).toBe(MIXED_REGION_COUNT);
    expect(first.regions.filter((region) => region.fixed)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: FIXED_MIXED_REGION_NAMES.town, kind: "town" }),
      expect.objectContaining({ name: FIXED_MIXED_REGION_NAMES.rural, kind: "rural" }),
      expect.objectContaining({ name: FIXED_MIXED_REGION_NAMES.forest, kind: "forest" }),
    ]));
  });

  it("places enlarged regions in a compact seeded irregular cluster", () => {
    const seedZero = createMixedRegionSpecs(0);
    const seedOne = createMixedRegionSpecs(1);

    expect(createMixedRegionSpecs(0)).toEqual(seedZero);
    expect(seedOne.map(({ centerX, centerZ }) => [centerX, centerZ]))
      .not.toEqual(seedZero.map(({ centerX, centerZ }) => [centerX, centerZ]));

    for (const seed of [0, 1, 11, 16, 38, 42, 2026, 4820, 0xffff_ffff]) {
      const regions = createMixedRegionSpecs(seed);
      const uniqueX = new Set(regions.map((region) => region.centerX));
      const uniqueZ = new Set(regions.map((region) => region.centerZ));
      const xCoordinates = regions.map((region) => region.centerX);
      const zCoordinates = regions.map((region) => region.centerZ);

      expect(uniqueX.size, `${seed}:unique-x`).toBeGreaterThanOrEqual(5);
      expect(uniqueZ.size, `${seed}:unique-z`).toBeGreaterThanOrEqual(5);
      const xSpan = Math.max(...xCoordinates) - Math.min(...xCoordinates);
      const zSpan = Math.max(...zCoordinates) - Math.min(...zCoordinates);
      expect(xSpan, `${seed}:x-span`).toBeLessThanOrEqual(1_400);
      expect(zSpan, `${seed}:z-span`).toBeLessThanOrEqual(1_400);
      expect(xSpan * zSpan, `${seed}:bounding-area`).toBeLessThanOrEqual(1_450_000);

      for (const region of regions) {
        expect(region.width * region.depth, `${seed}:${region.id}:area`)
          .toBeGreaterThan(640 * 880);
        expect(Math.max(region.width, region.depth) / Math.min(region.width, region.depth), `${seed}:${region.id}:aspect`)
          .toBeLessThanOrEqual(1.1);
        expect(Math.abs(region.centerX) + region.width / 2, `${seed}:${region.id}:map-x`)
          .toBeLessThanOrEqual(MAP_HALF_SIZE - 20);
        expect(Math.abs(region.centerZ) + region.depth / 2, `${seed}:${region.id}:map-z`)
          .toBeLessThanOrEqual(MAP_HALF_SIZE - 20);
        const otherRegions = regions.filter((candidate) => candidate.id !== region.id);
        const nearestCenter = Math.min(...otherRegions.map((candidate) =>
          Math.hypot(candidate.centerX - region.centerX, candidate.centerZ - region.centerZ)
        ));
        const nearestEdge = Math.min(...otherRegions.map((candidate) =>
          regionFootprintGap(region, candidate)
        ));
        expect(nearestCenter, `${seed}:${region.id}:center-spacing`).toBeGreaterThanOrEqual(620);
        expect(nearestCenter, `${seed}:${region.id}:nearest-center`).toBeLessThanOrEqual(820);
        expect(nearestEdge, `${seed}:${region.id}:nearest-edge`).toBeLessThanOrEqual(70);
      }
    }
  });

  it("connects random region edges with a short non-grid backbone", () => {
    for (const seed of [0, 1, 11, 16, 38, 42, 2026, 12894, 0xffff_ffff]) {
      const blueprint = createMixedMapBlueprint(seed);
      const localRoadCount = blueprint.regions.reduce(
        (total, region) => total + (region.kind === "town" ? 4 : region.kind === "rural" ? 1 : 0),
        0,
      );
      expect(blueprint.roadSegments).toHaveLength(MIXED_REGION_COUNT - 1 + localRoadCount);

      const connectors = blueprint.roadSegments.slice(0, MIXED_REGION_COUNT - 1);
      const lengths = connectors.map(([startX, startZ, endX, endZ]) => {
        expect(blueprint.regions.some((region) =>
          pointInMixedRegion(region, startX, startZ)
        ), `${seed}:start:${startX}:${startZ}`).toBe(true);
        expect(blueprint.regions.some((region) =>
          pointInMixedRegion(region, endX, endZ)
        ), `${seed}:end:${endX}:${endZ}`).toBe(true);
        return Math.hypot(endX - startX, endZ - startZ);
      });

      expect(connectors.some(([startX, startZ, endX, endZ]) =>
        Math.abs(endX - startX) > 20 && Math.abs(endZ - startZ) > 20
      ), `${seed}:diagonal`).toBe(true);
      for (let leftIndex = 0; leftIndex < connectors.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < connectors.length; rightIndex += 1) {
          expect(
            segmentsCross(connectors[leftIndex] as readonly [number, number, number, number],
              connectors[rightIndex] as readonly [number, number, number, number]),
            `${seed}:connector-cross:${leftIndex}:${rightIndex}`,
          ).toBe(false);
        }
      }
      expect(Math.max(...lengths), `${seed}:longest`).toBeLessThanOrEqual(820);
      expect(lengths.reduce((total, length) => total + length, 0), `${seed}:total`)
        .toBeLessThanOrEqual(3_900);
    }
  });

  it("varies the three random region kinds and names across seeds", () => {
    const signatures = new Set<string>();

    for (let seed = 0; seed < 100_000 && signatures.size < 27; seed += 1) {
      const randomRegions = createMixedRegionSpecs(seed).filter((region) => !region.fixed);
      expect(randomRegions).toHaveLength(3);
      signatures.add(randomRegions.map((region) => region.kind).join("|"));
    }

    expect(signatures).toEqual(new Set(
      (["town", "rural", "forest"] as const).flatMap((first) =>
        (["town", "rural", "forest"] as const).flatMap((second) =>
          (["town", "rural", "forest"] as const).map((third) => `${first}|${second}|${third}`)
        )
      ),
    ));
    expect(createMixedRegionSpecs(11).filter((region) => !region.fixed).map((region) => region.kind))
      .toEqual(["rural", "rural", "rural"]);
    expect(createMixedRegionSpecs(16).filter((region) => !region.fixed).map((region) => region.kind))
      .toEqual(["town", "town", "town"]);
    expect(createMixedRegionSpecs(38).filter((region) => !region.fixed).map((region) => region.kind))
      .toEqual(["forest", "forest", "forest"]);
  });

  it("keeps one reachable hospital named 医院 inside the fixed town", () => {
    for (const seed of [0, 1, 42, 2026, 0xffff_ffff]) {
      const blueprint = createMixedMapBlueprint(seed);
      const layout = createMapLayout("mixed", seed);
      const fixedTown = blueprint.regions.find((region) => region.name === FIXED_MIXED_REGION_NAMES.town);
      const hospital = layout.obstacles.find((building) => building.id === layout.hospital.buildingId);
      if (!fixedTown || !hospital) throw new Error(`hospital fixture missing for seed ${seed}`);

      expect(layout.mapPoints).toHaveLength(MIXED_REGION_COUNT);
      expect(layout.hospital.name).toBe("医院");
      expect(hospital.color).toBe(HOSPITAL_WALL_COLOR);
      expect(Math.abs(hospital.center.x - fixedTown.centerX)).toBeLessThan(fixedTown.width / 2);
      expect(Math.abs(hospital.center.z - fixedTown.centerZ)).toBeLessThan(fixedTown.depth / 2);
      expect(layout.obstacles.filter((building) => building.color === HOSPITAL_WALL_COLOR)).toHaveLength(1);
      const bandage = layout.lootSpawnPoints[layout.hospital.bandageLootIndex];
      const medkit = layout.lootSpawnPoints[layout.hospital.medkitLootIndex];
      if (!bandage || !medkit) throw new Error(`hospital medicine missing for seed ${seed}`);
      const door = layout.wallOpenings.find((opening) =>
        opening.obstacleId === hospital.id && opening.storyIndex === 0 && opening.kind === "door"
      );
      if (!door) throw new Error(`hospital door missing for seed ${seed}`);
      const outside = {
        x: door.center.x,
        y: getTerrainHeight(door.center.x, door.center.z - 2, layout) + 1.76,
        z: door.center.z - 2,
      };
      const navigator = new GridNavigator(layout);
      expect(navigator.findPath(outside, bandage), `${seed}:bandage`).not.toHaveLength(0);
      expect(navigator.findPath(outside, medkit), `${seed}:medkit`).not.toHaveLength(0);
    }
  });

  it("keeps each region structurally distinct and all authoritative footprints clear", () => {
    for (const seed of [0, 1, 2, 3, 11, 16, 38, 42, 256, 423, 2026]) {
      const blueprint = createMixedMapBlueprint(seed);
      const layout = createMapLayout("mixed", seed);

      expect(layout.lootSpawnPoints).toHaveLength(
        GLOBAL_LOOT_POINTS +
        layout.ammunitionDepot.levels.length * AMMUNITION_DEPOT_LOOT_POINTS_PER_LEVEL +
        10,
      );
      expect(layout.grenadeLootStartIndex).toBe(
        PRE_GRENADE_LOOT_POINTS +
        layout.ammunitionDepot.levels.length * AMMUNITION_DEPOT_LOOT_POINTS_PER_LEVEL,
      );
      expect(layout.lootSpawnPoints.slice(layout.grenadeLootStartIndex)).toHaveLength(10);
      expect(layout.lootZoneCounts).toHaveLength(16);
      expect(layout.lootZoneCounts.reduce((total, count) => total + count, 0)).toBe(240);
      expect(blueprint.landingZones).toHaveLength(16);
      for (const point of blueprint.landingZones) {
        const region = blueprint.regions.find((candidate) => candidate.id === point.regionId);
        if (!region) throw new Error(`landing region missing: ${seed}:${point.name}`);
        expect(pointOwnedByMixedRegion(
          blueprint.regions,
          region,
          point.x,
          point.z,
        ), `${seed}:${point.name}:ownership`).toBe(true);
      }
      for (const region of blueprint.regions) {
        const buildings = layout.obstacles.filter((obstacle) => obstacle.regionId === region.id);
        const trees = layout.treeTrunks.filter((tree) => tree.regionId === region.id);
        const rocks = layout.rockObstacles.filter((rock) => rock.regionId === region.id);
        const hay = layout.coverObstacles.filter((cover) =>
          cover.kind === "hay" && cover.regionId === region.id
        );

        expect(buildings).toHaveLength(region.kind === "town" ? 36 : region.kind === "rural" ? 9 : 2);
        if (region.kind === "town") {
          const coverage = mixedRegionBuildingCoverage(
            blueprint.regions,
            region,
            blueprint.buildings.filter((building) => building.regionId === region.id),
          );
          expect(coverage).toBeGreaterThanOrEqual(MIXED_TOWN_MINIMUM_OWNED_COVERAGE);
          expect(coverage).toBeLessThanOrEqual(0.55);
        }
        expect(trees).toHaveLength(region.kind === "forest" ? 180 : region.kind === "rural" ? 36 : 12);
        expect(rocks).toHaveLength(region.kind === "forest" ? 24 : region.kind === "rural" ? 10 : 4);
        if (region.kind === "rural") expect(hay).toHaveLength(30);
        if (region.kind === "forest") {
          const regionHills = blueprint.terrainHills.filter((hill) => hill.regionId === region.id);
          expect(regionHills).toHaveLength(3);
          expect(Math.max(...regionHills.map((hill) => hill.height))).toBeGreaterThanOrEqual(34);
          expect(trees.every((tree) => getTerrainHeight(tree.center.x, tree.center.z, layout) >= 3)).toBe(true);
          expect(rocks.every((rock) => getTerrainHeight(rock.center.x, rock.center.z, layout) >= 3)).toBe(true);
        }
        for (const hill of blueprint.terrainHills.filter((candidate) => candidate.regionId === region.id)) {
          expect(Math.abs(hill.x) + hill.radius, `${seed}:${region.id}:hill-x`)
            .toBeLessThanOrEqual(MAP_HALF_SIZE);
          expect(Math.abs(hill.z) + hill.radius, `${seed}:${region.id}:hill-z`)
            .toBeLessThanOrEqual(MAP_HALF_SIZE);
        }
        for (const obstacle of [...buildings, ...trees, ...rocks, ...hay]) {
          expect(pointOwnedByMixedRegion(
            blueprint.regions,
            region,
            obstacle.center.x,
            obstacle.center.z,
          ), `${seed}:${obstacle.id}:ownership`).toBe(true);
        }
        for (const obstacle of [...trees, ...rocks]) {
          const terrainRange = footprintTerrainRange(obstacle, layout);
          const bottomY = obstacle.center.y - obstacle.height / 2;
          expect(terrainRange.maximum - terrainRange.minimum, `${seed}:${obstacle.id}:slope`)
            .toBeLessThanOrEqual(MIXED_NATURAL_OBSTACLE_MAX_TERRAIN_DELTA + 0.001);
          expect(
            Math.abs(bottomY - (terrainRange.minimum + terrainRange.maximum) / 2),
            `${seed}:${obstacle.id}:bottom`,
          ).toBeLessThanOrEqual(0.001);
          expect(terrainRange.maximum - bottomY, `${seed}:${obstacle.id}:embed`)
            .toBeLessThanOrEqual(0.400_001);
          expect(bottomY - terrainRange.minimum, `${seed}:${obstacle.id}:float`)
            .toBeLessThanOrEqual(0.400_001);
        }
        for (const rock of rocks) {
          expect(getSupportHeight(rock.center.x, rock.center.z, Number.POSITIVE_INFINITY, layout))
            .toBeCloseTo(rock.center.y + rock.height / 2, 3);
        }
        for (const tree of trees) {
          expect(getSupportHeight(tree.center.x, tree.center.z, Number.POSITIVE_INFINITY, layout))
            .toBeCloseTo(getTerrainHeight(tree.center.x, tree.center.z, layout), 3);
        }
        for (const building of buildings) {
          const roofY = building.baseY +
            building.storyHeight * building.storyCount +
            BUILDING_ROOF_CAP_HEIGHT;
          for (let xStep = 0; xStep <= 4; xStep += 1) {
            for (let zStep = 0; zStep <= 4; zStep += 1) {
              const x = building.center.x - building.width / 2 + building.width * xStep / 4;
              const z = building.center.z - building.depth / 2 + building.depth * zStep / 4;
              expect(getTerrainHeight(x, z, layout), `${seed}:${building.id}:${xStep}:${zStep}`)
                .toBeLessThanOrEqual(roofY - 3.4);
            }
          }
        }
      }
      for (const obstacle of [
        ...layout.obstacles,
        ...layout.treeTrunks,
        ...layout.rockObstacles,
        ...layout.coverObstacles,
      ]) {
        expect(mixedFootprintClearsRoads(
          layout.roadSegments,
          obstacle.center.x,
          obstacle.center.z,
          obstacle.width,
          obstacle.depth,
        ), `${seed}:${obstacle.id}`).toBe(true);
      }
      for (let index = 0; index < layout.lootSpawnPoints.length; index += 1) {
        for (let otherIndex = index + 1; otherIndex < layout.lootSpawnPoints.length; otherIndex += 1) {
          const point = layout.lootSpawnPoints[index];
          const other = layout.lootSpawnPoints[otherIndex];
          if (!point || !other) throw new Error(`loot point missing: ${seed}:${index}:${otherIndex}`);
          if (Math.abs(point.y - other.y) > 2) continue;
          const hospitalPair = index === layout.hospital.bandageLootIndex &&
            otherIndex === layout.hospital.medkitLootIndex;
          const depotLevel = layout.ammunitionDepot.levels.find((level) => level.lootIndices.includes(index));
          const otherDepotLevel = layout.ammunitionDepot.levels.find((level) =>
            level.lootIndices.includes(otherIndex)
          );
          const depotPair = depotLevel !== undefined && depotLevel === otherDepotLevel;
          expect(Math.hypot(point.x - other.x, point.z - other.z))
            .toBeGreaterThanOrEqual(depotPair ? 3.9 : hospitalPair ? 7.9 : 11.9);
        }
      }
    }
  }, 30_000);

  it.each([0, 1, 42, 2026])(
    "keeps supplemental mixed medical loot owned, clear, and corridor-reachable for seed %i",
    (seed) => {
      const blueprint = createMixedMapBlueprint(seed);
      const layout = createMapLayout("mixed", seed);
      const medicalPoints = layout.lootSpawnPoints.slice(240, 248);

      expect(medicalPoints).toHaveLength(8);
      for (const [index, point] of medicalPoints.entries()) {
        const anchor = blueprint.landingZones[index % blueprint.landingZones.length];
        const region = anchor && blueprint.regions.find((candidate) => candidate.id === anchor.regionId);
        if (!anchor || !region) throw new Error(`medical anchor missing: ${seed}:${index}`);
        expect(pointOwnedByMixedRegion(
          blueprint.regions,
          region,
          point.x,
          point.z,
        ), `${seed}:${index}:ownership`).toBe(true);
        expect(layout.obstacles.every((obstacle) =>
          pointClearsObstacle(point, obstacle, 8)
        ), `${seed}:${index}:building-clearance`).toBe(true);
        expect([
          ...layout.rockObstacles,
          ...layout.coverObstacles,
          ...layout.treeTrunks,
        ].every((obstacle) =>
          pointClearsObstacle(point, obstacle, 14)
        ), `${seed}:${index}:natural-clearance`).toBe(true);
        expect(corridorClearsMixedObstacles(
          anchor,
          point,
          [
            ...layout.obstacles,
            ...layout.rockObstacles,
            ...layout.coverObstacles,
            ...layout.treeTrunks,
          ],
          layout.roofRamps,
        ), `${seed}:${index}:corridor`).toBe(true);
      }
    },
    30_000,
  );

  it("navigates from mixed-region streets through internal ramps to town roofs", () => {
    const layout = createMapLayout("mixed", 42);
    const building = layout.obstacles.find((candidate) =>
      candidate.townKind && candidate.storyCount >= 3
    );
    const ramp = layout.roofRamps.find((candidate) =>
      candidate.obstacleId === building?.id && candidate.fromLevel === 0
    );
    if (!building || !ramp) throw new Error("Mixed map multistory fixture missing");
    const ground = {
      x: ramp.centerX,
      y: ramp.bottomY + 1.76,
      z: ramp.startZ,
    };
    const roof = {
      x: building.center.x,
      y: building.baseY + building.storyHeight * building.storyCount + BUILDING_ROOF_CAP_HEIGHT + 1.76,
      z: building.center.z,
    };
    const navigator = new GridNavigator(layout);

    expect(navigator.findPath(ground, roof)).not.toHaveLength(0);
    expect(navigator.findPath(roof, ground)).not.toHaveLength(0);
  });

  it("uses the same forest and rural obstacles for navigation and combat", () => {
    const layout = createMapLayout("mixed", 42);
    const fixtures = [
      layout.treeTrunks[0],
      layout.rockObstacles[0],
      layout.coverObstacles.find((cover) => cover.kind === "hay"),
    ];
    for (const obstacle of fixtures) {
      if (!obstacle) throw new Error("Mixed map environment fixture missing");
      const shooter = createActorState("shooter", "player", {
        x: obstacle.center.x - obstacle.width / 2 - 5,
        y: obstacle.center.y,
        z: obstacle.center.z,
      });
      const target = createActorState("target", "bot", {
        x: obstacle.center.x + obstacle.width / 2 + 5,
        y: obstacle.center.y,
        z: obstacle.center.z,
      });
      shooter.position.y = obstacle.center.y;
      target.position.y = obstacle.center.y;
      const state = createMixedCombatState(layout.seed, shooter, target);
      const world = new SimulationCombatWorld(state, true, layout);
      const direction = {
        x: target.position.x - shooter.position.x,
        y: 0,
        z: target.position.z - shooter.position.z,
      };

      expect(world.traceShotDetailed({
        shooterId: shooter.id,
        origin: shooter.position,
        direction,
        range: 100,
      }), obstacle.id).toMatchObject({ targetId: null, hitType: "environment" });
      expect(world.hasLineOfSight(shooter.id, target.id), obstacle.id).toBe(false);

      const start = {
        x: shooter.position.x,
        y: getTerrainHeight(shooter.position.x, shooter.position.z, layout) + 1.76,
        z: shooter.position.z,
      };
      const end = {
        x: target.position.x,
        y: getTerrainHeight(target.position.x, target.position.z, layout) + 1.76,
        z: target.position.z,
      };
      expect(new GridNavigator(layout).findPath(start, end).length, obstacle.id).toBeGreaterThan(2);
    }
  });

  it("keeps compact positions deterministic across ten thousand seeds", () => {
    const violations: string[] = [];
    for (let seed = 0; seed < 10_000; seed += 1) {
      const regions = createMixedRegionSpecs(seed);
      const xCoordinates = regions.map((region) => region.centerX);
      const zCoordinates = regions.map((region) => region.centerZ);
      const xSpan = Math.max(...xCoordinates) - Math.min(...xCoordinates);
      const zSpan = Math.max(...zCoordinates) - Math.min(...zCoordinates);
      if (xSpan > 1_400 || zSpan > 1_400 || xSpan * zSpan > 1_450_000) {
        violations.push(`${seed}:${xSpan.toFixed(3)}:${zSpan.toFixed(3)}`);
      }
    }
    expect(violations).toEqual([]);
  }, 900_000);
});

function regionFootprintGap(
  left: ReturnType<typeof createMixedRegionSpecs>[number],
  right: ReturnType<typeof createMixedRegionSpecs>[number],
): number {
  const gapX = Math.max(
    0,
    Math.abs(left.centerX - right.centerX) - (left.width + right.width) / 2,
  );
  const gapZ = Math.max(
    0,
    Math.abs(left.centerZ - right.centerZ) - (left.depth + right.depth) / 2,
  );
  return Math.hypot(gapX, gapZ);
}

function pointClearsObstacle(
  point: { x: number; z: number },
  obstacle: { center: { x: number; z: number }; width: number; depth: number },
  clearance: number,
): boolean {
  return Math.abs(point.x - obstacle.center.x) > obstacle.width / 2 + clearance ||
    Math.abs(point.z - obstacle.center.z) > obstacle.depth / 2 + clearance;
}

function corridorClearsMixedObstacles(
  start: { x: number; z: number },
  end: { x: number; z: number },
  obstacles: readonly { center: { x: number; z: number }; width: number; depth: number }[],
  ramps: readonly { centerX: number; startZ: number; endZ: number; width: number }[],
): boolean {
  return obstacles.every((obstacle) =>
    !segmentIntersectsRectangle(
      start.x,
      start.z,
      end.x,
      end.z,
      obstacle.center.x,
      obstacle.center.z,
      obstacle.width + 3,
      obstacle.depth + 3,
    )
  ) && ramps.every((ramp) =>
    !segmentIntersectsRectangle(
      start.x,
      start.z,
      end.x,
      end.z,
      ramp.centerX,
      (ramp.startZ + ramp.endZ) / 2,
      ramp.width + 3,
      Math.abs(ramp.endZ - ramp.startZ) + 3,
    )
  );
}

function segmentIntersectsRectangle(
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
  centerX: number,
  centerZ: number,
  width: number,
  depth: number,
): boolean {
  const minimumX = centerX - width / 2;
  const maximumX = centerX + width / 2;
  const minimumZ = centerZ - depth / 2;
  const maximumZ = centerZ + depth / 2;
  let entry = 0;
  let exit = 1;
  for (const [start, delta, minimum, maximum] of [
    [startX, endX - startX, minimumX, maximumX],
    [startZ, endZ - startZ, minimumZ, maximumZ],
  ] as const) {
    if (Math.abs(delta) < 1e-9) {
      if (start < minimum || start > maximum) return false;
      continue;
    }
    const first = (minimum - start) / delta;
    const second = (maximum - start) / delta;
    entry = Math.max(entry, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
    if (entry > exit) return false;
  }
  return exit >= 0 && entry <= 1;
}

function segmentsCross(
  left: readonly [number, number, number, number],
  right: readonly [number, number, number, number],
): boolean {
  const [leftStartX, leftStartZ, leftEndX, leftEndZ] = left;
  const [rightStartX, rightStartZ, rightEndX, rightEndZ] = right;
  const leftDeltaX = leftEndX - leftStartX;
  const leftDeltaZ = leftEndZ - leftStartZ;
  const rightDeltaX = rightEndX - rightStartX;
  const rightDeltaZ = rightEndZ - rightStartZ;
  const denominator = leftDeltaX * rightDeltaZ - leftDeltaZ * rightDeltaX;
  if (Math.abs(denominator) < 1e-9) return false;
  const offsetX = rightStartX - leftStartX;
  const offsetZ = rightStartZ - leftStartZ;
  const leftProgress = (offsetX * rightDeltaZ - offsetZ * rightDeltaX) / denominator;
  const rightProgress = (offsetX * leftDeltaZ - offsetZ * leftDeltaX) / denominator;
  return (
    leftProgress > 1e-6 &&
    leftProgress < 1 - 1e-6 &&
    rightProgress > 1e-6 &&
    rightProgress < 1 - 1e-6
  );
}

function createMixedCombatState(
  mapSeed: number,
  ...actors: ReturnType<typeof createActorState>[]
): MatchState {
  return {
    mapId: "mixed",
    mapSeed,
    phase: "combat",
    elapsedSeconds: 0,
    actors: Object.fromEntries(actors.map((actor) => [actor.id, actor])),
    groundLoot: {},
    activeGrenades: {},
    nextGrenadeSequence: 1,
    safeZone: {
      center: { x: 0, y: 0, z: 0 },
      radius: 400,
      startCenter: { x: 0, y: 0, z: 0 },
      startRadius: 400,
      targetCenter: { x: 0, y: 0, z: 0 },
      targetRadius: 400,
      stageIndex: 0,
      status: "waiting",
      secondsRemaining: 60,
      damagePerSecond: 0,
    },
    flight: {
      start: { x: -400, y: 180, z: 0 },
      end: { x: 400, y: 180, z: 0 },
      durationSeconds: 20,
      progress: 0,
    },
    result: null,
  };
}

function footprintTerrainRange(
  obstacle: { center: { x: number; z: number }; width: number; depth: number },
  layout: ReturnType<typeof createMapLayout>,
): { minimum: number; maximum: number } {
  const heights: number[] = [];
  for (let xStep = 0; xStep <= 4; xStep += 1) {
    for (let zStep = 0; zStep <= 4; zStep += 1) {
      heights.push(getTerrainHeight(
        obstacle.center.x - obstacle.width / 2 + obstacle.width * xStep / 4,
        obstacle.center.z - obstacle.depth / 2 + obstacle.depth * zStep / 4,
        layout,
      ));
    }
  }
  return { minimum: Math.min(...heights), maximum: Math.max(...heights) };
}
