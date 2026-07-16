import { describe, expect, it } from "vitest";
import { WEAPONS } from "../../src/config/weapons";
import { createIdleCommand, type ActorCommand } from "../../src/game/commands/ActorCommand";
import { GameSimulation } from "../../src/game/GameSimulation";
import { TrainingMode } from "../../src/game/modes/TrainingMode";
import { createActorState, createWeaponState, getActiveWeapon, type MatchState } from "../../src/game/state/types";
import type { CombatWorld } from "../../src/game/systems/CombatSystem";
import { SimulationCombatWorld } from "../../src/game/systems/SimulationCombatWorld";

function createSimulation(weaponId = "rifle"): GameSimulation {
  const player = createActorState("player", "player", { x: 0, y: 1.76, z: 0 }, weaponId);
  const bot = createActorState("bot-1", "bot", { x: 0, y: 1.76, z: 10 });
  const state: MatchState = {
    phase: "ready",
    elapsedSeconds: 0,
    actors: { player, "bot-1": bot },
    groundLoot: {},
    safeZone: {
      center: { x: 0, y: 0, z: 0 },
      radius: 400,
      startCenter: { x: 0, y: 0, z: 0 },
      startRadius: 400,
      targetCenter: { x: 0, y: 0, z: 0 },
      targetRadius: 400,
      stageIndex: 0,
      status: "waiting",
      secondsRemaining: 60,
      damagePerSecond: 0,
    },
    flight: {
      start: { x: -400, y: 180, z: 0 },
      end: { x: 400, y: 180, z: 0 },
      durationSeconds: 20,
      progress: 0,
    },
    result: null,
  };
  const simulation = new GameSimulation(state, new TrainingMode("player"), WEAPONS);
  simulation.start();
  simulation.drainEvents();
  return simulation;
}

const fireCommand: ActorCommand = {
  ...createIdleCommand(),
  aimDirection: { x: 0, y: 0, z: 1 },
  fire: true,
};

