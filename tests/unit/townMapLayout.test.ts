import { describe, expect, it } from "vitest";
import { GridNavigator } from "../../src/ai/navigation/GridNavigator";
import {
  ADDITIONAL_GRENADE_LOOT_POINTS,
  AMMUNITION_DEPOT_LOOT_POINTS_PER_LEVEL,
  BUILDING_ROOF_CAP_HEIGHT,
  createMapLayout,
  GLOBAL_LOOT_POINTS,
  getTerrainHeight,
  MAP_HALF_SIZE,
  type MapObstacle,
} from "../../src/config/map";
import {
  createTownMapBlueprint,
  TOWN_POINT_HALF_DEPTH,
  TOWN_POINT_HALF_WIDTH,
  TOWN_POINT_OBSTACLE_CLEARANCE,
  TOWN_ROAD_SHOULDER_HALF_WIDTH,
} from "../../src/config/townMap";
import {
  ACTOR_EYE_HEIGHT,
  MAX_WALKABLE_STEP_HEIGHT,
} from "../../src/game/rules/actorGeometry";
import { createIdleCommand } from "../../src/game/commands/ActorCommand";
import { getSupportHeight, MovementSystem } from "../../src/game/systems/MovementSystem";
import { SimulationCombatWorld } from "../../src/game/systems/SimulationCombatWorld";
import { createActorState, type MatchState } from "../../src/game/state/types";

