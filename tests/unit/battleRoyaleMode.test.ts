import { describe, expect, it } from "vitest";
import {
  BATTLE_ROYALE_CONFIG,
  FAST_BATTLE_ROYALE_CONFIG,
  type BattleRoyaleConfig,
} from "../../src/config/battleRoyale";
import { ITEMS } from "../../src/config/items";
import { createMapLayout } from "../../src/config/map";
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
  it("budgets 18 minutes from the flight route through the final circle", () => {
    const budgetSeconds =
      BATTLE_ROYALE_CONFIG.flightSeconds +
      BATTLE_ROYALE_CONFIG.safeZoneStages.reduce(
        (total, stage) => total + stage.waitSeconds + stage.shrinkSeconds,
        0,
      );

    expect(budgetSeconds).toBe(18 * 60);
    expect(budgetSeconds).toBeGreaterThanOrEqual(15 * 60);
    expect(budgetSeconds).toBeLessThanOrEqual(20 * 60);
  });

  it("creates a serializable 20-person match with complete ground loot", () => {
    const state = createBattleRoyaleState("player", FAST_BATTLE_ROYALE_CONFIG, () => 0.5);
    const actors = Object.values(state.actors);
    const itemIds = new Set(Object.values(state.groundLoot).map((loot) => loot.itemId));

    expect(actors).toHaveLength(20);
    expect(actors.filter((actor) => actor.kind === "player")).toHaveLength(1);
    expect(actors.filter((actor) => actor.kind === "bot")).toHaveLength(19);
    expect(actors.every((actor) => actor.deployment === "aircraft")).toBe(true);
    expect(state.mapSeed).toBe(2_147_483_648);
    expect(Object.values(state.groundLoot).map((loot) => loot.position)).toEqual(
      createMapLayout(state.mapSeed).lootSpawnPoints,
    );
    expect(itemIds).toEqual(
      new Set([
        "weapon.rifle",
        "weapon.smg",
        "weapon.shotgun",
        "ammo.rifle",
        "ammo.light",
        "ammo.shell",
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

  it("stratifies each POI loot slice without clustering adjacent categories", () => {
    const state = createBattleRoyaleState("player", FAST_BATTLE_ROYALE_CONFIG, seededRandom(2026));
    const loot = Object.values(state.groundLoot);

    expect(loot).toHaveLength(72);
    for (let start = 0; start < loot.length; start += 18) {
      const poiLoot = loot.slice(start, start + 18);
      const weapons = poiLoot.filter((entry) => lootCategory(entry.itemId) === "weapon");
      const ammo = poiLoot.filter((entry) => lootCategory(entry.itemId) === "ammo");
      const medical = poiLoot.filter((entry) => lootCategory(entry.itemId) === "medical");
      const equipment = poiLoot.filter((entry) => lootCategory(entry.itemId) === "equipment");
      const categories = poiLoot.map((entry) => lootCategory(entry.itemId));
      const adjacentMatches = categories.filter(
        (category, index) => category === categories[(index + 1) % categories.length],
      ).length;

      expect(new Set(weapons.map((entry) => entry.itemId))).toEqual(
        new Set(["weapon.rifle", "weapon.smg", "weapon.shotgun"]),
      );
      expect(new Set(ammo.map((entry) => entry.itemId))).toEqual(
        new Set(["ammo.rifle", "ammo.light", "ammo.shell"]),
      );
      expect(weapons).toHaveLength(5);
      expect(ammo).toHaveLength(4);
      expect(medical).toHaveLength(3);
      expect(equipment).toHaveLength(6);
      expect(adjacentMatches / categories.length).toBeLessThanOrEqual(0.2);

      for (const entry of weapons) {
        const weaponId = ITEMS[entry.itemId]?.weaponId;
        if (!weaponId) {
          throw new Error(`weapon config missing: ${entry.itemId}`);
        }
        expect(entry.weapon).toEqual(createWeaponState(weaponId));
      }
    }
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

  it("auto-ejects the player at the current aircraft position", () => {
    const state = createBattleRoyaleState("player", damageConfig, () => 0.5);
    const mode = new BattleRoyaleMode(damageConfig, () => 0.5);
    mode.start(state, []);

    mode.update(state, damageConfig.flightSeconds * 0.76, []);

    const player = state.actors.player;
    if (!player) throw new Error("player missing");
    expect(player.deployment).toBe("parachuting");
    expect(player.position.x).toBeCloseTo(state.flight.start.x + (state.flight.end.x - state.flight.start.x) * 0.76);
    expect(player.position.z).toBeCloseTo(state.flight.start.z + (state.flight.end.z - state.flight.start.z) * 0.76);
    expect(createMapLayout(state.mapSeed).lootSpawnPoints).not.toContainEqual(player.position);
    expect(Object.values(state.actors).every((actor) => actor.deployment === "parachuting")).toBe(true);
    expect(Object.values(state.actors).every((actor) => actor.position.x === player.position.x)).toBe(true);
    expect(Object.values(state.actors).every((actor) => actor.position.z === player.position.z)).toBe(true);
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
  });

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
