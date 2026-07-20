import { describe, expect, it } from "vitest";
import { BUILDING_ROOF_CAP_HEIGHT, createMapLayout, getTerrainHeight } from "../../src/config/map";
import { BotController } from "../../src/controllers/BotController";
import { createIdleCommand } from "../../src/game/commands/ActorCommand";
import { createBattleRoyaleState } from "../../src/game/modes/BattleRoyaleMode";
import { createWeaponState, getActiveWeapon, type Vector3State } from "../../src/game/state/types";
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

  it("settles over its parachute target without repeated steering reversals", () => {
    const state = createBattleRoyaleState("player", undefined, seededRandom(77));
    const bot = state.actors["bot-1"];
    if (!bot) throw new Error("bot missing");
    const controller = new BotController(1, seededRandom(901));
    const target = (controller as unknown as {
      findLandingTarget(matchState: typeof state): Vector3State;
    }).findLandingTarget(state);
    bot.deployment = "parachuting";
    bot.position = {
      x: target.x + 8,
      y: getTerrainHeight(target.x + 8, target.z, state.mapSeed) + 120,
      z: target.z,
    };
    const movement = new MovementSystem();
    let previousDirection: Vector3State | null = null;
    let reversals = 0;
    for (let tick = 0; tick < 180; tick += 1) {
      const command = controller.update(bot, state, miss, 1 / 30, "player");
      const magnitude = Math.hypot(command.move.x, command.move.z);
      if (magnitude > 0.05) {
        const direction = { x: command.move.x / magnitude, y: 0, z: command.move.z / magnitude };
        if (previousDirection && direction.x * previousDirection.x + direction.z * previousDirection.z < -0.5) {
          reversals += 1;
        }
        previousDirection = direction;
      }
      movement.processCommand(state, bot.id, command, 1 / 30);
    }

    expect(reversals).toBeLessThanOrEqual(1);
    expect(Math.hypot(bot.position.x - target.x, bot.position.z - target.z)).toBeLessThanOrEqual(0.8);
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

  it("fires while moving toward cover at twenty-five health", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!bot || !player) throw new Error("actors missing");
    for (const actor of Object.values(state.actors)) actor.alive = actor.id === bot.id || actor.id === player.id;
    bot.position = { x: 0, y: 1.76, z: 0 };
    bot.health = 25;
    bot.yaw = Math.PI / 2;
    player.position = { x: 20, y: 1.76, z: 0 };

    const command = new BotController(1, () => 0.5).update(bot, state, miss, 1, player.id);

    expect(command.fire).toBe(true);
    expect(command.useItem).toBeNull();
    expect(Math.hypot(command.move.x, command.move.z)).toBeGreaterThan(0.5);
    expect(command.sprint).toBe(true);
  });

  it("keeps fighting above the twenty-five health retreat threshold", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!bot || !player) throw new Error("actors missing");
    for (const actor of Object.values(state.actors)) actor.alive = actor.id === bot.id || actor.id === player.id;
    bot.position = { x: 0, y: 1.76, z: 0 };
    bot.health = 26;
    bot.yaw = Math.PI / 2;
    player.position = { x: 20, y: 1.76, z: 0 };

    const command = new BotController(1, () => 0.5).update(bot, state, miss, 1, player.id);

    expect(command.fire).toBe(true);
  });

  it("heals only after low-health retreat breaks line of sight", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!bot || !player) throw new Error("actors missing");
    for (const actor of Object.values(state.actors)) actor.alive = actor.id === bot.id || actor.id === player.id;
    bot.position = { x: 0, y: 1.76, z: 0 };
    bot.health = 20;
    bot.yaw = Math.PI / 2;
    bot.inventory.backpack.push({ itemId: "medkit", quantity: 1 });
    player.position = { x: 20, y: 1.76, z: 0 };
    let visible = true;
    const world: CombatWorld = { traceShot: () => null, hasLineOfSight: () => visible };
    const controller = new BotController(1, () => 0.5);

    const retreat = controller.update(bot, state, world, 1, player.id);
    visible = false;
    state.elapsedSeconds += 1;
    const heal = controller.update(bot, state, world, 1, player.id);

    expect(retreat.useItem).toBeNull();
    expect(retreat.fire).toBe(true);
    expect(heal.useItem).toBe("medkit");
    expect(heal.move).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("searches for reachable medicine after retreating without healing supplies", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!bot || !player) throw new Error("actors missing");
    for (const actor of Object.values(state.actors)) actor.alive = actor.id === bot.id || actor.id === player.id;
    bot.position = { x: 0, y: 1.76, z: 0 };
    bot.health = 20;
    bot.yaw = Math.PI / 2;
    bot.inventory.backpack = [];
    player.position = { x: 20, y: 1.76, z: 0 };
    state.safeZone.radius = 200;
    state.safeZone.targetRadius = 20;
    state.groundLoot.medkit = {
      id: "medkit",
      itemId: "medkit",
      quantity: 1,
      position: { x: -40, y: 0.45, z: 0 },
      available: true,
    };
    let visible = true;
    const world: CombatWorld = { traceShot: () => null, hasLineOfSight: () => visible };
    const controller = new BotController(1, () => 0.5);

    controller.update(bot, state, world, 1, player.id);
    visible = false;
    state.elapsedSeconds += 1;
    const hiding = controller.update(bot, state, world, 1, player.id);
    state.elapsedSeconds += 1.1;
    const search = controller.update(bot, state, world, 1.1, player.id);

    expect(hiding.move).toEqual({ x: 0, y: 0, z: 0 });
    expect(search.useItem).toBeNull();
    expect(search.fire).toBe(false);
    expect(Math.hypot(search.move.x, search.move.z)).toBeGreaterThan(0.5);
    expect(search.aimDirection.x).toBeLessThan(-0.5);
  });

  it("leaves cover to patrol after confirming LOS loss when no medicine exists", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!bot || !player) throw new Error("actors missing");
    for (const actor of Object.values(state.actors)) actor.alive = actor.id === bot.id || actor.id === player.id;
    bot.position = { x: 0, y: 1.76, z: 0 };
    bot.health = 20;
    bot.yaw = Math.PI / 2;
    bot.inventory.backpack = [];
    player.position = { x: 20, y: 1.76, z: 0 };
    state.groundLoot = {};
    let visible = true;
    const world: CombatWorld = { traceShot: () => null, hasLineOfSight: () => visible };
    const controller = new BotController(1, () => 0.5);

    controller.update(bot, state, world, 1, player.id);
    visible = false;
    state.elapsedSeconds += 1;
    const hiding = controller.update(bot, state, world, 1, player.id);
    state.elapsedSeconds += 1.1;
    const patrol = controller.update(bot, state, world, 1.1, player.id);

    expect(hiding.move).toEqual({ x: 0, y: 0, z: 0 });
    expect(Math.hypot(patrol.move.x, patrol.move.z)).toBeGreaterThan(0.5);
    expect(patrol.useItem).toBeNull();
  });

  it("switches to a loaded secondary weapon when the active magazine is empty", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!bot || !player) throw new Error("actors missing");
    for (const actor of Object.values(state.actors)) actor.alive = actor.id === bot.id || actor.id === player.id;
    bot.position = { x: 0, y: 1.76, z: 0 };
    bot.yaw = Math.PI / 2;
    player.position = { x: 20, y: 1.76, z: 0 };
    bot.inventory.weaponSlots = [createWeaponState("rifle", false), createWeaponState("smg")];
    bot.inventory.activeWeaponSlot = 0;
    bot.inventory.backpack = [];

    const command = new BotController(1, () => 0.5).update(bot, state, miss, 1, player.id);
    new InventorySystem().processCommand(state, bot.id, command, []);

    expect(command.switchWeapon).toBe(1);
    expect(command.fire).toBe(false);
    expect(bot.inventory.activeWeaponSlot).toBe(1);
  });

  it("retreats from a visible enemy when both weapons are completely out of ammo", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!bot || !player) throw new Error("actors missing");
    for (const actor of Object.values(state.actors)) actor.alive = actor.id === bot.id || actor.id === player.id;
    bot.position = { x: 0, y: 1.76, z: 0 };
    bot.yaw = Math.PI / 2;
    player.position = { x: 20, y: 1.76, z: 0 };
    bot.inventory.weaponSlots = [createWeaponState("rifle", false), createWeaponState("smg", false)];
    bot.inventory.backpack = [];

    const command = new BotController(1, () => 0.5).update(bot, state, miss, 1, player.id);

    expect(command.fire).toBe(false);
    expect(command.reload).toBe(false);
    expect(Math.hypot(command.move.x, command.move.z)).toBeGreaterThan(0.5);
  });

  it("rotates away from a blocked retreat direction instead of staying against a real wall", () => {
    const state = groundedState();
    state.mapSeed = 0;
    const layout = createMapLayout(0);
    const wall = layout.wallSegments.find((candidate) =>
      candidate.width > candidate.depth * 2 &&
      candidate.height > 3 &&
      candidate.center.y - candidate.height / 2 <= getTerrainHeight(candidate.center.x, candidate.center.z, layout) + 0.2
    );
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!wall || !bot || !player) throw new Error("wall retreat setup missing");
    for (const actor of Object.values(state.actors)) actor.alive = actor.id === bot.id || actor.id === player.id;
    const x = wall.center.x + wall.width / 2 - 2.5;
    const z = wall.center.z - wall.depth / 2 - 0.421;
    bot.position = { x, y: getTerrainHeight(x, z, layout) + 1.76, z };
    bot.health = 20;
    bot.yaw = Math.PI;
    bot.inventory.backpack = [];
    player.position = { x, y: getTerrainHeight(x, z - 20, layout) + 1.76, z: z - 20 };
    const world = new SimulationCombatWorld(state);
    expect(world.hasLineOfSight(bot.id, player.id)).toBe(true);
    const controller = new BotController(1, () => 0.5);
    const movement = new MovementSystem();
    const damage = new DamageSystem();
    const start = { ...bot.position };
    let stalledTicks = 0;
    let maximumStalledTicks = 0;

    for (let tick = 0; tick < 180; tick += 1) {
      if (tick % 6 === 0) damage.applyDamage(state, bot.id, 0.05, player.id, []);
      const before = { ...bot.position };
      const command = controller.update(bot, state, world, 1 / 30, player.id);
      movement.processCommand(state, bot.id, command, 1 / 30);
      state.elapsedSeconds += 1 / 30;
      const intendedMove = Math.hypot(command.move.x, command.move.z) > 0.1;
      const moved = Math.hypot(bot.position.x - before.x, bot.position.z - before.z);
      stalledTicks = intendedMove && moved < 0.01 ? stalledTicks + 1 : 0;
      maximumStalledTicks = Math.max(maximumStalledTicks, stalledTicks);
    }

    expect(
      Math.hypot(bot.position.x - start.x, bot.position.z - start.z) > 2 ||
      !world.hasLineOfSight(bot.id, player.id),
    ).toBe(true);
    expect(maximumStalledTicks).toBeLessThan(45);
  });

  it("clears the previous retreat path when the visible threat changes", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    const nextThreat = state.actors["bot-2"];
    if (!bot || !player || !nextThreat) throw new Error("threat switch setup missing");
    for (const actor of Object.values(state.actors)) {
      actor.alive = actor.id === bot.id || actor.id === player.id;
    }
    bot.position = { x: 0, y: 1.76, z: 0 };
    bot.health = 20;
    bot.yaw = Math.PI / 2;
    player.position = { x: 20, y: 1.76, z: 0 };
    nextThreat.position = { x: -20, y: 1.76, z: 0 };
    const controller = new BotController(1, () => 0.5);
    controller.update(bot, state, miss, 1, player.id);
    const internals = controller as unknown as {
      navigationPath: Vector3State[];
      navigationTarget: Vector3State | null;
      waypointIndex: number;
      navigationPreservesAim: boolean;
    };
    const staleTarget = { x: 0, y: 1.76, z: 100 };
    internals.navigationPath = [{ ...bot.position }, staleTarget];
    internals.navigationTarget = staleTarget;
    internals.waypointIndex = 1;
    internals.navigationPreservesAim = true;
    player.alive = false;
    for (const actor of Object.values(state.actors)) actor.alive = actor.id === bot.id;
    nextThreat.alive = true;
    bot.yaw = -Math.PI / 2;
    state.elapsedSeconds += 1;

    controller.update(bot, state, miss, 1, player.id);

    expect(internals.navigationTarget).not.toEqual(staleTarget);
  });

  it("uses the matching roof ramp while pursuing a visible rooftop target", () => {
    const state = groundedState();
    state.safeZone.radius = 2_000;
    const layout = createMapLayout(state.mapSeed);
    const obstacle = layout.obstacles.find((entry) => entry.storyCount === 1);
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

  it("climbs every internal ramp while pursuing a three-story rooftop target", () => {
    const state = groundedState();
    state.safeZone.radius = 2_000;
    const layout = createMapLayout(state.mapSeed);
    const building = layout.obstacles.find((entry) => entry.storyCount === 3);
    const firstRamp = layout.roofRamps.find((entry) => entry.obstacleId === building?.id && entry.fromLevel === 0);
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!building || !firstRamp || !bot || !player) throw new Error("multi-story test setup missing");
    for (const actor of Object.values(state.actors)) actor.alive = actor.id === bot.id || actor.id === player.id;
    bot.position = {
      x: firstRamp.centerX,
      y: firstRamp.bottomY + 1.76,
      z: firstRamp.startZ,
    };
    player.position = {
      x: building.center.x,
      y: building.baseY + building.storyHeight * building.storyCount + BUILDING_ROOF_CAP_HEIGHT + 1.76,
      z: building.center.z,
    };
    bot.yaw = Math.atan2(player.position.x - bot.position.x, player.position.z - bot.position.z);
    const controller = new BotController(1, () => 0.5);
    const movement = new MovementSystem();
    let maximumY = bot.position.y;

    for (let step = 0; step < 2_400; step += 1) {
      const command = controller.update(bot, state, miss, 1 / 30, player.id);
      movement.processCommand(state, bot.id, command, 1 / 30);
      state.elapsedSeconds += 1 / 30;
      maximumY = Math.max(maximumY, bot.position.y);
    }

    expect(maximumY).toBeCloseTo(player.position.y, 1);
  });

  it("keeps pursuing the last visible rooftop position through a temporary LOS loss", () => {
    const state = groundedState();
    const layout = createMapLayout(state.mapSeed);
    const obstacle = layout.obstacles.find((entry) => entry.storyCount === 1);
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!obstacle || !bot || !player) throw new Error("test setup missing");
    const botX = obstacle.center.x - obstacle.width / 2 - 35;
    bot.position = { x: botX, y: getTerrainHeight(botX, obstacle.center.z, layout) + 1.76, z: obstacle.center.z };
    player.position = {
      x: obstacle.center.x,
      y: obstacle.center.y + obstacle.height / 2 + BUILDING_ROOF_CAP_HEIGHT + 1.76,
      z: obstacle.center.z,
    };
    bot.yaw = Math.atan2(player.position.x - bot.position.x, player.position.z - bot.position.z);
    let visible = true;
    const world: CombatWorld = { traceShot: () => null, hasLineOfSight: () => visible };
    const controller = new BotController(1, () => 0.5);

    controller.update(bot, state, world, 1, player.id);
    visible = false;
    state.elapsedSeconds += 1;
    const hiddenCommand = controller.update(bot, state, world, 1, player.id);

    expect(Math.hypot(hiddenCommand.move.x, hiddenCommand.move.z)).toBeGreaterThan(0.5);
    expect(hiddenCommand.aimDirection.x).toBeGreaterThan(0.8);
    expect(hiddenCommand.fire).toBe(false);
  });

  it("turns toward an unseen rooftop attacker and then pursues it", () => {
    const state = groundedState();
    state.safeZone.radius = 2_000;
    const layout = createMapLayout(state.mapSeed);
    const obstacle = layout.obstacles.find((entry) => entry.storyCount === 1);
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
    const obstacle = layout.obstacles.find((entry) => entry.storyCount === 1);
    const ramp = layout.roofRamps.find((entry) => entry.obstacleId === obstacle?.id);
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
    state.safeZone.targetCenter = { x: 0, y: 0, z: 0 };
    state.safeZone.targetRadius = 40;

    const command = new BotController(1, () => 0.5).update(bot, state, miss, 1, "player");

    expect(command.move.x).toBeLessThan(0);
    expect(command.sprint).toBe(true);
  });

  it("clears stale navigation when every safe-zone path fails", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!bot || !player) throw new Error("actors missing");
    player.alive = false;
    for (const actor of Object.values(state.actors)) actor.alive = actor.id === bot.id;
    bot.position = { x: 200, y: 1.76, z: 0 };
    state.safeZone.center = { x: 0, y: 0, z: 0 };
    state.safeZone.radius = 40;
    state.safeZone.targetCenter = { x: 0, y: 0, z: 0 };
    state.safeZone.targetRadius = 10;
    const controller = new BotController(1, () => 0.5);
    let pathSearches = 0;
    const internal = controller as unknown as {
      navigator: { findPath(): Vector3State[] };
      navigationPath: Vector3State[];
      navigationTarget: Vector3State | null;
      waypointIndex: number;
      navigatorSeed: number;
    };
    internal.navigator = { findPath: () => {
      pathSearches += 1;
      return [];
    } };
    internal.navigationPath = [
      { ...bot.position },
      { x: 300, y: bot.position.y, z: 0 },
    ];
    internal.navigationTarget = { x: 300, y: bot.position.y, z: 0 };
    internal.waypointIndex = 1;
    internal.navigatorSeed = state.mapSeed;

    const decision = controller.update(bot, state, miss, 1 / 30, player.id);
    const cached = controller.update(bot, state, miss, 1 / 30, player.id);
    for (let tick = 0; tick < 30; tick += 1) {
      state.elapsedSeconds += 1 / 30;
      state.safeZone.radius -= 0.1;
      controller.update(bot, state, miss, 1 / 30, player.id);
    }

    expect(decision.move.x).toBeLessThan(-0.9);
    expect(cached.move.x).toBeLessThan(-0.9);
    expect(internal.navigationPath).toHaveLength(0);
    expect(internal.navigationTarget).toBeNull();
    expect(pathSearches).toBeLessThanOrEqual(10);
  });

  it("abandons forced relocation immediately after falling outside the current zone", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!bot || !player) throw new Error("actors missing");
    player.alive = false;
    bot.position = { x: 200, y: 1.76, z: 0 };
    state.safeZone.center = { x: 0, y: 0, z: 0 };
    state.safeZone.radius = 40;
    state.safeZone.targetCenter = { x: 0, y: 0, z: 0 };
    state.safeZone.targetRadius = 40;
    state.elapsedSeconds = 10;
    const controller = new BotController(1, () => 0.5);
    const internal = controller as unknown as {
      forcedRelocationOrigin: Vector3State | null;
      forcedRelocationTarget: Vector3State | null;
      forcedRelocationUntilSeconds: number;
    };
    internal.forcedRelocationOrigin = { ...bot.position };
    internal.forcedRelocationTarget = { x: 300, y: bot.position.y, z: 0 };
    internal.forcedRelocationUntilSeconds = 30;

    const command = controller.update(bot, state, miss, 1 / 30, player.id);

    expect(command.move.x).toBeLessThan(-0.9);
    expect(internal.forcedRelocationTarget).toBeNull();
    expect(internal.forcedRelocationUntilSeconds).toBe(-1);
  });

  it("leaves a building through its door when rotating into the safe zone", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!bot || !player) throw new Error("actors missing");
    player.alive = false;
    state.groundLoot = {};
    state.mapSeed = 99;
    const layout = createMapLayout(state.mapSeed);
    const building = layout.obstacles.find((candidate) => candidate.id === layout.hospital.buildingId);
    if (!building) throw new Error("building missing");
    bot.position = {
      x: building.center.x,
      y: getTerrainHeight(building.center.x, building.center.z, layout) + 1.76,
      z: building.center.z,
    };
    state.safeZone.center = { x: building.center.x, y: 0, z: building.center.z + 500 };
    state.safeZone.radius = 40;
    state.safeZone.targetCenter = { ...state.safeZone.center };
    state.safeZone.targetRadius = 40;
    const initialDistance = Math.hypot(
      bot.position.x - state.safeZone.center.x,
      bot.position.z - state.safeZone.center.z,
    );
    const controller = new BotController(1, () => 0.5);
    const movement = new MovementSystem();
    const navigation = controller as unknown as {
      navigationPath: Vector3State[];
      navigationTarget: Vector3State | null;
      waypointIndex: number;
    };
    for (let tick = 0; tick < 600; tick += 1) {
      state.elapsedSeconds += 1 / 30;
      const command = controller.update(bot, state, miss, 1 / 30, player.id);
      movement.processCommand(state, bot.id, command, 1 / 30);
    }

    expect(Math.hypot(
      bot.position.x - state.safeZone.center.x,
      bot.position.z - state.safeZone.center.z,
    )).toBeLessThan(initialDistance - 5);
    const stillInside = Math.abs(bot.position.x - building.center.x) < building.width / 2 &&
      Math.abs(bot.position.z - building.center.z) < building.depth / 2;
    expect(stillInside, JSON.stringify({
      position: bot.position,
      building: { center: building.center, width: building.width, depth: building.depth, baseY: building.baseY },
      navigationPath: navigation.navigationPath,
      navigationTarget: navigation.navigationTarget,
      waypointIndex: navigation.waypointIndex,
    })).toBe(false);
  });

  it("moves into the next target zone before the current zone starts shrinking", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!bot || !player) throw new Error("actors missing");
    player.alive = false;
    bot.position = { x: 0, y: getTerrainHeight(0, 0, state.mapSeed) + 1.76, z: 0 };
    state.safeZone.center = { x: 0, y: 0, z: 0 };
    state.safeZone.radius = 1_000;
    state.safeZone.targetCenter = { x: 240, y: 0, z: 0 };
    state.safeZone.targetRadius = 60;
    state.safeZone.status = "waiting";
    state.safeZone.secondsRemaining = 90;

    const command = new BotController(1, () => 0.5).update(bot, state, miss, 1 / 30, player.id);

    expect(command.move.x).toBeGreaterThan(0.9);
    expect(command.sprint).toBe(true);
  });

  it("picks up a weapon at its feet before rotating into the next zone", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!bot || !player) throw new Error("actors missing");
    player.alive = false;
    bot.inventory.weaponSlots = [null, null];
    bot.position = { x: 0, y: getTerrainHeight(0, 0, state.mapSeed) + 1.76, z: 0 };
    state.safeZone.targetCenter = { x: 500, y: 0, z: 0 };
    state.safeZone.targetRadius = 60;
    state.groundLoot.weapon = {
      id: "weapon",
      itemId: "weapon.rifle",
      quantity: 1,
      weapon: createWeaponState("rifle"),
      position: { x: 0, y: bot.position.y - 1.31, z: 0 },
      available: true,
    };

    const command = new BotController(1, () => 0.5).update(bot, state, miss, 1 / 30, player.id);

    expect(command.interact).toBe(true);
    expect(command.move).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("takes a short weapon detour before rotating into the next zone", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!bot || !player) throw new Error("actors missing");
    player.alive = false;
    bot.inventory.weaponSlots = [null, null];
    bot.position = { x: 0, y: getTerrainHeight(0, 0, state.mapSeed) + 1.76, z: 0 };
    state.safeZone.targetCenter = { x: 500, y: 0, z: 0 };
    state.safeZone.targetRadius = 60;
    state.groundLoot.weapon = {
      id: "weapon",
      itemId: "weapon.rifle",
      quantity: 1,
      weapon: createWeaponState("rifle"),
      position: { x: -80, y: getTerrainHeight(-80, 0, state.mapSeed) + 0.45, z: 0 },
      available: true,
    };

    const command = new BotController(1, () => 0.5).update(bot, state, miss, 1 / 30, player.id);

    expect(command.move.x).toBeLessThan(-0.9);
    expect(command.sprint).toBe(true);
  });

  it("does not detour to a nearby weapon outside the current zone", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!bot || !player) throw new Error("actors missing");
    player.alive = false;
    bot.inventory.weaponSlots = [null, null];
    bot.position = { x: 0, y: getTerrainHeight(0, 0, state.mapSeed) + 1.76, z: 0 };
    state.safeZone.center = { x: 0, y: 0, z: 0 };
    state.safeZone.radius = 100;
    state.safeZone.targetCenter = { x: 500, y: 0, z: 0 };
    state.safeZone.targetRadius = 60;
    state.groundLoot.weapon = {
      id: "weapon",
      itemId: "weapon.rifle",
      quantity: 1,
      weapon: createWeaponState("rifle"),
      position: { x: -110, y: getTerrainHeight(-110, 0, state.mapSeed) + 0.45, z: 0 },
      available: true,
    };

    const command = new BotController(1, () => 0.5).update(bot, state, miss, 1 / 30, player.id);

    expect(command.move.x).toBeGreaterThan(0.9);
  });

  it("does not leave the target zone for a nearby weapon after arriving", () => {
    const withWeapon = groundedState();
    const withoutWeapon = groundedState();
    for (const state of [withWeapon, withoutWeapon]) {
      const bot = state.actors["bot-1"];
      const player = state.actors.player;
      if (!bot || !player) throw new Error("actors missing");
      player.alive = false;
      bot.inventory.weaponSlots = [null, null];
      bot.position = { x: 0, y: getTerrainHeight(0, 0, state.mapSeed) + 1.76, z: 0 };
      state.safeZone.center = { x: 0, y: 0, z: 0 };
      state.safeZone.radius = 1_000;
      state.safeZone.targetCenter = { x: 0, y: 0, z: 0 };
      state.safeZone.targetRadius = 60;
    }
    withWeapon.groundLoot.weapon = {
      id: "weapon",
      itemId: "weapon.rifle",
      quantity: 1,
      weapon: createWeaponState("rifle"),
      position: { x: 80, y: getTerrainHeight(80, 0, withWeapon.mapSeed) + 0.45, z: 0 },
      available: true,
    };

    const withWeaponCommand = new BotController(1, () => 0.5).update(
      withWeapon.actors["bot-1"]!, withWeapon, miss, 1 / 30, "player",
    );
    const withoutWeaponCommand = new BotController(1, () => 0.5).update(
      withoutWeapon.actors["bot-1"]!, withoutWeapon, miss, 1 / 30, "player",
    );

    expect(withWeaponCommand).toEqual(withoutWeaponCommand);
  });

  it("prioritizes reaching the safe zone over fighting a visible enemy", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!bot || !player) throw new Error("actors missing");
    state.safeZone.center = { x: 0, y: 0, z: 0 };
    state.safeZone.radius = 40;
    state.safeZone.targetCenter = { x: 0, y: 0, z: 0 };
    state.safeZone.targetRadius = 40;
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
    state.safeZone.targetCenter = { x: 0, y: 0, z: 0 };
    state.safeZone.targetRadius = 40;
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

  it("lets a new hit override stale combat memory", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    const attacker = state.actors["bot-2"];
    if (!bot || !player || !attacker) throw new Error("actors missing");
    for (const actor of Object.values(state.actors)) {
      actor.alive = actor.id === bot.id || actor.id === player.id || actor.id === attacker.id;
    }
    bot.position = { x: 0, y: 1.76, z: 0 };
    player.position = { x: 20, y: 1.76, z: 0 };
    attacker.position = { x: -20, y: 1.76, z: 0 };
    bot.yaw = Math.PI / 2;
    let playerVisible = true;
    const world: CombatWorld = {
      traceShot: () => null,
      hasLineOfSight: (_observerId, targetId) => playerVisible && targetId === player.id,
    };
    const controller = new BotController(1, () => 0.5);
    controller.update(bot, state, world, 1, player.id);
    playerVisible = false;
    state.elapsedSeconds += 1;
    new DamageSystem().applyDamage(state, bot.id, 5, attacker.id, []);

    const reaction = controller.update(bot, state, world, 1 / 30, player.id);

    expect(reaction.aimDirection.x).toBeLessThan(-0.9);
    expect(reaction.fire).toBe(false);
  });

  it("uses 3D range before firing at a parachuting target", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!bot || !player) throw new Error("actors missing");
    for (const actor of Object.values(state.actors)) actor.alive = actor.id === bot.id || actor.id === player.id;
    bot.position = { x: 0, y: 1.76, z: 0 };
    player.position = { x: 10, y: 201.76, z: 0 };
    player.deployment = "parachuting";
    bot.yaw = Math.PI / 2;

    const command = new BotController(1, () => 0.5).update(bot, state, miss, 1, player.id);

    expect(command.fire).toBe(false);
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
    state.safeZone.targetCenter = { x: 0, y: 0, z: 0 };
    state.safeZone.targetRadius = 120;
    bot.position = { x: 0, y: getTerrainHeight(0, 0, state.mapSeed) + 1.76, z: 0 };
    state.groundLoot = {};

    const command = new BotController(1, () => 0.5).update(bot, state, miss, 1 / 30, "player");

    expect(Math.hypot(command.move.x, command.move.z)).toBeGreaterThan(0.9);
    expect(command.sprint).toBe(true);
  });

  it("keeps searching the current zone when the final target radius is zero", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!bot || !player) throw new Error("actors missing");
    for (const actor of Object.values(state.actors)) actor.alive = actor.id === bot.id || actor.id === player.id;
    state.safeZone.radius = 120;
    state.safeZone.targetRadius = 0;
    bot.position = { x: 0, y: getTerrainHeight(0, 0, state.mapSeed) + 1.76, z: 0 };
    player.position = { x: 500, y: getTerrainHeight(500, 0, state.mapSeed) + 1.76, z: 0 };
    const hidden: CombatWorld = { traceShot: () => null, hasLineOfSight: () => false };

    const command = new BotController(1, () => 0.5).update(bot, state, hidden, 1 / 30, player.id);

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
    state.safeZone.targetCenter = { x: 0, y: 0, z: 0 };
    state.safeZone.targetRadius = 1_000;
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

  it("retreats from a visible enemy before searching for compatible ammo", () => {
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

    let visible = true;
    const world: CombatWorld = { traceShot: () => null, hasLineOfSight: () => visible };
    const controller = new BotController(1, () => 0.5);
    const retreat = controller.update(bot, state, world, 1, "player");
    visible = false;
    state.elapsedSeconds += 1;
    const search = controller.update(bot, state, world, 1, "player");

    expect(retreat.fire).toBe(false);
    expect(Math.hypot(retreat.move.x, retreat.move.z)).toBeGreaterThan(0.5);
    expect(search.fire).toBe(false);
    expect(search.move.x).toBeGreaterThan(0.9);
    expect(Math.abs(search.move.z)).toBeLessThan(0.2);
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
    const inventory = new InventorySystem();
    const events: import("../../src/game/state/types").GameEvent[] = [];
    inventory.processCommand(state, bot.id, command, events);
    const cachedCommand = controller.update(bot, state, miss, 0.01, "player");
    for (let decision = 0; decision < 8; decision += 1) {
      const next = controller.update(bot, state, miss, 1, "player");
      inventory.processCommand(state, bot.id, next, events);
      state.elapsedSeconds += 1;
    }

    expect(command).toMatchObject({
      interact: true,
      interactLootId: "rifleAmmo",
      interactLootGeneration: 0,
      dropItem: "ammo.shell",
    });
    expect(bot.inventory.backpack.some((stack) => stack.itemId === "ammo.rifle")).toBe(true);
    expect(state.groundLoot.rifleAmmo?.available).toBe(false);
    expect(cachedCommand.dropItem).toBeNull();
    expect(cachedCommand.interact).toBe(false);
    expect(cachedCommand.interactLootId).toBeNull();
    expect(cachedCommand.interactLootGeneration).toBeNull();
    expect(events.filter((event) => event.type === "item-dropped")).toHaveLength(1);
  });

  it("does not ping-pong medical stacks during ordinary full-backpack looting", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!bot || !player) throw new Error("actors missing");
    player.alive = false;
    bot.position = { x: 0, y: 1.76, z: 0 };
    bot.health = 80;
    bot.inventory.maxBackpackStacks = 1;
    bot.inventory.backpack = [{ itemId: "bandage", quantity: 5 }];
    state.groundLoot.medkit = {
      id: "medkit",
      itemId: "medkit",
      quantity: 1,
      position: { x: 1, y: 0.45, z: 0 },
      available: true,
    };
    const controller = new BotController(1, () => 0.5);
    const inventory = new InventorySystem();
    const events: import("../../src/game/state/types").GameEvent[] = [];

    for (let decision = 0; decision < 12; decision += 1) {
      const command = controller.update(bot, state, miss, 1, player.id);
      inventory.processCommand(state, bot.id, command, events);
      state.elapsedSeconds += 1;
    }

    expect(bot.inventory.backpack).toEqual([{ itemId: "bandage", quantity: 5 }]);
    expect(state.groundLoot.medkit.available).toBe(true);
    expect(events.filter((event) => event.type === "item-dropped" || event.type === "item-picked")).toHaveLength(0);
  });

  it("picks the planned ammo instead of replacing weapons with a nearer gun", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!bot || !player) throw new Error("actors missing");
    player.alive = false;
    bot.position = { x: 0, y: 1.76, z: 0 };
    bot.inventory.weaponSlots = [createWeaponState("rifle", false), createWeaponState("smg", false)];
    bot.inventory.backpack = [];
    state.groundLoot = {
      shotgun: {
        id: "shotgun",
        itemId: "weapon.shotgun",
        quantity: 1,
        weapon: createWeaponState("shotgun"),
        position: { x: 1, y: 0.45, z: 0 },
        available: true,
      },
      rifleAmmo: {
        id: "rifleAmmo",
        itemId: "ammo.rifle",
        quantity: 90,
        position: { x: 2, y: 0.45, z: 0 },
        available: true,
      },
    };
    const controller = new BotController(1, () => 0.5);
    const command = controller.update(bot, state, miss, 1, player.id);
    const events: import("../../src/game/state/types").GameEvent[] = [];
    const inventory = new InventorySystem();
    inventory.processCommand(state, bot.id, command, events);
    for (let decision = 0; decision < 8; decision += 1) {
      const next = controller.update(bot, state, miss, 1, player.id);
      inventory.processCommand(state, bot.id, next, events);
      state.elapsedSeconds += 1;
    }

    expect(command).toMatchObject({
      interact: true,
      interactLootId: "rifleAmmo",
      interactLootGeneration: 0,
      dropItem: null,
    });
    expect(bot.inventory.weaponSlots.map((weapon) => weapon?.weaponId)).toEqual(["rifle", "smg"]);
    expect(state.groundLoot.shotgun.available).toBe(true);
    expect(state.groundLoot.rifleAmmo.available).toBe(false);
    expect(events.some((event) => event.type === "item-dropped")).toBe(false);
  });

  it("keeps the replacement stack when a planned loot target is no longer available", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!bot || !player) throw new Error("actors missing");
    player.alive = false;
    bot.position = { x: 0, y: 1.76, z: 0 };
    const weapon = getActiveWeapon(bot);
    if (!weapon) throw new Error("weapon missing");
    weapon.ammoInMagazine = 0;
    bot.inventory.maxBackpackStacks = 1;
    bot.inventory.backpack = [{ itemId: "ammo.shell", quantity: 18 }];
    state.groundLoot.rifleAmmo = {
      id: "rifleAmmo",
      itemId: "ammo.rifle",
      quantity: 90,
      position: { x: 1, y: 0.45, z: 0 },
      available: true,
    };
    const command = new BotController(1, () => 0.5).update(bot, state, miss, 1, player.id);
    state.groundLoot.rifleAmmo.available = false;
    const events: import("../../src/game/state/types").GameEvent[] = [];

    new InventorySystem().processCommand(state, bot.id, command, events);

    expect(bot.inventory.backpack).toEqual([{ itemId: "ammo.shell", quantity: 18 }]);
    expect(events.some((event) => event.type === "item-dropped")).toBe(false);
  });

  it("skips sniper weapons and ammunition when AI snipers are disabled", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!bot || !player) throw new Error("actors missing");
    player.alive = false;
    bot.position = { x: 0, y: 1.76, z: 0 };
    bot.inventory.weaponSlots = [null, null];
    bot.inventory.backpack = [];
    state.groundLoot = {
      sniper: {
        id: "sniper",
        itemId: "weapon.sniper",
        quantity: 1,
        weapon: createWeaponState("sniper"),
        position: { x: 1, y: 0.45, z: 0 },
        available: true,
      },
      rifle: {
        id: "rifle",
        itemId: "weapon.rifle",
        quantity: 1,
        weapon: createWeaponState("rifle"),
        position: { x: 2, y: 0.45, z: 0 },
        available: true,
      },
      sniperAmmo: {
        id: "sniperAmmo",
        itemId: "ammo.sniper",
        quantity: 16,
        position: { x: 0.5, y: 0.45, z: 0 },
        available: true,
      },
    };
    const command = new BotController(1, () => 0.5, true).update(bot, state, miss, 1, player.id);
    new InventorySystem().processCommand(state, bot.id, command, []);

    expect(command.interactLootId).toBe("rifle");
    expect(getActiveWeapon(bot)?.weaponId).toBe("rifle");
    expect(state.groundLoot.sniper.available).toBe(true);
    expect(state.groundLoot.sniperAmmo.available).toBe(true);
  });

  it("drops an existing sniper and switches to an allowed secondary weapon", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    if (!bot) throw new Error("bot missing");
    bot.inventory.weaponSlots = [createWeaponState("sniper"), createWeaponState("rifle")];
    bot.inventory.activeWeaponSlot = 0;
    const command = new BotController(1, () => 0.5, true).update(bot, state, miss, 1, "player");

    new InventorySystem().processCommand(state, bot.id, command, []);

    expect(command).toMatchObject({ fire: false, dropItem: "weapon.sniper" });
    expect(getActiveWeapon(bot)?.weaponId).toBe("rifle");
    expect(bot.inventory.weaponSlots.some((weapon) => weapon?.weaponId === "sniper")).toBe(false);
  });

  it("allows sniper pickup when the AI sniper restriction is disabled", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    const player = state.actors.player;
    if (!bot || !player) throw new Error("actors missing");
    player.alive = false;
    bot.position = { x: 0, y: 1.76, z: 0 };
    bot.inventory.weaponSlots = [null, null];
    state.groundLoot.sniper = {
      id: "sniper",
      itemId: "weapon.sniper",
      quantity: 1,
      weapon: createWeaponState("sniper"),
      position: { x: 1, y: 0.45, z: 0 },
      available: true,
    };
    const command = new BotController(1, () => 0.5, false).update(bot, state, miss, 1, player.id);

    new InventorySystem().processCommand(state, bot.id, command, []);

    expect(getActiveWeapon(bot)?.weaponId).toBe("sniper");
  });

  it("forces a new relocation before a grounded bot can stay in place for one minute", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    if (!bot) throw new Error("bot missing");
    for (const actor of Object.values(state.actors)) actor.alive = actor.id === bot.id;
    bot.health = 20;
    state.safeZone.center = { x: bot.position.x + 100, y: 0, z: bot.position.z };
    state.safeZone.radius = 1_000;
    state.safeZone.targetCenter = { x: bot.position.x + 100, y: 0, z: bot.position.z };
    state.safeZone.targetRadius = 1_000;
    const controller = new BotController(1, () => 0.5);
    let command = createIdleCommand();

    for (let tick = 0; tick < 46 * 30; tick += 1) {
      state.elapsedSeconds += 1 / 30;
      command = controller.update(bot, state, miss, 1 / 30, "player");
    }

    const internals = controller as unknown as {
      forcedRelocationUntilSeconds: number;
    };
    expect(internals.forcedRelocationUntilSeconds).toBeGreaterThan(state.elapsedSeconds);
    expect(Math.hypot(command.move.x, command.move.z)).toBeGreaterThan(0.5);
    expect(command.sprint).toBe(true);
  });

  it("breaks repeated left-right oscillation without waiting for damage", () => {
    const state = groundedState();
    const bot = state.actors["bot-1"];
    if (!bot) throw new Error("bot missing");
    for (const actor of Object.values(state.actors)) actor.alive = actor.id === bot.id;
    bot.position = { x: 0, y: 1.76, z: 0 };
    const controller = new BotController(1, () => 0.5);
    controller.update(bot, state, miss, 1 / 30, "player");
    let command = createIdleCommand();

    for (let reversal = 0; reversal < 8; reversal += 1) {
      bot.position.x = reversal % 2 === 0 ? -0.7 : 0.7;
      state.elapsedSeconds += 0.5;
      command = controller.update(bot, state, miss, 0.5, "player");
    }

    const internals = controller as unknown as { forcedRelocationUntilSeconds: number };
    expect(internals.forcedRelocationUntilSeconds).toBeGreaterThan(state.elapsedSeconds);
    expect(Math.hypot(command.move.x, command.move.z)).toBeGreaterThan(0.5);
    expect(command.sprint).toBe(true);
  });
});

function groundedState() {
  const state = createBattleRoyaleState("player", undefined, () => 0.5);
  for (const actor of Object.values(state.actors)) {
    actor.deployment = "grounded";
    actor.inventory.weaponSlots[0] = createWeaponState("rifle");
  }
  state.phase = "combat";
  state.groundLoot = {};
  state.safeZone.center = { x: 0, y: 0, z: 0 };
  state.safeZone.radius = 2_000;
  state.safeZone.targetCenter = { x: 0, y: 0, z: 0 };
  state.safeZone.targetRadius = 2_000;
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
