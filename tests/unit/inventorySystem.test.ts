import { describe, expect, it } from "vitest";
import { createIdleCommand, type ActorCommand } from "../../src/game/commands/ActorCommand";
import {
  createActorState,
  createWeaponState,
  type GameEvent,
  type GroundLootState,
  type MatchState,
  type WeaponState,
} from "../../src/game/state/types";
import { InventorySystem } from "../../src/game/systems/InventorySystem";

function createState(): MatchState {
  const actor = createActorState("player", "player", { x: 0, y: 0, z: 0 });
  return {
    phase: "combat",
    elapsedSeconds: 0,
    actors: { player: actor },
    groundLoot: {},
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
      damagePerSecond: 0,
    },
    flight: {
      start: { x: 0, y: 100, z: 0 },
      end: { x: 100, y: 100, z: 0 },
      durationSeconds: 30,
      progress: 0,
    },
    result: null,
  };
}

function createLoot(id: string, itemId: string, quantity: number, x = 1, weapon?: WeaponState): GroundLootState {
  return {
    id,
    itemId,
    quantity,
    ...(weapon ? { weapon } : {}),
    position: { x, y: 0, z: 0 },
    available: true,
  };
}

function command(overrides: Partial<ActorCommand>): ActorCommand {
  return { ...createIdleCommand(), ...overrides };
}