describe("town map layout", () => {
  it("rebuilds the same seeded town blueprint deterministically without layout caching", () => {
    const first = createTownMapBlueprint(42);
    const second = createTownMapBlueprint(42);

    expect(second).not.toBe(first);
    expect(second).toEqual(first);
  });

  it("creates a deterministic high-density Greyfurnace City", () => {
    const first = createMapLayout("town", 42);
    const second = createMapLayout("town", 42);
    const island = createMapLayout("island", 42);

    expect(second).toBe(first);
    expect(first).not.toBe(island);
    expect(first.mapId).toBe("town");
    expect(first.displayName).toBe("灰炉城");
    expect(first.obstacles).toHaveLength(448);
    expect(first.obstacles.filter((building) => building.storyCount > 1)).toHaveLength(233);
    expect(first.obstacles.filter((building) => building.storyCount >= 4)).toHaveLength(54);
    expect(first.skybridges).toHaveLength(56);
    expect(first.roadSegments.length).toBeGreaterThanOrEqual(100);
    expect(first.roadSegments.length).toBeLessThanOrEqual(170);
    expect(first.lootSpawnPoints).toHaveLength(
      GLOBAL_LOOT_POINTS +
      first.ammunitionDepot.levels.length * AMMUNITION_DEPOT_LOOT_POINTS_PER_LEVEL +
      ADDITIONAL_GRENADE_LOOT_POINTS,
    );
    expect(first.treeTrunks).toHaveLength(96);
    expect(first.coverObstacles).toHaveLength(168);
    expect(first.rockObstacles).toHaveLength(64);
    expect(new Set(first.obstacles.map((building) => building.townKind))).toEqual(new Set([
      "factory",
      "warehouse",
      "rowhouse",
      "commercial",
      "corner",
      "tower",
    ]));
    expect(first.obstacles.filter((building) => building.storyCount >= 4)
      .every((building) => building.townKind === "tower")).toBe(true);
    const core = first.obstacles.slice(0, 384);
    const coreCoverage = core.reduce((total, building) => total + building.width * building.depth, 0) /
      (1_400 * 1_400);
    expect(coreCoverage).toBeGreaterThanOrEqual(0.45);
    expect(coreCoverage).toBeLessThanOrEqual(0.6);
    expect(core.every((building) =>
      Math.max(building.width / building.depth, building.depth / building.width) <= 3.21
    )).toBe(true);
    const kindPatterns = Array.from({ length: 64 }, (_, blockIndex) =>
      core.slice(blockIndex * 6, blockIndex * 6 + 6).map((building) => building.townKind).join(":"));
    expect(new Set(kindPatterns).size).toBeGreaterThanOrEqual(3);
    expect(core.every((building, index) =>
      core.slice(index + 1).every((other) =>
        Math.abs(building.center.x - other.center.x) >= (building.width + other.width) / 2 ||
        Math.abs(building.center.z - other.center.z) >= (building.depth + other.depth) / 2
      )
    )).toBe(true);
  });

  it.each([1, 42, 2026])(
    "builds one connected staggered road network for seed %i instead of a full orthogonal grid",
    (seed) => {
      const roads = createMapLayout("town", seed).roadSegments;
      const topology = roadTopology(roads);

      expect(topology.componentCount).toBe(1);
      expect(topology.tJunctionCount).toBeGreaterThanOrEqual(12);
      expect(topology.bendCount).toBeGreaterThanOrEqual(12);
      expect(topology.fourWayJunctionCount).toBeLessThan(40);
      expect(topology.nonAxisSegmentCount).toBeGreaterThanOrEqual(40);
      expect(topology.longestSegment).toBeLessThan(260);
      expect(topology.minimumX).toBeLessThanOrEqual(-850);
      expect(topology.maximumX).toBeGreaterThanOrEqual(850);
      expect(topology.minimumZ).toBeLessThanOrEqual(-850);
      expect(topology.maximumZ).toBeGreaterThanOrEqual(850);
    },
  );

  it("keeps every building floor and ramp authoritative through five stories", () => {
    const layout = createMapLayout("town", 2026);
    const highBuildings = layout.obstacles.filter((building) => building.storyCount >= 4);
    expect(highBuildings.length).toBeGreaterThan(0);

    for (const building of highBuildings) {
      const ramps = layout.roofRamps.filter((ramp) => ramp.obstacleId === building.id);
      const slabs = layout.floorSlabs.filter((slab) => slab.obstacleId === building.id);
      const openings = layout.wallOpenings.filter((opening) => opening.obstacleId === building.id);

      expect(ramps).toHaveLength(building.storyCount);
      expect(new Set(ramps.map((ramp) => ramp.fromLevel))).toEqual(
        new Set(Array.from({ length: building.storyCount }, (_, level) => level)),
      );
      expect(new Set(openings.map((opening) => opening.storyIndex))).toEqual(
        new Set(Array.from({ length: building.storyCount }, (_, level) => level)),
      );
      expect(slabs.some((slab) => slab.level === building.storyCount && slab.kind === "roof")).toBe(true);
      expect(building.center.y + building.height / 2).toBeCloseTo(
        building.baseY + building.storyHeight * building.storyCount,
        3,
      );
    }
  });

  it("keeps industrial cover outside every authoritative building and internal ramp", () => {
    for (const seed of [0, 42, 2026]) {
      const layout = createMapLayout("town", seed);
      for (const cover of layout.coverObstacles) {
        expect(layout.obstacles.every((building) =>
          Math.abs(cover.center.x - building.center.x) >= (cover.width + building.width) / 2 + 0.5 ||
          Math.abs(cover.center.z - building.center.z) >= (cover.depth + building.depth) / 2 + 0.5
        ), `${seed}:${cover.id}:building`).toBe(true);
        expect(layout.roofRamps.every((ramp) =>
          Math.abs(cover.center.x - ramp.centerX) >= cover.width / 2 + ramp.width / 2 + 0.5 ||
          Math.max(ramp.startZ, ramp.endZ) <= cover.center.z - cover.depth / 2 - 0.5 ||
          Math.min(ramp.startZ, ramp.endZ) >= cover.center.z + cover.depth / 2 + 0.5
        ), `${seed}:${cover.id}:ramp`).toBe(true);
      }
      for (const obstacle of [...layout.coverObstacles, ...layout.treeTrunks]) {
        expect(layout.roadSegments.every((road) =>
          !roadIntersectsFootprint(
            road,
            obstacle.center.x,
            obstacle.center.z,
            obstacle.width,
            obstacle.depth,
            TOWN_ROAD_SHOULDER_HALF_WIDTH + 0.25,
          )
        ), `${seed}:${obstacle.id}:road`).toBe(true);
      }
    }
  });

  it.each([0, 1, 2, 7, 19, 42, 99, 2026, 314_159])(
    "keeps seeded POIs and landing zones in real public space for seed %i",
    (seed) => {
      const layout = createMapLayout("town", seed);
      expect(layout.mapPoints).toHaveLength(8);
      expect(layout.landingZones).toHaveLength(16);

      for (const point of layout.landingZones) {
        const anchor = TOWN_POINT_ANCHORS[point.name];
        if (!anchor) throw new Error(`Town point anchor missing: ${point.name}`);
        expect(Math.hypot(
          point.position.x - anchor[0],
          point.position.z - anchor[1],
        ), `${seed}:${point.name}:anchor`).toBeLessThan(330);
        expect(layout.obstacles.every((building) =>
          Math.abs(point.position.x - building.center.x) >
            building.width / 2 + TOWN_POINT_HALF_WIDTH + TOWN_POINT_OBSTACLE_CLEARANCE ||
          Math.abs(point.position.z - building.center.z) >
            building.depth / 2 + TOWN_POINT_HALF_DEPTH + TOWN_POINT_OBSTACLE_CLEARANCE
        ), `${seed}:${point.name}:building`).toBe(true);
        expect(layout.roofRamps.every((ramp) =>
          Math.abs(point.position.x - ramp.centerX) >
            ramp.width / 2 + TOWN_POINT_HALF_WIDTH + TOWN_POINT_OBSTACLE_CLEARANCE ||
          point.position.z + TOWN_POINT_HALF_DEPTH + TOWN_POINT_OBSTACLE_CLEARANCE <
            Math.min(ramp.startZ, ramp.endZ) ||
          point.position.z - TOWN_POINT_HALF_DEPTH - TOWN_POINT_OBSTACLE_CLEARANCE >
            Math.max(ramp.startZ, ramp.endZ)
        ), `${seed}:${point.name}:ramp`).toBe(true);
        for (const road of layout.roadSegments) {
          expect(roadIntersectsFootprint(
            road,
            point.position.x,
            point.position.z,
            TOWN_POINT_HALF_WIDTH * 2,
            TOWN_POINT_HALF_DEPTH * 2,
            TOWN_ROAD_SHOULDER_HALF_WIDTH + TOWN_POINT_OBSTACLE_CLEARANCE,
          ), `${seed}:${point.name}:road`).toBe(false);
        }
        for (const obstacle of [
          ...layout.coverObstacles,
          ...layout.treeTrunks,
          ...layout.rockObstacles,
        ]) {
          expect(
            Math.abs(point.position.x - obstacle.center.x) >
              TOWN_POINT_HALF_WIDTH + obstacle.width / 2 + TOWN_POINT_OBSTACLE_CLEARANCE ||
            Math.abs(point.position.z - obstacle.center.z) >
              TOWN_POINT_HALF_DEPTH + obstacle.depth / 2 + TOWN_POINT_OBSTACLE_CLEARANCE,
            `${seed}:${point.name}:${obstacle.id}`,
          ).toBe(true);
        }

        for (const opening of layout.wallOpenings.filter((candidate) =>
          candidate.storyIndex === 0 && candidate.kind === "door"
        )) {
          const outwardX = opening.side === "left"
            ? opening.center.x - TOWN_POINT_ENTRANCE_DEPTH / 2
            : opening.side === "right"
              ? opening.center.x + TOWN_POINT_ENTRANCE_DEPTH / 2
              : opening.center.x;
          const outwardZ = opening.side === "front"
            ? opening.center.z - TOWN_POINT_ENTRANCE_DEPTH / 2
            : opening.side === "back"
              ? opening.center.z + TOWN_POINT_ENTRANCE_DEPTH / 2
              : opening.center.z;
          const entranceWidth = opening.side === "front" || opening.side === "back"
            ? opening.width + 4
            : TOWN_POINT_ENTRANCE_DEPTH;
          const entranceDepth = opening.side === "front" || opening.side === "back"
            ? TOWN_POINT_ENTRANCE_DEPTH
            : opening.width + 4;
          expect(
            Math.abs(point.position.x - outwardX) >
              entranceWidth / 2 + TOWN_POINT_HALF_WIDTH + TOWN_POINT_OBSTACLE_CLEARANCE ||
            Math.abs(point.position.z - outwardZ) >
              entranceDepth / 2 + TOWN_POINT_HALF_DEPTH + TOWN_POINT_OBSTACLE_CLEARANCE,
            `${seed}:${point.name}:${opening.obstacleId}:entrance`,
          ).toBe(true);
        }
      }
      for (const [index, point] of layout.landingZones.entries()) {
        for (const other of layout.landingZones.slice(index + 1)) {
          expect(
            Math.abs(point.position.x - other.position.x) >
              TOWN_POINT_HALF_WIDTH * 2 + TOWN_POINT_OBSTACLE_CLEARANCE ||
            Math.abs(point.position.z - other.position.z) >
              TOWN_POINT_HALF_DEPTH * 2 + TOWN_POINT_OBSTACLE_CLEARANCE,
            `${seed}:${point.name}:${other.name}:public-space`,
          ).toBe(true);
        }
      }
    },
  );

  it.each([5, 7])("keeps skybridges connected, walkable, and inside the map for seed %i", (seed) => {
    const layout = createMapLayout("town", seed);
    const buildings = new Map(layout.obstacles.map((building) => [building.id, building]));
    if (seed === 5) {
      expect(layout.skybridges.some((bridge) =>
        bridge.fromBuildingId === "town-building-63-0" ||
        bridge.toBuildingId === "town-building-63-1"
      )).toBe(false);
    }

    for (const bridge of layout.skybridges) {
      const from = buildings.get(bridge.fromBuildingId);
      const to = buildings.get(bridge.toBuildingId);
      expect(from?.storyCount).toBeGreaterThanOrEqual(2);
      expect(to?.storyCount).toBeGreaterThanOrEqual(2);
      expect(bridge.floorY).toBeCloseTo(
        Math.max(
          (from?.baseY ?? 0) + (from?.storyHeight ?? 0) + 0.18,
          (to?.baseY ?? 0) + (to?.storyHeight ?? 0) + 0.18,
        ),
        2,
      );
      expect(Math.abs(bridge.center.x) + bridge.width / 2).toBeLessThan(MAP_HALF_SIZE);
      expect(Math.abs(bridge.center.z) + bridge.depth / 2).toBeLessThan(MAP_HALF_SIZE);
      expect(bridge.width).toBeGreaterThan(0);
      expect(bridge.depth).toBeGreaterThanOrEqual(5);
      expect(Math.abs(
        (from?.baseY ?? 0) + (from?.storyHeight ?? 0) + BUILDING_ROOF_CAP_HEIGHT -
          ((to?.baseY ?? 0) + (to?.storyHeight ?? 0) + BUILDING_ROOF_CAP_HEIGHT),
      )).toBeLessThanOrEqual(MAX_WALKABLE_STEP_HEIGHT);
    }
  });

  it("lets navigation cross a second-story skybridge without descending to ground", () => {
    const layout = createMapLayout("town", 19);
    const bridge = layout.skybridges[0];
    if (!bridge) throw new Error("Town skybridge missing");
    const from = layout.obstacles.find((building) => building.id === bridge.fromBuildingId);
    const to = layout.obstacles.find((building) => building.id === bridge.toBuildingId);
    if (!from || !to) throw new Error("Town skybridge buildings missing");
    const startDirection = bridge.fromSide === "right" ? 1 : -1;
    const targetDirection = bridge.toSide === "right" ? 1 : -1;
    const start = {
      x: from.center.x + startDirection * (from.width / 2 - 4),
      y: bridge.floorY + ACTOR_EYE_HEIGHT,
      z: bridge.center.z,
    };
    const target = {
      x: to.center.x + targetDirection * (to.width / 2 - 4),
      y: bridge.floorY + ACTOR_EYE_HEIGHT,
      z: bridge.center.z,
    };

    const path = new GridNavigator(layout).findPath(start, target);

    expect(path.length).toBeGreaterThanOrEqual(4);
    expect(path.every((point) => point.y > bridge.floorY + 1)).toBe(true);
    expect(path.some((point) => Math.abs(point.x - bridge.center.x) < bridge.width / 2)).toBe(true);
  });

  it("composes town doors, internal ramps, high floors, and skybridges into walkable routes", () => {
    const layout = createMapLayout("town", 42);
    const navigator = new GridNavigator(layout);
    const highBuilding = layout.obstacles.find((building) => building.storyCount === 5);
    if (!highBuilding) throw new Error("Five-story town building missing");
    const highDoor = groundDoorPoints(layout, highBuilding.id);
    const roof = {
      x: highBuilding.center.x,
      y: highBuilding.baseY +
        highBuilding.storyHeight * highBuilding.storyCount +
        BUILDING_ROOF_CAP_HEIGHT +
        ACTOR_EYE_HEIGHT,
      z: highBuilding.center.z,
    };
    const upward = navigator.findPath(highDoor.outside, roof);
    const downward = navigator.findPath(roof, highDoor.outside);

    expect(upward.length).toBeGreaterThan(highBuilding.storyCount * 2);
    expect(downward.length).toBeGreaterThan(highBuilding.storyCount * 2);
    followTownPath(layout, highDoor.outside, upward);
    followTownPath(layout, roof, downward);

    const bridge = layout.skybridges[0];
    if (!bridge) throw new Error("Town skybridge missing");
    const from = layout.obstacles.find((building) => building.id === bridge.fromBuildingId);
    const to = layout.obstacles.find((building) => building.id === bridge.toBuildingId);
    if (!from || !to) throw new Error("Town skybridge endpoint building missing");
    const fromDoor = groundDoorPoints(layout, from.id);
    const toDirection = bridge.toSide === "right" ? 1 : -1;
    const adjacentFloor = {
      x: to.center.x + toDirection * (to.width / 2 - 4),
      y: to.baseY + to.storyHeight + BUILDING_ROOF_CAP_HEIGHT + ACTOR_EYE_HEIGHT,
      z: bridge.center.z,
    };
    const bridgePath = navigator.findPath(fromDoor.outside, adjacentFloor);

    expect(bridgePath.some((point) =>
      Math.abs(point.x - bridge.center.x) < bridge.width / 2 &&
      Math.abs(point.z - bridge.center.z) < bridge.depth / 2 &&
      point.y > bridge.floorY + 1
    )).toBe(true);
    followTownPath(layout, fromDoor.outside, bridgePath);

    const sourceBuilding = layout.obstacles[0];
    const targetBuilding = layout.obstacles[48];
    if (!sourceBuilding || !targetBuilding) throw new Error("Cross-block town buildings missing");
    const sourceInterior = groundDoorPoints(layout, sourceBuilding.id).inside;
    const targetInterior = groundDoorPoints(layout, targetBuilding.id).inside;
    const buildingPath = navigator.findPath(sourceInterior, targetInterior);
    expect(buildingPath.length).toBeGreaterThan(4);
    followTownPath(layout, sourceInterior, buildingPath);
  }, 60_000);

  it("uses authoritative bridge floors and rails for support and combat obstruction", () => {
    const layout = createMapLayout("town", 99);
    const bridge = layout.skybridges[0];
    if (!bridge) throw new Error("Town skybridge missing");
    const support = getSupportHeight(
      bridge.center.x,
      bridge.center.z,
      bridge.floorY + BUILDING_ROOF_CAP_HEIGHT,
      layout,
    );
    expect(support).toBeCloseTo(bridge.floorY, 2);

    const shooter = createActorState("shooter", "player", {
      x: bridge.center.x,
      y: bridge.floorY + ACTOR_EYE_HEIGHT,
      z: bridge.center.z,
    });
    const state = matchState(layout.seed, shooter);
    const world = new SimulationCombatWorld(state, true, layout);
    const railDirection = { x: 0, y: -0.35, z: 1 };
    expect(world.traceShotDetailed({
      shooterId: shooter.id,
      origin: shooter.position,
      direction: railDirection,
      range: 10,
    })).toMatchObject({ hitType: "environment", targetId: null });
  });

  it.each([42, 2026, 314_159])(
    "keeps the street grid clear and fragments standable core sightlines for seed %i",
    (seed) => {
      const layout = createMapLayout("town", seed);
      for (const road of layout.roadSegments) {
        expect(layout.obstacles.every((building) =>
          !roadIntersectsFootprint(
            road,
            building.center.x,
            building.center.z,
            building.width,
            building.depth,
            TOWN_ROAD_SHOULDER_HALF_WIDTH + 0.5,
          )
        )).toBe(true);
      }

      const blockers = [
        ...layout.obstacles,
        ...layout.coverObstacles,
        ...layout.treeTrunks,
        ...layout.rockObstacles,
      ];
      const samples = [];
      for (let x = -660; x <= 660; x += 30) {
        for (let z = -660; z <= 660; z += 30) {
          const sample = { x, z };
          if (blockers.some((blocker) => pointInsideFootprint(sample, blocker, 0.5))) continue;
          if (layout.mapPoints.some((point) =>
            (point.name === "灰炉广场" || point.name === "城市公园") &&
            Math.hypot(x - point.position.x, z - point.position.z) < 100
          )) continue;
          samples.push(sample);
        }
      }
      expect(samples.length).toBeGreaterThan(760);
      const distances = samples.flatMap((sample) =>
        Array.from({ length: 16 }, (_, index) => {
          const angle = (index + 0.5) / 16 * Math.PI * 2;
          return distanceToBlocker(
            sample.x,
            sample.z,
            Math.cos(angle),
            Math.sin(angle),
            blockers,
            240,
          );
        })
      ).sort((left, right) => left - right);
      const median = distances[Math.floor(distances.length * 0.5)] ?? Number.POSITIVE_INFINITY;
      const percentile90 = distances[Math.floor(distances.length * 0.9)] ?? Number.POSITIVE_INFINITY;

      expect(median).toBeLessThanOrEqual(90);
      expect(percentile90).toBeLessThanOrEqual(180);
    },
  );

  it("uses seeded random block layouts instead of one repeated rectangular grid", () => {
    const first = createMapLayout("town", 1);
    const second = createMapLayout("town", 2);
    const firstCore = first.obstacles.slice(0, 384);
    const secondCore = second.obstacles.slice(0, 384);
    const changedCenters = firstCore.filter((building, index) => {
      const other = secondCore[index];
      return other &&
        (Math.abs(building.center.x - other.center.x) > 0.01 ||
          Math.abs(building.center.z - other.center.z) > 0.01);
    });
    const changedFootprints = firstCore.filter((building, index) => {
      const other = secondCore[index];
      return other &&
        (Math.abs(building.width - other.width) > 0.01 ||
          Math.abs(building.depth - other.depth) > 0.01);
    });
    expect(changedCenters.length).toBeGreaterThan(320);
    expect(changedFootprints.length).toBeGreaterThan(320);
    expect(first.roadSegments).not.toEqual(second.roadSegments);
    expect(first.mapPoints.map(({ position }) => position)).not.toEqual(
      second.mapPoints.map(({ position }) => position),
    );
    expect(first.coverObstacles.map(({ center }) => center)).not.toEqual(
      second.coverObstacles.map(({ center }) => center),
    );
    expect(roadTopology(first.roadSegments).headingBinCount).toBeGreaterThanOrEqual(5);
    expect(first.obstacles.map((building) => building.storyCount)).not.toEqual(
      second.obstacles.map((building) => building.storyCount),
    );

    const localPatternKeys = Array.from({ length: 64 }, (_, blockIndex) => {
      const block = firstCore.slice(blockIndex * 6, blockIndex * 6 + 6);
      const centerX = block.reduce((total, building) => total + building.center.x, 0) / block.length;
      const centerZ = block.reduce((total, building) => total + building.center.z, 0) / block.length;
      return block
        .map((building) =>
          `${Math.round((building.center.x - centerX) * 10)}:` +
          `${Math.round((building.center.z - centerZ) * 10)}:` +
          `${Math.round(building.width * 10)}:${Math.round(building.depth * 10)}`
        )
        .sort()
        .join("|");
    });
    expect(new Set(localPatternKeys).size).toBeGreaterThanOrEqual(48);
    const crossBlockGaps = adjacentCoreBlockGaps(firstCore);
    expect(crossBlockGaps.filter((gap) => gap < 22).length).toBeGreaterThanOrEqual(10);
    expect(Math.max(...crossBlockGaps)).toBeGreaterThan(45);
  }, 60_000);
});

