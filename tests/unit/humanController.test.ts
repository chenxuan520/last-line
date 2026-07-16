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

    canvas.dispatchEvent(wheelEvent(-1));
    inventory.processCommand(state, actor.id, controller.createCommand(actor), []);
    expect(actor.inventory.activeWeaponSlot).toBe(0);
    canvas.dispatchEvent(wheelEvent(1));
    inventory.processCommand(state, actor.id, controller.createCommand(actor), []);
    expect(actor.inventory.activeWeaponSlot).toBe(1);

    pointerLockElement = null;
    documentTarget.dispatchEvent(new Event("pointerlockchange"));
    documentTarget.dispatchEvent(keyEvent("Digit1"));
    pointerLockElement = canvas;
    expect(controller.createCommand(actor).switchWeapon).toBeNull();
    controller.dispose();
  });
});

function createState(actor: ReturnType<typeof createActorState>): MatchState {
  return {
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
  return Object.assign(new Event("keydown"), { code, repeat: false });
}

function wheelEvent(deltaY: number): Event {
  return Object.assign(new Event("wheel", { cancelable: true }), { deltaY });
}
