import { describe, expect, it } from "vitest";
import { BUILDING_ROOF_CAP_HEIGHT, createMapLayout, getTerrainHeight } from "../../src/config/map";
import { BotController } from "../../src/controllers/BotController";
import { createBattleRoyaleState } from "../../src/game/modes/BattleRoyaleMode";
import { createWeaponState, getActiveWeapon } from "../../src/game/state/types";
import type { CombatWorld } from "../../src/game/systems/CombatSystem";
import { InventorySystem } from "../../src/game/systems/InventorySystem";
import { MovementSystem } from "../../src/game/systems/MovementSystem";
import { DamageSystem } from "../../src/game/systems/DamageSystem";
import { SimulationCombatWorld } from "../../src/game/systems/SimulationCombatWorld";

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

  it("assigns all 49 bots distinct descent headings", () => {
    const state = createBattleRoyaleState("player", undefined, seededRandom(2026));
    const bots = Object.values(state.actors).filter((actor) => actor.kind === "bot");
    const headings = bots.map((bot, index) => {
      bot.deployment = "parachuting";
      bot.position = { x: 0, y: 180, z: 0 };
      const command = new BotController(index + 1, seededRandom(8_000 + index)).update(bot, state, miss, 1 / 30, "player");
      return `${command.move.x.toFixed(6)}:${command.move.z.toFixed(6)}`;
    });

    expect(bots).toHaveLength(49);
    expect(new Set(headings)).toHaveLength(49);
  });

  it("uses independent non-uniform parachute timings", () => {
    const state = createBattleRoyaleState("player", undefined, () => 0.5);
    const bots = Object.values(state.actors).filter((actor) => actor.kind === "bot").slice(0, 16);
    const dropProgresses = bots.map((bot, index) => {
      bot.deployment = "aircraft";
      const controller = new BotController(index + 1, seededRandom(700 + index));
      for (let progress = 0; progress <= 1; progress += 0.01) {
        state.flight.progress = progress;
        if (controller.update(bot, state, miss, 1 / 30, "player").jump) return Math.round(progress * 100) / 100;
      }
      return 1;
    });
    expect(Math.min(...dropProgresses)).toBeGreaterThanOrEqual(0.12);
    expect(Math.max(...dropProgresses)).toBeLessThanOrEqual(0.89);
    expect(new Set(dropProgresses).size).toBeGreaterThanOrEqual(8);
  });

  it("does not target an actor hidden by world geometry", () => {
    const state = groundedState();
    state.safeZone.radius = 2_000;
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
    state.safeZone.radius = 2_000;
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
    expect(command.aimDirection.z).toBeCloseTo(0, 6);

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

  it("turns toward an unseen rooftop attacker and then pursues it", () => {
    const state = groundedState();
    state.safeZone.radius = 2_000;
    const layout = createMapLayout(state.mapSeed);
    const obstacle = layout.obstacles[0];
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!obstacle || !bot || !player) throw new Error("test setup missing");
    for (const actor of Object.values(state.actors)) actor.alive = actor.id === bot.id || actor.id === player.id;
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
    bot.yaw = Math.atan2(bot.position.x - player.position.x, bot.position.z - player.position.z);
    const world = new SimulationCombatWorld(state);
    expect(world.hasLineOfSight(bot.id, player.id)).toBe(true);
    new DamageSystem().applyDamage(state, bot.id, 5, player.id, []);
    const controller = new BotController(1, () => 0.5);

    const reaction = controller.update(bot, state, world, 1 / 30, player.id);

    expect(reaction.fire).toBe(false);
    expect(reaction.aimDirection.x).toBeGreaterThan(0.8);
    expect(reaction.aimDirection.y).toBeGreaterThan(0);
    new MovementSystem().processCommand(state, bot.id, reaction, 1 / 30);
    state.elapsedSeconds += 0.3;
    const pursuit = controller.update(bot, state, world, 0.3, player.id);
    expect(pursuit.fire).toBe(true);
    expect(Math.hypot(pursuit.move.x, pursuit.move.z)).toBeGreaterThan(0.5);
  });

  it("consumes cached roof-ramp waypoints at the production 30Hz fixed step", () => {
    const state = groundedState();
    const layout = createMapLayout(state.mapSeed);
    const obstacle = layout.obstacles[0];
    const ramp = layout.roofRamps[0];
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!obstacle || !ramp || !bot || !player) throw new Error("test setup missing");
    player.alive = false;
    state.safeZone.radius = 2_000;
    bot.position = {
      x: obstacle.center.x,
      y: obstacle.center.y + obstacle.height / 2 + BUILDING_ROOF_CAP_HEIGHT + 1.76,
      z: obstacle.center.z,
    };
    bot.inventory.weaponSlots = [null, null];
    const lootX = ramp.centerX;
    const lootZ = ramp.startZ + Math.sign(ramp.startZ - ramp.endZ) * 8;
    state.groundLoot.weapon = {
      id: "weapon",
      itemId: "weapon.rifle",
      quantity: 1,
      weapon: createWeaponState("rifle"),
      position: { x: lootX, y: getTerrainHeight(lootX, lootZ, layout) + 0.45, z: lootZ },
      available: true,
    };
    const controller = new BotController(1, () => 0.5);
    const movement = new MovementSystem();
    const inventory = new InventorySystem();

    for (let step = 0; step < 1_800 && !getActiveWeapon(bot); step += 1) {
      const command = controller.update(bot, state, miss, 1 / 30, "player");
      movement.processCommand(state, bot.id, command, 1 / 30);
      inventory.processCommand(state, bot.id, command, []);
    }

    expect(getActiveWeapon(bot)?.weaponId).toBe("rifle");
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

  it("prioritizes reaching the safe zone over fighting a visible enemy", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!bot || !player) throw new Error("actors missing");
    state.safeZone.center = { x: 0, y: 0, z: 0 };
    state.safeZone.radius = 40;
    bot.position = { x: 200, y: 1.76, z: 0 };
    bot.yaw = Math.PI;
    player.position = { x: 200, y: 1.76, z: 15 };

    const command = new BotController(1, () => 0.5).update(bot, state, miss, 1 / 30, "player");

    expect(command.fire).toBe(false);
    expect(command.move.x).toBeLessThan(-0.9);
    expect(Math.abs(command.move.z)).toBeLessThan(0.2);
    expect(command.sprint).toBe(true);
  });

  it("prioritizes reaching the safe zone over healing", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!bot || !player) throw new Error("actors missing");
    player.alive = false;
    state.safeZone.center = { x: 0, y: 0, z: 0 };
    state.safeZone.radius = 40;
    bot.position = { x: 200, y: 1.76, z: 0 };
    bot.health = 20;
    bot.inventory.backpack = [{ itemId: "medkit", quantity: 1 }];

    const command = new BotController(1, () => 0.5).update(bot, state, miss, 1 / 30, "player");

    expect(command.useItem).toBeNull();
    expect(command.move.x).toBeLessThan(-0.9);
    expect(command.sprint).toBe(true);
  });

  it("uses carried medicine when injured", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    if (!bot) throw new Error("bot missing");
    bot.position = { x: 0, y: 1.76, z: 0 };
    bot.health = 30;
    bot.inventory.backpack = [{ itemId: "medkit", quantity: 1 }];

    const command = new BotController(1, () => 0.5).update(bot, state, miss, 1, "player");

    expect(command.useItem).toBe("medkit");
    expect(command.move).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("patrols the late safe zone instead of standing at its center", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    if (!bot) throw new Error("bot missing");
    for (const actor of Object.values(state.actors)) {
      actor.alive = actor.id === bot.id;
    }
    state.safeZone.center = { x: 0, y: 0, z: 0 };
    state.safeZone.radius = 120;
    bot.position = { x: 0, y: getTerrainHeight(0, 0, state.mapSeed) + 1.76, z: 0 };
    state.groundLoot = {};

    const command = new BotController(1, () => 0.5).update(bot, state, miss, 1 / 30, "player");

    expect(Math.hypot(command.move.x, command.move.z)).toBeGreaterThan(0.9);
    expect(command.sprint).toBe(true);
  });

  it("patrols during the early game when no target or useful loot exists", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    if (!bot) throw new Error("bot missing");
    for (const actor of Object.values(state.actors)) {
      actor.deployment = actor.id === bot.id ? "grounded" : "aircraft";
    }
    state.safeZone.center = { x: 0, y: 0, z: 0 };
    state.safeZone.radius = 1_000;
    bot.position = { x: 0, y: getTerrainHeight(0, 0, state.mapSeed) + 1.76, z: 0 };
    state.groundLoot = {};

    const command = new BotController(1, () => 0.5).update(bot, state, miss, 1 / 30, "player");

    expect(Math.hypot(command.move.x, command.move.z)).toBeGreaterThan(0.9);
    expect(command.sprint).toBe(true);
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
    expect(Math.abs(command.move.z)).toBeLessThan(0.2);
  });

  it("skips unreachable loot instead of moving directly into it", () => {
    const state = groundedState();
    const obstacle = createMapLayout(state.mapSeed).wallSegments[0];
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
        position: { x: bot.position.x, y: 0.45, z: bot.position.z + 30 },
        available: true,
      },
    };

    const controller = new BotController(1, () => 0.5);
    const firstCommand = controller.update(bot, state, miss, 1, "player");
    const secondCommand = controller.update(bot, state, miss, 1, "player");

    expect(Math.abs(firstCommand.move.z)).toBeGreaterThan(0.2);
    expect(Math.abs(secondCommand.move.z)).toBeGreaterThan(0.2);
    expect(firstCommand.move.x > 0.9 && Math.abs(firstCommand.move.z) < 0.1).toBe(false);
    expect(secondCommand.move.x > 0.9 && Math.abs(secondCommand.move.z) < 0.1).toBe(false);
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
    expect(Math.abs(command.move.z)).toBeLessThan(0.2);
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
