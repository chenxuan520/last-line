import { afterEach, describe, expect, it, vi } from "vitest";
import { GridNavigator } from "../../src/ai/navigation/GridNavigator";
import type { BattleRoyaleConfig } from "../../src/config/battleRoyale";
import {
  createMapLayout,
  getTerrainHeight,
  LOOT_SPAWN_POINTS,
  MAP_WALL_SEGMENTS,
  wallOpeningOutwardDirection,
} from "../../src/config/map";
import type { MapId } from "../../src/config/maps";
import { WEAPONS } from "../../src/config/weapons";
import { BotController } from "../../src/controllers/BotController";
import { createIdleCommand, type ActorCommand } from "../../src/game/commands/ActorCommand";
import { GameSimulation } from "../../src/game/GameSimulation";
import { BattleRoyaleMode, createBattleRoyaleState } from "../../src/game/modes/BattleRoyaleMode";
import { ACTOR_EYE_HEIGHT, ACTOR_HEIGHT } from "../../src/game/rules/actorGeometry";
import { GROUND_LOOT_POSITION_HEIGHT } from "../../src/game/rules/loot";
import { pointInsideObstacle2D } from "../../src/game/rules/obstacleGeometry";
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps every generated loot point standable and interactable", () => {
    const navigator = new GridNavigator();
    const state = createBattleRoyaleState("player", TEST_CONFIG, seededRandom(1));
    const player = state.actors.player;
    if (!player) throw new Error("player missing");
    player.deployment = "grounded";
    const inventory = new InventorySystem();

    expect(LOOT_SPAWN_POINTS).toHaveLength(createMapLayout(0).lootSpawnPoints.length);
    LOOT_SPAWN_POINTS.forEach((point, index) => {
      const actorFeetY = point.y - GROUND_LOOT_POSITION_HEIGHT;
      const actorTopY = actorFeetY + ACTOR_HEIGHT;
      const insideExpandedWall = MAP_WALL_SEGMENTS.some(
        (wall) => {
          const wallBottomY = wall.center.y - wall.height / 2;
          const wallTopY = wall.center.y + wall.height / 2;
          return wallBottomY < actorTopY &&
            wallTopY > actorFeetY &&
            pointInsideObstacle2D(wall, point.x, point.z, 0.5);
        },
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
    const findPath = vi.spyOn(GridNavigator.prototype, "findPath");
    const random = seededRandom(seed);
    const state = createBattleRoyaleState("player", TEST_CONFIG, random);
    const simulation = new GameSimulation(state, new BattleRoyaleMode(TEST_CONFIG, random), WEAPONS);
    const bots = Object.values(state.actors).filter((actor) => actor.kind === "bot");
    const controllers = new Map(
      bots.map((bot, index) => [bot.id, new BotController(index + 1, seededRandom(seed * 100 + index), true)]),
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
    expect(findPath.mock.calls.length, `findPath calls for seed ${seed}`).toBeLessThanOrEqual(5_500);
    expect(bots.flatMap((bot) => bot.inventory.weaponSlots).some((weapon) => weapon?.weaponId === "sniper")).toBe(false);
    expect(bots.some((bot) => bot.inventory.backpack.some((stack) => stack.itemId === "ammo.sniper"))).toBe(false);
  }, 120_000);

  it.each([
    ["Greyfurnace City", "town"],
    ["mixed region map", "mixed"],
  ] as const)("arms at least 42 of 49 bots in %s", (_label, mapId: MapId) => {
    const seed = 42;
    const random = seededRandom(seed);
    const state = createBattleRoyaleState("player", TEST_CONFIG, random, { mapId });
    const layout = createMapLayout(mapId, state.mapSeed);
    const simulation = new GameSimulation(state, new BattleRoyaleMode(TEST_CONFIG, random), WEAPONS, layout);
    const bots = Object.values(state.actors).filter((actor) => actor.kind === "bot");
    const controllers = new Map(
      bots.map((bot, index) => [
        bot.id,
        new BotController(index + 1, seededRandom(seed * 100 + index), true, layout),
      ]),
    );
    simulation.start();

    let groundedAt: number | null = null;
    for (let tick = 0; tick < 1_000; tick += 1) {
      const commands = new Map<EntityId, ActorCommand>([["player", createIdleCommand()]]);
      for (const bot of bots) {
        const controller = controllers.get(bot.id);
        if (!controller) throw new Error(`controller missing for ${bot.id}`);
        commands.set(bot.id, controller.update(bot, state, NO_COMBAT_WORLD, 0.25, "player"));
      }
      simulation.step(0.25, commands, NO_COMBAT_WORLD);
      if (bots.every((bot) => bot.deployment === "grounded")) {
        groundedAt ??= state.elapsedSeconds;
        if (state.elapsedSeconds - groundedAt >= 140) break;
      }
    }

    const armedBots = bots.filter((bot) => getActiveWeapon(bot) !== null);
    expect(bots.every((bot) => bot.deployment === "grounded")).toBe(true);
    expect(armedBots.length, `${armedBots.length} ${mapId} bots armed`).toBeGreaterThanOrEqual(42);
  }, 120_000);

  it.each([1, 42, 99])("keeps Greyfurnace City loot navigable and interactable with seed %i", (seed) => {
    const random = seededRandom(seed);
    const state = createBattleRoyaleState("player", TEST_CONFIG, random, { mapId: "town" });
    const layout = createMapLayout("town", state.mapSeed);
    const navigator = new GridNavigator(layout);
    const inventory = new InventorySystem(layout);
    const player = state.actors.player;
    if (!player) throw new Error("Town loot test player missing");
    player.deployment = "grounded";

    for (const [index, point] of layout.lootSpawnPoints.entries()) {
      const building = layout.obstacles.find((candidate) =>
        pointInsideObstacle2D(candidate, point.x, point.z)
      );
      if (!building) throw new Error(`Town loot ${index} is not inside a building`);
      const door = layout.wallOpenings.find((opening) =>
        opening.obstacleId === building.id &&
        opening.storyIndex === 0 &&
        opening.kind === "door"
      );
      if (!door) throw new Error(`Town loot ${index} building has no ground door`);
      const outward = wallOpeningOutwardDirection(door);
      const outsideX = door.center.x + outward.x * 1.1;
      const outsideZ = door.center.z + outward.z * 1.1;
      const outside = {
        x: outsideX,
        y: getTerrainHeight(outsideX, outsideZ, layout) + ACTOR_EYE_HEIGHT,
        z: outsideZ,
      };
      const target = {
        x: point.x,
        y: point.y + 1.31,
        z: point.z,
      };
      expect(navigator.findPath(outside, target), `${seed}:${index}:path`).not.toHaveLength(0);

      player.position = target;
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
      expect(state.groundLoot.loot?.available, `${seed}:${index}:pickup`).toBe(false);
    }
  }, 120_000);

  it.each([1, 42, 99])("keeps mixed-region loot navigable and interactable with seed %i", (seed) => {
    const random = seededRandom(seed);
    const state = createBattleRoyaleState("player", TEST_CONFIG, random, { mapId: "mixed" });
    const layout = createMapLayout("mixed", state.mapSeed);
    const navigator = new GridNavigator(layout);
    const inventory = new InventorySystem(layout);
    const player = state.actors.player;
    if (!player) throw new Error("Mixed map loot test player missing");
    player.deployment = "grounded";

    for (const [index, point] of layout.lootSpawnPoints.entries()) {
      const building = layout.obstacles.find((candidate) =>
        Math.abs(point.x - candidate.center.x) <= candidate.width / 2 &&
        Math.abs(point.z - candidate.center.z) <= candidate.depth / 2
      );
      const start = building
        ? outsideBuildingDoor(layout, building.id)
        : nearestLandingZone(layout, point.x, point.z);
      const target = {
        x: point.x,
        y: point.y + 1.31,
        z: point.z,
      };
      expect(navigator.findPath(start, target), `${seed}:${index}:path`).not.toHaveLength(0);

      player.position = target;
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
      expect(state.groundLoot.loot?.available, `${seed}:${index}:pickup`).toBe(false);
    }
  }, 120_000);

  it("keeps the fourth ammunition-depot floor navigable and interactable", () => {
    const layout = createMapLayout("mixed", 5);
    const finalLevel = layout.ammunitionDepot.levels.at(-1);
    const depot = layout.obstacles.find((building) => building.id === layout.ammunitionDepot.buildingId);
    if (!finalLevel || !depot) throw new Error("Four-story ammunition depot missing");
    const navigator = new GridNavigator(layout);
    const inventory = new InventorySystem(layout);
    const state = createBattleRoyaleState("player", TEST_CONFIG, mapSeedRandom(5), { mapId: "mixed" });
    const player = state.actors.player;
    if (!player) throw new Error("Four-story depot test player missing");
    const start = outsideBuildingDoor(layout, depot.id);

    expect(layout.ammunitionDepot.levels).toHaveLength(4);
    for (const index of finalLevel.lootIndices) {
      const point = layout.lootSpawnPoints[index];
      if (!point) throw new Error(`Four-story depot loot missing: ${index}`);
      const target = { x: point.x, y: point.y + 1.31, z: point.z };
      expect(navigator.findPath(start, target), `mixed:5:${index}:path`).not.toHaveLength(0);

      player.position = target;
      player.deployment = "grounded";
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
      expect(state.groundLoot.loot?.available, `mixed:5:${index}:pickup`).toBe(false);
    }
  });

  it.each([
    ["island", "island"],
    ["Greyfurnace City", "town"],
    ["mixed region map", "mixed"],
  ] as const)("lets 49 real bot controllers loot, fight, and produce one winner on %s", (_label, mapId: MapId) => {
    const config: BattleRoyaleConfig = {
      participantCount: 50,
      flightSeconds: 1,
      safeZoneStages: [
        { waitSeconds: 130, shrinkSeconds: 20, radius: 660, damagePerSecond: 5 },
        { waitSeconds: 35, shrinkSeconds: 20, radius: 210, damagePerSecond: 12 },
        { waitSeconds: 8, shrinkSeconds: 18, radius: 0, damagePerSecond: 80 },
      ],
    };
    vi.spyOn(Math, "random").mockImplementation(seededRandom(2026));
    const findPath = vi.spyOn(GridNavigator.prototype, "findPath");
    const random = seededRandom(2026);
    const state = createBattleRoyaleState("player", config, random, { mapId });
    const layout = createMapLayout(mapId, state.mapSeed);
    const simulation = new GameSimulation(state, new BattleRoyaleMode(config, random), WEAPONS, layout);
    const bots = Object.values(state.actors).filter((actor) => actor.kind === "bot");
    const controllers = new Map(
      bots.map((bot, index) => [
        bot.id,
        new BotController(index + 1, seededRandom(20_260 + index), true, layout),
      ]),
    );
    const world = new SimulationCombatWorld(state, true, layout);
    const hasLineOfSight = vi.spyOn(world, "hasLineOfSight");
    const traceShotDetailed = vi.spyOn(world, "traceShotDetailed");
    simulation.start();
    const allEvents = simulation.drainEvents();
    let controllerUpdates = 0;
    let actorCommands = 0;
    let steps = 0;
    let peakGroundLoot = Object.keys(state.groundLoot).length;

    for (let tick = 0; tick < 1_200 && state.phase !== "finished"; tick += 1) {
      const commands = new Map<EntityId, ActorCommand>([["player", createIdleCommand()]]);
      for (const bot of bots) {
        const controller = controllers.get(bot.id);
        if (controller && bot.alive) {
          commands.set(bot.id, controller.update(bot, state, world, 0.25, "player"));
          controllerUpdates += 1;
        }
      }
      actorCommands += commands.size;
      simulation.step(0.25, commands, world);
      steps += 1;
      allEvents.push(...simulation.drainEvents());
      peakGroundLoot = Math.max(peakGroundLoot, Object.keys(state.groundLoot).length);
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
    expect(allEvents.some((event) =>
      event.type === "item-picked" &&
      event.actorId.startsWith("bot-") &&
      (event.itemId === "weapon.sniper" || event.itemId === "ammo.sniper")
    )).toBe(false);
    expect(allEvents.some((event) =>
      event.type === "shot-fired" && event.actorId.startsWith("bot-") && event.weaponId === "sniper"
    )).toBe(false);
    expect(allEvents.some((event) => event.type === "actor-died" && event.sourceId?.startsWith("bot-"))).toBe(true);
    expect(controllerUpdates).toBeLessThanOrEqual(47_000);
    expect(actorCommands).toBeLessThanOrEqual(48_000);
    const operationBudget: Record<MapId, {
      findPath: number;
      lineOfSight: number;
      shotTrace: number;
    }> = {
      island: { findPath: 17_500, lineOfSight: 20_000, shotTrace: 23_500 },
      town: { findPath: 22_000, lineOfSight: 26_000, shotTrace: 30_000 },
      mixed: { findPath: 22_000, lineOfSight: 26_000, shotTrace: 30_000 },
    };
    expect(findPath.mock.calls.length).toBeLessThanOrEqual(operationBudget[mapId].findPath);
    expect(hasLineOfSight.mock.calls.length).toBeLessThanOrEqual(operationBudget[mapId].lineOfSight);
    expect(traceShotDetailed.mock.calls.length).toBeLessThanOrEqual(operationBudget[mapId].shotTrace);
    expect(allEvents.length).toBeLessThanOrEqual(7_000);
    expect(peakGroundLoot).toBeLessThanOrEqual(300);
    expect(steps).toBeLessThanOrEqual(1_200);
  }, 600_000);
});

function outsideBuildingDoor(
  layout: ReturnType<typeof createMapLayout>,
  buildingId: string,
): { x: number; y: number; z: number } {
  const door = layout.wallOpenings.find((opening) =>
    opening.obstacleId === buildingId &&
    opening.storyIndex === 0 &&
    opening.kind === "door"
  );
  if (!door) throw new Error(`Ground door missing for ${buildingId}`);
  const z = door.center.z - 1.1;
  return {
    x: door.center.x,
    y: getTerrainHeight(door.center.x, z, layout) + 1.76,
    z,
  };
}

function nearestLandingZone(
  layout: ReturnType<typeof createMapLayout>,
  x: number,
  z: number,
): { x: number; y: number; z: number } {
  const point = [...layout.landingZones].sort((left, right) =>
    Math.hypot(left.position.x - x, left.position.z - z) -
      Math.hypot(right.position.x - x, right.position.z - z)
  )[0];
  if (!point) throw new Error("Mixed map landing zone missing");
  return {
    x: point.position.x,
    y: getTerrainHeight(point.position.x, point.position.z, layout) + 1.76,
    z: point.position.z,
  };
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

function mapSeedRandom(seed: number): () => number {
  let first = true;
  return () => {
    if (first) {
      first = false;
      return seed / 4_294_967_296;
    }
    return 0.5;
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
