import { describe, expect, it } from "vitest";
import { getTerrainHeight, TOTAL_LOOT_POINTS } from "../../src/config/map";
import { createIdleCommand } from "../../src/game/commands/ActorCommand";
import { createWeaponState } from "../../src/game/state/types";
import type { SequencedGameEvent, ServerMessage } from "../../src/network/protocol";
import {
  isMatchCheckpointCompatible,
  MATCH_CHECKPOINT_VERSION,
  MatchRuntime,
} from "../../src/server/MatchRuntime";

describe("MatchRuntime", () => {
  it("creates non-default maps explicitly and restores legacy states as island", () => {
    const town = new MatchRuntime({
      humanActorIds: ["human-1", "human-2"],
      seed: 2026,
      mapId: "town",
      startWithBandage: true,
      disableAiSnipers: true,
    });
    expect(town.state.mapId).toBe("town");
    expect(town.state.mapSeed).toBeGreaterThanOrEqual(0);

    const mixed = new MatchRuntime({
      humanActorIds: ["human-1", "human-2"],
      seed: 2026,
      mapId: "mixed",
      startWithBandage: true,
      disableAiSnipers: true,
    });
    expect(mixed.state.mapId).toBe("mixed");
    const mixedCheckpoint = mixed.checkpoint();
    expect(mixedCheckpoint.version).toBe(MATCH_CHECKPOINT_VERSION);
    expect(new MatchRuntime({
      humanActorIds: ["human-1", "human-2"],
      seed: 2026,
      startWithBandage: true,
      disableAiSnipers: true,
      ...mixedCheckpoint,
    }).state).toEqual(mixedCheckpoint.state);

    const legacyState = JSON.parse(JSON.stringify(town.state)) as Record<string, unknown>;
    delete legacyState.mapId;
    const restored = new MatchRuntime({
      humanActorIds: ["human-1", "human-2"],
      seed: 2026,
      startWithBandage: true,
      disableAiSnipers: true,
      state: legacyState as unknown as MatchRuntime["state"],
    });
    expect(restored.state.mapId).toBe("island");
  }, 30_000);

  it("runs a 10-human authoritative room with 40 bots", () => {
    const humanActorIds = Array.from({ length: 10 }, (_, index) => `human-${index + 1}`);
    const runtime = new MatchRuntime({
      humanActorIds,
      seed: 2026,
      startWithBandage: true,
      disableAiSnipers: true,
    });
    expect(Object.values(runtime.state.actors).filter((actor) => actor.kind === "player")).toHaveLength(10);
    expect(Object.values(runtime.state.actors).filter((actor) => actor.kind === "bot")).toHaveLength(40);

    expect(runtime.submitInput("human-1", 1, { ...createIdleCommand(), jump: true })).toBe(true);
    runtime.step();
    expect(runtime.acknowledge("human-1")).toBe(1);
    expect(runtime.tick).toBe(1);
    expect(runtime.takeFrame(123).actors).toBe(runtime.state.actors);
  });

  it("restores checkpoints and keeps disconnected human identities", () => {
    const runtime = new MatchRuntime({
      humanActorIds: ["human-1", "human-2"],
      seed: 7,
      startWithBandage: false,
      disableAiSnipers: true,
    });
    runtime.setConnected("human-2", false);
    for (let tick = 0; tick < 151; tick += 1) runtime.step();
    expect(runtime.state.actors["human-2"]?.kind).toBe("player");
    const checkpoint = runtime.checkpoint();
    expect(checkpoint.version).toBe(MATCH_CHECKPOINT_VERSION);
    const restored = new MatchRuntime({
      humanActorIds: ["human-1", "human-2"],
      seed: 7,
      startWithBandage: false,
      disableAiSnipers: true,
      ...checkpoint,
    });
    expect(restored.tick).toBe(runtime.tick);
    expect(restored.state).toEqual(checkpoint.state);
  });

  it("accepts only current version 7 checkpoints with explicit known map identities", () => {
    const runtime = new MatchRuntime({
      humanActorIds: ["human-1", "human-2"],
      seed: 42,
      mapId: "town",
      startWithBandage: false,
      disableAiSnipers: true,
    });
    const checkpoint = runtime.checkpoint();

    expect(MATCH_CHECKPOINT_VERSION).toBe(7);
    expect(isMatchCheckpointCompatible(checkpoint)).toBe(true);
    expect(isMatchCheckpointCompatible({
      ...checkpoint,
      state: { ...checkpoint.state, mapId: "invalid" as never },
    })).toBe(false);
    expect(isMatchCheckpointCompatible({
      ...checkpoint,
      version: MATCH_CHECKPOINT_VERSION - 1,
    })).toBe(false);
    const missingMapIdState = structuredClone(checkpoint.state) as unknown as Record<string, unknown>;
    delete missingMapIdState.mapId;
    expect(isMatchCheckpointCompatible({
      ...checkpoint,
      state: missingMapIdState,
    })).toBe(false);
    const islandCheckpoint = {
      ...checkpoint,
      version: MATCH_CHECKPOINT_VERSION - 1,
      state: { ...checkpoint.state, mapId: "island" as const },
    };
    expect(isMatchCheckpointCompatible(islandCheckpoint)).toBe(false);
    const mixedCheckpoint = {
      ...checkpoint,
      version: MATCH_CHECKPOINT_VERSION - 1,
      state: { ...checkpoint.state, mapId: "mixed" as const },
    };
    expect(isMatchCheckpointCompatible(mixedCheckpoint)).toBe(false);
    expect(isMatchCheckpointCompatible({
      ...checkpoint,
      version: MATCH_CHECKPOINT_VERSION - 1,
      state: { ...checkpoint.state, mapId: "invalid" as never },
    })).toBe(false);
    expect(isMatchCheckpointCompatible({
      ...checkpoint,
      version: MATCH_CHECKPOINT_VERSION - 2,
    })).toBe(false);
    expect(isMatchCheckpointCompatible({
      ...checkpoint,
      version: MATCH_CHECKPOINT_VERSION - 1,
      state: undefined,
    } as never)).toBe(false);
    expect(isMatchCheckpointCompatible({
      ...checkpoint,
      version: MATCH_CHECKPOINT_VERSION - 1,
      state: null,
    } as never)).toBe(false);
    expect(isMatchCheckpointCompatible({
      ...checkpoint,
      version: MATCH_CHECKPOINT_VERSION - 1,
      state: { mapId: undefined },
    } as never)).toBe(false);
    expect(isMatchCheckpointCompatible({
      ...checkpoint,
      state: { ...checkpoint.state, actors: undefined },
    } as never)).toBe(false);
    expect(isMatchCheckpointCompatible({
      ...checkpoint,
      state: {
        ...checkpoint.state,
        actors: { "human-1": { id: "human-1", kind: "player" } },
      },
    } as never)).toBe(false);
    expect(isMatchCheckpointCompatible({
      ...checkpoint,
      state: { ...checkpoint.state, safeZone: { radius: 100 } },
    } as never)).toBe(false);
    expect(isMatchCheckpointCompatible({
      ...checkpoint,
      state: { ...checkpoint.state, groundLoot: {} },
    })).toBe(false);
    const missingCanonicalLoot = structuredClone(checkpoint.state.groundLoot);
    delete missingCanonicalLoot["loot-250"];
    expect(isMatchCheckpointCompatible({
      ...checkpoint,
      state: { ...checkpoint.state, groundLoot: missingCanonicalLoot },
    })).toBe(false);
    expect(isMatchCheckpointCompatible({
      ...checkpoint,
      state: {
        ...checkpoint.state,
        groundLoot: {
          ...checkpoint.state.groundLoot,
          "loot-250": { ...checkpoint.state.groundLoot["loot-250"], id: "loot-other" },
        },
      },
    })).toBe(false);
    expect(isMatchCheckpointCompatible({
      ...checkpoint,
      state: {
        ...checkpoint.state,
        groundLoot: {
          ...checkpoint.state.groundLoot,
          "dynamic-extra": {
            id: "dynamic-extra",
            itemId: "ammo.rifle",
            quantity: 1,
            position: { x: 0, y: 0.45, z: 0 },
            available: true,
            source: "drop",
          },
        },
      },
    })).toBe(true);
    expect(isMatchCheckpointCompatible({
      ...checkpoint,
      tick: undefined,
    } as never)).toBe(false);
    const actorId = Object.keys(checkpoint.state.actors)[0];
    if (!actorId) throw new Error("checkpoint actor fixture missing");
    expect(isMatchCheckpointCompatible({
      ...checkpoint,
      state: {
        ...checkpoint.state,
        actors: {
          ...checkpoint.state.actors,
          [actorId]: {
            ...checkpoint.state.actors[actorId],
            inventory: {
              ...checkpoint.state.actors[actorId]?.inventory,
              armorLevel: "1",
            },
          },
        },
      },
    } as never)).toBe(false);
    expect(isMatchCheckpointCompatible({
      ...checkpoint,
      state: {
        ...checkpoint.state,
        safeZone: {
          ...checkpoint.state.safeZone,
          stageIndex: 999,
        },
      },
    } as never)).toBe(false);
    const actorEntries = Object.entries(checkpoint.state.actors);
    const oneActor = Object.fromEntries(actorEntries.slice(0, 1));
    expect(isMatchCheckpointCompatible({
      ...checkpoint,
      state: { ...checkpoint.state, actors: oneActor },
    })).toBe(false);
    expect(isMatchCheckpointCompatible({
      ...checkpoint,
      state: { ...checkpoint.state, actors: Object.fromEntries(actorEntries.slice(0, -1)) },
    })).toBe(false);
    const extraActorSource = actorEntries.find(([, actor]) => actor.kind === "bot")?.[1];
    if (!extraActorSource) throw new Error("extra actor fixture missing");
    expect(isMatchCheckpointCompatible({
      ...checkpoint,
      state: {
        ...checkpoint.state,
        actors: {
          ...checkpoint.state.actors,
          "extra-bot": { ...extraActorSource, id: "extra-bot" },
        },
      },
    })).toBe(false);
    const [firstActorKey, firstActor] = actorEntries[0] ?? [];
    if (!firstActorKey || !firstActor) throw new Error("checkpoint actor fixture missing");
    const mismatchedActors = { ...checkpoint.state.actors };
    delete mismatchedActors[firstActorKey];
    mismatchedActors["mismatched-key"] = firstActor;
    expect(isMatchCheckpointCompatible({
      ...checkpoint,
      state: { ...checkpoint.state, actors: mismatchedActors },
    })).toBe(false);
    const replacementActors = structuredClone(checkpoint.state.actors);
    delete replacementActors["human-1"];
    const replacementSource = Object.values(replacementActors).find((actor) => actor.kind === "bot");
    if (!replacementSource) throw new Error("replacement bot fixture missing");
    replacementActors["replacement-bot"] = {
      ...replacementSource,
      id: "replacement-bot",
    };
    expect(isMatchCheckpointCompatible({
      ...checkpoint,
      state: { ...checkpoint.state, actors: replacementActors },
    }, ["human-1", "human-2"])).toBe(false);
    expect(isMatchCheckpointCompatible(checkpoint, ["human-1", "human-2"])).toBe(true);
    expect(isMatchCheckpointCompatible(checkpoint, ["human-1"])).toBe(false);
    const botMemberActors = structuredClone(checkpoint.state.actors);
    const humanActor = botMemberActors["human-1"];
    if (!humanActor) throw new Error("human actor fixture missing");
    botMemberActors["human-1"] = { ...humanActor, kind: "bot" };
    expect(isMatchCheckpointCompatible({
      ...checkpoint,
      state: { ...checkpoint.state, actors: botMemberActors },
    }, ["human-1", "human-2"])).toBe(false);
    expect(isMatchCheckpointCompatible(
      checkpoint,
      ["human-1", "human-1"],
    )).toBe(false);
  });

  it("redacts distant actors and expands only airborne loot replication", () => {
    const runtime = new MatchRuntime({
      humanActorIds: ["human-1", "human-2"],
      seed: 11,
      startWithBandage: true,
      disableAiSnipers: true,
    });
    const viewer = runtime.state.actors["human-1"];
    const distant = runtime.state.actors["human-2"];
    const loot = Object.values(runtime.state.groundLoot)[0];
    if (!viewer || !distant || !loot) throw new Error("test state missing");
    viewer.deployment = "aircraft";
    viewer.position = { x: 0, y: 180, z: 0 };
    distant.deployment = "grounded";
    distant.position = { x: 1_000, y: 1.76, z: 1_000 };
    loot.position = { x: 400, y: 0.45, z: 0 };

    const projected = runtime.projectState(viewer.id);
    const airborneLootCount = Object.keys(projected.groundLoot).length;

    expect(projected.actors[distant.id]?.position.y).toBe(-10_000);
    expect(projected.actors[distant.id]?.inventory.weaponSlots).toEqual([null, null]);
    expect(projected.groundLoot[loot.id]).toEqual(loot);
    expect(airborneLootCount).toBeGreaterThan(5);
    expect(airborneLootCount).toBeLessThan(Object.keys(runtime.state.groundLoot).length / 2);
    expect(jsonBytes(projected)).toBeLessThanOrEqual(50_000);
    expect(Object.values(projected.groundLoot).every((entry) =>
      Math.hypot(entry.position.x - viewer.position.x, entry.position.z - viewer.position.z) <= 400
    )).toBe(true);
    loot.position.x = 400.01;
    expect(runtime.projectState(viewer.id).groundLoot[loot.id]).toBeUndefined();

    viewer.deployment = "parachuting";
    loot.position.x = 400;
    expect(runtime.projectState(viewer.id).groundLoot[loot.id]).toEqual(loot);

    viewer.deployment = "grounded";
    loot.position.x = 60;
    expect(runtime.projectState(viewer.id).groundLoot[loot.id]).toEqual(loot);
    loot.position.x = 60.01;
    expect(runtime.projectState(viewer.id).groundLoot[loot.id]).toBeUndefined();
  });

  it("sends loot only on visibility, dirtiness, and range-exit transitions", () => {
    const runtime = new MatchRuntime({
      humanActorIds: ["human-1", "human-2"],
      seed: 17,
      startWithBandage: false,
      disableAiSnipers: true,
    });
    const viewer = runtime.state.actors["human-1"];
    const loot = Object.values(runtime.state.groundLoot)[0];
    if (!viewer || !loot) throw new Error("test state missing");
    viewer.position = { x: 0, y: 180, z: 0 };
    loot.position = { x: 2, y: 0.45, z: 2 };
    const initiallyVisible = new Set(Object.keys(runtime.projectState(viewer.id).groundLoot));
    const steady = runtime.projectFrame(runtime.takeFrame(0), viewer.id, initiallyVisible);
    expect(steady.frame.lootChanges).toEqual([]);

    viewer.position.x = 1_000;
    const exited = runtime.projectFrame(runtime.takeFrame(1), viewer.id, steady.visibleLootIds);
    expect(exited.frame.lootChanges).toContainEqual(expect.objectContaining({ id: loot.id, available: false }));

    viewer.position.x = 0;
    const reentered = runtime.projectFrame(runtime.takeFrame(2), viewer.id, exited.visibleLootIds);
    expect(reentered.frame.lootChanges).toContainEqual(loot);
  });

  it("bounds airborne loot visibility and transition deltas across a full flight", () => {
    const runtime = new MatchRuntime({
      humanActorIds: ["human-1", "human-2"],
      seed: 2026,
      startWithBandage: false,
      disableAiSnipers: true,
    });
    const viewer = runtime.state.actors["human-1"];
    if (!viewer) throw new Error("test viewer missing");
    viewer.deployment = "aircraft";
    const uniqueLootIds = new Set<string>();
    let previousLootIds = new Set<string>();
    let maximumVisible = 0;
    let maximumTransition = 0;

    for (let snapshot = 0; snapshot <= 600; snapshot += 1) {
      const progress = snapshot / 600;
      viewer.position = {
        x: runtime.state.flight.start.x + (runtime.state.flight.end.x - runtime.state.flight.start.x) * progress,
        y: runtime.state.flight.start.y + (runtime.state.flight.end.y - runtime.state.flight.start.y) * progress,
        z: runtime.state.flight.start.z + (runtime.state.flight.end.z - runtime.state.flight.start.z) * progress,
      };
      const visibleLootIds = new Set(Object.keys(runtime.projectState(viewer.id).groundLoot));
      for (const id of visibleLootIds) uniqueLootIds.add(id);
      maximumVisible = Math.max(maximumVisible, visibleLootIds.size);
      maximumTransition = Math.max(
        maximumTransition,
        [...visibleLootIds].filter((id) => !previousLootIds.has(id)).length,
        [...previousLootIds].filter((id) => !visibleLootIds.has(id)).length,
      );
      previousLootIds = visibleLootIds;
    }

    expect(maximumVisible).toBeGreaterThanOrEqual(20);
    expect(maximumVisible).toBeLessThanOrEqual(60);
    expect(uniqueLootIds.size).toBeLessThanOrEqual(150);
    expect(maximumTransition).toBeLessThanOrEqual(8);
  });

  it("emits one globally visible sequenced event per real human connection transition", () => {
    const runtime = new MatchRuntime({
      humanActorIds: ["human-1", "human-2"],
      seed: 19,
      startWithBandage: false,
      disableAiSnipers: true,
    });
    runtime.takeFrame(0);

    runtime.setConnected("human-2", false);
    runtime.setConnected("human-2", false);
    const disconnected = runtime.takeFrame(1);
    expect(disconnected.events).toHaveLength(1);
    expect(disconnected.events[0]).toMatchObject({
      event: { type: "human-connection", actorId: "human-2", status: "disconnected" },
    });
    const projected = runtime.projectFrame(disconnected, "human-1", new Set());
    expect(projected.frame.events).toEqual(disconnected.events);

    runtime.setConnected("human-2", true);
    runtime.setConnected("human-2", true);
    expect(runtime.takeFrame(2).events).toEqual([expect.objectContaining({
      event: { type: "human-connection", actorId: "human-2", status: "reconnected" },
    })]);

    runtime.setConnected("human-2", false, false);
    expect(runtime.takeFrame(3).events).toEqual([]);
    runtime.setConnected("bot-1", false);
    expect(runtime.takeFrame(4).events).toEqual([]);
  });

  it("applies a trusted render tick to authoritative human hitscan", () => {
    const runtime = new MatchRuntime({
      humanActorIds: ["human-1", "human-2"],
      seed: 13,
      startWithBandage: false,
      disableAiSnipers: true,
    });
    for (const actor of Object.values(runtime.state.actors)) {
      actor.alive = actor.id === "human-1" || actor.id === "human-2";
      actor.deployment = "grounded";
    }
    const shooter = runtime.state.actors["human-1"];
    const target = runtime.state.actors["human-2"];
    if (!shooter || !target) throw new Error("test humans missing");
    shooter.position = { x: 0, y: getTerrainHeight(0, 0, runtime.state.mapSeed) + 1.76, z: 0 };
    target.position = { x: 0, y: getTerrainHeight(0, 3, runtime.state.mapSeed) + 1.76, z: 3 };
    shooter.inventory.weaponSlots = [createWeaponState("rifle"), null];
    shooter.inventory.activeWeaponSlot = 0;
    target.armor = 0;
    target.inventory.armorLevel = 0;
    runtime.state.phase = "combat";
    runtime.state.safeZone.radius = 1_000;
    runtime.state.safeZone.damagePerSecond = 0;
    runtime.takeFrame(0);
    runtime.step();
    const renderTick = runtime.tick;
    const aimDirection = {
      x: target.position.x - shooter.position.x,
      y: target.position.y - shooter.position.y,
      z: target.position.z - shooter.position.z,
    };
    target.position = { x: 5, y: getTerrainHeight(5, 3, runtime.state.mapSeed) + 1.76, z: 3 };

    expect(runtime.submitInput(
      shooter.id,
      1,
      { ...createIdleCommand(), aimDirection, fire: true },
      renderTick,
      77,
      "rifle",
    )).toBe(true);
    runtime.step();

    const events = runtime.takeFrame(0).events;
    expect(events).toContainEqual(expect.objectContaining({
      shotSequence: 77,
      event: expect.objectContaining({ type: "shot-fired", actorId: shooter.id }),
    }));
    expect(events.map(({ event }) => event)).toContainEqual(expect.objectContaining({
      type: "actor-damaged",
      actorId: target.id,
      sourceId: shooter.id,
    }));
    expect(target.health).toBeLessThan(target.maxHealth);
  });

  it("keeps hot full, snapshot, event burst, and checkpoint payloads bounded", () => {
    const humanActorIds = Array.from({ length: 10 }, (_, index) => `human-${index + 1}`);
    const runtime = new MatchRuntime({
      humanActorIds,
      seed: 2026,
      startWithBandage: true,
      disableAiSnipers: true,
    });
    for (const actor of Object.values(runtime.state.actors)) {
      actor.deployment = "grounded";
      actor.position = { x: 0, y: 1.76, z: 0 };
      actor.inventory.weaponSlots = [createWeaponState("shotgun"), createWeaponState("sniper")];
      actor.inventory.activeWeaponSlot = 1;
      actor.inventory.backpack = [
        { itemId: "ammo.rifle", quantity: 120 },
        { itemId: "ammo.light", quantity: 180 },
        { itemId: "ammo.shell", quantity: 30 },
        { itemId: "ammo.sniper", quantity: 30 },
        { itemId: "bandage", quantity: 5 },
        { itemId: "medkit", quantity: 2 },
      ];
      actor.inventory.armorLevel = 2;
      actor.inventory.helmetLevel = 2;
      actor.inventory.usingItem = { itemId: "bandage", remainingSeconds: 3.5 };
    }

    expect(humanActorIds).toHaveLength(10);
    expect(Object.keys(runtime.state.actors)).toHaveLength(50);
    expect(Object.keys(runtime.state.groundLoot)).toHaveLength(TOTAL_LOOT_POINTS);

    const localActorId = humanActorIds[0] ?? "human-1";
    const fullMessage = {
      type: "match.full",
      snapshotSequence: 0,
      tick: runtime.tick,
      localActorId,
      state: runtime.projectState(localActorId),
      displayNames: Object.fromEntries(humanActorIds.map((actorId, index) => [actorId, `Human ${index + 1}`])),
      events: [],
    } satisfies ServerMessage;

    runtime.takeFrame(0);
    const steadyFrame = runtime.projectFrame(runtime.takeFrame(123_456), localActorId, new Set()).frame;
    const steadyMessage = {
      type: "match.snapshot",
      ackSequence: runtime.acknowledge(localActorId),
      frame: steadyFrame,
    } satisfies ServerMessage;
    const burstEvents: SequencedGameEvent[] = Array.from({ length: 450 }, (_, index) => ({
      sequence: index + 1,
      event: {
        type: "shot-traced",
        actorId: `bot-${index % 40 + 1}`,
        origin: { x: 100.125, y: 12.25, z: -99.75 },
        end: { x: -100.5, y: 1.125, z: 250.875 },
        normal: { x: 0, y: 1, z: 0 },
        hitType: "environment",
        targetId: null,
      },
    }));
    const burstMessage = {
      ...steadyMessage,
      frame: { ...steadyFrame, events: burstEvents },
    } satisfies ServerMessage;

    expect(jsonBytes(fullMessage)).toBeLessThanOrEqual(50_000);
    expect(jsonBytes(steadyMessage)).toBeLessThanOrEqual(50_000);
    expect(burstEvents).toHaveLength(450);
    expect(jsonBytes(burstMessage)).toBeLessThanOrEqual(150_000);
    expect(jsonBytes(runtime.checkpoint())).toBeLessThanOrEqual(100_000);
  });
});

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
