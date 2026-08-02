import { afterEach, describe, expect, it, vi } from "vitest";
import { HumanController } from "../../src/controllers/HumanController";
import {
  backpackSnapshotSignature,
  parseBackpackStackDropRequest,
} from "../../src/game/commands/ActorCommand";
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

  it("maps desktop keys 4-9 and mobile requests to one-shot backpack stack drops", () => {
    const canvas = new EventTarget() as HTMLCanvasElement;
    const documentTarget = new EventTarget() as Document;
    Object.defineProperty(documentTarget, "pointerLockElement", { configurable: true, value: canvas });
    vi.stubGlobal("document", documentTarget);
    const actor = createActorState("player", "player", { x: 0, y: 1.76, z: 0 });
    actor.inventory.backpack = [
      { itemId: "ammo.rifle", quantity: 40 },
      { itemId: "medkit", quantity: 1 },
    ];
    const controller = new HumanController(canvas, 1, { touchEnabled: false });
    controller.rememberActor(actor);

    documentTarget.dispatchEvent(keyEvent("Digit5"));
    expect(parseBackpackStackDropRequest(controller.createCommand(actor).dropItem ?? "")).toMatchObject({
      index: 1,
      itemId: "medkit",
    });
    expect(controller.createCommand(actor).dropItem).toBeNull();

    controller.requestDropBackpackItem(0, "ammo.rifle");
    expect(parseBackpackStackDropRequest(controller.createCommand(actor).dropItem ?? "")).toMatchObject({
      index: 0,
      itemId: "ammo.rifle",
    });
    controller.requestDropBackpackItem(1, "ammo.rifle");
    expect(controller.createCommand(actor).dropItem).toBeNull();

    const oldSnapshot = backpackSnapshotSignature(actor.inventory.backpack);
    actor.inventory.backpack[0]!.quantity = 39;
    controller.rememberActor(actor);
    controller.requestDropBackpackItem(0, "ammo.rifle", oldSnapshot);
    expect(parseBackpackStackDropRequest(controller.createCommand(actor).dropItem ?? "")?.snapshot)
      .toBe(oldSnapshot);
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

  it("emits the same movement, look, fire, and one-shot commands from touch input", () => {
    const canvas = new EventTarget() as HTMLCanvasElement;
    const documentTarget = new EventTarget() as Document;
    Object.defineProperty(documentTarget, "pointerLockElement", { configurable: true, value: null });
    vi.stubGlobal("document", documentTarget);
    const actor = createActorState("player", "player", { x: 0, y: 1.76, z: 0 });
    actor.inventory.weaponSlots[1] = createWeaponState("smg");
    const controller = new HumanController(canvas, 1, { touchEnabled: true });
    controller.rememberActor(actor);

    controller.setTouchMovement(0, 1, 0.9);
    controller.applyTouchLook(100, 0);
    controller.setTouchFire(true);
    controller.triggerTouchAction("jump");
    controller.triggerTouchAction("interact");
    controller.triggerTouchAction("switch-weapon");
    const command = controller.createCommand(actor);

    expect(controller.usesTouchControls()).toBe(true);
    expect(controller.isGameplayInputActive()).toBe(true);
    expect(command.move.x).toBeCloseTo(Math.sin(0.6));
    expect(command.move.z).toBeCloseTo(Math.cos(0.6));
    expect(command.sprint).toBe(true);
    expect(command.fire).toBe(true);
    expect(command.jump).toBe(true);
    expect(command.interact).toBe(true);
    expect(command.switchWeapon).toBe(1);
    expect(controller.createCommand(actor)).toMatchObject({
      jump: false,
      interact: false,
      switchWeapon: null,
      fire: true,
    });

    controller.setTouchFire(false);
    controller.triggerTouchAction("pause");
    expect(controller.isGameplayInputActive()).toBe(false);
    expect(controller.createCommand(actor)).toMatchObject({ fire: false, move: { x: 0, y: 0, z: 0 } });
    controller.resumeInput();
    expect(controller.isGameplayInputActive()).toBe(true);
    controller.dispose();
  });

  it("applies the full touch sensitivity range to a fast mobile look baseline", () => {
    const canvas = new EventTarget() as HTMLCanvasElement;
    const documentTarget = new EventTarget() as Document;
    Object.defineProperty(documentTarget, "pointerLockElement", { configurable: true, value: null });
    vi.stubGlobal("document", documentTarget);
    const lowSensitivity = new HumanController(canvas, 0.4, { touchEnabled: true });
    const highSensitivity = new HumanController(canvas, 2, { touchEnabled: true });

    lowSensitivity.applyTouchLook(100, 0);
    highSensitivity.applyTouchLook(100, 0);

    expect(lowSensitivity.getRotation().yaw).toBeCloseTo(0.24);
    expect(highSensitivity.getRotation().yaw).toBeCloseTo(1.2);
    expect(highSensitivity.getRotation().yaw / lowSensitivity.getRotation().yaw).toBeCloseTo(5);
    lowSensitivity.dispose();
    highSensitivity.dispose();
  });

  it("keeps the desktop mouse look baseline unchanged", () => {
    const canvas = new EventTarget() as HTMLCanvasElement;
    const documentTarget = new EventTarget() as Document;
    Object.defineProperty(documentTarget, "pointerLockElement", { configurable: true, value: canvas });
    vi.stubGlobal("document", documentTarget);
    const controller = new HumanController(canvas, 1, { touchEnabled: false });

    documentTarget.dispatchEvent(Object.assign(new Event("mousemove"), { movementX: 100, movementY: 0 }));

    expect(controller.getRotation().yaw).toBeCloseTo(0.21);
    controller.dispose();
  });

  it("clears dual touch fire through pause, hiding, blur, and disposal", () => {
    const canvas = new EventTarget() as HTMLCanvasElement;
    const documentTarget = new EventTarget() as Document;
    const windowTarget = createTouchWindow();
    const touchRoot = createTouchRoot();
    let visibilityState: DocumentVisibilityState = "visible";
    Object.defineProperty(documentTarget, "pointerLockElement", { configurable: true, value: null });
    Object.defineProperty(documentTarget, "visibilityState", { configurable: true, get: () => visibilityState });
    vi.stubGlobal("document", documentTarget);
    vi.stubGlobal("window", windowTarget);
    const actor = createActorState("player", "player", { x: 0, y: 1.76, z: 0 });
    const controller = new HumanController(canvas, 1, { touchEnabled: true, touchRoot });
    controller.rememberActor(actor);

    pressTouchFire(touchRoot, 1, "fire-look");
    pressTouchFire(touchRoot, 2, "fire");
    expect(controller.createCommand(actor).fire).toBe(true);
    pressTouchAction(touchRoot, 9, "pause");
    expect(controller.createCommand(actor).fire).toBe(false);

    controller.resumeInput();
    pressTouchFire(touchRoot, 3, "fire-look");
    pressTouchFire(touchRoot, 4, "fire");
    visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    expect(controller.createCommand(actor).fire).toBe(false);

    visibilityState = "visible";
    controller.resumeInput();
    pressTouchFire(touchRoot, 5, "fire-look");
    pressTouchFire(touchRoot, 6, "fire");
    windowTarget.dispatchEvent(new Event("blur"));
    expect(controller.createCommand(actor).fire).toBe(false);

    controller.resumeInput();
    pressTouchFire(touchRoot, 7, "fire-look");
    pressTouchFire(touchRoot, 8, "fire");
    windowTarget.portrait = true;
    windowTarget.dispatchEvent(new Event("orientationchange"));
    expect(controller.createCommand(actor).fire).toBe(false);

    windowTarget.portrait = false;
    controller.resumeInput();
    pressTouchFire(touchRoot, 10, "fire-look");
    pressTouchFire(touchRoot, 11, "fire");
    controller.dispose();
    expect(controller.createCommand(actor).fire).toBe(false);
  });

  it("suppresses dual touch fire until every held pointer is released during healing", () => {
    const canvas = new EventTarget() as HTMLCanvasElement;
    const documentTarget = new EventTarget() as Document;
    const windowTarget = createTouchWindow();
    const touchRoot = createTouchRoot();
    Object.defineProperty(documentTarget, "pointerLockElement", { configurable: true, value: null });
    vi.stubGlobal("document", documentTarget);
    vi.stubGlobal("window", windowTarget);
    const actor = createActorState("player", "player", { x: 0, y: 1.76, z: 0 });
    actor.health = 40;
    actor.inventory.backpack = [{ itemId: "bandage", quantity: 1 }];
    const controller = new HumanController(canvas, 1, { touchEnabled: true, touchRoot });
    controller.rememberActor(actor);

    pressTouchFire(touchRoot, 1, "fire-look");
    pressTouchFire(touchRoot, 2, "fire");
    pressTouchAction(touchRoot, 4, "bandage");

    expect(controller.createCommand(actor)).toMatchObject({
      move: { x: 0, y: 0, z: 0 },
      sprint: false,
      fire: false,
      useItem: "bandage",
    });
    expect(controller.createCommand(actor).useItem).toBeNull();
    touchRoot.dispatchEvent(touchPointerEvent("pointerup", 1));
    expect(controller.createCommand(actor).fire).toBe(false);
    touchRoot.dispatchEvent(touchPointerEvent("pointerup", 2));
    expect(controller.createCommand(actor).fire).toBe(false);

    pressTouchFire(touchRoot, 3, "fire-look");
    expect(controller.createCommand(actor).fire).toBe(true);
    touchRoot.dispatchEvent(touchPointerEvent("pointerup", 3));
    controller.dispose();
  });

  it("toggles touch scope and supports touch spectator directions", () => {
    const canvas = new EventTarget() as HTMLCanvasElement;
    const documentTarget = new EventTarget() as Document;
    Object.defineProperty(documentTarget, "pointerLockElement", { configurable: true, value: null });
    vi.stubGlobal("document", documentTarget);
    const actor = createActorState("player", "player", { x: 0, y: 1.76, z: 0 });
    actor.inventory.weaponSlots[0] = createWeaponState("sniper");
    const controller = new HumanController(canvas, 1, { touchEnabled: true });
    controller.rememberActor(actor);

    controller.triggerTouchAction("scope");
    expect(controller.isScoped(actor)).toBe(true);
    controller.triggerTouchAction("scope");
    expect(controller.isScoped(actor)).toBe(false);

    actor.alive = false;
    controller.rememberActor(actor);
    controller.triggerTouchAction("spectator-previous");
    expect(controller.consumeSpectatorSwitchRequest()).toBe(-1);
    controller.triggerTouchAction("spectator-next");
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

type TouchRoot = HTMLElement;

type TouchWindow = Window & {
  portrait: boolean;
};

function createTouchRoot(): TouchRoot {
  const root = new EventTarget() as TouchRoot;
  Object.assign(root, {
    dataset: {} as DOMStringMap,
    closest: () => root,
    setPointerCapture: () => undefined,
    querySelector: () => null,
  });
  return root;
}

function createTouchWindow(): TouchWindow {
  const windowTarget = new EventTarget() as unknown as TouchWindow;
  Object.assign(windowTarget, {
    portrait: false,
    matchMedia: (query: string) => ({ matches: query === "(orientation: portrait)" && windowTarget.portrait }),
  });
  return windowTarget;
}

function pressTouchFire(root: TouchRoot, pointerId: number, role: "fire" | "fire-look"): void {
  root.dataset.touchAction = "fire";
  root.dataset.touchRole = role;
  root.dispatchEvent(touchPointerEvent("pointerdown", pointerId));
}

function pressTouchAction(
  root: TouchRoot,
  pointerId: number,
  action: "bandage" | "pause",
): void {
  root.dataset.touchAction = action;
  delete root.dataset.touchRole;
  root.dispatchEvent(touchPointerEvent("pointerdown", pointerId));
}

function touchPointerEvent(type: string, pointerId: number): Event {
  return Object.assign(new Event(type, { cancelable: true }), {
    pointerId,
    pointerType: "touch",
    clientX: pointerId * 10,
    clientY: 20,
  });
}