const TOWN_POINT_ENTRANCE_DEPTH = 10;
const TOWN_POINT_ANCHORS: Readonly<Record<string, readonly [number, number]>> = {
  灰炉广场: [0, 0],
  铸造工业园: [-540, -540],
  旧火车站: [540, -540],
  工人住宅区: [-540, 540],
  仓储港区: [540, 540],
  老城区: [0, 540],
  商业街: [0, -540],
  城市公园: [540, 0],
  北部货场: [-270, 810],
  炉渣仓库: [270, 810],
  西侧厂区: [-810, -270],
  旧供电站: [-810, 270],
  东部车场: [810, -270],
  废水工场: [810, 270],
  南部工棚: [-270, -810],
  物流站场: [270, -810],
};

function adjacentCoreBlockGaps(core: readonly MapObstacle[]): number[] {
  const blocks = Array.from({ length: 64 }, (_, blockIndex) =>
    core.filter((building) => building.id.startsWith(`town-building-${blockIndex}-`)));
  const gaps: number[] = [];
  for (let blockZ = 0; blockZ < 8; blockZ += 1) {
    for (let blockX = 0; blockX < 7; blockX += 1) {
      const left = blocks[blockZ * 8 + blockX] ?? [];
      const right = blocks[blockZ * 8 + blockX + 1] ?? [];
      gaps.push(
        Math.min(...right.map((building) => building.center.x - building.width / 2)) -
        Math.max(...left.map((building) => building.center.x + building.width / 2)),
      );
    }
  }
  for (let blockZ = 0; blockZ < 7; blockZ += 1) {
    for (let blockX = 0; blockX < 8; blockX += 1) {
      const lower = blocks[blockZ * 8 + blockX] ?? [];
      const upper = blocks[(blockZ + 1) * 8 + blockX] ?? [];
      gaps.push(
        Math.min(...upper.map((building) => building.center.z - building.depth / 2)) -
        Math.max(...lower.map((building) => building.center.z + building.depth / 2)),
      );
    }
  }
  return gaps;
}

