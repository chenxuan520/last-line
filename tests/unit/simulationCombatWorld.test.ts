import { describe, expect, it } from "vitest";
import {
  BUILDING_ROOF_CAP_HEIGHT,
  createMapLayout,
  getRampHeight,
  getTerrainHeight,
  MAP_HALF_SIZE,
  MAP_OBSTACLES,
} from "../../src/config/map";
import { createActorState, type MatchState, type Vector3State } from "../../src/game/state/types";
import type { ShotTrace } from "../../src/game/systems/CombatSystem";
import { SimulationCombatWorld } from "../../src/game/systems/SimulationCombatWorld";

describe("SimulationCombatWorld", () => {
  it("hits the nearest living actor inside the fixed simulation hit volume", () => {
    const shooter = createActorState("shooter", "player", { x: 0, y: 1.76, z: 0 });
    const target = createActorState("target", "bot", { x: 0, y: 1.76, z: 10 });
    const farTarget = createActorState("far-target", "bot", { x: 0, y: 1.76, z: 20 });
    const state = createState(shooter, target, farTarget);
    const world = new SimulationCombatWorld(state);

    expect(world.traceShot(trace(shooter.position, subtract(target.position, shooter.position)))).toBe("target");
    const actorHit = world.traceShotDetailed(trace(
      { ...shooter.position, y: shooter.position.y - 0.56 },
      subtract({ ...target.position, y: target.position.y - 0.56 }, { ...shooter.position, y: shooter.position.y - 0.56 }),
    ));
    expect(actorHit.hitType).toBe("actor");
    expect(actorHit.normal.y).toBeCloseTo(0);
    expect(actorHit.normal.z).toBeLessThan(-0.99);
    expect(world.hasLineOfSight("shooter", "target")).toBe(true);
    expect(world.traceShot(trace({ ...shooter.position, y: shooter.position.y + 3 }, { x: 0, y: 0, z: 1 }))).toBeNull();
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
    const hit = world.traceShotDetailed(trace(shooter.position, subtract(target.position, shooter.position)));
    expect(hit).toMatchObject({ targetId: null, hitType: "environment" });
    expect(Math.hypot(hit.normal.x, hit.normal.y, hit.normal.z)).toBeCloseTo(1);
    expect(world.hasLineOfSight("shooter", "target")).toBe(false);
  });

  it("hits the visible top of building roof caps", () => {
    const obstacle = MAP_OBSTACLES[0];
    if (!obstacle) throw new Error("test obstacle missing");
    const roofY = obstacle.center.y + obstacle.height / 2 + BUILDING_ROOF_CAP_HEIGHT;
    const shooter = createActorState("shooter", "player", {
      x: obstacle.center.x,
      y: roofY + 5,
      z: obstacle.center.z,
    });
    const state = createState(shooter);
    shooter.position.y = roofY + 5;
    const world = new SimulationCombatWorld(state);

    const hit = world.traceShotDetailed(trace(shooter.position, { x: 0, y: -1, z: 0 }));

    expect(hit).toMatchObject({ targetId: null, hitType: "environment" });
    expect(hit.point.y).toBeCloseTo(roofY, 5);
    expect(hit.normal).toEqual({ x: 0, y: 1, z: 0 });
  });

  it("returns authoritative ground impact positions and normals", () => {
    const shooter = createActorState("shooter", "player", { x: 0, y: 1.76, z: 0 });
    const state = createState(shooter);
    const world = new SimulationCombatWorld(state);

    const hit = world.traceShotDetailed(trace(shooter.position, { x: 0, y: -1, z: 2 }));

    expect(hit.hitType).toBe("environment");
    expect(hit.targetId).toBeNull();
    expect(hit.point.y).toBeCloseTo(getTerrainHeight(hit.point.x, hit.point.z, state.mapSeed), 2);
    expect(hit.normal.y).toBeGreaterThan(0.9);
  });

  it("blocks shots with roof ramps", () => {
    const ramp = createMapLayout(0).roofRamps[0];
    if (!ramp) throw new Error("test ramp missing");
    const z = (ramp.startZ + ramp.endZ) / 2;
    const surfaceY = getRampHeight(ramp, ramp.centerX, z);
    if (surfaceY === null) throw new Error("test ramp surface missing");
    const shooter = createActorState("shooter", "player", { x: ramp.centerX, y: surfaceY + 5, z });
    const state = createState(shooter);
    shooter.position.y = surfaceY + 5;
    const world = new SimulationCombatWorld(state);

    const hit = world.traceShotDetailed(trace(shooter.position, { x: 0, y: -1, z: 0 }));

    expect(hit).toMatchObject({ targetId: null, hitType: "environment" });
    expect(hit.point.y).toBeCloseTo(surfaceY, 5);
    expect(Math.abs(hit.normal.z)).toBeGreaterThan(0.1);
  });

  it("does not create invisible terrain impacts outside the island", () => {
    const shooter = createActorState("shooter", "player", { x: MAP_HALF_SIZE + 20, y: 5, z: 0 });
    const world = new SimulationCombatWorld(createState(shooter));

    const hit = world.traceShotDetailed(trace(shooter.position, { x: 0, y: -1, z: 0 }));

    expect(hit).toMatchObject({ targetId: null, hitType: "miss" });
  });

  it("returns the configured end point for a miss", () => {
    const shooter = createActorState("shooter", "player", { x: 0, y: 1.76, z: 0 });
    const world = new SimulationCombatWorld(createState(shooter));

    const hit = world.traceShotDetailed({
      shooterId: "shooter",
      origin: shooter.position,
      direction: { x: 0, y: 1, z: 0 },
      range: 25,
    });

    expect(hit).toMatchObject({ hitType: "miss", targetId: null });
    expect(hit.point).toEqual({ x: shooter.position.x, y: shooter.position.y + 25, z: shooter.position.z });
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
  for (const actor of actors) {
    actor.position.y = getTerrainHeight(actor.position.x, actor.position.z, 0) + 1.76;
  }
  return {
    mapSeed: 0,
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
