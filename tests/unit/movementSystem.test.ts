import { describe, expect, it } from "vitest";
import { GridNavigator } from "../../src/ai/navigation/GridNavigator";
import {
  BUILDING_ROOF_CAP_HEIGHT,
  createMapLayout,
  getTerrainHeight,
  MAP_HALF_SIZE,
  MAP_ROCK_OBSTACLES,
  MAP_WALL_SEGMENTS,
} from "../../src/config/map";
import { createIdleCommand, type ActorCommand } from "../../src/game/commands/ActorCommand";
import { createActorState, type MatchState } from "../../src/game/state/types";
import {
  getSupportHeight,
  getWallCollisionCandidateCount,
  MovementSystem,
} from "../../src/game/systems/MovementSystem";

const GROUND_HEIGHT = 1.76;
const ACTOR_RADIUS = 0.42;

describe("MovementSystem", () => {
  it("moves the same distance at different frame rates", () => {
    const slowFrames = createState(0, 0);
    const fastFrames = createState(0, 0);
    const command = movingCommand(1, 0);

    advance(slowFrames, command, 20, 1 / 20);
    advance(fastFrames, command, 60, 1 / 60);

    expect(slowFrames.actors.actor?.position.x).toBeCloseTo(8.7, 8);
    expect(fastFrames.actors.actor?.position.x).toBeCloseTo(8.7, 8);
    expect(slowFrames.actors.actor?.position.x).toBeCloseTo(fastFrames.actors.actor?.position.x ?? 0, 8);
  });

  it("keeps actors inside the map and outside buildings", () => {
    const boundaryState = createState(MAP_HALF_SIZE - 1, 0);
    advance(boundaryState, movingCommand(1, 0, true), 30, 1 / 30);
    expect(boundaryState.actors.actor?.position.x).toBeLessThanOrEqual(MAP_HALF_SIZE - ACTOR_RADIUS);

    const wall = MAP_WALL_SEGMENTS[0];
    if (!wall) {
      throw new Error("test wall missing");
    }
    const obstacleState = createState(wall.center.x - wall.width / 2 - ACTOR_RADIUS - 1, wall.center.z);
    advance(obstacleState, movingCommand(1, 0, true), 60, 1 / 60);

    const actor = obstacleState.actors.actor;
    expect(actor).toBeDefined();
    if (actor) {
      const closestX = clamp(
        actor.position.x,
        wall.center.x - wall.width / 2,
        wall.center.x + wall.width / 2,
      );
      const closestZ = clamp(
        actor.position.z,
        wall.center.z - wall.depth / 2,
        wall.center.z + wall.depth / 2,
      );
      expect(Math.hypot(actor.position.x - closestX, actor.position.z - closestZ)).toBeGreaterThanOrEqual(
        ACTOR_RADIUS - 0.001,
      );
    }
  });

  it("recovers an actor that starts overlapped with a wall", () => {
    const wall = MAP_WALL_SEGMENTS[0];
    if (!wall) throw new Error("test wall missing");
    const state = createState(wall.center.x, wall.center.z);
    const actor = state.actors.actor;
    if (!actor) throw new Error("test actor missing");
    actor.position.x = wall.center.x;
    actor.position.z = wall.center.z;

    new MovementSystem().processCommand(state, actor.id, movingCommand(1, 0), 1 / 30);

    const closestX = clamp(actor.position.x, wall.center.x - wall.width / 2, wall.center.x + wall.width / 2);
    const closestZ = clamp(actor.position.z, wall.center.z - wall.depth / 2, wall.center.z + wall.depth / 2);
    expect(Math.hypot(actor.position.x - closestX, actor.position.z - closestZ)).toBeGreaterThanOrEqual(
      ACTOR_RADIUS,
    );
  });

  it("blocks movement with authoritative cover rocks", () => {
    const rock = MAP_ROCK_OBSTACLES[0];
    if (!rock) throw new Error("test cover rock missing");
    const state = createState(rock.center.x - rock.width / 2 - ACTOR_RADIUS - 1, rock.center.z);
    const actor = state.actors.actor;
    if (!actor) throw new Error("test actor missing");

    advance(state, movingCommand(1, 0, true), 120, 1 / 60);

    expect(actor.position.x).toBeLessThanOrEqual(rock.center.x - rock.width / 2 - ACTOR_RADIUS + 0.002);
    expect(getSupportHeight(rock.center.x, rock.center.z, Number.POSITIVE_INFINITY, createMapLayout(0))).toBeCloseTo(
      rock.center.y + rock.height / 2,
      5,
    );
  });

  it("blocks movement and routes around generated fence cover", () => {
    const layout = createMapLayout(0);
    const fence = layout.coverObstacles.find((cover) => cover.kind === "fence");
    if (!fence) throw new Error("test fence missing");
    const horizontal = fence.width > fence.depth;
    const startX = horizontal ? fence.center.x : fence.center.x - fence.width / 2 - ACTOR_RADIUS - 1;
    const startZ = horizontal ? fence.center.z - fence.depth / 2 - ACTOR_RADIUS - 1 : fence.center.z;
    const state = createState(startX, startZ);
    const actor = state.actors.actor;
    if (!actor) throw new Error("test actor missing");
    advance(state, movingCommand(horizontal ? 0 : 1, horizontal ? 1 : 0, true), 120, 1 / 60);

    if (horizontal) {
      expect(actor.position.z).toBeLessThanOrEqual(fence.center.z - fence.depth / 2 - ACTOR_RADIUS + 0.002);
    } else {
      expect(actor.position.x).toBeLessThanOrEqual(fence.center.x - fence.width / 2 - ACTOR_RADIUS + 0.002);
    }
    const target = {
      x: horizontal ? startX : fence.center.x + fence.width / 2 + ACTOR_RADIUS + 2,
      y: actor.position.y,
      z: horizontal ? fence.center.z + fence.depth / 2 + ACTOR_RADIUS + 2 : startZ,
    };
    expect(new GridNavigator(layout).findPath({ x: startX, y: actor.position.y, z: startZ }, target).length)
      .toBeGreaterThan(2);
  });

  it("keeps wall collision queries local to the current spatial cell", () => {
    const layout = createMapLayout(0);
    const wall = layout.wallSegments[0];
    if (!wall) throw new Error("test wall missing");
    const state = createState(wall.center.x - wall.width / 2 - ACTOR_RADIUS - 2, wall.center.z);
    const actor = state.actors.actor;
    if (!actor) throw new Error("test actor missing");

    advance(state, movingCommand(1, 0, true), 300, 1 / 60);

    expect(getWallCollisionCandidateCount(wall.center.x, wall.center.z, layout)).toBeLessThan(
      layout.wallSegments.length / 4,
    );
    expect(Number.isFinite(actor.position.x)).toBe(true);
  });

  it("enters a parachute from the aircraft and lands automatically", () => {
    const state = createState(0, 0, 180);
    const actor = state.actors.actor;
    if (!actor) {
      throw new Error("test actor missing");
    }
    actor.deployment = "aircraft";

    new MovementSystem().processCommand(state, actor.id, { ...movingCommand(1, 0), jump: true }, 1 / 60);
    expect(actor.deployment).toBe("parachuting");
    expect(actor.position.x).toBeGreaterThan(0);

    advance(state, createIdleCommand(), 2_400, 1 / 60);
    expect(actor.deployment).toBe("grounded");
    expect(actor.position.y).toBeCloseTo(getSupportHeight(actor.position.x, actor.position.z) + GROUND_HEIGHT);
    expect(actor.velocity.y).toBe(0);
  });

  it("slows horizontal gliding continuously near the ground", () => {
    const high = createState(0, 0, 180);
    const low = createState(0, 0, getTerrainHeight(0, 0) + GROUND_HEIGHT + 18);
    const highActor = high.actors.actor;
    const lowActor = low.actors.actor;
    if (!highActor || !lowActor) throw new Error("test actors missing");
    highActor.deployment = "parachuting";
    lowActor.deployment = "parachuting";

    new MovementSystem().processCommand(high, highActor.id, movingCommand(1, 0), 0.25);
    new MovementSystem().processCommand(low, lowActor.id, movingCommand(1, 0), 0.25);

    expect(highActor.position.x).toBeGreaterThan(lowActor.position.x * 2);
    expect(lowActor.position.x).toBeCloseTo(2, 6);
    expect(lowActor.position.x).toBeLessThan(3.5);
  });

  it("ignores manual ejection while the aircraft is outside the island", () => {
    const state = createState(MAP_HALF_SIZE + 120, 0, 180);
    const actor = state.actors.actor;
    if (!actor) throw new Error("test actor missing");
    actor.deployment = "aircraft";

    new MovementSystem().processCommand(state, actor.id, { ...createIdleCommand(), jump: true }, 1 / 60);

    expect(actor.deployment).toBe("aircraft");
    expect(actor.position).toEqual({ x: MAP_HALF_SIZE + 120, y: 180, z: 0 });
  });

  it("walks up a roof ramp, jumps on the roof, and falls back to terrain", () => {
    const layout = createMapLayout(0);
    const ramp = layout.roofRamps.find((entry) => entry.kind === "exterior");
    const obstacle = layout.obstacles.find((entry) => entry.id === ramp?.obstacleId);
    if (!ramp || !obstacle) throw new Error("test ramp missing");
    const state = createState(ramp.centerX, ramp.startZ, ramp.bottomY + GROUND_HEIGHT);
    const actor = state.actors.actor;
    if (!actor) throw new Error("test actor missing");

    const rampDirection = Math.sign(ramp.endZ - ramp.startZ) || 1;
    advance(state, movingCommand(0, rampDirection), 240, 1 / 60);

    const roofY = obstacle.center.y + obstacle.height / 2 + BUILDING_ROOF_CAP_HEIGHT;
    expect(actor.position.y).toBeCloseTo(roofY + GROUND_HEIGHT, 1);

    new MovementSystem().processCommand(state, actor.id, { ...createIdleCommand(), jump: true }, 1 / 60);
    expect(actor.velocity.y).toBeGreaterThan(0);
    advance(state, createIdleCommand(), 90, 1 / 60);
    expect(actor.position.y).toBeCloseTo(roofY + GROUND_HEIGHT, 1);

    advance(state, movingCommand(1, 0), 180, 1 / 60);
    advance(state, createIdleCommand(), 90, 1 / 60);
    expect(actor.position.y).toBeCloseTo(getTerrainHeight(actor.position.x, actor.position.z, layout) + GROUND_HEIGHT, 1);
  });

  it("reaches a 1.7 meter jump apex and lands on the same support", () => {
    const state = createState(0, 0);
    const actor = state.actors.actor;
    if (!actor) throw new Error("test actor missing");
    const supportY = actor.position.y;
    let maximumY = supportY;

    new MovementSystem().processCommand(state, actor.id, { ...createIdleCommand(), jump: true }, 1 / 30);
    for (let tick = 0; tick < 90; tick += 1) {
      new MovementSystem().processCommand(state, actor.id, createIdleCommand(), 1 / 30);
      maximumY = Math.max(maximumY, actor.position.y);
    }

    expect(maximumY - supportY).toBeCloseTo(1.7, 2);
    expect(actor.position.y).toBeCloseTo(supportY, 5);
    expect(actor.velocity.y).toBe(0);
  });

  it("walks through every internal ramp onto a multi-story roof", () => {
    const layout = createMapLayout(0);
    const building = layout.obstacles.find((entry) => entry.storyCount === 3);
    if (!building) throw new Error("three-story building missing");
    const ramps = layout.roofRamps
      .filter((ramp) => ramp.obstacleId === building.id)
      .sort((left, right) => left.fromLevel - right.fromLevel);
    const firstRamp = ramps[0];
    if (!firstRamp) throw new Error("internal ramp missing");
    const state = createState(firstRamp.centerX, firstRamp.startZ, firstRamp.bottomY + GROUND_HEIGHT);
    const actor = state.actors.actor;
    if (!actor) throw new Error("test actor missing");

    for (const ramp of ramps) {
      const direction = Math.sign(ramp.endZ - ramp.startZ) || 1;
      for (let tick = 0; tick < 240 && direction * (ramp.endZ - actor.position.z) > 0.08; tick += 1) {
        new MovementSystem().processCommand(state, actor.id, movingCommand(0, direction), 1 / 60);
      }
      new MovementSystem().processCommand(state, actor.id, createIdleCommand(), 1 / 60);
      expect(actor.position.y, ramp.id).toBeCloseTo(
        getSupportHeight(actor.position.x, actor.position.z, actor.position.y - GROUND_HEIGHT + 0.35, layout) + GROUND_HEIGHT,
        1,
      );
      expect(actor.position.y, ramp.id).toBeGreaterThanOrEqual(ramp.topY + GROUND_HEIGHT - 0.2);
    }

    const horizontalDirection = Math.sign(building.center.x - actor.position.x) || 1;
    advance(state, movingCommand(horizontalDirection, 0), 45, 1 / 60);
    expect(actor.position.y).toBeCloseTo(
      building.baseY + building.storyHeight * building.storyCount + BUILDING_ROOF_CAP_HEIGHT + GROUND_HEIGHT,
      1,
    );
  });
});