function distanceToBlocker(
  originX: number,
  originZ: number,
  directionX: number,
  directionZ: number,
  blockers: readonly MapObstacle[],
  maximumDistance: number,
): number {
  for (let distance = 0; distance <= maximumDistance; distance += 4) {
    const point = {
      x: originX + directionX * distance,
      z: originZ + directionZ * distance,
    };
    if (blockers.some((blocker) => pointInsideFootprint(point, blocker, 0))) return distance;
  }
  return maximumDistance;
}

function pointInsideFootprint(
  point: { x: number; z: number },
  blocker: MapObstacle,
  padding: number,
): boolean {
  return (
    Math.abs(point.x - blocker.center.x) <= blocker.width / 2 + padding &&
    Math.abs(point.z - blocker.center.z) <= blocker.depth / 2 + padding
  );
}

function roadIntersectsFootprint(
  road: readonly [number, number, number, number],
  centerX: number,
  centerZ: number,
  width: number,
  depth: number,
  padding: number,
): boolean {
  const [startX, startZ, endX, endZ] = road;
  const minimumX = centerX - width / 2 - padding;
  const maximumX = centerX + width / 2 + padding;
  const minimumZ = centerZ - depth / 2 - padding;
  const maximumZ = centerZ + depth / 2 + padding;
  let minimumProgress = 0;
  let maximumProgress = 1;
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
    minimumProgress = Math.max(minimumProgress, Math.min(first, second));
    maximumProgress = Math.min(maximumProgress, Math.max(first, second));
    if (minimumProgress > maximumProgress) return false;
  }
  return true;
}

