import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BATTLE_ROYALE_CONFIG } from "../../src/config/battleRoyale";
import {
  parseSinglePlayerDebugArguments,
  singlePlayerDebugEnabledForVite,
} from "../../src/config/debug";
import { ITEMS } from "../../src/config/items";
import { createMapLayout } from "../../src/config/map";
import { WEAPONS } from "../../src/config/weapons";
import { createIdleCommand } from "../../src/game/commands/ActorCommand";
import { GameSimulation } from "../../src/game/GameSimulation";
import { BattleRoyaleMode } from "../../src/game/modes/BattleRoyaleMode";
import { ACTOR_EYE_HEIGHT } from "../../src/game/rules/actorGeometry";
import { CombatSystem } from "../../src/game/systems/CombatSystem";
import {
  SinglePlayerDebugSystem,
  createSinglePlayerDebugDamageSystem,
} from "../../src/game/systems/SinglePlayerDebugSystem";
import { getSupportHeight } from "../../src/game/systems/MovementSystem";
import { ThrowableSystem } from "../../src/game/systems/ThrowableSystem";
import { createActorState, createWeaponState, type MatchState } from "../../src/game/state/types";

function createState(): MatchState {
  const player = createActorState("player", "player", { x: 25, y: 180, z: -30 });
  player.deployment = "parachuting";
  player.inventory.weaponSlots = [null, null];
  player.inventory.backpack = [];
  player.inventory.armorLevel = 0;
  player.inventory.helmetLevel = 0;
  player.armor = 0;
  player.maxArmor = 0;
  return {
    mapId: "island",
    mapSeed: 7,
    phase: "combat",
    elapsedSeconds: 0,
    actors: { player },
    groundLoot: {},
    activeGrenades: {},
    nextGrenadeSequence: 1,
    safeZone: {
      center: { x: 0, y: 0, z: 0 },
      radius: 100,
      startCenter: { x: 0, y: 0, z: 0 },
      startRadius: 100,
      targetCenter: { x: 0, y: 0, z: 0 },
      targetRadius: 100,
      stageIndex: 0,
      status: "waiting",
      secondsRemaining: 60,
      damagePerSecond: 1,
    },
    flight: {
      start: { x: -400, y: 180, z: 0 },
      end: { x: 400, y: 180, z: 0 },
      durationSeconds: 20,
      progress: 0.5,
    },
    result: null,
  };
}