describe("GridNavigator", () => {
  it("adds waypoints when a building blocks the direct path", () => {
    const footprint = { id: "test-building", center: { x: 0, y: 2, z: 0 }, width: 14, height: 4, depth: 12, color: "#fff" };
    const wall = { ...footprint, id: "test-wall", obstacleId: footprint.id, width: 0.35, depth: 12 };
    const start = { x: wall.center.x - wall.width / 2 - 5, y: GROUND_HEIGHT, z: wall.center.z };
    const target = { x: wall.center.x + wall.width / 2 + 5, y: GROUND_HEIGHT, z: wall.center.z };

    const path = new GridNavigator([footprint], [], [wall]).findPath(start, target);

    expect(path[0]).toEqual(start);
    expect(path.at(-1)).toEqual(target);
    expect(path.length).toBeGreaterThan(2);
    expect(path.slice(1, -1).some((point) => Math.abs(point.z - wall.center.z) > wall.depth / 2)).toBe(true);
    expect(path.slice(1, -1).every((point) =>
      Math.abs(point.x - wall.center.x) >= wall.width / 2 + 0.54 ||
      Math.abs(point.z - wall.center.z) >= wall.depth / 2 + 0.54
    )).toBe(true);
  });

  it("routes around several wall segments without limiting the path to two turns", () => {
    const walls = [
      { id: "wall-1", center: { x: -6, y: 2, z: -8 }, width: 0.35, height: 4, depth: 24, color: "#fff" },
      { id: "wall-2", center: { x: 0, y: 2, z: 8 }, width: 0.35, height: 4, depth: 24, color: "#fff" },
      { id: "wall-3", center: { x: 6, y: 2, z: -8 }, width: 0.35, height: 4, depth: 24, color: "#fff" },
    ];
    const start = { x: -12, y: GROUND_HEIGHT, z: 0 };
    const target = { x: 12, y: GROUND_HEIGHT, z: 0 };

    const path = new GridNavigator([], [], walls).findPath(start, target);

    expect(path[0]).toEqual(start);
    expect(path.at(-1)).toEqual(target);
    expect(path.length).toBeGreaterThan(4);
  });

  it("routes around authoritative rock cover", () => {
    const rock = { id: "cover-rock", center: { x: 0, y: 2, z: 0 }, width: 8, height: 4, depth: 7, color: "#666" };
    const start = { x: -10, y: GROUND_HEIGHT, z: 0 };
    const target = { x: 10, y: GROUND_HEIGHT, z: 0 };

    const path = new GridNavigator([], [], [rock]).findPath(start, target);

    expect(path[0]).toEqual(start);
    expect(path.at(-1)).toEqual(target);
    expect(path.length).toBeGreaterThan(2);
  });

  it("routes rooftop actors down the matching ramp", () => {
    const layout = createMapLayout(0);
    const ramp = layout.roofRamps.find((entry) => entry.kind === "exterior");
    const obstacle = layout.obstacles.find((entry) => entry.id === ramp?.obstacleId);
    if (!obstacle || !ramp) throw new Error("test rooftop missing");
    const start = {
      x: obstacle.center.x,
      y: obstacle.center.y + obstacle.height / 2 + BUILDING_ROOF_CAP_HEIGHT + GROUND_HEIGHT,
      z: obstacle.center.z,
    };
    const target = { x: ramp.centerX, y: getTerrainHeight(ramp.centerX, ramp.startZ, layout), z: ramp.startZ - 8 };

    const path = new GridNavigator(layout).findPath(start, target);

    expect(path.length).toBeGreaterThanOrEqual(4);
    expect(path.some((point) => point.x === ramp.centerX && point.z === ramp.endZ)).toBe(true);
    expect(path.some((point) => point.x === ramp.centerX && point.z === ramp.startZ)).toBe(true);
    expect(path.at(-1)).toEqual({ ...target, y: getTerrainHeight(target.x, target.z, layout) + GROUND_HEIGHT });
  });
});

