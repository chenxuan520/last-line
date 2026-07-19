import { describe, expect, it } from "vitest";
import {
  BATTLE_ROYALE_CONFIG,
  FAST_BATTLE_ROYALE_CONFIG,
  type BattleRoyaleConfig,
} from "../../src/config/battleRoyale";
import { ITEMS } from "../../src/config/items";
import { createMapLayout, MAP_HALF_SIZE } from "../../src/config/map";
import { WEAPONS } from "../../src/config/weapons";
import { BattleRoyaleMode, createBattleRoyaleState } from "../../src/game/modes/BattleRoyaleMode";
import { createIdleCommand } from "../../src/game/commands/ActorCommand";
import { createWeaponState, type GameEvent } from "../../src/game/state/types";
import { MovementSystem } from "../../src/game/systems/MovementSystem";

const damageConfig: BattleRoyaleConfig = {
  participantCount: 20,
  flightSeconds: 1,
  safeZoneStages: [{ waitSeconds: 10, shrinkSeconds: 1, radius: 100, damagePerSecond: 10 }],
};

describe("BattleRoyaleMode", () => {
  it("budgets about 13 minutes while accelerating the late circles", () => {
    const budgetSeconds =
      BATTLE_ROYALE_CONFIG.flightSeconds +
      BATTLE_ROYALE_CONFIG.safeZoneStages.reduce(
        (total, stage) => total + stage.waitSeconds + stage.shrinkSeconds,
        0,
      );

    expect(budgetSeconds).toBe(802);
    expect(budgetSeconds).toBeGreaterThanOrEqual(13 * 60);
    expect(budgetSeconds).toBeLessThanOrEqual(14 * 60);
    const stages = BATTLE_ROYALE_CONFIG.safeZoneStages;
    expect(stages.slice(2).map((stage) => stage.waitSeconds)).toEqual([70, 35, 15, 5]);
    expect(stages.slice(2).map((stage) => stage.shrinkSeconds)).toEqual([45, 28, 16, 8]);
  });

  it("creates a serializable 50-person match with complete ground loot", () => {
    const state = createBattleRoyaleState("player", FAST_BATTLE_ROYALE_CONFIG, () => 0.5);
    const actors = Object.values(state.actors);
    const itemIds = new Set(Object.values(state.groundLoot).map((loot) => loot.itemId));

    expect(actors).toHaveLength(50);
    expect(actors.filter((actor) => actor.kind === "player")).toHaveLength(1);
    expect(actors.filter((actor) => actor.kind === "bot")).toHaveLength(49);
    expect(actors.every((actor) => actor.deployment === "aircraft")).toBe(true);
    expect(actors.every((actor) =>
      actor.inventory.backpack.length === 1 &&
      actor.inventory.backpack[0]?.itemId === "bandage" &&
      actor.inventory.backpack[0]?.quantity === 1
    )).toBe(true);
    expect(Object.fromEntries(Object.entries(WEAPONS).map(([id, weapon]) => [id, weapon.magazineSize]))).toEqual({
      rifle: 45,
      smg: 48,
      shotgun: 9,
      sniper: 8,
    });
    expect(Object.values(state.groundLoot)
      .filter((loot) => loot.weapon)
      .every((loot) => {
        const weapon = loot.weapon;
        return Boolean(weapon && weapon.ammoInMagazine === WEAPONS[weapon.weaponId]?.magazineSize);
      })).toBe(true);
    expect(state.mapSeed).toBe(2_147_483_648);
    expect(Object.values(state.groundLoot).map((loot) => loot.position)).toEqual(
      createMapLayout(state.mapSeed).lootSpawnPoints,
    );
    expect(itemIds).toEqual(
      new Set([
        "weapon.rifle",
        "weapon.smg",
        "weapon.shotgun",
        "weapon.sniper",
        "ammo.rifle",
        "ammo.light",
        "ammo.shell",
        "ammo.sniper",
        "armor.1",
        "armor.2",
        "helmet.1",
        "helmet.2",
        "bandage",
        "medkit",
      ]),
    );
    expect(() => JSON.parse(JSON.stringify(state)) as unknown).not.toThrow();
  });

  it("can disable the shared starter bandage for both player and AI", () => {
    const state = createBattleRoyaleState("player", damageConfig, () => 0.5, { startWithBandage: false });

    expect(Object.values(state.actors).every((actor) => actor.inventory.backpack.length === 0)).toBe(true);
  });

  it("stratifies each POI loot slice without clustering adjacent categories", () => {
    const state = createBattleRoyaleState("player", FAST_BATTLE_ROYALE_CONFIG, seededRandom(2026));
    const loot = Object.values(state.groundLoot);
    const layout = createMapLayout(state.mapSeed);

    expect(loot).toHaveLength(250);
    let start = 0;
    for (const zoneCount of layout.lootZoneCounts) {
      const poiLoot = loot.slice(start, start + zoneCount);
      const weapons = poiLoot.filter((entry) => lootCategory(entry.itemId) === "weapon");
      const ammo = poiLoot.filter((entry) => lootCategory(entry.itemId) === "ammo");
      const medical = poiLoot.filter((entry) => lootCategory(entry.itemId) === "medical");
      const equipment = poiLoot.filter((entry) => lootCategory(entry.itemId) === "equipment");
      const categories = poiLoot.map((entry) => lootCategory(entry.itemId));
      const adjacentMatches = categories.filter(
        (category, index) => category === categories[(index + 1) % categories.length],
      ).length;

      expect(new Set(weapons.map((entry) => entry.itemId))).toEqual(
        new Set(["weapon.rifle", "weapon.smg", "weapon.shotgun", "weapon.sniper"]),
      );
      expect(new Set(ammo.map((entry) => entry.itemId))).toEqual(
        new Set(["ammo.rifle", "ammo.light", "ammo.shell", "ammo.sniper"]),
      );
      const ammoQuantities = { "ammo.rifle": 90, "ammo.light": 96, "ammo.shell": 18, "ammo.sniper": 16 } as const;
      expect(ammo.every((entry) => entry.quantity === ammoQuantities[entry.itemId as keyof typeof ammoQuantities])).toBe(true);
      const weaponCount = Math.max(4, Math.round(zoneCount * 0.4));
      const ammoCount = Math.max(4, Math.round(zoneCount * 0.2));
      const medicalCount = Math.max(1, Math.floor(zoneCount * 0.15));
      expect(weapons).toHaveLength(weaponCount);
      expect(ammo).toHaveLength(ammoCount);
      expect(medical).toHaveLength(medicalCount);
      expect(equipment).toHaveLength(zoneCount - weaponCount - ammoCount - medicalCount);
      expect(adjacentMatches / categories.length).toBeLessThanOrEqual(0.2);

      for (const entry of weapons) {
        const weaponId = ITEMS[entry.itemId]?.weaponId;
        if (!weaponId) {
          throw new Error(`weapon config missing: ${entry.itemId}`);
        }
        expect(entry.weapon).toEqual(createWeaponState(weaponId));
      }
      start += zoneCount;
    }
    const additionalMedical = loot.slice(start);
    expect(additionalMedical).toHaveLength(10);
    expect(additionalMedical.every((entry) => lootCategory(entry.itemId) === "medical")).toBe(true);
    expect(additionalMedical.filter((entry) => entry.itemId === "bandage")).toHaveLength(5);
    expect(additionalMedical.filter((entry) => entry.itemId === "medkit")).toHaveLength(5);
  });

  it("reproduces loot for the same seed and varies it for a different seed", () => {
    const first = createBattleRoyaleState("player", FAST_BATTLE_ROYALE_CONFIG, seededRandom(7));
    const second = createBattleRoyaleState("player", FAST_BATTLE_ROYALE_CONFIG, seededRandom(7));
    const different = createBattleRoyaleState("player", FAST_BATTLE_ROYALE_CONFIG, seededRandom(8));

    expect(first.groundLoot).toEqual(second.groundLoot);
    expect(Object.values(first.groundLoot).map((entry) => entry.itemId)).not.toEqual(
      Object.values(different.groundLoot).map((entry) => entry.itemId),
    );
  });

  it("uses the injected random source for reproducible flight routes", () => {
    const firstState = createBattleRoyaleState("player", damageConfig, () => 0.5);
    const secondState = createBattleRoyaleState("player", damageConfig, () => 0.5);
    const differentState = createBattleRoyaleState("player", damageConfig, () => 0.25);
    const firstMode = new BattleRoyaleMode(damageConfig, () => 0.5);
    const secondMode = new BattleRoyaleMode(damageConfig, () => 0.5);

    firstMode.start(firstState, []);
    secondMode.start(secondState, []);

    expect(firstState.mapSeed).toBe(2_147_483_648);
    expect(firstState.flight).toEqual(secondState.flight);
    expect(firstState.flight).not.toEqual(differentState.flight);
    expect(Object.values(firstState.actors).every((actor) => actor.position.x === firstState.flight.start.x)).toBe(true);
  });

  it("does not change the state's map seed when the mode starts", () => {
    const state = createBattleRoyaleState("player", damageConfig, () => 0.5);
    const mapSeed = state.mapSeed;

    new BattleRoyaleMode(damageConfig, () => 0.25).start(state, []);

    expect(state.mapSeed).toBe(mapSeed);
  });

  it("auto-ejects every remaining actor at the last legal island position", () => {
    const state = createBattleRoyaleState("player", damageConfig, () => 0.5);
    const mode = new BattleRoyaleMode(damageConfig, () => 0.5);
    mode.start(state, []);

    mode.update(state, damageConfig.flightSeconds * 0.93, []);

    const player = state.actors.player;
    if (!player) throw new Error("player missing");
    expect(player.deployment).toBe("parachuting");
    expect(Math.abs(player.position.x)).toBeLessThanOrEqual(MAP_HALF_SIZE - 0.42 + 1e-6);
    expect(Math.abs(player.position.z)).toBeLessThanOrEqual(MAP_HALF_SIZE - 0.42 + 1e-6);
    expect(createMapLayout(state.mapSeed).lootSpawnPoints).not.toContainEqual(player.position);
    expect(Object.values(state.actors).every((actor) => actor.deployment === "parachuting")).toBe(true);
    expect(Object.values(state.actors).every((actor) => actor.position.x === player.position.x)).toBe(true);
    expect(Object.values(state.actors).every((actor) => actor.position.z === player.position.z)).toBe(true);
    const beforeMove = { ...player.position };
    new MovementSystem().processCommand(
      state,
      player.id,
      { ...createIdleCommand(), move: { x: 1, y: 0, z: 0 } },
      1 / 30,
    );
    expect(Math.hypot(player.position.x - beforeMove.x, player.position.z - beforeMove.z)).toBeLessThan(2.2);
  });

  it("applies outside-zone damage directly to health", () => {
    const state = createBattleRoyaleState("player", damageConfig, () => 0);
    const mode = new BattleRoyaleMode(damageConfig, () => 0);
    mode.start(state, []);
    for (const actor of Object.values(state.actors)) {
      actor.deployment = "grounded";
      actor.position = { x: 0, y: 1.76, z: 0 };
    }
    mode.update(state, 0, []);

    const player = state.actors.player;
    if (!player) {
      throw new Error("player missing");
    }
    player.position.x = state.safeZone.radius + 1;
    player.armor = 50;
    player.inventory.helmetLevel = 2;
    mode.update(state, 1, []);

    expect(player.health).toBe(90);
    expect(player.armor).toBe(50);
  });

  it("does not apply safe-zone damage until an actor is grounded", () => {
    const state = createBattleRoyaleState("player", damageConfig, () => 0);
    const mode = new BattleRoyaleMode(damageConfig, () => 0);
    mode.start(state, []);
    for (const actor of Object.values(state.actors)) {
      actor.deployment = "grounded";
      actor.position = { x: 0, y: 1.76, z: 0 };
    }
    mode.update(state, 0, []);
    const player = state.actors.player;
    if (!player) throw new Error("player missing");
    player.deployment = "parachuting";
    player.position.x = state.safeZone.radius + 100;

    mode.update(state, 1, []);

    expect(player.health).toBe(100);
  });

  it("does not let a dead parachuting actor block the transition to combat", () => {
    const state = createBattleRoyaleState("player", damageConfig, () => 0.5);
    const mode = new BattleRoyaleMode(damageConfig, () => 0.5);
    mode.start(state, []);
    const deadBot = state.actors["bot-1"];
    if (!deadBot) throw new Error("bot missing");
    for (const actor of Object.values(state.actors)) actor.deployment = "grounded";
    deadBot.deployment = "parachuting";
    deadBot.alive = false;

    mode.update(state, 0, []);

    expect(state.phase).toBe("combat");
  });

  it("doubles only active shrinking when fewer than five actors remain", () => {
    const config: BattleRoyaleConfig = {
      participantCount: 5,
      flightSeconds: 1,
      safeZoneStages: [{ waitSeconds: 10, shrinkSeconds: 10, radius: 100, damagePerSecond: 0 }],
    };
    const createShrinkingState = () => {
      const state = createBattleRoyaleState("player", config, () => 0.5);
      const mode = new BattleRoyaleMode(config, () => 0.5);
      mode.start(state, []);
      state.phase = "combat";
      state.safeZone.status = "shrinking";
      state.safeZone.secondsRemaining = 10;
      state.safeZone.startRadius = 200;
      state.safeZone.radius = 200;
      state.safeZone.targetRadius = 100;
      for (const actor of Object.values(state.actors)) actor.deployment = "grounded";
      return { state, mode };
    };
    const fiveAlive = createShrinkingState();
    const fourAlive = createShrinkingState();
    const removed = fourAlive.state.actors["bot-1"];
    if (!removed) throw new Error("bot missing");
    removed.alive = false;

    fiveAlive.mode.update(fiveAlive.state, 1, []);
    fourAlive.mode.update(fourAlive.state, 1, []);

    expect(fiveAlive.state.safeZone.secondsRemaining).toBe(9);
    expect(fiveAlive.state.safeZone.radius).toBe(190);
    expect(fourAlive.state.safeZone.secondsRemaining).toBe(8);
    expect(fourAlive.state.safeZone.radius).toBe(180);
  });

  it("advances every zone stage and finishes with exactly one winner", () => {
    const state = createBattleRoyaleState("player", FAST_BATTLE_ROYALE_CONFIG, () => 0);
    const mode = new BattleRoyaleMode(FAST_BATTLE_ROYALE_CONFIG, () => 0);
    const movement = new MovementSystem();
    const events: GameEvent[] = [];
    mode.start(state, events);

    for (let tick = 0; tick < 1_000 && state.phase !== "finished"; tick += 1) {
      for (const actor of Object.values(state.actors)) {
        movement.processCommand(state, actor.id, createIdleCommand(), 0.1);
      }
      mode.update(state, 0.1, events);
    }

    const living = Object.values(state.actors).filter((actor) => actor.alive);
    const zoneEvents = events.filter((event) => event.type === "safe-zone-changed");
    expect(state.phase).toBe("finished");
    expect(living).toHaveLength(1);
    expect(state.result?.winnerId).toBe(living[0]?.id);
    expect(zoneEvents).toEqual(
      expect.arrayContaining([
        { type: "safe-zone-changed", stageIndex: 0, status: "waiting" },
        { type: "safe-zone-changed", stageIndex: 0, status: "shrinking" },
        { type: "safe-zone-changed", stageIndex: 1, status: "waiting" },
        { type: "safe-zone-changed", stageIndex: 2, status: "closed" },
      ]),
    );
    expect(events).toContainEqual({ type: "phase-changed", phase: "flight" });
    expect(events).toContainEqual({ type: "phase-changed", phase: "combat" });
    expect(events).toContainEqual({ type: "phase-changed", phase: "finished" });
  }, 30_000);

  it("rotates simultaneous final-zone survivors instead of favoring an actor class", () => {
    const config: BattleRoyaleConfig = {
      participantCount: 2,
      flightSeconds: 1,
      safeZoneStages: [{ waitSeconds: 100, shrinkSeconds: 1, radius: 0, damagePerSecond: 100 }],
    };
    const winners = new Set<string | null>();

    for (let tick = 0; tick < 24; tick += 1) {
      const state = createBattleRoyaleState("player", config, () => 0.5);
      const mode = new BattleRoyaleMode(config, () => 0.5);
      mode.start(state, []);
      state.phase = "combat";
      state.elapsedSeconds = tick / 30;
      state.safeZone.radius = 0;
      state.safeZone.damagePerSecond = 100;
      for (const actor of Object.values(state.actors)) {
        actor.deployment = "grounded";
        actor.position = { x: 10, y: 1.76, z: 0 };
        actor.health = 1;
      }

      mode.update(state, 1, []);
      winners.add(state.result?.winnerId ?? null);
      expect(Object.values(state.actors).find((actor) => actor.alive)?.health).toBe(1);
    }

    expect(winners).toEqual(new Set(["bot-1", "player"]));
  });

  it("finishes with one winner when multiple actors stand at the exact center of a zero-radius zone", () => {
    const config: BattleRoyaleConfig = {
      participantCount: 3,
      flightSeconds: 1,
      safeZoneStages: [{ waitSeconds: 100, shrinkSeconds: 1, radius: 0, damagePerSecond: 100 }],
    };
    const state = createBattleRoyaleState("player", config, () => 0.5);
    const mode = new BattleRoyaleMode(config, () => 0.5);
    mode.start(state, []);
    state.phase = "combat";
    state.safeZone.center = { x: 12, y: 0, z: -8 };
    state.safeZone.radius = 0;
    state.safeZone.damagePerSecond = 100;
    for (const actor of Object.values(state.actors)) {
      actor.deployment = "grounded";
      actor.position = { x: 12, y: 1.76, z: -8 };
      actor.health = 1;
    }

    mode.update(state, 1, []);

    expect(state.phase).toBe("finished");
    expect(Object.values(state.actors).filter((actor) => actor.alive)).toHaveLength(1);
  });
});

function lootCategory(itemId: string): "weapon" | "ammo" | "medical" | "equipment" {
  const kind = ITEMS[itemId]?.kind;
  if (!kind) {
    throw new Error(`unknown item: ${itemId}`);
  }
  return kind === "armor" || kind === "helmet" ? "equipment" : kind;
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}
