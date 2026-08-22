import { describe, expect, it } from "vitest";
import { FRAG_GRENADE_CONFIG, FRAG_GRENADE_ITEM_ID } from "../../src/config/throwables";
import { createIdleCommand } from "../../src/game/commands/ActorCommand";
import {
  createActorState,
  type ActiveGrenadeState,
  type ActorState,
  type GameEvent,
  type MatchState,
  type Vector3State,
} from "../../src/game/state/types";
import { ACTOR_HEIGHT, ACTOR_RADIUS } from "../../src/game/rules/actorGeometry";
import type { CombatWorld } from "../../src/game/systems/CombatSystem";
import {
  closestActorCapsulePoint,
  grenadeDamage,
  sampleGrenadeTrajectory,
  ThrowableSystem,
} from "../../src/game/systems/ThrowableSystem";

describe("ThrowableSystem", () => {
  it("uses a 2.5-second authoritative frag grenade fuse", () => {
    expect(FRAG_GRENADE_CONFIG.fuseSeconds).toBe(2.5);
  });

  it("consumes one backpack grenade and creates one serializable authoritative projectile", () => {
    const state = createState(["player"]);
    const player = state.actors.player;
    if (!player) throw new Error("player missing");
    player.inventory.backpack = [{ itemId: FRAG_GRENADE_ITEM_ID, quantity: 2 }];
    const events: GameEvent[] = [];

    new ThrowableSystem().processCommands(
      state,
      new Map([[
        player.id,
        { ...createIdleCommand(), aimDirection: { x: 0, y: 0, z: 1 }, throwGrenade: "high" },
      ]]),
      events,
    );

    expect(player.inventory.backpack).toEqual([{ itemId: FRAG_GRENADE_ITEM_ID, quantity: 1 }]);
    expect(state.nextGrenadeSequence).toBe(2);
    expect(state.activeGrenades["grenade-1"]).toMatchObject({
      id: "grenade-1",
      ownerId: player.id,
      fuseSeconds: FRAG_GRENADE_CONFIG.fuseSeconds,
      velocity: expect.objectContaining({ z: FRAG_GRENADE_CONFIG.highThrowSpeed }),
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: "grenade-thrown",
      actorId: player.id,
      grenadeId: "grenade-1",
    }));
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it("explodes at the configured 2.5-second authoritative fuse boundary", () => {
    const state = createState(["player", "survivor"]);
    const player = state.actors.player;
    const survivor = state.actors.survivor;
    if (!player || !survivor) throw new Error("fuse fixture actors missing");
    player.inventory.backpack = [{ itemId: FRAG_GRENADE_ITEM_ID, quantity: 1 }];
    survivor.position = { x: 100, y: 1.76, z: 0 };
    const system = new ThrowableSystem();
    const events: GameEvent[] = [];
    system.processCommands(
      state,
      new Map([[
        player.id,
        { ...createIdleCommand(), aimDirection: { x: 0, y: 0, z: 1 }, throwGrenade: "high" },
      ]]),
      events,
    );

    system.update(state, FRAG_GRENADE_CONFIG.fuseSeconds - 0.01, createWorld(), events);
    expect(state.activeGrenades["grenade-1"]?.fuseSeconds).toBeCloseTo(0.01, 6);
    expect(events.some((event) => event.type === "grenade-exploded")).toBe(false);

    system.update(state, 0.01, createWorld(), events);
    expect(state.activeGrenades).toEqual({});
    expect(events).toContainEqual(expect.objectContaining({
      type: "grenade-exploded",
      grenadeId: "grenade-1",
    }));
  });

  it("rejects a throw without inventory and does not consume duplicate one-shot commands", () => {
    const state = createState(["player"]);
    const player = state.actors.player;
    if (!player) throw new Error("player missing");
    const system = new ThrowableSystem();
    const command = { ...createIdleCommand(), throwGrenade: "low" as const };

    system.processCommands(state, new Map([[player.id, command]]), []);
    expect(state.activeGrenades).toEqual({});

    player.inventory.backpack = [{ itemId: FRAG_GRENADE_ITEM_ID, quantity: 1 }];
    system.processCommands(state, new Map([[player.id, command]]), []);
    system.processCommands(state, new Map([[player.id, createIdleCommand()]]), []);

    expect(Object.keys(state.activeGrenades)).toEqual(["grenade-1"]);
    expect(player.inventory.backpack).toEqual([]);
  });

  it("authoritatively caps simultaneous bot throws at six active grenades", () => {
    const botIds = Array.from({ length: 4 }, (_, index) => `bot-${index + 1}`);
    const state = createState(botIds);
    for (let index = 0; index < 5; index += 1) {
      state.activeGrenades[`grenade-${index + 1}`] = grenade(
        `grenade-${index + 1}`,
        botIds[0] as string,
        100 + index,
      );
    }
    state.nextGrenadeSequence = 6;
    const commands = new Map(botIds.map((botId) => {
      const actor = state.actors[botId];
      if (!actor) throw new Error("bot missing");
      actor.inventory.backpack = [{ itemId: FRAG_GRENADE_ITEM_ID, quantity: 1 }];
      return [botId, { ...createIdleCommand(), throwGrenade: "high" as const }] as const;
    }));

    new ThrowableSystem().processCommands(state, commands, []);

    expect(Object.keys(state.activeGrenades)).toHaveLength(6);
    expect(state.actors["bot-1"]?.inventory.backpack).toEqual([]);
    expect(state.actors["bot-2"]?.inventory.backpack).toEqual([
      { itemId: FRAG_GRENADE_ITEM_ID, quantity: 1 },
    ]);
  });

  it("shares the authoritative cap between Bots and player-kind takeover AI", () => {
    const actorIds = ["bot-1", "human-1", "human-2"];
    const state = createState(actorIds);
    const humanOne = state.actors["human-1"];
    const humanTwo = state.actors["human-2"];
    if (!humanOne || !humanTwo) throw new Error("takeover actors missing");
    humanOne.kind = "player";
    humanTwo.kind = "player";
    for (let index = 0; index < 5; index += 1) {
      state.activeGrenades[`grenade-${index + 1}`] = grenade(
        `grenade-${index + 1}`,
        "bot-1",
        100 + index,
      );
    }
    state.nextGrenadeSequence = 6;
    const commands = new Map(actorIds.map((actorId) => {
      const actor = state.actors[actorId];
      if (!actor) throw new Error("actor missing");
      actor.inventory.backpack = [{ itemId: FRAG_GRENADE_ITEM_ID, quantity: 1 }];
      return [actorId, { ...createIdleCommand(), throwGrenade: "high" as const }] as const;
    }));

    new ThrowableSystem().processCommands(
      state,
      commands,
      [],
      new Set(["bot-1", "human-1", "human-2"]),
    );

    expect(Object.keys(state.activeGrenades)).toHaveLength(6);
    expect(state.actors["bot-1"]?.inventory.backpack).toEqual([]);
    expect(state.actors["human-1"]?.inventory.backpack).toHaveLength(1);
    expect(state.actors["human-2"]?.inventory.backpack).toHaveLength(1);
  });

  it("uses bounded trajectory sampling with authoritative collision responses", () => {
    let collisionChecks = 0;
    const world = createWorld({
      traceThrowable(origin, displacement) {
        collisionChecks += 1;
        const nextY = origin.y + displacement.y;
        if (nextY > 0.18) return null;
        return {
          point: { x: origin.x + displacement.x, y: 0.18, z: origin.z + displacement.z },
          normal: { x: 0, y: 1, z: 0 },
        };
      },
    });

    const points = sampleGrenadeTrajectory(
      { x: 0, y: 1.5, z: 0 },
      { x: 0, y: 1, z: 8 },
      world,
    );

    expect(points.length).toBeGreaterThan(10);
    expect(points.length).toBeLessThanOrEqual(120);
    expect(collisionChecks).toBe(points.length - 1);
    expect(Math.min(...points.map((point) => point.y))).toBeGreaterThanOrEqual(0.18);
  });

  it("applies falloff damage, permits self-damage, and respects explosion occlusion", () => {
    const state = createState(["owner", "near", "far", "blocked"]);
    positionActor(state.actors.owner, 0);
    positionActor(state.actors.near, 1);
    positionActor(state.actors.far, 6);
    positionActor(state.actors.blocked, 2);
    state.activeGrenades.grenade = grenade("grenade", "owner", 0);
    const events: GameEvent[] = [];
    const blockedActor = state.actors.blocked;
    if (!blockedActor) throw new Error("blocked actor missing");
    const world = createWorld({
      hasExplosionLineOfSight(origin, target) {
        const blockedTargetPoint = closestActorCapsulePoint(origin, blockedActor);
        return vectorDistanceForTest(target, blockedTargetPoint) > 1e-6;
      },
    });

    new ThrowableSystem().update(state, 0.1, world, events);

    expect(state.activeGrenades).toEqual({});
    expect(state.actors.owner?.health).toBe(0);
    expect(state.actors.near?.health).toBe(0);
    expect(state.actors.far?.health).toBeGreaterThan(0);
    expect(state.actors.far?.health).toBeLessThan(100);
    expect(state.actors.blocked?.health).toBe(100);
    expect(state.actors.owner?.kills).toBe(1);
    expect(events[0]).toMatchObject({ type: "grenade-exploded", grenadeId: "grenade" });
  });

  it("records damage direction from the blast origin after the thrower moves away", () => {
    const state = createState(["owner", "target"]);
    positionActor(state.actors.owner, 50);
    positionActor(state.actors.target, 6);
    state.activeGrenades.grenade = grenade("grenade", "owner", 0);

    new ThrowableSystem().update(state, 0.1, createWorld(), []);

    expect(state.actors.target?.lastDamageDirection?.x).toBeLessThan(-0.9);
    expect(state.actors.target?.lastDamageElapsedSeconds).toBe(state.elapsedSeconds);
  });

  it("resolves simultaneous grenade damage independently of insertion order", () => {
    const first = simultaneousState(["grenade-a", "grenade-b"]);
    const reversed = simultaneousState(["grenade-b", "grenade-a"]);
    const world = createWorld();

    new ThrowableSystem().update(first, 0.1, world, []);
    new ThrowableSystem().update(reversed, 0.1, world, []);

    expect(actorOutcome(first)).toEqual(actorOutcome(reversed));
    expect(Object.values(first.actors).filter((actor) => actor.alive)).toHaveLength(1);
  });

  it("uses the configured ten-meter blast, three-meter full-damage, and five-meter lethal radii", () => {
    expect(FRAG_GRENADE_CONFIG).toMatchObject({
      radius: 10,
      maximumDamage: 140,
      fullDamageRadius: 3,
      visualRadius: 8,
    });
    expect(grenadeDamage(0)).toBe(FRAG_GRENADE_CONFIG.maximumDamage);
    expect(grenadeDamage(FRAG_GRENADE_CONFIG.fullDamageRadius)).toBe(
      FRAG_GRENADE_CONFIG.maximumDamage,
    );
    expect(grenadeDamage(5)).toBe(100);
    expect(grenadeDamage(5.001)).toBeLessThan(100);
    expect(grenadeDamage(FRAG_GRENADE_CONFIG.radius)).toBe(0);
  });

  it("kills an unarmored full-health actor at five authoritative meters", () => {
    const state = createState(["owner", "target", "outside"]);
    positionActor(state.actors.owner, 100);
    positionActor(state.actors.target, 5 + ACTOR_RADIUS);
    positionActor(state.actors.outside, 5 + ACTOR_RADIUS + 0.001);
    state.activeGrenades.grenade = grenade("grenade", "owner", 0);
    state.activeGrenades.grenade.position.y = ACTOR_HEIGHT - ACTOR_RADIUS;
    const target = state.actors.target;
    if (!target) throw new Error("target missing");
    expect(vectorDistanceForTest(
      state.activeGrenades.grenade.position,
      closestActorCapsulePoint(state.activeGrenades.grenade.position, target),
    )).toBe(5);
    const events: GameEvent[] = [];

    new ThrowableSystem().update(state, 0.1, createWorld(), events);

    expect(state.actors.target?.health).toBe(0);
    expect(state.actors.target?.alive).toBe(false);
    expect(events).toContainEqual({
      type: "actor-damaged",
      actorId: "target",
      sourceId: "owner",
      damage: 100,
    });
    expect(state.actors.outside?.health).toBeGreaterThan(0);
    expect(state.actors.outside?.alive).toBe(true);
  });

  it("measures ground blasts against the authoritative actor capsule", () => {
    const actor = createActorState("actor", "player", { x: 0, y: 1.76, z: 0 });
    actor.armor = 0;
    actor.maxArmor = 0;
    actor.inventory.armorLevel = 0;
    const grenadePosition = { x: 0, y: 0.18, z: 0 };
    const targetPoint = closestActorCapsulePoint(grenadePosition, actor);

    expect(vectorDistanceForTest(grenadePosition, targetPoint)).toBeLessThanOrEqual(
      FRAG_GRENADE_CONFIG.fullDamageRadius,
    );

    const state = createState(["actor", "survivor"]);
    const target = state.actors.actor;
    const survivor = state.actors.survivor;
    if (!target || !survivor) throw new Error("target state missing");
    target.position = { ...actor.position };
    survivor.position = { x: 100, y: 1.76, z: 0 };
    state.activeGrenades.grenade = {
      ...grenade("grenade", "actor", 0),
      position: grenadePosition,
    };
    const obstructionQueries: Array<{ origin: Vector3State; target: Vector3State }> = [];
    new ThrowableSystem().update(state, 0.1, createWorld({
      hasExplosionLineOfSight(origin, targetPosition) {
        obstructionQueries.push({
          origin: { ...origin },
          target: { ...targetPosition },
        });
        return true;
      },
    }), []);

    expect(target.health).toBe(0);
    const obstructionQuery = obstructionQueries[0];
    if (!obstructionQuery) throw new Error("obstruction query missing");
    expect(obstructionQuery.target).toEqual(closestActorCapsulePoint(obstructionQuery.origin, target));
  });
});

function createState(actorIds: readonly string[]): MatchState {
  const actors = Object.fromEntries(actorIds.map((id) => {
    const actor = createActorState(id, id === "owner" || id === "player" ? "player" : "bot", {
      x: 0,
      y: 1.76,
      z: 0,
    });
    actor.armor = 0;
    actor.maxArmor = 0;
    actor.inventory.armorLevel = 0;
    actor.inventory.helmetLevel = 0;
    actor.inventory.backpack = [];
    return [id, actor];
  }));
  return {
    phase: "combat",
    elapsedSeconds: 10,
    mapId: "island",
    mapSeed: 0,
    actors,
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
      start: { x: 0, y: 180, z: -1_000 },
      end: { x: 0, y: 180, z: 1_000 },
      durationSeconds: 60,
      progress: 1,
    },
    result: null,
  };
}