function roadTopology(roads: readonly (readonly [number, number, number, number])[]): {
  componentCount: number;
  tJunctionCount: number;
  fourWayJunctionCount: number;
  bendCount: number;
  nonAxisSegmentCount: number;
  headingBinCount: number;
  longestSegment: number;
  minimumX: number;
  maximumX: number;
  minimumZ: number;
  maximumZ: number;
} {
  const positions = new Map<string, readonly [number, number]>();
  const neighbors = new Map<string, Set<string>>();
  const connect = (from: string, to: string): void => {
    const entries = neighbors.get(from) ?? new Set<string>();
    entries.add(to);
    neighbors.set(from, entries);
  };
  let nonAxisSegmentCount = 0;
  let longestSegment = 0;
  let minimumX = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let minimumZ = Number.POSITIVE_INFINITY;
  let maximumZ = Number.NEGATIVE_INFINITY;
  const headingBins = new Set<number>();
  for (const [startX, startZ, endX, endZ] of roads) {
    const startKey = roadNodeKey(startX, startZ);
    const endKey = roadNodeKey(endX, endZ);
    positions.set(startKey, [startX, startZ]);
    positions.set(endKey, [endX, endZ]);
    connect(startKey, endKey);
    connect(endKey, startKey);
    const deltaX = endX - startX;
    const deltaZ = endZ - startZ;
    if (Math.abs(deltaX) > 0.01 && Math.abs(deltaZ) > 0.01) nonAxisSegmentCount += 1;
    longestSegment = Math.max(longestSegment, Math.hypot(deltaX, deltaZ));
    const heading = (Math.atan2(deltaZ, deltaX) + Math.PI) % Math.PI;
    headingBins.add(Math.round(heading / (Math.PI / 36)));
    minimumX = Math.min(minimumX, startX, endX);
    maximumX = Math.max(maximumX, startX, endX);
    minimumZ = Math.min(minimumZ, startZ, endZ);
    maximumZ = Math.max(maximumZ, startZ, endZ);
  }
  let componentCount = 0;
  const visited = new Set<string>();
  for (const node of neighbors.keys()) {
    if (visited.has(node)) continue;
    componentCount += 1;
    const pending = [node];
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current || visited.has(current)) continue;
      visited.add(current);
      for (const neighbor of neighbors.get(current) ?? []) pending.push(neighbor);
    }
  }
  let bendCount = 0;
  for (const [node, adjacent] of neighbors) {
    if (adjacent.size !== 2) continue;
    const center = positions.get(node);
    const endpoints = [...adjacent].map((neighbor) => positions.get(neighbor));
    if (!center || !endpoints[0] || !endpoints[1]) continue;
    const firstX = endpoints[0][0] - center[0];
    const firstZ = endpoints[0][1] - center[1];
    const secondX = endpoints[1][0] - center[0];
    const secondZ = endpoints[1][1] - center[1];
    const cross = Math.abs(firstX * secondZ - firstZ * secondX);
    if (cross > Math.hypot(firstX, firstZ) * Math.hypot(secondX, secondZ) * 0.01) bendCount += 1;
  }
  return {
    componentCount,
    tJunctionCount: [...neighbors.values()].filter((adjacent) => adjacent.size === 3).length,
    fourWayJunctionCount: [...neighbors.values()].filter((adjacent) => adjacent.size === 4).length,
    bendCount,
    nonAxisSegmentCount,
    headingBinCount: headingBins.size,
    longestSegment,
    minimumX,
    maximumX,
    minimumZ,
    maximumZ,
  };
}

