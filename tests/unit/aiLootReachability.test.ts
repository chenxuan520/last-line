import { describe, expect, it } from "vitest";
import { GridNavigator } from "../../src/ai/navigation/GridNavigator";
import type { BattleRoyaleConfig } from "../../src/config/battleRoyale";
import { createMapLayout, LOOT_SPAWN_POINTS, MAP_WALL_SEGMENTS } from "../../src/config/map";
import { WEAPONS } from "../../src/config/weapons";
import { BotController } from "../../src/controllers/BotController";
import { createIdleCommand, type ActorCommand } from "../../src/game/commands/ActorCommand";
import { GameSimulation } from "../../src/game/GameSimulation";
import { BattleRoyaleMode, createBattleRoyaleState } from "../../src/game/modes/BattleRoyaleMode";
import { getActiveWeapon, type EntityId } from "../../src/game/state/types";
import type { CombatWorld } from "../../src/game/systems/CombatSystem";
import { InventorySystem } from "../../src/game/systems/InventorySystem";
import { SimulationCombatWorld } from "../../src/game/systems/SimulationCombatWorld";

const TEST_CONFIG: BattleRoyaleConfig = {
  participantCount: 50,
  flightSeconds: 1,
  safeZoneStages: [{ waitSeconds: 300, shrinkSeconds: 1, radius: 1_200, damagePerSecond: 0 }],
};
const NO_COMBAT_WORLD: CombatWorld = { traceShot: () => null, hasLineOfSight: () => false };
const SEEDS = [1, 7, 19, 42, 99] as const;