function createWorld(overrides: Partial<CombatWorld> = {}): CombatWorld {
  return {
    traceShot: () => null,
    traceThrowable: () => null,
    hasExplosionLineOfSight: () => true,
    ...overrides,
  };
}

function grenade(id: string, ownerId: string, x: number): ActiveGrenadeState {
  return {
    id,
    ownerId,
    aiControlled: ownerId.startsWith("bot-"),
    position: { x, y: 1.76, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    fuseSeconds: 0.01,
  };
}

function positionActor(actor: ActorState | undefined, x: number): void {
  if (!actor) throw new Error("actor missing");
  actor.position = { x, y: 1.76, z: 0 };
}

function simultaneousState(order: readonly string[]): MatchState {
  const state = createState(["a", "b"]);
  positionActor(state.actors.a, -1);
  positionActor(state.actors.b, 1);
  for (const grenadeId of order) {
    const ownerId = grenadeId === "grenade-a" ? "a" : "b";
    state.activeGrenades[grenadeId] = grenade(grenadeId, ownerId, 0);
  }
  return state;
}

function actorOutcome(state: MatchState): Record<string, { alive: boolean; health: number; kills: number }> {
  return Object.fromEntries(Object.values(state.actors).map((actor) => [
    actor.id,
    { alive: actor.alive, health: actor.health, kills: actor.kills },
  ]));
}

function vectorDistanceForTest(left: Vector3State, right: Vector3State): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}
