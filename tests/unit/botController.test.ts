import { describe, expect, it } from "vitest";
import { BUILDING_ROOF_CAP_HEIGHT, createMapLayout, getTerrainHeight, MAP_OBSTACLES } from "../../src/config/map";
import { BotController } from "../../src/controllers/BotController";
import { createBattleRoyaleState } from "../../src/game/modes/BattleRoyaleMode";
import { getActiveWeapon } from "../../src/game/state/types";
import type { CombatWorld } from "../../src/game/systems/CombatSystem";
import { InventorySystem } from "../../src/game/systems/InventorySystem";
import { MovementSystem } from "../../src/game/systems/MovementSystem";

const miss: CombatWorld = { traceShot: () => null, hasLineOfSight: () => true };

describe("BotController", () => {
  it("assigns parachuting bots to different weapon landing points", () => {
    const state = createBattleRoyaleState("player", undefined, () => 0.5);
    const first = state.actors["bot-1"];
    const second = state.actors["bot-2"];
    if (!first || !second) throw new Error("bots missing");
    first.deployment = "parachuting";
    second.deployment = "parachuting";
    first.position = { x: 0, y: 100, z: 0 };
    second.position = { x: 0, y: 100, z: 0 };

    const firstCommand = new BotController(1, () => 0.5).update(first, state, miss, 1, "player");
    const secondCommand = new BotController(2, () => 0.5).update(second, state, miss, 1, "player");

    expect(firstCommand.move).not.toEqual(secondCommand.move);
  });

  it("does not target an actor hidden by world geometry", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!bot || !player) throw new Error("actors missing");
    bot.position = { x: 0, y: 1.76, z: 0 };
    player.position = { x: 0, y: 1.76, z: 10 };
    const blocked: CombatWorld = { traceShot: () => null, hasLineOfSight: () => false };

    const command = new BotController(1, () => 0.5).update(bot, state, blocked, 1, "player");

    expect(command.fire).toBe(false);
  });

  it("uses the matching roof ramp while pursuing a visible rooftop target", () => {
    const state = groundedState();
    const layout = createMapLayout(state.mapSeed);
    const obstacle = layout.obstacles[0];
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!obstacle || !bot || !player) throw new Error("test setup missing");
    const botX = obstacle.center.x - obstacle.width / 2 - 35;
    bot.position = {
      x: botX,
      y: getTerrainHeight(botX, obstacle.center.z, layout) + 1.76,
      z: obstacle.center.z,
    };
    player.position = {
      x: obstacle.center.x,
      y: obstacle.center.y + obstacle.height / 2 + BUILDING_ROOF_CAP_HEIGHT + 1.76,
      z: obstacle.center.z,
    };
    bot.yaw = Math.atan2(player.position.x - bot.position.x, player.position.z - bot.position.z);

    const controller = new BotController(1, () => 0.5);
    const command = controller.update(bot, state, miss, 1, "player");

    expect(command.move.x).toBeGreaterThan(0);
    expect(Math.abs(command.move.z)).toBeGreaterThan(0.1);
    expect(command.aimDirection.x).toBeGreaterThan(0);
    expect(Math.abs(command.aimDirection.z)).toBeLessThan(0.01);

    const movement = new MovementSystem();
    let maximumY = bot.position.y;
    for (let step = 0; step < 300; step += 1) {
      const nextCommand = controller.update(bot, state, miss, 0.1, "player");
      movement.processCommand(state, bot.id, nextCommand, 0.1);
      maximumY = Math.max(maximumY, bot.position.y);
    }
    const roofEyeY = obstacle.center.y + obstacle.height / 2 + BUILDING_ROOF_CAP_HEIGHT + 1.76;
    expect(maximumY).toBeCloseTo(roofEyeY, 1);
  });

  it("reloads rather than firing with an empty magazine", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!bot || !player) throw new Error("actors missing");
    bot.position = { x: 0, y: 1.76, z: 0 };
    player.position = { x: 0, y: 1.76, z: 10 };
    const weapon = getActiveWeapon(bot);
    if (!weapon) throw new Error("weapon missing");
    weapon.ammoInMagazine = 0;
    bot.inventory.backpack = [{ itemId: "ammo.rifle", quantity: 30 }];

    const command = new BotController(1, () => 0.5).update(bot, state, miss, 1, "player");

    expect(command.fire).toBe(false);
    expect(command.reload).toBe(true);
  });

  it("moves toward the safe zone when outside it", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!bot || !player) throw new Error("actors missing");
    bot.position = { x: 200, y: 1.76, z: 0 };
    player.alive = false;
    state.safeZone.center = { x: 0, y: 0, z: 0 };
    state.safeZone.radius = 40;

    const command = new BotController(1, () => 0.5).update(bot, state, miss, 1, "player");

    expect(command.move.x).toBeLessThan(0);
    expect(command.sprint).toBe(true);
  });

  it("uses carried medicine when injured", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    if (!bot) throw new Error("bot missing");
    bot.health = 30;
    bot.inventory.backpack = [{ itemId: "medkit", quantity: 1 }];

    const command = new BotController(1, () => 0.5).update(bot, state, miss, 1, "player");

    expect(command.useItem).toBe("medkit");
    expect(command.move).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("searches the whole map for a reachable weapon when unarmed", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!bot || !player) throw new Error("actors missing");
    bot.position = { x: 0, y: 1.76, z: 0 };
    bot.inventory.weaponSlots = [null, null];
    player.alive = false;
    state.groundLoot = {
      nearbyAmmo: {
        id: "nearbyAmmo",
        itemId: "ammo.rifle",
        quantity: 30,
        position: { x: 10, y: 0.45, z: 0 },
        available: true,
      },
      distantWeapon: {
        id: "distantWeapon",
        itemId: "weapon.rifle",
        quantity: 1,
        position: { x: 120, y: 0.45, z: 0 },
        available: true,
      },
    };

    const command = new BotController(1, () => 0.5).update(bot, state, miss, 1, "player");

    expect(command.move.x).toBeGreaterThan(0.9);
    expect(Math.abs(command.move.z)).toBeLessThan(0.1);
  });

  it("skips unreachable loot instead of moving directly into it", () => {
    const obstacle = MAP_OBSTACLES[0];
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!obstacle || !bot || !player) throw new Error("test setup missing");
    bot.position = {
      x: obstacle.center.x - obstacle.width / 2 - 10,
      y: 1.76,
      z: obstacle.center.z,
    };
    bot.inventory.weaponSlots = [null, null];
    player.alive = false;
    state.groundLoot = {
      blocked: {
        id: "blocked",
        itemId: "weapon.rifle",
        quantity: 1,
        position: { ...obstacle.center, y: 0.45 },
        available: true,
      },
      reachable: {
        id: "reachable",
        itemId: "weapon.smg",
        quantity: 1,
        position: { x: bot.position.x - 30, y: 0.45, z: bot.position.z },
        available: true,
      },
    };

    const controller = new BotController(1, () => 0.5);
    const firstCommand = controller.update(bot, state, miss, 1, "player");
    const secondCommand = controller.update(bot, state, miss, 1, "player");

    expect(firstCommand.move.x).toBeLessThan(-0.9);
    expect(secondCommand.move.x).toBeLessThan(-0.9);
  });

  it("recomputes the waypoint when the loot target changes", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!bot || !player) throw new Error("actors missing");
    bot.position = { x: 0, y: 1.76, z: 0 };
    player.alive = false;
    state.groundLoot = {
      east: {
        id: "east",
        itemId: "ammo.rifle",
        quantity: 30,
        position: { x: 30, y: 0.45, z: 0 },
        available: true,
      },
      west: {
        id: "west",
        itemId: "ammo.rifle",
        quantity: 30,
        position: { x: -35, y: 0.45, z: 0 },
        available: true,
      },
    };
    const controller = new BotController(1, () => 0.5);

    const firstCommand = controller.update(bot, state, miss, 1, "player");
    const east = state.groundLoot.east;
    if (!east) throw new Error("east loot missing");
    east.available = false;
    const secondCommand = controller.update(bot, state, miss, 1, "player");

    expect(firstCommand.move.x).toBeGreaterThan(0.9);
    expect(secondCommand.move.x).toBeLessThan(-0.9);
  });

  it("searches for compatible ammo instead of chasing an enemy with no ammunition", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!bot || !player) throw new Error("actors missing");
    bot.position = { x: 0, y: 1.76, z: 0 };
    player.position = { x: 0, y: 1.76, z: 10 };
    const weapon = getActiveWeapon(bot);
    if (!weapon) throw new Error("weapon missing");
    weapon.ammoInMagazine = 0;
    bot.inventory.backpack = [];
    state.groundLoot = {
      shells: {
        id: "shells",
        itemId: "ammo.shell",
        quantity: 12,
        position: { x: -8, y: 0.45, z: 0 },
        available: true,
      },
      rifleAmmo: {
        id: "rifleAmmo",
        itemId: "ammo.rifle",
        quantity: 30,
        position: { x: 20, y: 0.45, z: 0 },
        available: true,
      },
    };

    const command = new BotController(1, () => 0.5).update(bot, state, miss, 1, "player");

    expect(command.fire).toBe(false);
    expect(command.move.x).toBeGreaterThan(0.9);
    expect(Math.abs(command.move.z)).toBeLessThan(0.1);
  });

  it("drops incompatible supplies to pick compatible ammo when the backpack is full", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!bot || !player) throw new Error("actors missing");
    player.alive = false;
    bot.position = { x: 0, y: 1.76, z: 0 };
    const weapon = getActiveWeapon(bot);
    if (!weapon) throw new Error("weapon missing");
    weapon.ammoInMagazine = 0;
    bot.inventory.maxBackpackStacks = 6;
    bot.inventory.backpack = Array.from({ length: 6 }, () => ({ itemId: "ammo.shell", quantity: 1 }));
    state.groundLoot = {
      rifleAmmo: {
        id: "rifleAmmo",
        itemId: "ammo.rifle",
        quantity: 30,
        position: { x: 1, y: 0.45, z: 0 },
        available: true,
      },
    };

    const controller = new BotController(1, () => 0.5);
    const command = controller.update(bot, state, miss, 1, "player");
    new InventorySystem().processCommand(state, bot.id, command, []);
    const cachedCommand = controller.update(bot, state, miss, 0.01, "player");

    expect(command).toMatchObject({ interact: true, dropItem: "ammo.shell" });
    expect(bot.inventory.backpack.some((stack) => stack.itemId === "ammo.rifle")).toBe(true);
    expect(state.groundLoot.rifleAmmo?.available).toBe(false);
    expect(cachedCommand.dropItem).toBeNull();
    expect(cachedCommand.interact).toBe(false);
  });
});

function groundedState() {
  const state = createBattleRoyaleState("player", undefined, () => 0.5);
  for (const actor of Object.values(state.actors)) {
    actor.deployment = "grounded";
    actor.inventory.weaponSlots[0] = {
      weaponId: "rifle",
      ammoInMagazine: 30,
      cooldownSeconds: 0,
      reloadSeconds: 0,
    };
  }
  state.phase = "combat";
  state.groundLoot = {};
  return state;
}
