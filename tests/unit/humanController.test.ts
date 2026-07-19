import { afterEach, describe, expect, it, vi } from "vitest";
import { HumanController } from "../../src/controllers/HumanController";
import { createActorState, createWeaponState, type MatchState } from "../../src/game/state/types";
import { InventorySystem } from "../../src/game/systems/InventorySystem";

describe("HumanController weapon switching", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("runs the pickup and switching flow from real input without leaking requests", () => {
    const canvas = new EventTarget() as HTMLCanvasElement;
    const documentTarget = new EventTarget() as Document;
    let pointerLockElement: Element | null = canvas;
    Object.defineProperty(documentTarget, "pointerLockElement", {
      configurable: true,
      get: () => pointerLockElement,
    });
    vi.stubGlobal("document", documentTarget);
    const actor = createActorState("player", "player", { x: 0, y: 1.76, z: 0 });
    const activeWeapon = actor.inventory.weaponSlots[0];
    if (!activeWeapon) throw new Error("test weapon missing");
    activeWeapon.ammoInMagazine = 0;
    actor.inventory.backpack = [];
    const state = createState(actor);
    state.groundLoot.smg = {
      id: "smg",
      itemId: "weapon.smg",
      quantity: 1,
      weapon: createWeaponState("smg"),
      position: { x: 1, y: 1.76, z: 0 },
      available: true,
    };
    const controller = new HumanController(canvas);
    controller.rememberActor(actor);
    const inventory = new InventorySystem();

    documentTarget.dispatchEvent(keyEvent("KeyF"));
    inventory.processCommand(state, actor.id, controller.createCommand(actor), []);
    expect(actor.inventory.activeWeaponSlot).toBe(1);
    expect(actor.inventory.weaponSlots[1]?.weaponId).toBe("smg");

    documentTarget.dispatchEvent(keyEvent("Digit1"));
    inventory.processCommand(state, actor.id, controller.createCommand(actor), []);
    expect(actor.inventory.activeWeaponSlot).toBe(0);
    expect(controller.createCommand(actor).switchWeapon).toBeNull();

    documentTarget.dispatchEvent(keyEvent("Numpad2"));
    inventory.processCommand(state, actor.id, controller.createCommand(actor), []);
    expect(actor.inventory.activeWeaponSlot).toBe(1);

    documentTarget.dispatchEvent(wheelEvent(-1));
    inventory.processCommand(state, actor.id, controller.createCommand(actor), []);
    expect(actor.inventory.activeWeaponSlot).toBe(0);
    documentTarget.dispatchEvent(wheelEvent(1));
    inventory.processCommand(state, actor.id, controller.createCommand(actor), []);
    expect(actor.inventory.activeWeaponSlot).toBe(1);

    pointerLockElement = null;
    documentTarget.dispatchEvent(new Event("pointerlockchange"));
    documentTarget.dispatchEvent(keyEvent("Digit1"));
    pointerLockElement = canvas;
    expect(controller.createCommand(actor).switchWeapon).toBeNull();
    controller.dispose();
  });

  it.each([
    ["KeyQ", "bandage", 2.5],
    ["KeyH", "medkit", 5],
  ] as const)("starts %s healing from one key press even when movement and fire were held", (key, itemId, useSeconds) => {
    const canvas = new EventTarget() as HTMLCanvasElement;
    const documentTarget = new EventTarget() as Document;
    Object.defineProperty(documentTarget, "pointerLockElement", { configurable: true, value: canvas });
    vi.stubGlobal("document", documentTarget);
    const actor = createActorState("player", "player", { x: 0, y: 1.76, z: 0 });
    actor.health = 40;
    actor.inventory.backpack = [{ itemId, quantity: 1 }];
    const state = createState(actor);
    const controller = new HumanController(canvas);
    controller.rememberActor(actor);
    const inventory = new InventorySystem();
    const events: import("../../src/game/state/types").GameEvent[] = [];

    documentTarget.dispatchEvent(keyEvent("KeyW"));
    documentTarget.dispatchEvent(mouseEvent("mousedown", 0));
    documentTarget.dispatchEvent(keyEvent(key));
    const command = controller.createCommand(actor);

    expect(command.useItem).toBe(itemId);
    expect(command.move).toEqual({ x: 0, y: 0, z: 0 });
    expect(command.fire).toBe(false);
    inventory.processCommand(state, actor.id, command, events);
    expect(actor.inventory.usingItem).toEqual({ itemId, remainingSeconds: useSeconds });
    expect(events).toContainEqual({ type: "healing-started", actorId: actor.id, itemId });

    const nextCommand = controller.createCommand(actor);
    expect(nextCommand.useItem).toBeNull();
    expect(nextCommand.move).toEqual({ x: 0, y: 0, z: 0 });
    expect(nextCommand.fire).toBe(false);
    inventory.processCommand(state, actor.id, nextCommand, events);
    expect(actor.inventory.usingItem).not.toBeNull();

    documentTarget.dispatchEvent(keyEvent(key));
    expect(controller.createCommand(actor).useItem).toBeNull();
    controller.dispose();
  });

  it("does not swallow a new shot after healing was started without holding fire", () => {
    const canvas = new EventTarget() as HTMLCanvasElement;
    const documentTarget = new EventTarget() as Document;
    Object.defineProperty(documentTarget, "pointerLockElement", { configurable: true, value: canvas });
    vi.stubGlobal("document", documentTarget);
    const actor = createActorState("player", "player", { x: 0, y: 1.76, z: 0 });
    actor.health = 40;
    actor.inventory.backpack = [{ itemId: "bandage", quantity: 1 }];
    const controller = new HumanController(canvas);
    controller.rememberActor(actor);

    documentTarget.dispatchEvent(keyEvent("KeyQ"));
    expect(controller.createCommand(actor).useItem).toBe("bandage");
    documentTarget.dispatchEvent(mouseEvent("mousedown", 0));
    expect(controller.createCommand(actor).fire).toBe(true);
    controller.dispose();
  });

  it("scopes only the sniper and exits on release, reload, switch, and pointer unlock", () => {
    const canvas = new EventTarget() as HTMLCanvasElement;
    const documentTarget = new EventTarget() as Document;
    let pointerLockElement: Element | null = canvas;
    Object.defineProperty(documentTarget, "pointerLockElement", {
      configurable: true,
      get: () => pointerLockElement,
    });
    vi.stubGlobal("document", documentTarget);
    const actor = createActorState("player", "player", { x: 0, y: 1.76, z: 0 });
    const controller = new HumanController(canvas);
    controller.rememberActor(actor);

    documentTarget.dispatchEvent(mouseEvent("mousedown", 2));
    expect(controller.isScoped(actor)).toBe(false);

    actor.inventory.weaponSlots[0] = createWeaponState("sniper");
    controller.rememberActor(actor);
    documentTarget.dispatchEvent(mouseEvent("mousedown", 2));
    expect(controller.isScoped(actor)).toBe(true);
    documentTarget.dispatchEvent(mouseEvent("mouseup", 2));
    expect(controller.isScoped(actor)).toBe(false);

    documentTarget.dispatchEvent(mouseEvent("mousedown", 2));
    documentTarget.dispatchEvent(keyEvent("KeyR"));
    expect(controller.isScoped(actor)).toBe(false);
    documentTarget.dispatchEvent(mouseEvent("mousedown", 2));
    documentTarget.dispatchEvent(keyEvent("Digit2"));
    expect(controller.isScoped(actor)).toBe(false);

    documentTarget.dispatchEvent(mouseEvent("mousedown", 2));
    pointerLockElement = null;
    documentTarget.dispatchEvent(new Event("pointerlockchange"));
    expect(controller.isScoped(actor)).toBe(false);
    controller.dispose();
  });

  it("keeps a reload request alive until the weapon enters reload", () => {
    const canvas = new EventTarget() as HTMLCanvasElement;
    const documentTarget = new EventTarget() as Document;
    Object.defineProperty(documentTarget, "pointerLockElement", { configurable: true, value: canvas });
    vi.stubGlobal("document", documentTarget);
    const actor = createActorState("player", "player", { x: 0, y: 1.76, z: 0 });
    const weapon = actor.inventory.weaponSlots[0];
    if (!weapon) throw new Error("weapon missing");
    weapon.ammoInMagazine = 5;
    actor.inventory.backpack = [{ itemId: "ammo.rifle", quantity: 30 }];
    const controller = new HumanController(canvas);
    controller.rememberActor(actor);

    documentTarget.dispatchEvent(keyEvent("KeyR"));
    expect(controller.createCommand(actor).reload).toBe(true);
    expect(controller.createCommand(actor).reload).toBe(true);
    weapon.reloadSeconds = 1.8;
    controller.acknowledgeActorState(actor);
    expect(controller.createCommand(actor).reload).toBe(false);
    controller.dispose();
  });

  it("clears a buffered reload when switching by keyboard", () => {
    const canvas = new EventTarget() as HTMLCanvasElement;
    const documentTarget = new EventTarget() as Document;
    Object.defineProperty(documentTarget, "pointerLockElement", { configurable: true, value: canvas });
    vi.stubGlobal("document", documentTarget);
    const actor = createActorState("player", "player", { x: 0, y: 1.76, z: 0 });
    actor.inventory.weaponSlots[1] = createWeaponState("smg");
    const controller = new HumanController(canvas);
    controller.rememberActor(actor);

    documentTarget.dispatchEvent(keyEvent("KeyR"));
    documentTarget.dispatchEvent(keyEvent("Digit2"));
    const command = controller.createCommand(actor);

    expect(command.switchWeapon).toBe(1);
    expect(command.reload).toBe(false);
    expect(controller.createCommand(actor).reload).toBe(false);
    controller.dispose();
  });

  it("shows the leaderboard only while Tab is held", () => {
    const canvas = new EventTarget() as HTMLCanvasElement;
    const documentTarget = new EventTarget() as Document;
    Object.defineProperty(documentTarget, "pointerLockElement", { configurable: true, value: canvas });
    vi.stubGlobal("document", documentTarget);
    const controller = new HumanController(canvas);

    documentTarget.dispatchEvent(keyEvent("Tab"));
    expect(controller.isLeaderboardVisible()).toBe(true);
    documentTarget.dispatchEvent(Object.assign(new Event("keyup"), { code: "Tab" }));
    expect(controller.isLeaderboardVisible()).toBe(false);
    Object.defineProperty(documentTarget, "pointerLockElement", { configurable: true, value: null });
    documentTarget.dispatchEvent(keyEvent("Tab"));
    expect(controller.isLeaderboardVisible()).toBe(true);
    controller.dispose();
  });

  it("uses space and the wheel to cycle spectators after death without pointer lock", () => {
    const canvas = new EventTarget() as HTMLCanvasElement;
    const documentTarget = new EventTarget() as Document;
    Object.defineProperty(documentTarget, "pointerLockElement", { configurable: true, value: null });
    vi.stubGlobal("document", documentTarget);
    const actor = createActorState("player", "player", { x: 0, y: 1.76, z: 0 });
    actor.alive = false;
    const controller = new HumanController(canvas);
    controller.rememberActor(actor);

    const space = keyEvent("Space");
    documentTarget.dispatchEvent(space);
    expect(space.defaultPrevented).toBe(true);
    expect(controller.consumeSpectatorSwitchRequest()).toBe(1);
    expect(controller.consumeSpectatorSwitchRequest()).toBeNull();

    const previous = wheelEvent(-1);
    documentTarget.dispatchEvent(previous);
    expect(previous.defaultPrevented).toBe(true);
    expect(controller.consumeSpectatorSwitchRequest()).toBe(-1);

    documentTarget.dispatchEvent(wheelEvent(1));
    expect(controller.consumeSpectatorSwitchRequest()).toBe(1);
    controller.dispose();
  });
});

function createState(actor: ReturnType<typeof createActorState>): MatchState {
  return {
    mapSeed: 0,
    phase: "combat",
    elapsedSeconds: 0,
    actors: { [actor.id]: actor },
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

function keyEvent(code: string): Event {
  return Object.assign(new Event("keydown", { cancelable: true }), { code, repeat: false });
}

function wheelEvent(deltaY: number): Event {
  return Object.assign(new Event("wheel", { cancelable: true }), { deltaY });
}

function mouseEvent(type: string, button: number): Event {
  return Object.assign(new Event(type), { button });
}
