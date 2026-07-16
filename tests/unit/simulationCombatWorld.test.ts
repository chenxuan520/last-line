import { describe, expect, it } from "vitest";
import { MAP_OBSTACLES } from "../../src/config/map";
import { createActorState, type MatchState, type Vector3State } from "../../src/game/state/types";
import type { ShotTrace } from "../../src/game/systems/CombatSystem";
import { SimulationCombatWorld } from "../../src/game/systems/SimulationCombatWorld";

describe("SimulationCombatWorld", () => {
  it("hits the nearest living actor inside the fixed simulation hit volume", () => {
    const state = createState(
      createActorState("shooter", "player", { x: 0, y: 1.76, z: 0 }),
      createActorState("target", "bot", { x: 0, y: 1.76, z: 10 }),
      createActorState("far-target", "bot", { x: 0, y: 1.76, z: 20 }),
    );
    const world = new SimulationCombatWorld(state);

    expect(world.traceShot(trace({ x: 0, y: 1.76, z: 0 }, { x: 0, y: 0, z: 4 }))).toBe("target");
    expect(world.hasLineOfSight("shooter", "target")).toBe(true);
    expect(world.traceShot(trace({ x: 0, y: 3, z: 0 }, { x: 0, y: 0, z: 1 }))).toBeNull();
  });

  it("blocks shots and line of sight with static map buildings", () => {
    const obstacle = MAP_OBSTACLES[0];
    if (!obstacle) throw new Error("test obstacle missing");
    const shooter = createActorState("shooter", "player", {
      x: obstacle.center.x - obstacle.width / 2 - 5,
      y: 1.76,
      z: obstacle.center.z,
    });
    const target = createActorState("target", "bot", {
      x: obstacle.center.x + obstacle.width / 2 + 5,
      y: 1.76,
      z: obstacle.center.z,
    });
    const world = new SimulationCombatWorld(createState(shooter, target));

    expect(world.traceShot(trace(shooter.position, subtract(target.position, shooter.position)))).toBeNull();
    expect(world.hasLineOfSight("shooter", "target")).toBe(false);
  });

  it("reads current MatchState consistently across different update batching", () => {
    const shooter = createActorState("shooter", "player", { x: 0, y: 1.76, z: 0 });
    const target = createActorState("target", "bot", { x: 0, y: 1.76, z: 10 });
    const state = createState(shooter, target);
    const reusedWorld = new SimulationCombatWorld(state);
    const shot = trace(shooter.position, { x: 0, y: 0, z: 1 });

    expect(reusedWorld.traceShot(shot)).toBe("target");
    target.position.x = 2;

    expect(reusedWorld.traceShot(shot)).toBeNull();
    expect(reusedWorld.traceShot(shot)).toBe(new SimulationCombatWorld(state).traceShot(shot));
  });
});

function createState(...actors: ReturnType<typeof createActorState>[]): MatchState {
  return {
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

function trace(origin: Vector3State, direction: Vector3State): ShotTrace {
  return { shooterId: "shooter", origin, direction, range: 100 };
}

function subtract(left: Vector3State, right: Vector3State): Vector3State {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}