describe("GameSimulation combat", () => {
  it("consumes ammo and applies armor before health", () => {
    const simulation = createSimulation();
    simulation.step(1 / 30, new Map([["player", fireCommand]]), hit("bot-1"));

    expect(getActiveWeapon(simulation.state.actors.player)?.ammoInMagazine).toBe(29);
    expect(simulation.state.actors["bot-1"]?.armor).toBeCloseTo(34.7);
    expect(simulation.state.actors["bot-1"]?.health).toBeCloseTo(81.3);
  });

  it("finishes every actor's movement before tracing combat", () => {
    const simulation = createSimulation();
    const moveAndFire = {
      ...fireCommand,
      move: { x: 1, y: 0, z: 0 },
      aimDirection: { x: 0, y: -0.05, z: 1 },
    };
    const move = { ...createIdleCommand(), move: { x: 1, y: 0, z: 0 } };

    simulation.step(
      1,
      new Map([
        ["player", moveAndFire],
        ["bot-1", move],
      ]),
      new SimulationCombatWorld(simulation.state),
    );

    expect(simulation.state.actors.player?.position.x).toBeCloseTo(5.8);
    expect(simulation.state.actors["bot-1"]?.position.x).toBeCloseTo(5.8);
    expect(simulation.state.actors["bot-1"]?.health).toBeLessThan(100);
  });

  it("respects cooldown and empty magazines", () => {
    const simulation = createSimulation();
    const weapon = getActiveWeapon(simulation.state.actors.player);
    if (!weapon) throw new Error("test weapon missing");

    simulation.step(1 / 30, new Map([["player", fireCommand]]), hit("bot-1"));
    simulation.step(1 / 30, new Map([["player", fireCommand]]), hit("bot-1"));
    expect(weapon.ammoInMagazine).toBe(29);

    weapon.cooldownSeconds = 0;
    weapon.ammoInMagazine = 0;
    simulation.step(1, new Map([["player", fireCommand]]), hit("bot-1"));
    expect(weapon.ammoInMagazine).toBe(0);
  });

  it("reloads only the available reserve ammunition", () => {
    const simulation = createSimulation();
    const player = simulation.state.actors.player;
    const weapon = getActiveWeapon(player);
    if (!weapon) throw new Error("test weapon missing");
    weapon.ammoInMagazine = 28;
    player.inventory.backpack = [{ itemId: "ammo.rifle", quantity: 1 }];

    simulation.step(1 / 30, new Map([["player", { ...createIdleCommand(), reload: true }]]), miss);
    simulation.step(WEAPONS.rifle?.reloadSeconds ?? 2, new Map(), miss);

    expect(weapon.ammoInMagazine).toBe(29);
    expect(player.inventory.backpack).toEqual([]);
  });

  it("reloads only the active slot when both slots contain the same weapon", () => {
    const simulation = createSimulation();
    const player = simulation.state.actors.player;
    const firstWeapon = createWeaponState("rifle");
    const activeWeapon = createWeaponState("rifle", false);
    firstWeapon.ammoInMagazine = 5;
    player.inventory.weaponSlots = [firstWeapon, activeWeapon];
    player.inventory.activeWeaponSlot = 1;
    player.inventory.backpack = [{ itemId: "ammo.rifle", quantity: 30 }];

    simulation.step(1 / 30, new Map([["player", { ...createIdleCommand(), reload: true }]]), miss);
    simulation.step(WEAPONS.rifle?.reloadSeconds ?? 2, new Map(), miss);

    expect(firstWeapon).toMatchObject({ ammoInMagazine: 5, reloadSeconds: 0 });
    expect(activeWeapon).toMatchObject({ ammoInMagazine: 30, reloadSeconds: 0 });
    expect(player.inventory.backpack).toEqual([]);
    expect(simulation.drainEvents().filter((event) => event.type === "reload-completed")).toHaveLength(1);
  });

  it("emits damage, death, and match result in order", () => {
    const simulation = createSimulation();
    const bot = simulation.state.actors["bot-1"];
    if (!bot) throw new Error("test bot missing");
    bot.health = 1;
    bot.armor = 0;

    simulation.step(1 / 30, new Map([["player", fireCommand]]), hit("bot-1"));
    const eventTypes = simulation.drainEvents().map((event) => event.type);

    expect(eventTypes).toEqual(["shot-fired", "actor-damaged", "actor-died", "match-finished", "item-dropped", "item-dropped", "item-dropped"]);
    expect(simulation.state.result?.winnerId).toBe("player");
  });

  it("does not let dead actors fire", () => {
    const simulation = createSimulation();
    const player = simulation.state.actors.player;
    const weapon = getActiveWeapon(player);
    if (!weapon) throw new Error("test weapon missing");
    player.alive = false;

    simulation.step(1, new Map([["player", fireCommand]]), hit("bot-1"));

    expect(weapon.ammoInMagazine).toBe(30);
    expect(simulation.drainEvents().some((event) => event.type === "shot-fired")).toBe(false);
  });

  it("settles same-tick mutual fire independently of command insertion order", () => {
    const forward = runMutualFire(["player", "bot-1"]);
    const reversed = runMutualFire(["bot-1", "player"]);

    expect(reversed).toEqual(forward);
    expect(forward.livingActorIds).toHaveLength(1);
    expect(forward.winnerId).toBe(forward.livingActorIds[0]);
    expect(forward.survivorHealth).toBe(1);
    expect(forward.shotActorIds).toEqual(["bot-1", "player"]);
    expect(forward.droppedWeaponAmmo).toBe(29);
  });

  it("does not always award simultaneous fire to the same actor class", () => {
    const winners = new Set<string | null | undefined>();
    for (let tick = 0; tick < 24; tick += 1) {
      winners.add(runMutualFire(["player", "bot-1"], tick / 30).winnerId);
    }
    expect(winners).toEqual(new Set(["bot-1", "player"]));
  });

  it("resolves contested pickups independently of command insertion order without class bias", () => {
    const winners = new Set<string>();
    for (let tick = 0; tick < 24; tick += 1) {
      const forward = runContestedPickup(["player", "bot-1"], tick / 30);
      const reversed = runContestedPickup(["bot-1", "player"], tick / 30);
      expect(reversed).toBe(forward);
      winners.add(forward);
    }
    expect(winners).toEqual(new Set(["bot-1", "player"]));
  });

  it.each(["rifle", "smg", "shotgun"])("keeps %s near its configured RPM at 30 Hz", (weaponId) => {
    const durationSeconds = 30;
    const simulation = createSimulation(weaponId);
    const weapon = getActiveWeapon(simulation.state.actors.player);
    const config = WEAPONS[weaponId];
    if (!weapon || !config) throw new Error("test weapon config missing");
    weapon.ammoInMagazine = 10_000;

    for (let tick = 0; tick < durationSeconds * 30; tick += 1) {
      simulation.step(1 / 30, new Map([["player", fireCommand]]), miss);
    }

    const shotCount = simulation.drainEvents().filter((event) => event.type === "shot-fired").length;
    const expectedShots = (config.roundsPerMinute * durationSeconds) / 60;
    expect(Math.abs(shotCount - expectedShots)).toBeLessThanOrEqual(1);
  });
});