describe("single-player debug mode", () => {
  it("enables only the explicit true command-line spelling", () => {
    expect(parseSinglePlayerDebugArguments([])).toEqual({ enabled: false, viteArguments: [] });
    expect(parseSinglePlayerDebugArguments(["--debug"])).toEqual({ enabled: false, viteArguments: [] });
    expect(parseSinglePlayerDebugArguments(["--debug=false"])).toEqual({ enabled: false, viteArguments: [] });
    expect(parseSinglePlayerDebugArguments(["--debug=true", "--port", "8797"])).toEqual({
      enabled: true,
      viteArguments: ["--port", "8797"],
    });
    expect(parseSinglePlayerDebugArguments(["--debug", "true", "--strictPort"])).toEqual({
      enabled: true,
      viteArguments: ["--strictPort"],
    });
  });

  it("enables debug only for the Vite development server", () => {
    expect(singlePlayerDebugEnabledForVite("serve", "true")).toBe(true);
    expect(singlePlayerDebugEnabledForVite("serve", "false")).toBe(false);
    expect(singlePlayerDebugEnabledForVite("build", "true")).toBe(false);
    expect(singlePlayerDebugEnabledForVite("build", "false")).toBe(false);
  });

  it("keeps the debug flag out of multiplayer and server entry points", async () => {
    const [gameApp, singlePlayerSession, multiplayerSession, matchRuntime] = await Promise.all([
      readFile(resolve(process.cwd(), "src/app/GameApp.ts"), "utf8"),
      readFile(resolve(process.cwd(), "src/app/BattleRoyaleSession.ts"), "utf8"),
      readFile(resolve(process.cwd(), "src/app/MultiplayerSession.ts"), "utf8"),
      readFile(resolve(process.cwd(), "src/server/MatchRuntime.ts"), "utf8"),
    ]);

    expect(gameApp).toContain("BattleRoyaleSession.create");
    expect(gameApp).toContain("__SINGLE_PLAYER_DEBUG__");
    expect(singlePlayerSession).toContain("if (!__SINGLE_PLAYER_DEBUG__) return null");
    expect(singlePlayerSession).toContain('import("../client/ui/SinglePlayerDebugPanel")');
    expect(singlePlayerSession).toContain('import("../game/systems/SinglePlayerDebugSystem")');
    expect(multiplayerSession).not.toContain("SINGLE_PLAYER_DEBUG");
    expect(matchRuntime).not.toContain("SinglePlayerDebug");
  });

  it("keeps the configured local player immune without protecting bots", () => {
    const state = createState();
    const bot = createActorState("bot-1", "bot", { x: 0, y: 1.76, z: 0 });
    state.actors[bot.id] = bot;
    const damage = createSinglePlayerDebugDamageSystem("player");

    expect(damage.applyDamage(state, "player", 50, bot.id, [])).toBe(0);
    expect(state.actors.player?.health).toBe(100);
    expect(damage.applyDamage(state, bot.id, 50, "player", [])).toBeGreaterThan(0);
    expect(bot.health).toBeLessThan(100);
  });

  it("shares immunity across gunfire, grenades, and safe-zone damage", () => {
    const state = createState();
    const player = state.actors.player;
    if (!player) throw new Error("player fixture missing");
    player.deployment = "grounded";
    player.position = { x: 0, y: ACTOR_EYE_HEIGHT, z: 0 };
    const bot = createActorState("bot-1", "bot", { x: 0, y: ACTOR_EYE_HEIGHT, z: 5 });
    state.actors[bot.id] = bot;
    state.safeZone.center = { x: 1_000, y: 0, z: 1_000 };
    state.safeZone.radius = 1;
    state.safeZone.damagePerSecond = 100;
    state.activeGrenades["grenade-1"] = {
      id: "grenade-1",
      ownerId: bot.id,
      aiControlled: true,
      position: { x: 0, y: 0.18, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      fuseSeconds: 0.01,
    };
    state.nextGrenadeSequence = 2;
    const layout = createMapLayout("island", state.mapSeed);
    const damage = createSinglePlayerDebugDamageSystem(player.id);
    const simulation = new GameSimulation(
      state,
      new BattleRoyaleMode(BATTLE_ROYALE_CONFIG, () => 0.5, damage),
      WEAPONS,
      layout,
      damage,
    );

    simulation.step(
      1 / 30,
      new Map([[bot.id, {
        ...createIdleCommand(),
        fire: true,
        aimDirection: { x: 0, y: 0, z: -1 },
      }]]),
      {
        traceShot: () => player.id,
        traceThrowable: () => null,
        hasExplosionLineOfSight: () => true,
      },
    );

    expect(player.health).toBe(100);
    expect(player.alive).toBe(true);
    expect(simulation.drainEvents().filter(
      (event) => event.type === "actor-damaged" && event.actorId === player.id,
    )).toHaveLength(0);
  });

  it("does not let debug immunity grant a simultaneous-gunfire survivor to a bot", () => {
    const state = simultaneousLethalState();
    const damage = createSinglePlayerDebugDamageSystem("player");
    const combat = new CombatSystem(WEAPONS, damage, () => 0.5);
    const commands = new Map([
      ["player", { ...createIdleCommand(), fire: true, aimDirection: { x: 0, y: 0, z: 1 } }],
      ["bot-1", { ...createIdleCommand(), fire: true, aimDirection: { x: 0, y: 0, z: -1 } }],
    ]);

    combat.processCommands(state, commands, {
      traceShot: (trace) => trace.shooterId === "player" ? "bot-1" : "player",
    }, []);

    expect(state.actors.player?.alive).toBe(true);
    expect(state.actors.player?.health).toBe(1);
    expect(state.actors["bot-1"]?.alive).toBe(false);
  });

  it("does not let debug immunity grant a simultaneous-grenade survivor to a bot", () => {
    const state = simultaneousLethalState();
    state.activeGrenades["grenade-1"] = {
      id: "grenade-1",
      ownerId: "player",
      aiControlled: false,
      position: { x: 0, y: 0.18, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      fuseSeconds: 0.01,
    };
    state.nextGrenadeSequence = 2;
    const throwables = new ThrowableSystem(undefined, createSinglePlayerDebugDamageSystem("player"));

    throwables.update(state, 1 / 30, {
      traceShot: () => null,
      traceThrowable: () => null,
      hasExplosionLineOfSight: () => true,
    }, []);

    expect(state.actors.player?.alive).toBe(true);
    expect(state.actors.player?.health).toBe(1);
    expect(state.actors["bot-1"]?.alive).toBe(false);
  });

  it("does not let debug immunity grant a simultaneous-zone survivor to a bot", () => {
    const state = simultaneousLethalState();
    state.safeZone.center = { x: 1_000, y: 0, z: 1_000 };
    state.safeZone.radius = 1;
    state.safeZone.damagePerSecond = 60;
    const mode = new BattleRoyaleMode(
      BATTLE_ROYALE_CONFIG,
      () => 0.5,
      createSinglePlayerDebugDamageSystem("player"),
    );

    mode.update(state, 1 / 30, []);

    expect(state.actors.player?.alive).toBe(true);
    expect(state.actors.player?.health).toBe(1);
    expect(state.actors["bot-1"]?.alive).toBe(false);
  });

  it("lands immediately and updates editable attributes", () => {
    const state = createState();
    const debug = new SinglePlayerDebugSystem("player", createMapLayout("island", state.mapSeed));

    debug.apply(state, { type: "land-now" });
    debug.apply(state, { type: "set-health", value: 72 });
    debug.apply(state, { type: "set-armor", value: 83 });
    debug.apply(state, { type: "set-kills", value: 9 });

    const player = state.actors.player;
    expect(player?.deployment).toBe("grounded");
    expect(player?.position.y).toBeCloseTo(
      getSupportHeight(25, -30, Number.POSITIVE_INFINITY, createMapLayout("island", state.mapSeed)) +
        ACTOR_EYE_HEIGHT,
    );
    expect(player?.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(player?.health).toBe(72);
    expect(player?.maxArmor).toBe(100);
    expect(player?.armor).toBe(83);
    expect(player?.inventory.armorLevel).toBe(2);
    expect(player?.kills).toBe(9);
  });

  it("grants every configured item while preserving legal inventory shapes", () => {
    for (const item of Object.values(ITEMS)) {
      const state = createState();
      const debug = new SinglePlayerDebugSystem("player", createMapLayout("island", state.mapSeed));

      debug.apply(state, { type: "grant-item", itemId: item.id, quantity: item.maxStack * 2 + 1 });

      const player = state.actors.player;
      if (!player) throw new Error("player fixture missing");
      if (item.kind === "weapon") {
        expect(player.inventory.weaponSlots.some((weapon) => weapon?.weaponId === item.weaponId)).toBe(true);
      } else if (item.kind === "armor") {
        expect(player.inventory.armorLevel).toBe(item.level);
        expect(player.armor).toBe(player.maxArmor);
      } else if (item.kind === "helmet") {
        expect(player.inventory.helmetLevel).toBe(item.level);
      } else {
        const stacks = player.inventory.backpack.filter((stack) => stack.itemId === item.id);
        expect(stacks.reduce((total, stack) => total + stack.quantity, 0)).toBe(item.maxStack * 2 + 1);
        expect(stacks.every((stack) => stack.quantity > 0 && stack.quantity <= item.maxStack)).toBe(true);
      }
    }
  });

  it("bounds bulk grants and does not revive eliminated players", () => {
    const state = createState();
    const player = state.actors.player;
    if (!player) throw new Error("player fixture missing");
    const debug = new SinglePlayerDebugSystem("player", createMapLayout("island", state.mapSeed));
    player.alive = false;
    player.health = 0;

    debug.apply(state, { type: "set-health", value: 100 });
    debug.apply(state, { type: "grant-item", itemId: "grenade.frag", quantity: 999 });

    expect(player.alive).toBe(false);
    expect(player.health).toBe(0);
    expect(player.inventory.backpack).toEqual([]);

    player.alive = true;
    player.health = 100;
    debug.apply(state, { type: "grant-item", itemId: "grenade.frag", quantity: 999 });
    expect(player.inventory.backpack).toHaveLength(20);
    expect(player.inventory.backpack.every((stack) => stack.itemId === "grenade.frag" && stack.quantity === 3))
      .toBe(true);
  });

  it("equips a useful loadout and can clear it again", () => {
    const state = createState();
    const debug = new SinglePlayerDebugSystem("player", createMapLayout("island", state.mapSeed));

    debug.apply(state, { type: "grant-loadout" });
    const player = state.actors.player;
    expect(player?.inventory.weaponSlots.map((weapon) => weapon?.weaponId)).toEqual(["rifle", "sniper"]);
    expect(player?.inventory.backpack.some((stack) => stack.itemId === "grenade.frag")).toBe(true);
    expect(player?.inventory.armorLevel).toBe(2);
    expect(player?.inventory.helmetLevel).toBe(2);

    debug.apply(state, { type: "clear-inventory" });
    expect(player?.inventory.weaponSlots).toEqual([null, null]);
    expect(player?.inventory.backpack).toEqual([]);
    expect(player?.inventory.armorLevel).toBe(0);
    expect(player?.inventory.helmetLevel).toBe(0);
  });
});

function simultaneousLethalState(): MatchState {
  const state = createState();
  const player = state.actors.player;
  if (!player) throw new Error("player fixture missing");
  player.deployment = "grounded";
  player.position = { x: 0, y: ACTOR_EYE_HEIGHT, z: 0 };
  player.health = 1;
  player.inventory.weaponSlots = [createWeaponState("rifle"), null];
  const bot = createActorState("bot-1", "bot", { x: 0, y: ACTOR_EYE_HEIGHT, z: 1 });
  bot.health = 1;
  bot.inventory.weaponSlots = [createWeaponState("rifle"), null];
  state.actors[bot.id] = bot;
  state.elapsedSeconds = 1 / 30;
  return state;
}
