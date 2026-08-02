import { describe, expect, it } from "vitest";
import { GridNavigator } from "../../src/ai/navigation/GridNavigator";
import {
  BUILDING_ROOF_CAP_HEIGHT,
  createMapLayout,
  getTerrainHeight,
  MAP_HALF_SIZE,
  TOTAL_LOOT_POINTS,
  type MapObstacle,
} from "../../src/config/map";
import { ACTOR_EYE_HEIGHT } from "../../src/game/rules/actorGeometry";
import { createIdleCommand } from "../../src/game/commands/ActorCommand";
import { getSupportHeight, MovementSystem } from "../../src/game/systems/MovementSystem";
import { SimulationCombatWorld } from "../../src/game/systems/SimulationCombatWorld";
import { createActorState, type MatchState } from "../../src/game/state/types";

describe("town map layout", () => {
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
    expect(first.skybridges).toHaveLength(32);
    expect(first.roadSegments).toHaveLength(18);
    expect(first.lootSpawnPoints).toHaveLength(TOTAL_LOOT_POINTS);
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
  });

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
    }
  });

  it("keeps skybridges connected to second-story buildings and inside the map", () => {
    const layout = createMapLayout("town", 7);
    const buildings = new Map(layout.obstacles.map((building) => [building.id, building]));

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

    const sourceInterior = { x: from.center.x, y: highDoor.inside.y, z: from.center.z };
    const targetDoor = groundDoorPoints(layout, to.id);
    const targetInterior = { x: to.center.x, y: targetDoor.inside.y, z: to.center.z };
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
      for (const [startX, startZ, endX, endZ] of layout.roadSegments) {
        const vertical = startX === endX;
        expect(layout.obstacles.every((building) => {
          if (vertical) {
            const overlapsLength = Math.abs(building.center.z - (startZ + endZ) / 2) <
              Math.abs(endZ - startZ) / 2 + building.depth / 2;
            return !overlapsLength || Math.abs(building.center.x - startX) > building.width / 2 + 8;
          }
          const overlapsLength = Math.abs(building.center.x - (startX + endX) / 2) <
            Math.abs(endX - startX) / 2 + building.width / 2;
          return !overlapsLength || Math.abs(building.center.z - startZ) > building.depth / 2 + 8;
        })).toBe(true);
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
      expect(samples.length).toBeGreaterThan(800);
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

  it("varies town building details across seeds without changing the fixed city grid", () => {
    const first = createMapLayout("town", 1);
    const second = createMapLayout("town", 2);

    expect(first.obstacles.map((building) => building.center.x)).toEqual(
      second.obstacles.map((building) => building.center.x),
    );
    expect(first.obstacles.map((building) => building.center.z)).toEqual(
      second.obstacles.map((building) => building.center.z),
    );
    expect(first.obstacles.map((building) => building.width)).not.toEqual(
      second.obstacles.map((building) => building.width),
    );
    expect(first.obstacles.map((building) => building.storyCount)).not.toEqual(
      second.obstacles.map((building) => building.storyCount),
    );
  });
});

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

function matchState(seed: number, ...actors: ReturnType<typeof createActorState>[]): MatchState {
  return {
    mapId: "town",
    mapSeed: seed,
    phase: "combat",
    elapsedSeconds: 0,
    actors: Object.fromEntries(actors.map((actor) => [actor.id, actor])),
    groundLoot: {},
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
