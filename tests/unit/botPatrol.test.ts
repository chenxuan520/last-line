import { describe, expect, it } from "vitest";
import { GridNavigator } from "../../src/ai/navigation/GridNavigator";
import { createMapLayout, getTerrainHeight, MAP_HALF_SIZE } from "../../src/config/map";
import type { MapId } from "../../src/config/maps";
import { BotController } from "../../src/controllers/BotController";
import { createBattleRoyaleState } from "../../src/game/modes/BattleRoyaleMode";
import { ACTOR_RADIUS } from "../../src/game/rules/actorGeometry";
import { createWeaponState, type Vector3State } from "../../src/game/state/types";
import type { CombatWorld } from "../../src/game/systems/CombatSystem";
import { InventorySystem } from "../../src/game/systems/InventorySystem";

const hiddenWorld: CombatWorld = { traceShot: () => null, hasLineOfSight: () => false };

function patrolState(mapId: MapId = "island") {
  const state = createBattleRoyaleState("player", undefined, () => 0.5, { mapId });
  state.mapSeed = 7;
  state.phase = "combat";
  state.groundLoot = {};
  state.safeZone.center = state.safeZone.targetCenter = { x: 0, y: 0, z: 0 };
  state.safeZone.radius = state.safeZone.targetRadius = 1_200;
  state.safeZone.status = "waiting";
  state.safeZone.secondsRemaining = 120;
  return state;
}

describe("bot patrol and supplies", () => {
  it("keeps ordinary patrols near separate landing areas across all three maps", () => {
    for (const mapId of ["island", "town", "mixed"] as const) {
      const state = patrolState(mapId);
      const layout = createMapLayout(mapId, state.mapSeed);
      const navigator = new GridNavigator(layout);
      const origins = layout.landingZones.filter((zone) =>
        Math.hypot(zone.position.x, zone.position.z) > 400 &&
        Math.hypot(zone.position.x, zone.position.z) < 1_000
      ).slice(0, 2);
      expect(origins.length, mapId).toBe(2);
      for (const [index, origin] of origins.entries()) {
        const bot = state.actors[`bot-${index + 1}`]!;
        bot.position = { ...origin.position };
        bot.deployment = "grounded";
        bot.inventory.weaponSlots = [createWeaponState("rifle"), null];
        bot.inventory.backpack = [];
        const controller = new BotController(index + 1, () => 0.5, false, layout, navigator);
        const command = controller.update(bot, state, hiddenWorld, 1 / 30, "player");
        const navigation = controller as unknown as {
          navigationTarget: Vector3State | null;
          navigationPath: Vector3State[];
        };
        const target = navigation.navigationTarget;
        expect(target, `${mapId} ${bot.id}`).not.toBeNull();
        expect(Math.hypot(target!.x - bot.position.x, target!.z - bot.position.z), mapId).toBeLessThanOrEqual(180);
        expect(Math.hypot(target!.x, target!.z), mapId).toBeLessThanOrEqual(1_170);
        expect(navigation.navigationPath.length, mapId).toBeGreaterThan(0);
        expect(Math.hypot(command.move.x, command.move.z), mapId).toBeGreaterThan(0);
      }
    }
  }, 30_000);

  it("keeps local patrol targets inside the map and the allowed safe circle", () => {
    const state = patrolState();
    const layout = createMapLayout(state.mapId, state.mapSeed);
    const navigator = new GridNavigator(layout);
    const bot = state.actors["bot-2"]!;
    bot.deployment = "grounded";
    bot.inventory.weaponSlots = [createWeaponState("rifle"), null];
    for (const [x, z, zoneRadius] of [[1_195, 1_195, 2_000], [1_167, 0, 1_200]]) {
      bot.position = { x: x!, y: getTerrainHeight(x!, z!, layout) + 1.76, z: z! };
      state.safeZone.radius = state.safeZone.targetRadius = zoneRadius!;
      const controller = new BotController(2, () => 0.5, false, layout, navigator);
      controller.update(bot, state, hiddenWorld, 1 / 30, "player");
      const target = (controller as unknown as { navigationTarget: Vector3State | null }).navigationTarget;
      expect(target).not.toBeNull();
      expect(Math.abs(target!.x)).toBeLessThanOrEqual(MAP_HALF_SIZE - ACTOR_RADIUS);
      expect(Math.abs(target!.z)).toBeLessThanOrEqual(MAP_HALF_SIZE - ACTOR_RADIUS);
      expect(Math.hypot(target!.x, target!.z)).toBeLessThanOrEqual(zoneRadius! - 30);
    }
  });

  it("collects ammunition for both carried guns instead of filling slots with incompatible ammo", () => {
    const state = patrolState();
    const layout = createMapLayout(state.mapId, state.mapSeed);
    const bot = state.actors["bot-1"]!;
    bot.position = { x: 0, y: getTerrainHeight(0, 0, layout) + 1.76, z: 0 };
    bot.deployment = "grounded";
    bot.inventory.weaponSlots = [createWeaponState("rifle"), createWeaponState("shotgun")];
    bot.inventory.backpack = [];
    state.groundLoot = Object.fromEntries([
      ["unusable", "ammo.light", 0.5],
      ["rifle", "ammo.rifle", 1],
      ["shells", "ammo.shell", 1.5],
    ].map(([id, itemId, x]) => [id, {
      id: id as string,
      itemId: itemId as string,
      quantity: 10,
      position: { x: x as number, y: bot.position.y - 1.31, z: 0 },
      available: true,
    }]));
    const controller = new BotController(1, () => 0.5, false, layout);
    const inventory = new InventorySystem(layout);
    const first = controller.update(bot, state, hiddenWorld, 1, "player");
    expect(first.interactLootId).toBe("rifle");
    inventory.processCommand(state, bot.id, first, []);
    state.elapsedSeconds += 1;
    const second = controller.update(bot, state, hiddenWorld, 1, "player");
    expect(second.interactLootId).toBe("shells");
    inventory.processCommand(state, bot.id, second, []);
    expect(bot.inventory.backpack).toEqual([
      { itemId: "ammo.rifle", quantity: 10 },
      { itemId: "ammo.shell", quantity: 10 },
    ]);
    expect(state.groundLoot.unusable!.available).toBe(true);
  });
});
