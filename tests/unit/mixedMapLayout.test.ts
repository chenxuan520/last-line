import { describe, expect, it } from "vitest";
import { GridNavigator } from "../../src/ai/navigation/GridNavigator";
import {
  BUILDING_ROOF_CAP_HEIGHT,
  createMapLayout,
  getTerrainHeight,
  HOSPITAL_WALL_COLOR,
  MIXED_NATURAL_OBSTACLE_MAX_TERRAIN_DELTA,
  TOTAL_LOOT_POINTS,
} from "../../src/config/map";
import {
  createMixedMapBlueprint,
  createMixedRegionSpecs,
  FIXED_MIXED_REGION_NAMES,
  MIXED_REGION_COUNT,
  mixedFootprintClearsRoads,
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
    for (const seed of [0, 1, 2, 3, 11, 16, 38, 42, 2026]) {
      const blueprint = createMixedMapBlueprint(seed);
      const layout = createMapLayout("mixed", seed);

      expect(layout.lootSpawnPoints).toHaveLength(TOTAL_LOOT_POINTS);
      expect(layout.lootZoneCounts).toHaveLength(16);
      expect(layout.lootZoneCounts.reduce((total, count) => total + count, 0)).toBe(240);
      for (const region of blueprint.regions) {
        const buildings = layout.obstacles.filter((obstacle) =>
          pointInMixedRegion(region, obstacle.center.x, obstacle.center.z)
        );
        const trees = layout.treeTrunks.filter((tree) =>
          pointInMixedRegion(region, tree.center.x, tree.center.z)
        );
        const rocks = layout.rockObstacles.filter((rock) =>
          pointInMixedRegion(region, rock.center.x, rock.center.z)
        );
        const hay = layout.coverObstacles.filter((cover) =>
          cover.kind === "hay" && pointInMixedRegion(region, cover.center.x, cover.center.z)
        );

        expect(buildings).toHaveLength(region.kind === "town" ? 36 : region.kind === "rural" ? 9 : 2);
        if (region.kind === "town") {
          const coverage = buildings.reduce(
            (total, building) => total + building.width * building.depth,
            0,
          ) / (region.width * region.depth);
          expect(coverage).toBeGreaterThanOrEqual(0.38);
          expect(coverage).toBeLessThanOrEqual(0.41);
        }
        expect(trees).toHaveLength(region.kind === "forest" ? 150 : region.kind === "rural" ? 36 : 12);
        expect(rocks).toHaveLength(region.kind === "forest" ? 24 : region.kind === "rural" ? 10 : 4);
        if (region.kind === "rural") expect(hay).toHaveLength(30);
        if (region.kind === "forest") {
          const regionHills = blueprint.terrainHills.filter((hill) => hill.regionId === region.id);
          expect(regionHills).toHaveLength(3);
          expect(Math.max(...regionHills.map((hill) => hill.height))).toBeGreaterThanOrEqual(34);
          expect(trees.every((tree) => getTerrainHeight(tree.center.x, tree.center.z, layout) >= 3)).toBe(true);
          expect(rocks.every((rock) => getTerrainHeight(rock.center.x, rock.center.z, layout) >= 3)).toBe(true);
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
          const hospitalPair = index === layout.hospital.bandageLootIndex &&
            otherIndex === layout.hospital.medkitLootIndex;
          expect(Math.hypot(point.x - other.x, point.z - other.z))
            .toBeGreaterThanOrEqual(hospitalPair ? 7.9 : 11.9);
        }
      }
    }
  }, 30_000);

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
});

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