function roadNodeKey(x: number, z: number): string {
  return `${x.toFixed(6)}:${z.toFixed(6)}`;
}

function matchState(seed: number, ...actors: ReturnType<typeof createActorState>[]): MatchState {
  return {
    mapId: "town",
    mapSeed: seed,
    phase: "combat",
    elapsedSeconds: 0,
    actors: Object.fromEntries(actors.map((actor) => [actor.id, actor])),
    groundLoot: {},
    activeGrenades: {},
    nextGrenadeSequence: 1,
    safeZone: {
      center: { x: 0, y: 0, z: 0 },
      radius: 1_000,
      startCenter: { x: 0, y: 0, z: 0 },
      startRadius: 1_000,
      targetCenter: { x: 0, y: 0, z: 0 },
      targetRadius: 1_000,
      stageIndex: 0,
      status: "waiting",
      secondsRemaining: 60,
      damagePerSecond: 0,
    },
    flight: {
      start: { x: -1_000, y: 180, z: 0 },
      end: { x: 1_000, y: 180, z: 0 },
      durationSeconds: 20,
      progress: 0,
    },
    result: null,
  };
}

function groundDoorPoints(
  layout: ReturnType<typeof createMapLayout>,
  buildingId: string,
): { inside: ReturnType<typeof createActorState>["position"]; outside: ReturnType<typeof createActorState>["position"] } {
  const door = layout.wallOpenings.find((opening) =>
    opening.obstacleId === buildingId &&
    opening.storyIndex === 0 &&
    opening.kind === "door"
  );
  if (!door) throw new Error(`Ground door missing for ${buildingId}`);
  const outsideZ = door.side === "front" ? door.center.z - 1.1 : door.center.z + 1.1;
  const insideZ = door.side === "front" ? door.center.z + 1.1 : door.center.z - 1.1;
  return {
    outside: {
      x: door.center.x,
      y: getTerrainHeight(door.center.x, outsideZ, layout) + ACTOR_EYE_HEIGHT,
      z: outsideZ,
    },
    inside: {
      x: door.center.x,
      y: getTerrainHeight(door.center.x, insideZ, layout) + ACTOR_EYE_HEIGHT,
      z: insideZ,
    },
  };
}

