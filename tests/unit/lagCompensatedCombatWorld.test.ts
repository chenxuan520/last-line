import { describe, expect, it } from "vitest";
import { getTerrainHeight, MAP_WALL_SEGMENTS } from "../../src/config/map";
import { createActorState, type MatchState } from "../../src/game/state/types";
import type { ShotTrace } from "../../src/game/systems/CombatSystem";
import { SimulationCombatWorld } from "../../src/game/systems/SimulationCombatWorld";
import {
  LagCompensatedCombatWorld,
  MAX_LAG_COMPENSATION_TICKS,
  boundClientRenderTick,
} from "../../src/server/LagCompensatedCombatWorld";

describe("LagCompensatedCombatWorld", () => {
  it("hits historical actor capsules only inside the bounded rewind window", () => {
    const shooter = createActorState("shooter", "player", { x: 0, y: 1.76, z: 0 });
    const target = createActorState("target", "player", { x: 0, y: 1.76, z: 10 });
    const state = createState(shooter, target);
    const world = new LagCompensatedCombatWorld(state, new SimulationCombatWorld(state));
    const historicalTick = 10;
    const historicalDirection = subtract(target.position, shooter.position);
    world.recordFrame(historicalTick);

    target.position.x = 5;
    for (let tick = historicalTick + 1; tick <= historicalTick + MAX_LAG_COMPENSATION_TICKS + 1; tick += 1) {
      world.recordFrame(tick);
    }

    world.beginStep(
      historicalTick + MAX_LAG_COMPENSATION_TICKS,
      new Map([[shooter.id, historicalTick]]),
    );
    expect(world.traceShot(createTrace(shooter, historicalDirection))).toBe(target.id);

    world.beginStep(
      historicalTick + MAX_LAG_COMPENSATION_TICKS + 1,
      new Map([[shooter.id, historicalTick]]),
    );
    expect(world.traceShot(createTrace(shooter, historicalDirection))).toBeNull();
  });

  it("uses the current world when no trusted render tick is available", () => {
    const shooter = createActorState("shooter", "player", { x: 0, y: 1.76, z: 0 });
    const target = createActorState("target", "player", { x: 0, y: 1.76, z: 10 });
    const state = createState(shooter, target);
    const world = new LagCompensatedCombatWorld(state, new SimulationCombatWorld(state));
    const historicalDirection = subtract(target.position, shooter.position);
    world.recordFrame(1);
    target.position.x = 5;

    world.beginStep(2, new Map());

    expect(world.traceShot(createTrace(shooter, historicalDirection))).toBeNull();
  });

  it("keeps current authoritative map obstruction during historical actor queries", () => {
    const wall = MAP_WALL_SEGMENTS[0];
    if (!wall) throw new Error("test wall missing");
    const shooter = createActorState("shooter", "player", {
      x: wall.center.x - wall.width / 2 - 5,
      y: 1.76,
      z: wall.center.z,
    });
    const target = createActorState("target", "player", {
      x: wall.center.x + wall.width / 2 + 5,
      y: 1.76,
      z: wall.center.z,
    });
    const state = createState(shooter, target);
    const world = new LagCompensatedCombatWorld(state, new SimulationCombatWorld(state));
    const direction = subtract(target.position, shooter.position);
    world.recordFrame(1);
    world.beginStep(1, new Map([[shooter.id, 1]]));

    expect(world.traceShotDetailed(createTrace(shooter, direction))).toMatchObject({
      targetId: null,
      hitType: "environment",
    });
  });

  it("bounds render ticks to sent and monotonic connection history", () => {
    expect(boundClientRenderTick(12, 10, 8)).toBe(10);
    expect(boundClientRenderTick(5, 10, 8)).toBe(8);
    expect(boundClientRenderTick(9, undefined, 8)).toBeUndefined();
    expect(boundClientRenderTick(undefined, 10, 8)).toBeUndefined();
  });
});

function createTrace(
  shooter: ReturnType<typeof createActorState>,
  direction: ReturnType<typeof subtract>,
): ShotTrace {
  return {
    shooterId: shooter.id,
    origin: { ...shooter.position },
    direction,
    range: 100,
  };
}

function subtract(
  left: ReturnType<typeof createActorState>["position"],
  right: ReturnType<typeof createActorState>["position"],
) {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

function createState(...actors: ReturnType<typeof createActorState>[]): MatchState {
  for (const actor of actors) {
    actor.position.y = getTerrainHeight(actor.position.x, actor.position.z, 0) + 1.76;
  }
  return {
    phase: "combat",
    elapsedSeconds: 0,
    mapSeed: 0,
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
      secondsRemaining: 100,
      damagePerSecond: 0,
    },
    flight: {
      start: { x: 0, y: 0, z: 0 },
      end: { x: 0, y: 0, z: 0 },
      durationSeconds: 1,
      progress: 1,
    },
    result: null,
  };
}
