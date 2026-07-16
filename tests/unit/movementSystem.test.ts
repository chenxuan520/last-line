import { describe, expect, it } from "vitest";
import { GridNavigator } from "../../src/ai/navigation/GridNavigator";
import { MAP_HALF_SIZE, MAP_OBSTACLES } from "../../src/config/map";
import { createIdleCommand, type ActorCommand } from "../../src/game/commands/ActorCommand";
import { createActorState, type MatchState } from "../../src/game/state/types";
import { MovementSystem } from "../../src/game/systems/MovementSystem";

const GROUND_HEIGHT = 1.76;
const ACTOR_RADIUS = 0.42;

describe("MovementSystem", () => {
  it("moves the same distance at different frame rates", () => {
    const slowFrames = createState(0, 0);
    const fastFrames = createState(0, 0);
    const command = movingCommand(1, 0);

    advance(slowFrames, command, 20, 1 / 20);
    advance(fastFrames, command, 60, 1 / 60);

    expect(slowFrames.actors.actor?.position.x).toBeCloseTo(5.8, 8);
    expect(fastFrames.actors.actor?.position.x).toBeCloseTo(5.8, 8);
    expect(slowFrames.actors.actor?.position.x).toBeCloseTo(fastFrames.actors.actor?.position.x ?? 0, 8);
  });

  it("keeps actors inside the map and outside buildings", () => {
    const boundaryState = createState(MAP_HALF_SIZE - 1, 0);
    advance(boundaryState, movingCommand(1, 0, true), 30, 1 / 30);
    expect(boundaryState.actors.actor?.position.x).toBeLessThanOrEqual(MAP_HALF_SIZE - ACTOR_RADIUS);

    const obstacle = MAP_OBSTACLES[0];
    if (!obstacle) {
      throw new Error("test obstacle missing");
    }
    const obstacleState = createState(obstacle.center.x - obstacle.width / 2 - ACTOR_RADIUS - 1, obstacle.center.z);
    advance(obstacleState, movingCommand(1, 0, true), 60, 1 / 60);

    const actor = obstacleState.actors.actor;
    expect(actor).toBeDefined();
    if (actor) {
      const closestX = clamp(
        actor.position.x,
        obstacle.center.x - obstacle.width / 2,
        obstacle.center.x + obstacle.width / 2,
      );
      const closestZ = clamp(
        actor.position.z,
        obstacle.center.z - obstacle.depth / 2,
        obstacle.center.z + obstacle.depth / 2,
      );
      expect(Math.hypot(actor.position.x - closestX, actor.position.z - closestZ)).toBeGreaterThanOrEqual(
        ACTOR_RADIUS - 0.001,
      );
    }
  });

  it("enters a parachute from the aircraft and lands automatically", () => {
    const state = createState(0, 0, 20);
    const actor = state.actors.actor;
    if (!actor) {
      throw new Error("test actor missing");
    }
    actor.deployment = "aircraft";

    new MovementSystem().processCommand(state, actor.id, { ...movingCommand(1, 0), jump: true }, 1 / 60);
    expect(actor.deployment).toBe("parachuting");
    expect(actor.position.x).toBeGreaterThan(0);

    advance(state, createIdleCommand(), 300, 1 / 60);
    expect(actor.deployment).toBe("grounded");
    expect(actor.position.y).toBe(GROUND_HEIGHT);
    expect(actor.velocity.y).toBe(0);
  });
});

describe("GridNavigator", () => {
  it("adds waypoints when a building blocks the direct path", () => {
    const obstacle = MAP_OBSTACLES[0];
    if (!obstacle) {
      throw new Error("test obstacle missing");
    }
    const start = { x: obstacle.center.x - obstacle.width / 2 - 5, y: GROUND_HEIGHT, z: obstacle.center.z };
    const target = { x: obstacle.center.x + obstacle.width / 2 + 5, y: GROUND_HEIGHT, z: obstacle.center.z };

    const path = new GridNavigator().findPath(start, target);

    expect(path[0]).toEqual(start);
    expect(path.at(-1)).toEqual(target);
    expect(path.length).toBeGreaterThan(2);
    expect(path.slice(1, -1).some((point) => Math.abs(point.z - obstacle.center.z) > obstacle.depth / 2)).toBe(true);
  });
});

function createState(x: number, z: number, y = GROUND_HEIGHT): MatchState {
  const actor = createActorState("actor", "player", { x, y, z });
  return {
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
