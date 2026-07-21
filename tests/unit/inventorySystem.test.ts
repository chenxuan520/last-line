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
import { findPickupCandidate, InventorySystem } from "../../src/game/systems/InventorySystem";
import { BUILDING_ROOF_CAP_HEIGHT, createMapLayout, getTerrainHeight } from "../../src/config/map";
import { getSupportHeight } from "../../src/game/systems/MovementSystem";

function createState(): MatchState {
  const actor = createActorState("player", "player", { x: 0, y: getTerrainHeight(0, 0, 0) + 1.76, z: 0 });
  return {
    mapSeed: 0,
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
    position: { x, y: getTerrainHeight(x, 0, 0) + 0.45, z: 0 },
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

  it("does not pick loot through a floor even when the horizontal position matches", () => {
    const state = createState();
    const actor = state.actors.player;
    actor.position.y = 5;
    actor.inventory.backpack = [];
    state.groundLoot.ammo = createLoot("ammo", "ammo.rifle", 30, 0);

    new InventorySystem().processCommand(state, actor.id, command({ interact: true }), []);

    expect(state.groundLoot.ammo?.available).toBe(true);
    expect(actor.inventory.backpack).toEqual([]);
  });

  it("does not expose a pickup candidate to dead or airborne actors", () => {
    const state = createState();
    const actor = state.actors.player;
    state.groundLoot.ammo = createLoot("ammo", "ammo.rifle", 30, 1);
    actor.deployment = "parachuting";

    expect(findPickupCandidate(actor, state.groundLoot)).toBeNull();

    actor.deployment = "grounded";
    actor.alive = false;
    expect(findPickupCandidate(actor, state.groundLoot)).toBeNull();
  });

  it("keeps stable loot-id ordering for equally distant pickup candidates", () => {
    const state = createState();
    const actor = state.actors.player;
    actor.inventory.backpack = [];
    state.groundLoot.zulu = createLoot("zulu", "ammo.rifle", 30, 1);
    state.groundLoot.alpha = createLoot("alpha", "ammo.rifle", 30, -1);
    state.groundLoot.zulu.position.y = actor.position.y - 1.31;
    state.groundLoot.alpha.position.y = actor.position.y - 1.31;

    expect(findPickupCandidate(actor, state.groundLoot)?.id).toBe("alpha");
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

  it("automatically equips a picked weapon when the active weapon has no ammunition", () => {
    const state = createState();
    const actor = state.actors.player;
    const events: GameEvent[] = [];
    const inventory = new InventorySystem();
    const activeWeapon = actor.inventory.weaponSlots[0];
    if (!activeWeapon) throw new Error("test weapon missing");
    activeWeapon.ammoInMagazine = 0;
    actor.inventory.backpack = [];
    state.groundLoot.smg = createLoot("smg", "weapon.smg", 1, 1, createWeaponState("smg"));

    inventory.processCommand(state, actor.id, command({ interact: true }), events);

    expect(actor.inventory.weaponSlots[1]?.weaponId).toBe("smg");
    expect(actor.inventory.activeWeaponSlot).toBe(1);
    expect(events).toContainEqual({ type: "weapon-switched", actorId: actor.id, slot: 1 });
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

  it("replaces broken armor with fresh armor of the same level", () => {
    const state = createState();
    const actor = state.actors.player;
    actor.inventory.armorLevel = 2;
    actor.maxArmor = 100;
    actor.armor = 0;
    state.groundLoot.armor = createLoot("armor", "armor.2", 1);

    new InventorySystem().processCommand(state, actor.id, command({ interact: true }), []);

    expect(actor.inventory.armorLevel).toBe(2);
    expect(actor.armor).toBe(100);
    expect(state.groundLoot.armor?.available).toBe(false);
    expect(Object.values(state.groundLoot).filter((loot) => loot.available && loot.itemId === "armor.2")).toHaveLength(0);
  });

  it("skips unusable death loot and picks a helmet from the same pile", () => {
    const state = createState();
    const actor = state.actors.player;
    actor.inventory.armorLevel = 2;
    actor.maxArmor = 100;
    actor.armor = 100;
    actor.inventory.helmetLevel = 0;
    state.groundLoot = {
      armor: { ...createLoot("armor", "armor.2", 1), source: "death" },
      helmet: { ...createLoot("helmet", "helmet.2", 1), source: "death" },
    };

    expect(findPickupCandidate(actor, state.groundLoot)?.id).toBe("helmet");
    const events: GameEvent[] = [];
    new InventorySystem().processCommand(state, actor.id, command({ interact: true }), events);

    expect(state.groundLoot.armor?.available).toBe(true);
    expect(state.groundLoot.helmet?.available).toBe(false);
    expect(actor.inventory.helmetLevel).toBe(2);
    expect(events).toContainEqual(expect.objectContaining({ type: "item-picked", lootId: "helmet" }));
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
    expect(Object.values(state.groundLoot).every((loot) => loot.source === "death")).toBe(true);
    expect(Object.values(state.groundLoot).find((loot) => loot.itemId === "weapon.rifle")?.weapon).toBe(weapon);
    expect(weapon).toMatchObject({ ammoInMagazine: 4, cooldownSeconds: 0.3, reloadSeconds: 1.1 });
  });

  it("fans a large death inventory across distinct reachable support points", () => {
    const state = createState();
    const actor = state.actors.player;
    const inventory = new InventorySystem();
    actor.inventory.weaponSlots[1] = createWeaponState("smg");
    actor.inventory.backpack = [
      { itemId: "ammo.rifle", quantity: 30 },
      { itemId: "ammo.light", quantity: 30 },
      { itemId: "ammo.shell", quantity: 6 },
      { itemId: "ammo.sniper", quantity: 5 },
      { itemId: "bandage", quantity: 2 },
      { itemId: "medkit", quantity: 1 },
    ];
    actor.inventory.helmetLevel = 2;
    actor.alive = false;

    inventory.dropDeadInventories(state, []);

    const drops = Object.values(state.groundLoot);
    expect(drops).toHaveLength(10);
    for (let index = 0; index < drops.length; index += 1) {
      const drop = drops[index]!;
      expect(Math.hypot(
        drop.position.x - actor.position.x,
        drop.position.y - actor.position.y,
        drop.position.z - actor.position.z,
      )).toBeLessThanOrEqual(3);
      expect(drop.position.y).toBeCloseTo(
        getSupportHeight(
          drop.position.x,
          drop.position.z,
          actor.position.y - 1.76 + 0.35,
        ) + 0.45,
      );
      for (const other of drops.slice(index + 1)) {
        expect(Math.hypot(drop.position.x - other.position.x, drop.position.z - other.position.z))
          .toBeGreaterThanOrEqual(0.61);
      }
    }
  });

  it("keeps roof-edge death drops within the dead actor's 3m interaction range", () => {
    const state = createState();
    const actor = state.actors.player;
    const layout = createMapLayout(state.mapSeed);
    const building = layout.obstacles[0];
    if (!building) throw new Error("building missing");
    actor.position = {
      x: building.center.x + building.width / 2 - 0.01,
      y: building.center.y + building.height / 2 + BUILDING_ROOF_CAP_HEIGHT + 1.76,
      z: building.center.z,
    };
    fillDeathInventory(actor);
    actor.alive = false;

    new InventorySystem().dropDeadInventories(state, []);

    const drops = Object.values(state.groundLoot);
    expect(drops).toHaveLength(10);
    expect(drops.every((drop) => Math.hypot(
      drop.position.x - actor.position.x,
      drop.position.y - actor.position.y,
      drop.position.z - actor.position.z,
    ) <= 3)).toBe(true);
  });

  it("keeps several full death inventories from falling back to identical positions", () => {
    const state = createState();
    state.actors = {};
    for (let index = 0; index < 4; index += 1) {
      const actor = createActorState(`corpse-${index}`, "bot", {
        x: 0,
        y: getTerrainHeight(0, 0, state.mapSeed) + 1.76,
        z: 0,
      });
      fillDeathInventory(actor);
      actor.alive = false;
      state.actors[actor.id] = actor;
    }

    new InventorySystem().dropDeadInventories(state, []);

    const drops = Object.values(state.groundLoot);
    const positions = new Set(drops.map((drop) =>
      `${drop.position.x.toFixed(4)}:${drop.position.y.toFixed(4)}:${drop.position.z.toFixed(4)}`
    ));
    expect(drops).toHaveLength(40);
    expect(positions.size).toBe(40);
  });

  it("uses its pinned layout for death drops after the global seed cache is evicted", () => {
    const state = createState();
    const actor = state.actors.player;
    const baseLayout = createMapLayout(0x7f00_0001);
    let terrainReads = 0;
    const pinnedLayout = new Proxy(baseLayout, {
      get(target, property, receiver) {
        if (property === "terrainHills") terrainReads += 1;
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const inventory = new InventorySystem(pinnedLayout);
    state.mapSeed = baseLayout.seed;
    actor.position = {
      x: 0,
      y: getTerrainHeight(0, 0, baseLayout) + 1.76,
      z: 0,
    };
    for (let offset = 1; offset <= 9; offset += 1) createMapLayout(baseLayout.seed + offset);
    expect(createMapLayout(baseLayout.seed)).not.toBe(baseLayout);
    terrainReads = 0;
    actor.alive = false;

    inventory.dropDeadInventories(state, []);

    expect(terrainReads).toBeGreaterThan(0);
  }, 30_000);

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

  it("rejects a stale targeted pickup after its loot record is reused", () => {
    const state = createState();
    const picker = state.actors.player;
    picker.inventory.backpack = [];
    const dropper = createActorState("dropper", "bot", { ...picker.position });
    dropper.deployment = "grounded";
    dropper.inventory.backpack = [{ itemId: "ammo.shell", quantity: 18 }];
    const stalePicker = createActorState("stale-picker", "bot", { ...picker.position });
    stalePicker.deployment = "grounded";
    stalePicker.inventory.maxBackpackStacks = 1;
    stalePicker.inventory.backpack = [{ itemId: "ammo.sniper", quantity: 16 }];
    state.actors[dropper.id] = dropper;
    state.actors[stalePicker.id] = stalePicker;
    state.groundLoot.target = {
      id: "target",
      generation: 0,
      itemId: "ammo.rifle",
      quantity: 1,
      position: { x: picker.position.x, y: picker.position.y - 1.31, z: picker.position.z },
      available: true,
    };
    const inventory = new InventorySystem();
    const events: GameEvent[] = [];

    inventory.processCommand(state, picker.id, command({
      interact: true,
      interactLootId: "target",
      interactLootGeneration: 0,
    }), events);
    inventory.processCommand(state, dropper.id, command({ dropItem: "ammo.shell" }), events);
    inventory.processCommand(state, stalePicker.id, command({
      interact: true,
      interactLootId: "target",
      interactLootGeneration: 0,
      dropItem: "ammo.sniper",
    }), events);

    expect(state.groundLoot.target).toMatchObject({
      generation: 1,
      itemId: "ammo.shell",
      quantity: 18,
      available: true,
    });
    expect(stalePicker.inventory.backpack).toEqual([{ itemId: "ammo.sniper", quantity: 16 }]);
    expect(events.some((event) => event.type === "item-dropped" && event.actorId === stalePicker.id)).toBe(false);
  });
});

function fillDeathInventory(actor: MatchState["actors"][string]): void {
  actor.inventory.weaponSlots[1] = createWeaponState("smg");
  actor.inventory.backpack = [
    { itemId: "ammo.rifle", quantity: 30 },
    { itemId: "ammo.light", quantity: 30 },
    { itemId: "ammo.shell", quantity: 6 },
    { itemId: "ammo.sniper", quantity: 5 },
    { itemId: "bandage", quantity: 2 },
    { itemId: "medkit", quantity: 1 },
  ];
  actor.inventory.helmetLevel = 2;
}
