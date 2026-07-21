import { describe, expect, it } from "vitest";
import {
  createMapLayout,
  getRampHeight,
  getTerrainHeight,
  MAP_HALF_SIZE,
  MAP_ROCK_OBSTACLES,
  MAP_WALL_SEGMENTS,
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

  it("ignores aircraft occupants but allows shots to hit parachuting actors", () => {
    const shooter = createActorState("shooter", "player", { x: 0, y: 1.76, z: 0 });
    const target = createActorState("target", "bot", { x: 0, y: 1.76, z: 10 });
    const farTarget = createActorState("far-target", "bot", { x: 0, y: 1.76, z: 20 });
    const state = createState(shooter, target, farTarget);
    const world = new SimulationCombatWorld(state);
    target.deployment = "aircraft";

    expect(world.traceShot(trace(shooter.position, subtract(farTarget.position, shooter.position)))).toBe("far-target");

    target.deployment = "parachuting";
    expect(world.traceShot(trace(shooter.position, subtract(target.position, shooter.position)))).toBe("target");
  });

  it("blocks shots and line of sight with static map buildings", () => {
    const obstacle = MAP_WALL_SEGMENTS[0];
    if (!obstacle) throw new Error("test wall missing");
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

  it("blocks shots and line of sight with authoritative cover rocks", () => {
    const rock = MAP_ROCK_OBSTACLES[0];
    if (!rock) throw new Error("test cover rock missing");
    const shooter = createActorState("shooter", "player", {
      x: rock.center.x - rock.width / 2 - 5,
      y: rock.center.y,
      z: rock.center.z,
    });
    const target = createActorState("target", "bot", {
      x: rock.center.x + rock.width / 2 + 5,
      y: rock.center.y,
      z: rock.center.z,
    });
    const state = createState(shooter, target);
    shooter.position.y = rock.center.y;
    target.position.y = rock.center.y;
    const world = new SimulationCombatWorld(state);

    const hit = world.traceShotDetailed(trace(shooter.position, subtract(target.position, shooter.position)));
    expect(hit).toMatchObject({ targetId: null, hitType: "environment" });
    expect(world.hasLineOfSight("shooter", "target")).toBe(false);
  });

  it("blocks shots and line of sight with generated fence and hay cover", () => {
    const layout = createMapLayout(0);
    for (const kind of ["fence", "hay"] as const) {
      const cover = layout.coverObstacles.find((entry) => entry.kind === kind);
      if (!cover) throw new Error(`${kind} cover missing`);
      const horizontal = cover.width >= cover.depth;
      const shooter = createActorState("shooter", "player", {
        x: cover.center.x - (horizontal ? cover.width / 2 + 5 : 0),
        y: cover.center.y,
        z: cover.center.z - (horizontal ? 0 : cover.depth / 2 + 5),
      });
      const target = createActorState("target", "bot", {
        x: cover.center.x + (horizontal ? cover.width / 2 + 5 : 0),
        y: cover.center.y,
        z: cover.center.z + (horizontal ? 0 : cover.depth / 2 + 5),
      });
      const state = createState(shooter, target);
      shooter.position.y = cover.center.y;
      target.position.y = cover.center.y;
      const world = new SimulationCombatWorld(state);
      expect(world.traceShotDetailed(trace(shooter.position, subtract(target.position, shooter.position))))
        .toMatchObject({ targetId: null, hitType: "environment" });
      expect(world.hasLineOfSight(shooter.id, target.id)).toBe(false);
    }
  });

  it("hits the visible top of building roof caps", () => {
    const layout = createMapLayout(0);
    const obstacle = layout.obstacles.find((entry) => entry.storyCount === 1);
    if (!obstacle) throw new Error("test obstacle missing");
    const roof = layout.floorSlabs.find((slab) => slab.obstacleId === obstacle.id && slab.kind === "roof");
    if (!roof) throw new Error("test roof missing");
    const roofY = roof.center.y + roof.height / 2;
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
    const ramp = createMapLayout(0).roofRamps.find((entry) => entry.kind === "exterior");
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

  it("blocks shots with upper floors while leaving stairwell openings clear", () => {
    const layout = createMapLayout(0);
    const building = layout.obstacles.find((entry) => entry.storyCount === 3);
    const stairwell = building?.stairwell;
    const slab = layout.floorSlabs.find((entry) => entry.obstacleId === building?.id && entry.level === 1);
    if (!building || !stairwell || !slab) throw new Error("multi-story geometry missing");
    const slabTop = slab.center.y + slab.height / 2;
    const slabShooter = createActorState("shooter", "player", { x: slab.center.x, y: slabTop + 2, z: slab.center.z });
    const slabState = createState(slabShooter);
    slabShooter.position = { x: slab.center.x, y: slabTop + 2, z: slab.center.z };

    const slabHit = new SimulationCombatWorld(slabState).traceShotDetailed(
      trace(slabShooter.position, { x: 0, y: -1, z: 0 }),
    );

    expect(slabHit.point.y).toBeCloseTo(slabTop, 5);
    const openingX = stairwell.centerX + stairwell.width / 2 - 0.15;
    const roofY = building.baseY + building.storyHeight * building.storyCount + 0.18;
    const openingShooter = createActorState("shooter", "player", { x: openingX, y: roofY + 5, z: stairwell.centerZ });
    const openingState = createState(openingShooter);
    openingShooter.position = { x: openingX, y: roofY + 5, z: stairwell.centerZ };
    const openingHit = new SimulationCombatWorld(openingState).traceShotDetailed(
      trace(openingShooter.position, { x: 0, y: -1, z: 0 }),
    );
    expect(openingHit.point.y).toBeCloseTo(getTerrainHeight(openingX, stairwell.centerZ, layout), 2);
  });

  it("allows line of sight through upper-story windows and blocks the adjacent wall", () => {
    const layout = createMapLayout(0);
    const opening = layout.wallOpenings.find((entry) => entry.side === "front" && entry.storyIndex === 1);
    const building = layout.obstacles.find((entry) => entry.id === opening?.obstacleId);
    if (!opening || !building) throw new Error("upper window missing");
    const outsideZ = building.center.z - building.depth / 2 - 4;
    const insideZ = building.center.z - building.depth / 2 + 3;
    const shooter = createActorState("shooter", "player", { x: opening.center.x, y: opening.center.y, z: outsideZ });
    const target = createActorState("target", "bot", { x: opening.center.x, y: opening.center.y, z: insideZ });
    const state = createState(shooter, target);
    shooter.position = { x: opening.center.x, y: opening.center.y, z: outsideZ };
    target.position = { x: opening.center.x, y: opening.center.y, z: insideZ };
    expect(new SimulationCombatWorld(state).hasLineOfSight(shooter.id, target.id)).toBe(true);

    const blockedX = opening.center.x + opening.width / 2 + 0.6;
    shooter.position.x = blockedX;
    target.position.x = blockedX;
    expect(new SimulationCombatWorld(state).hasLineOfSight(shooter.id, target.id)).toBe(false);
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
    const shot = trace(shooter.position, {
      x: target.position.x - shooter.position.x,
      y: target.position.y - shooter.position.y,
      z: target.position.z - shooter.position.z,
    });

    expect(reusedWorld.traceShot(shot)).toBe("target");
    target.position.x = 2;

    expect(reusedWorld.traceShot(shot)).toBeNull();
    expect(reusedWorld.traceShot(shot)).toBe(new SimulationCombatWorld(state).traceShot(shot));
  });

  it("keeps indexed dense-combat rays identical to the complete geometry scan", () => {
    const shooter = createActorState("shooter", "player", { x: 0, y: 1.76, z: 0 });
    const targets = Array.from({ length: 20 }, (_, index) => createActorState(
      `target-${index}`,
      "bot",
      {
        x: Math.sin(index * 2.13) * (40 + index * 5),
        y: 1.76,
        z: Math.cos(index * 1.71) * (35 + index * 6),
      },
    ));
    const state = createState(shooter, ...targets);
    const indexed = new SimulationCombatWorld(state);
    const completeScan = new SimulationCombatWorld(state, false);

    for (let index = 0; index < 240; index += 1) {
      const x = Math.sin(index * 1.93) * (100 + index % 17 * 54);
      const z = Math.cos(index * 2.27) * (120 + index % 13 * 63);
      const origin = {
        x,
        y: getTerrainHeight(x, z, state.mapSeed) + 1.76 + index % 4 * 1.8,
        z,
      };
      const ray: ShotTrace = {
        shooterId: shooter.id,
        origin,
        direction: {
          x: Math.sin(index * 0.73),
          y: (index % 9 - 4) * 0.035,
          z: Math.cos(index * 0.73),
        },
        range: 40 + index % 7 * 80,
      };

      expect(indexed.traceShotDetailed(ray)).toEqual(completeScan.traceShotDetailed(ray));
    }
  });

  it("keeps every indexed roof-ramp trace identical to the complete geometry scan", () => {
    const layout = createMapLayout(0);
    const shooter = createActorState("shooter", "player", { x: 0, y: 1.76, z: 0 });
    const state = createState(shooter);
    const indexed = new SimulationCombatWorld(state);
    const completeScan = new SimulationCombatWorld(state, false);

    for (const ramp of layout.roofRamps) {
      const z = (ramp.startZ + ramp.endZ) / 2;
      const surfaceY = getRampHeight(ramp, ramp.centerX, z);
      if (surfaceY === null) throw new Error(`ramp surface missing: ${ramp.id}`);
      const ray: ShotTrace = {
        shooterId: shooter.id,
        origin: { x: ramp.centerX, y: surfaceY + 5, z },
        direction: { x: 0, y: -1, z: 0 },
        range: 10,
      };
      expect(indexed.traceShotDetailed(ray), ramp.id).toEqual(completeScan.traceShotDetailed(ray));
    }
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