function followTownPath(
  layout: ReturnType<typeof createMapLayout>,
  start: ReturnType<typeof createActorState>["position"],
  path: readonly ReturnType<typeof createActorState>["position"][],
): void {
  const actor = createActorState("walker", "bot", { ...start });
  actor.deployment = "grounded";
  const state = matchState(layout.seed, actor);
  const movement = new MovementSystem(layout);
  let waypointIndex = 1;
  for (let tick = 0; tick < 12_000 && waypointIndex < path.length; tick += 1) {
    const waypoint = path[waypointIndex];
    if (!waypoint) break;
    const distance = Math.hypot(
      actor.position.x - waypoint.x,
      actor.position.y - waypoint.y,
      actor.position.z - waypoint.z,
    );
    if (distance < 0.6) {
      waypointIndex += 1;
      continue;
    }
    const horizontal = Math.hypot(waypoint.x - actor.position.x, waypoint.z - actor.position.z);
    movement.processCommand(
      state,
      actor.id,
      {
        ...createIdleCommand(),
        move: {
          x: horizontal > 0 ? (waypoint.x - actor.position.x) / horizontal : 0,
          y: 0,
          z: horizontal > 0 ? (waypoint.z - actor.position.z) / horizontal : 0,
        },
      },
      1 / 60,
    );
  }
  expect(waypointIndex, JSON.stringify({ start, position: actor.position, path })).toBe(path.length);
}