describe("AI loot reachability", () => {
  it("keeps every generated loot point standable and interactable", () => {
    const navigator = new GridNavigator();
    const state = createBattleRoyaleState("player", TEST_CONFIG, seededRandom(1));
    const player = state.actors.player;
    if (!player) throw new Error("player missing");
    player.deployment = "grounded";
    const inventory = new InventorySystem();

    expect(LOOT_SPAWN_POINTS).toHaveLength(240);
    LOOT_SPAWN_POINTS.forEach((point, index) => {
      const insideExpandedWall = MAP_WALL_SEGMENTS.some(
        (wall) =>
          point.x >= wall.center.x - wall.width / 2 - 0.5 &&
          point.x <= wall.center.x + wall.width / 2 + 0.5 &&
          point.z >= wall.center.z - wall.depth / 2 - 0.5 &&
          point.z <= wall.center.z + wall.depth / 2 + 0.5,
      );
      expect(insideExpandedWall, `loot point ${index} overlaps an expanded wall`).toBe(false);
      expect(navigator.findPath(point, point), `loot point ${index} is not standable`).not.toHaveLength(0);

      player.position = { x: point.x, y: point.y + 1.31, z: point.z };
      player.inventory.backpack = [];
      state.groundLoot = {
        loot: {
          id: "loot",
          itemId: "ammo.rifle",
          quantity: 1,
          position: { ...point },
          available: true,
        },
      };
      inventory.processCommand(state, player.id, { ...createIdleCommand(), interact: true }, []);
      expect(state.groundLoot.loot?.available, `loot point ${index} is not interactable`).toBe(false);
    });
  });

  it.each(SEEDS)("arms at least 42 of 49 bots after landing with seed %i", (seed) => {
    const random = seededRandom(seed);
    const state = createBattleRoyaleState("player", TEST_CONFIG, random);
    const simulation = new GameSimulation(state, new BattleRoyaleMode(TEST_CONFIG, random), WEAPONS);
    const bots = Object.values(state.actors).filter((actor) => actor.kind === "bot");
    const controllers = new Map(
      bots.map((bot, index) => [bot.id, new BotController(index + 1, seededRandom(seed * 100 + index))]),
    );
    const landingZones = createMapLayout(state.mapSeed).landingZones;
    simulation.start();

    let groundedAt: number | null = null;
    const landingPoiByBot = new Map<EntityId, number>();
    for (let tick = 0; tick < 1_000; tick += 1) {
      const commands = new Map<EntityId, ActorCommand>([["player", createIdleCommand()]]);
      for (const bot of bots) {
        const controller = controllers.get(bot.id);
        if (!controller) throw new Error(`controller missing for ${bot.id}`);
        commands.set(bot.id, controller.update(bot, state, NO_COMBAT_WORLD, 0.25, "player"));
      }
      simulation.step(0.25, commands, NO_COMBAT_WORLD);
      for (const bot of bots) {
        if (bot.deployment !== "grounded" || landingPoiByBot.has(bot.id)) continue;
        landingPoiByBot.set(bot.id, nearestPoiIndex(bot.position.x, bot.position.z, landingZones));
      }

      if (bots.every((bot) => bot.deployment === "grounded")) {
        groundedAt ??= state.elapsedSeconds;
        if (state.elapsedSeconds - groundedAt >= 140) break;
      }
    }

    const armedBots = bots.filter((bot) => getActiveWeapon(bot) !== null);
    const heldWeapons = bots.flatMap((bot) => bot.inventory.weaponSlots).filter((weapon) => weapon !== null).length;
    const availableWeapons = Object.values(state.groundLoot).filter(
      (loot) => loot.available && loot.itemId.startsWith("weapon."),
    );
    const unarmedPositions = bots
      .filter((bot) => getActiveWeapon(bot) === null)
      .map((bot) => ({
        id: bot.id,
        x: Math.round(bot.position.x),
        z: Math.round(bot.position.z),
        nearest: Math.round(
          Math.min(
            ...availableWeapons.map((loot) =>
              Math.hypot(bot.position.x - loot.position.x, bot.position.z - loot.position.z),
            ),
          ),
        ),
      }));
    expect(bots.every((bot) => bot.deployment === "grounded")).toBe(true);
    const landingCounts = new Map<number, number>();
    for (const poiIndex of landingPoiByBot.values()) {
      landingCounts.set(poiIndex, (landingCounts.get(poiIndex) ?? 0) + 1);
    }
    expect(landingCounts.size, `only ${landingCounts.size} landing zones for seed ${seed}`).toBeGreaterThanOrEqual(13);
    expect(Math.max(...landingCounts.values()), `landing counts for seed ${seed}: ${JSON.stringify([...landingCounts])}`)
      .toBeLessThanOrEqual(10);
    expect(
      armedBots.length,
      `${armedBots.length} bots armed, ${heldWeapons} weapons held, ${availableWeapons.length} available for seed ${seed}: ${JSON.stringify(unarmedPositions)}`,
    ).toBeGreaterThanOrEqual(42);
  }, 60_000);

  it("lets 49 real bot controllers loot, fight, and produce one winner", () => {
    const config: BattleRoyaleConfig = {
      participantCount: 50,
      flightSeconds: 1,
      safeZoneStages: [
        { waitSeconds: 130, shrinkSeconds: 20, radius: 660, damagePerSecond: 5 },
        { waitSeconds: 35, shrinkSeconds: 20, radius: 210, damagePerSecond: 12 },
        { waitSeconds: 8, shrinkSeconds: 18, radius: 0, damagePerSecond: 80 },
      ],
    };
    const random = seededRandom(2026);
    const state = createBattleRoyaleState("player", config, random);
    const simulation = new GameSimulation(state, new BattleRoyaleMode(config, random), WEAPONS);
    const bots = Object.values(state.actors).filter((actor) => actor.kind === "bot");
    const controllers = new Map(
      bots.map((bot, index) => [bot.id, new BotController(index + 1, seededRandom(20_260 + index))]),
    );
    const world = new SimulationCombatWorld(state);
    simulation.start();
    const allEvents = simulation.drainEvents();

    for (let tick = 0; tick < 1_200 && state.phase !== "finished"; tick += 1) {
      const commands = new Map<EntityId, ActorCommand>([["player", createIdleCommand()]]);
      for (const bot of bots) {
        const controller = controllers.get(bot.id);
        if (controller && bot.alive) commands.set(bot.id, controller.update(bot, state, world, 0.25, "player"));
      }
      simulation.step(0.25, commands, world);
      allEvents.push(...simulation.drainEvents());
    }

    const living = Object.values(state.actors).filter((actor) => actor.alive);
    expect(
      state.phase,
      JSON.stringify({
        elapsedSeconds: state.elapsedSeconds,
        safeZone: state.safeZone,
        living: living.map((actor) => ({
          id: actor.id,
          health: actor.health,
          deployment: actor.deployment,
          position: actor.position,
        })),
      }),
    ).toBe("finished");
    expect(living).toHaveLength(1);
    expect(state.result?.winnerId).toBe(living[0]?.id);
    expect(allEvents.some((event) => event.type === "item-picked" && event.actorId.startsWith("bot-"))).toBe(true);
    expect(allEvents.some((event) => event.type === "shot-fired" && event.actorId.startsWith("bot-"))).toBe(true);
    expect(allEvents.some((event) => event.type === "actor-died" && event.sourceId?.startsWith("bot-"))).toBe(true);
  }, 120_000);
});

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

function nearestPoiIndex(x: number, z: number, landingZones: ReturnType<typeof createMapLayout>["landingZones"]): number {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  landingZones.forEach((poi, index) => {
    const distance = Math.hypot(x - poi.position.x, z - poi.position.z);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  return nearestIndex;
}