function createState(x: number, z: number, y = GROUND_HEIGHT): MatchState {
  const groundY = getTerrainHeight(x, z, 0) + GROUND_HEIGHT;
  const actor = createActorState("actor", "player", { x, y: y === GROUND_HEIGHT ? groundY : y, z });
  return {
    mapSeed: 0,
    phase: "combat",
    elapsedSeconds: 0,
    actors: { actor },
    groundLoot: {},
    safeZone: {
      center: { x: 0, y: 0, z: 0 },
      radius: MAP_HALF_SIZE,
      startCenter: { x: 0, y: 0, z: 0 },
      startRadius: MAP_HALF_SIZE,
      targetCenter: { x: 0, y: 0, z: 0 },
      targetRadius: MAP_HALF_SIZE,
      stageIndex: 0,
      status: "waiting",
      secondsRemaining: 0,
      damagePerSecond: 0,
    },
    flight: {
      start: { x: -MAP_HALF_SIZE, y: 100, z: 0 },
      end: { x: MAP_HALF_SIZE, y: 100, z: 0 },
      durationSeconds: 1,
      progress: 0,
    },
    result: null,
  };
}

function movingCommand(x: number, z: number, sprint = false): ActorCommand {
  return { ...createIdleCommand(), move: { x, y: 0, z }, sprint };
}

function advance(state: MatchState, command: ActorCommand, steps: number, deltaSeconds: number): void {
  const movement = new MovementSystem();
  for (let step = 0; step < steps; step += 1) {
    movement.processCommand(state, "actor", command, deltaSeconds);
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