function runMutualFire(commandOrder: readonly string[], elapsedSeconds = 0) {
  const simulation = createSimulation();
  simulation.state.elapsedSeconds = elapsedSeconds;
  for (const actor of Object.values(simulation.state.actors)) {
    actor.health = 30;
    actor.armor = 0;
    actor.inventory.armorLevel = 0;
  }
  const reciprocalHits: CombatWorld = {
    traceShot: ({ shooterId }) => (shooterId === "player" ? "bot-1" : "player"),
  };
  simulation.step(
    1 / 30,
    new Map(commandOrder.map((actorId) => [actorId, fireCommand] as const)),
    reciprocalHits,
  );
  const events = simulation.drainEvents();
  return {
    livingActorIds: Object.values(simulation.state.actors)
      .filter((actor) => actor.alive)
      .map((actor) => actor.id)
      .sort(),
    winnerId: simulation.state.result?.winnerId,
    shotActorIds: events.filter((event) => event.type === "shot-fired").map((event) => event.actorId),
    droppedWeaponAmmo: Object.values(simulation.state.groundLoot).find((loot) => loot.weapon)?.weapon?.ammoInMagazine,
    survivorHealth: Object.values(simulation.state.actors).find((actor) => actor.alive)?.health,
    events,
  };
}

function runContestedPickup(commandOrder: readonly string[], elapsedSeconds: number): string {
  const simulation = createSimulation();
  simulation.state.elapsedSeconds = elapsedSeconds;
  for (const actor of Object.values(simulation.state.actors)) {
    actor.position = { x: 0, y: 1.76, z: 0 };
    actor.inventory.backpack = [];
  }
  simulation.state.groundLoot.contested = {
    id: "contested",
    itemId: "ammo.shell",
    quantity: 1,
    position: { x: 0, y: 0.45, z: 0 },
    available: true,
  };
  const interact = { ...createIdleCommand(), interact: true };
  simulation.step(
    1 / 30,
    new Map(commandOrder.map((actorId) => [actorId, interact] as const)),
    miss,
  );
  const winner = Object.values(simulation.state.actors).find((actor) =>
    actor.inventory.backpack.some((stack) => stack.itemId === "ammo.shell"),
  );
  if (!winner) throw new Error("contested pickup had no winner");
  return winner.id;
}

function hit(actorId: string): CombatWorld {
  return { traceShot: () => actorId };
}

const miss: CombatWorld = { traceShot: () => null };