describe("InventorySystem", () => {
  it("does not pick up a new stack when the backpack is full", () => {
    const state = createState();
    const actor = state.actors.player;
    const events: GameEvent[] = [];
    actor.inventory.maxBackpackStacks = 1;
    actor.inventory.backpack = [{ itemId: "bandage", quantity: 5 }];
    state.groundLoot.ammo = createLoot("ammo", "ammo.rifle", 30);

    new InventorySystem().processCommand(state, actor.id, command({ interact: true }), events);

    expect(actor.inventory.backpack).toEqual([{ itemId: "bandage", quantity: 5 }]);
    expect(state.groundLoot.ammo).toMatchObject({ quantity: 30, available: true });
    expect(events).toEqual([]);
  });

  it("picks the nearest ammo within 3m and observes stack limits", () => {
    const state = createState();
    const actor = state.actors.player;
    const events: GameEvent[] = [];
    actor.inventory.maxBackpackStacks = 2;
    actor.inventory.backpack = [{ itemId: "ammo.rifle", quantity: 119 }];
    state.groundLoot.outside = createLoot("outside", "ammo.rifle", 20, 3.1);
    state.groundLoot.near = createLoot("near", "ammo.rifle", 125, 2);

    new InventorySystem().processCommand(state, actor.id, command({ interact: true }), events);

    expect(actor.inventory.backpack).toEqual([
      { itemId: "ammo.rifle", quantity: 120 },
      { itemId: "ammo.rifle", quantity: 120 },
    ]);
    expect(state.groundLoot.near).toMatchObject({ quantity: 4, available: true });
    expect(state.groundLoot.outside).toMatchObject({ quantity: 20, available: true });
    expect(events).toContainEqual({
      type: "item-picked",
      actorId: actor.id,
      lootId: "near",
      itemId: "ammo.rifle",
      quantity: 121,
    });
  });

  it("fills two weapon slots, switches weapons, and drops the replaced active weapon", () => {
    const state = createState();
    const actor = state.actors.player;
    const events: GameEvent[] = [];
    const inventory = new InventorySystem();
    state.groundLoot.smg = createLoot("smg", "weapon.smg", 1, 1, createWeaponState("smg"));

    inventory.processCommand(state, actor.id, command({ interact: true }), events);
    inventory.processCommand(state, actor.id, command({ switchWeapon: 1 }), events);
    state.groundLoot.shotgun = createLoot("shotgun", "weapon.shotgun", 1, 0.5, createWeaponState("shotgun"));
    inventory.processCommand(state, actor.id, command({ interact: true }), events);

    expect(actor.inventory.weaponSlots[0]?.weaponId).toBe("rifle");
    expect(actor.inventory.weaponSlots[1]?.weaponId).toBe("shotgun");
    expect(actor.inventory.activeWeaponSlot).toBe(1);
    expect(events).toContainEqual({ type: "weapon-switched", actorId: actor.id, slot: 1 });
    expect(Object.values(state.groundLoot)).toContainEqual(
      expect.objectContaining({ itemId: "weapon.smg", quantity: 1, available: true }),
    );
  });

  it("keeps an empty weapon empty when it is dropped and picked back up", () => {
    const state = createState();
    const actor = state.actors.player;
    const events: GameEvent[] = [];
    const inventory = new InventorySystem();
    const weapon = actor.inventory.weaponSlots[0];
    if (!weapon) throw new Error("test weapon missing");
    weapon.ammoInMagazine = 0;
    weapon.cooldownSeconds = 0.4;
    weapon.reloadSeconds = 1.2;
    actor.inventory.backpack = [];

    inventory.processCommand(state, actor.id, command({ dropItem: "weapon.rifle" }), events);
    const dropped = Object.values(state.groundLoot).find((loot) => loot.itemId === "weapon.rifle");
    expect(dropped?.weapon).toBe(weapon);
    expect(dropped?.weapon).toMatchObject({ ammoInMagazine: 0, cooldownSeconds: 0.4, reloadSeconds: 1.2 });

    inventory.processCommand(state, actor.id, command({ interact: true }), events);

    expect(actor.inventory.weaponSlots[0]).toBe(weapon);
    expect(actor.inventory.weaponSlots[0]).toMatchObject({
      ammoInMagazine: 0,
      cooldownSeconds: 0.4,
      reloadSeconds: 1.2,
    });
    expect(dropped).toMatchObject({ available: false, quantity: 0 });
    expect(dropped?.weapon).toBeUndefined();
  });

  it("preserves both weapon states when replacing the active slot", () => {
    const state = createState();
    const actor = state.actors.player;
    const events: GameEvent[] = [];
    const inventory = new InventorySystem();
    const replacedWeapon = actor.inventory.weaponSlots[0];
    if (!replacedWeapon) throw new Error("test weapon missing");
    replacedWeapon.ammoInMagazine = 7;
    replacedWeapon.cooldownSeconds = 0.25;
    replacedWeapon.reloadSeconds = 0.75;
    actor.inventory.weaponSlots[1] = createWeaponState("smg");

    const pickedWeapon = createWeaponState("shotgun", false);
    pickedWeapon.ammoInMagazine = 2;
    pickedWeapon.cooldownSeconds = 0.5;
    pickedWeapon.reloadSeconds = 1.5;
    state.groundLoot.shotgun = createLoot("shotgun", "weapon.shotgun", 1, 1, pickedWeapon);

    inventory.processCommand(state, actor.id, command({ interact: true }), events);

    expect(actor.inventory.weaponSlots[0]).toBe(pickedWeapon);
    expect(actor.inventory.weaponSlots[0]).toMatchObject({
      ammoInMagazine: 2,
      cooldownSeconds: 0.5,
      reloadSeconds: 1.5,
    });
    const dropped = Object.values(state.groundLoot).find(
      (loot) => loot.available && loot.itemId === "weapon.rifle",
    );
    expect(dropped?.weapon).toBe(replacedWeapon);
    expect(dropped?.weapon).toMatchObject({ ammoInMagazine: 7, cooldownSeconds: 0.25, reloadSeconds: 0.75 });
  });

  it("only equips better armor and helmets and drops replaced equipment", () => {
    const state = createState();
    const actor = state.actors.player;
    const events: GameEvent[] = [];
    const inventory = new InventorySystem();
    actor.inventory.helmetLevel = 1;
    state.groundLoot.armor = createLoot("armor", "armor.2", 1);

    inventory.processCommand(state, actor.id, command({ interact: true }), events);
    state.groundLoot.helmet = createLoot("helmet", "helmet.2", 1, 0.5);
    actor.position.x = 0.5;
    inventory.processCommand(state, actor.id, command({ interact: true }), events);

    expect(actor.inventory.armorLevel).toBe(2);
    expect(actor.armor).toBe(100);
    expect(actor.maxArmor).toBe(100);
    expect(actor.inventory.helmetLevel).toBe(2);
    expect(Object.values(state.groundLoot)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemId: "armor.1", available: true }),
        expect.objectContaining({ itemId: "helmet.1", available: true }),
      ]),
    );

    const eventCount = events.length;
    inventory.processCommand(state, actor.id, command({ interact: true }), events);
    expect(actor.inventory.helmetLevel).toBe(2);
    expect(events).toHaveLength(eventCount);
  });

  it("interrupts healing on movement or fire without consuming the item", () => {
    const state = createState();
    const actor = state.actors.player;
    const events: GameEvent[] = [];
    const inventory = new InventorySystem();
    actor.health = 50;
    actor.inventory.backpack = [{ itemId: "bandage", quantity: 1 }];

    inventory.processCommand(state, actor.id, command({ useItem: "bandage" }), events);
    inventory.processCommand(state, actor.id, command({ move: { x: 1, y: 0, z: 0 } }), events);
    inventory.processCommand(state, actor.id, command({ useItem: "bandage" }), events);
    inventory.processCommand(state, actor.id, command({ fire: true }), events);

    expect(actor.inventory.usingItem).toBeNull();
    expect(actor.inventory.backpack).toEqual([{ itemId: "bandage", quantity: 1 }]);
    expect(actor.health).toBe(50);
    expect(events).toEqual([
      { type: "healing-started", actorId: actor.id, itemId: "bandage" },
      { type: "healing-interrupted", actorId: actor.id },
      { type: "healing-started", actorId: actor.id, itemId: "bandage" },
      { type: "healing-interrupted", actorId: actor.id },
    ]);
  });

  it.each([
    ["bandage", 18, 2.5],
    ["medkit", 65, 5],
  ])("completes timed healing with %s", (itemId, healAmount, useSeconds) => {
    const state = createState();
    const actor = state.actors.player;
    const events: GameEvent[] = [];
    const inventory = new InventorySystem();
    actor.health = 20;
    actor.inventory.backpack = [{ itemId, quantity: 1 }];

    inventory.processCommand(state, actor.id, command({ useItem: itemId }), events);
    inventory.update(state, useSeconds - 0.1, events);
    expect(actor.health).toBe(20);
    inventory.update(state, 0.1, events);

    expect(actor.health).toBe(Math.min(100, 20 + healAmount));
    expect(actor.inventory.backpack).toEqual([]);
    expect(actor.inventory.usingItem).toBeNull();
    expect(events.at(-1)).toEqual({ type: "healing-completed", actorId: actor.id, itemId });
  });

  it("drops an entire requested backpack stack", () => {
    const state = createState();
    const actor = state.actors.player;
    const events: GameEvent[] = [];
    actor.inventory.backpack = [{ itemId: "ammo.rifle", quantity: 40 }];

    new InventorySystem().processCommand(state, actor.id, command({ dropItem: "ammo.rifle" }), events);

    expect(actor.inventory.backpack).toEqual([]);
    expect(Object.values(state.groundLoot)).toContainEqual(
      expect.objectContaining({ itemId: "ammo.rifle", quantity: 40, available: true }),
    );
    expect(events[0]).toEqual(expect.objectContaining({ type: "item-dropped", actorId: actor.id, quantity: 40 }));
  });

  it("drops each dead actor inventory exactly once", () => {
    const state = createState();
    const actor = state.actors.player;
    const events: GameEvent[] = [];
    const inventory = new InventorySystem();
    const weapon = actor.inventory.weaponSlots[0];
    if (!weapon) throw new Error("test weapon missing");
    weapon.ammoInMagazine = 4;
    weapon.cooldownSeconds = 0.3;
    weapon.reloadSeconds = 1.1;
    actor.inventory.backpack.push({ itemId: "bandage", quantity: 2 });
    actor.inventory.helmetLevel = 2;
    actor.alive = false;

    inventory.dropDeadInventories(state, events);
    const firstDropCount = events.filter((event) => event.type === "item-dropped").length;
    inventory.dropDeadInventories(state, events);

    expect(firstDropCount).toBe(5);
    expect(events).toHaveLength(firstDropCount);
    expect(actor.inventory.weaponSlots).toEqual([null, null]);
    expect(actor.inventory.backpack).toEqual([]);
    expect(actor.inventory.armorLevel).toBe(0);
    expect(actor.inventory.helmetLevel).toBe(0);
    expect(Object.values(state.groundLoot)).toHaveLength(firstDropCount);
    expect(Object.values(state.groundLoot).find((loot) => loot.itemId === "weapon.rifle")?.weapon).toBe(weapon);
    expect(weapon).toMatchObject({ ammoInMagazine: 4, cooldownSeconds: 0.3, reloadSeconds: 1.1 });
  });

  it("reuses inactive loot records during repeated drop and pickup", () => {
    const state = createState();
    const actor = state.actors.player;
    const inventory = new InventorySystem();

    for (let cycle = 0; cycle < 30; cycle += 1) {
      inventory.processCommand(state, actor.id, command({ dropItem: "weapon.rifle" }), []);
      inventory.processCommand(state, actor.id, command({ interact: true }), []);
    }

    expect(Object.keys(state.groundLoot)).toHaveLength(1);
    expect(Object.values(state.groundLoot)[0]).toMatchObject({ available: false, itemId: "weapon.rifle" });
    expect(actor.inventory.weaponSlots[0]?.weaponId).toBe("rifle");
  });
});
