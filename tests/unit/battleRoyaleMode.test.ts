import { describe, expect, it } from "vitest";
import {
  BATTLE_ROYALE_CONFIG,
  FAST_BATTLE_ROYALE_CONFIG,
  type BattleRoyaleConfig,
} from "../../src/config/battleRoyale";
import { BattleRoyaleMode, createBattleRoyaleState } from "../../src/game/modes/BattleRoyaleMode";
import { createIdleCommand } from "../../src/game/commands/ActorCommand";
import type { GameEvent } from "../../src/game/state/types";
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

  it("uses the injected random source for reproducible flight routes", () => {
    const firstState = createBattleRoyaleState("player", damageConfig, () => 0.5);
    const secondState = createBattleRoyaleState("player", damageConfig, () => 0.5);
    const differentState = createBattleRoyaleState("player", damageConfig, () => 0.25);
    const firstMode = new BattleRoyaleMode(damageConfig, () => 0.5);
    const secondMode = new BattleRoyaleMode(damageConfig, () => 0.5);

    firstMode.start(firstState, []);
    secondMode.start(secondState, []);

    expect(firstState.flight).toEqual(secondState.flight);
    expect(firstState.flight).not.toEqual(differentState.flight);
    expect(Object.values(firstState.actors).every((actor) => actor.position.x === firstState.flight.start.x)).toBe(true);
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
