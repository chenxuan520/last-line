import type { ActorCommand } from "../game/commands/ActorCommand";
import { createIdleCommand } from "../game/commands/ActorCommand";
import { WEAPONS } from "../config/weapons";
import { getActiveWeapon, getItemQuantity, type ActorState, type WeaponSlot } from "../game/state/types";
import { TouchInputAdapter, type TouchAction, type TouchInputSink } from "./TouchInputAdapter";

const MOVEMENT_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "ShiftRight"]);
export type SpectatorSwitchDirection = -1 | 1;
export interface HumanControllerOptions {
  touchRoot?: HTMLElement;
  touchEnabled?: boolean;
}

export class HumanController implements TouchInputSink {
  private readonly pressedKeys = new Set<string>();
  private readonly suppressedMovementKeys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private fireHeld = false;
  private fireSuppressedUntilRelease = false;
  private scopeHeld = false;
  private reloadRequestTicks = 0;
  private leaderboardHeld = false;
  private jumpRequested = false;
  private interactRequested = false;
  private switchWeaponRequested: WeaponSlot | null = null;
  private useItemRequested: string | null = null;
  private dropItemRequested: string | null = null;
  private spectatorSwitchRequested: SpectatorSwitchDirection | null = null;
  private readonly touchEnabled: boolean;
  private readonly touchAdapter: TouchInputAdapter | null;
  private touchPaused = false;
  private touchRight = 0;
  private touchForward = 0;
  private touchMagnitude = 0;

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    private sensitivity = 1,
    options: HumanControllerOptions = {},
  ) {
    this.touchEnabled = options.touchEnabled ?? supportsTouchInput();
    this.touchAdapter = this.touchEnabled && options.touchRoot
      ? new TouchInputAdapter(options.touchRoot, this)
      : null;
    document.addEventListener("keydown", this.handleKeyDown);
    document.addEventListener("keyup", this.handleKeyUp);
    document.addEventListener("mousemove", this.handleMouseMove);
    document.addEventListener("mousedown", this.handleMouseDown);
    document.addEventListener("mouseup", this.handleMouseUp);
    document.addEventListener("pointerlockchange", this.handlePointerLockChange);
    document.addEventListener("visibilitychange", this.handleInputAvailabilityChange);
    document.addEventListener("wheel", this.handleWheel, { passive: false });
    canvas.addEventListener("contextmenu", this.preventContextMenu);
    if (typeof window !== "undefined") {
      window.addEventListener("blur", this.handleInputAvailabilityChange);
      window.addEventListener("orientationchange", this.handleInputAvailabilityChange);
      window.addEventListener("resize", this.handleInputAvailabilityChange);
    }
  }

  public createCommand(actor: ActorState): ActorCommand {
    const command = createIdleCommand();
    if (actor.alive && this.isGameplayInputActive()) {
      const forwardInput = this.touchForward +
        Number(this.pressedKeys.has("KeyW")) - Number(this.pressedKeys.has("KeyS"));
      const rightInput = this.touchRight +
        Number(this.pressedKeys.has("KeyD")) - Number(this.pressedKeys.has("KeyA"));
      const forward = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
      const right = { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
      command.move = {
        x: forward.x * forwardInput + right.x * rightInput,
        y: 0,
        z: forward.z * forwardInput + right.z * rightInput,
      };
      const horizontal = Math.cos(this.pitch);
      command.aimDirection = {
        x: Math.sin(this.yaw) * horizontal,
        y: -Math.sin(this.pitch),
        z: Math.cos(this.yaw) * horizontal,
      };
      command.fire = this.fireHeld;
      command.reload = this.reloadRequestTicks > 0;
      command.sprint = this.touchMagnitude >= 0.82 ||
        this.pressedKeys.has("ShiftLeft") || this.pressedKeys.has("ShiftRight");
      command.jump = this.jumpRequested;
      command.interact = this.interactRequested;
      command.switchWeapon = this.switchWeaponRequested;
      command.useItem = this.useItemRequested;
      command.dropItem = this.dropItemRequested;
    }

    if (this.reloadRequestTicks > 0) this.reloadRequestTicks -= 1;
    this.jumpRequested = false;
    this.interactRequested = false;
    this.switchWeaponRequested = null;
    this.useItemRequested = null;
    this.dropItemRequested = null;
    return command;
  }

  public getRotation(): { yaw: number; pitch: number } {
    return { yaw: this.yaw, pitch: this.pitch };
  }

  public setSensitivity(value: number): void {
    this.sensitivity = value;
  }

  public usesTouchControls(): boolean {
    return this.touchEnabled;
  }

  public isOrientationBlocked(): boolean {
    return this.touchEnabled && typeof window !== "undefined" && window.matchMedia?.("(orientation: portrait)").matches === true;
  }

  public isGameplayInputActive(): boolean {
    if (!this.touchEnabled) return document.pointerLockElement === this.canvas;
    const active = !this.touchPaused && !this.isOrientationBlocked() && document.visibilityState !== "hidden";
    if (!active) this.clearAllInput();
    return active;
  }

  public resumeInput(): void {
    if (!this.touchEnabled) return;
    this.touchPaused = false;
    this.clearAllInput();
  }

  public setTouchMovement(right: number, forward: number, magnitude: number): void {
    this.touchRight = right;
    this.touchForward = forward;
    this.touchMagnitude = magnitude;
  }

  public applyTouchLook(deltaX: number, deltaY: number): void {
    if (!this.isGameplayInputActive()) return;
    this.applyLookDelta(deltaX, deltaY, 0.0042);
  }

  public setTouchFire(held: boolean): void {
    if (!held) {
      this.fireHeld = false;
      this.fireSuppressedUntilRelease = false;
      return;
    }
    if (this.isGameplayInputActive() && !this.fireSuppressedUntilRelease) this.fireHeld = true;
  }

  public triggerTouchAction(action: Exclude<TouchAction, "fire">): void {
    if (action === "pause") {
      this.touchPaused = true;
      this.clearAllInput();
      return;
    }
    if (action === "spectator-previous" || action === "spectator-next") {
      this.spectatorSwitchRequested = action === "spectator-previous" ? -1 : 1;
      return;
    }
    if (!this.isGameplayInputActive()) return;
    if (action === "scope") {
      if (this.lastActor && this.canScope(this.lastActor)) this.scopeHeld = !this.scopeHeld;
      return;
    }
    if (action === "jump") {
      if (this.lastActor && !this.lastActor.alive) this.spectatorSwitchRequested = 1;
      else this.jumpRequested = true;
      return;
    }
    if (action === "interact") this.interactRequested = true;
    if (action === "reload") this.requestReload();
    if (action === "switch-weapon") this.requestNextWeapon();
    if (action === "bandage") this.requestMedicalItem("bandage");
    if (action === "medkit") this.requestMedicalItem("medkit");
  }

  public applyRecoil(amount: number): void {
    this.pitch = Math.max(-1.45, this.pitch - amount);
  }

  public isScoped(actor: ActorState): boolean {
    return this.scopeHeld && this.canScope(actor);
  }

  public isLeaderboardVisible(): boolean {
    return this.leaderboardHeld;
  }

  public consumeSpectatorSwitchRequest(): SpectatorSwitchDirection | null {
    const request = this.spectatorSwitchRequested;
    this.spectatorSwitchRequested = null;
    return request;
  }

  public acknowledgeActorState(actor: ActorState): void {
    this.lastActor = actor;
    if (!this.canScope(actor)) this.scopeHeld = false;
    const weapon = getActiveWeapon(actor);
    if (weapon?.reloadSeconds && weapon.reloadSeconds > 0) this.reloadRequestTicks = 0;
  }

  public dispose(): void {
    this.touchAdapter?.dispose();
    document.removeEventListener("keydown", this.handleKeyDown);
    document.removeEventListener("keyup", this.handleKeyUp);
    document.removeEventListener("mousemove", this.handleMouseMove);
    document.removeEventListener("mousedown", this.handleMouseDown);
    document.removeEventListener("mouseup", this.handleMouseUp);
    document.removeEventListener("pointerlockchange", this.handlePointerLockChange);
    document.removeEventListener("visibilitychange", this.handleInputAvailabilityChange);
    document.removeEventListener("wheel", this.handleWheel);
    this.canvas.removeEventListener("contextmenu", this.preventContextMenu);
    if (typeof window !== "undefined") {
      window.removeEventListener("blur", this.handleInputAvailabilityChange);
      window.removeEventListener("orientationchange", this.handleInputAvailabilityChange);
      window.removeEventListener("resize", this.handleInputAvailabilityChange);
    }
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === "Tab") {
      event.preventDefault();
      this.leaderboardHeld = true;
      return;
    }
    if (event.code === "Space" && !event.repeat && this.lastActor && !this.lastActor.alive) {
      event.preventDefault();
      this.spectatorSwitchRequested = 1;
      return;
    }
    if (document.pointerLockElement !== this.canvas && !this.isGameplayInputActive()) {
      return;
    }
    if (this.suppressedMovementKeys.has(event.code)) {
      return;
    }
    this.pressedKeys.add(event.code);
    if (event.repeat) {
      return;
    }
    if (event.code === "Space") this.jumpRequested = true;
    if (event.code === "KeyR") this.requestReload();
    if (event.code === "KeyF") this.interactRequested = true;
    if (event.code === "Digit1" || event.code === "Numpad1") {
      this.requestWeaponSlot(0);
    }
    if (event.code === "Digit2" || event.code === "Numpad2") {
      this.requestWeaponSlot(1);
    }
    if (event.code === "KeyQ") this.requestMedicalItem("bandage");
    if (event.code === "KeyH") this.requestMedicalItem("medkit");
    if (event.code === "KeyG") {
      const actor = this.lastActor;
      const weapon = actor ? getActiveWeapon(actor) : null;
      this.dropItemRequested = weapon ? `weapon.${weapon.weaponId}` : null;
    }
  };

  private lastActor: ActorState | null = null;

  public rememberActor(actor: ActorState): void {
    this.acknowledgeActorState(actor);
  }

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.suppressedMovementKeys.delete(event.code);
    this.pressedKeys.delete(event.code);
    if (event.code === "Tab") this.leaderboardHeld = false;
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (document.pointerLockElement !== this.canvas) {
      return;
    }
    this.applyLookDelta(event.movementX, event.movementY, 0.0021);
  };

  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (event.button === 0 && document.pointerLockElement === this.canvas && !this.fireSuppressedUntilRelease) {
      this.fireHeld = true;
    }
    if (event.button === 2 && document.pointerLockElement === this.canvas && this.lastActor && this.canScope(this.lastActor)) {
      this.scopeHeld = true;
    }
  };

  private readonly handleMouseUp = (event: MouseEvent): void => {
    if (event.button === 0) {
      this.fireHeld = false;
      this.fireSuppressedUntilRelease = false;
    }
    if (event.button === 2) this.scopeHeld = false;
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    if (event.deltaY === 0) {
      return;
    }
    if (this.lastActor && !this.lastActor.alive) {
      event.preventDefault();
      this.spectatorSwitchRequested = event.deltaY > 0 ? 1 : -1;
      return;
    }
    if (document.pointerLockElement !== this.canvas) return;
    event.preventDefault();
    this.requestNextWeapon();
  };

  private readonly handlePointerLockChange = (): void => {
    if (this.touchEnabled) return;
    if (document.pointerLockElement === this.canvas) {
      return;
    }
    this.clearAllInput();
  };

  private readonly handleInputAvailabilityChange = (event?: Event): void => {
    if (this.touchEnabled && (event?.type === "blur" || this.isOrientationBlocked() || document.visibilityState === "hidden")) {
      this.clearAllInput();
    }
  };

  private clearHeldInput(): void {
    this.pressedKeys.clear();
    this.suppressedMovementKeys.clear();
    this.touchRight = 0;
    this.touchForward = 0;
    this.touchMagnitude = 0;
    this.fireHeld = false;
    this.fireSuppressedUntilRelease = false;
    this.scopeHeld = false;
    this.leaderboardHeld = false;
  }

  private clearAllInput(): void {
    this.clearHeldInput();
    this.reloadRequestTicks = 0;
    this.jumpRequested = false;
    this.interactRequested = false;
    this.switchWeaponRequested = null;
    this.useItemRequested = null;
    this.dropItemRequested = null;
    this.touchAdapter?.reset();
  }

  private requestMedicalItem(itemId: "bandage" | "medkit"): void {
    const actor = this.lastActor;
    if (
      !actor?.alive ||
      actor.deployment !== "grounded" ||
      actor.health >= actor.maxHealth ||
      actor.inventory.usingItem ||
      getItemQuantity(actor, itemId) <= 0
    ) {
      return;
    }
    for (const key of this.pressedKeys) {
      if (MOVEMENT_KEYS.has(key)) {
        this.suppressedMovementKeys.add(key);
        this.pressedKeys.delete(key);
      }
    }
    this.touchRight = 0;
    this.touchForward = 0;
    this.touchMagnitude = 0;
    this.touchAdapter?.suppressMovementUntilRelease();
    this.fireSuppressedUntilRelease = this.fireHeld;
    this.fireHeld = false;
    this.scopeHeld = false;
    this.useItemRequested = itemId;
  }

  private requestReload(): void {
    this.reloadRequestTicks = 9;
    this.scopeHeld = false;
  }

  private requestNextWeapon(): void {
    const actor = this.lastActor;
    if (!actor) return;
    const nextSlot: WeaponSlot = actor.inventory.activeWeaponSlot === 0 ? 1 : 0;
    if (actor.inventory.weaponSlots[nextSlot]) this.requestWeaponSlot(nextSlot);
  }

  private requestWeaponSlot(slot: WeaponSlot): void {
    this.switchWeaponRequested = slot;
    this.scopeHeld = false;
    this.reloadRequestTicks = 0;
  }

  private applyLookDelta(deltaX: number, deltaY: number, baseScale: number): void {
    const scale = baseScale * this.sensitivity * (this.lastActor && this.isScoped(this.lastActor) ? 0.38 : 1);
    this.yaw += deltaX * scale;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + deltaY * scale));
  }

  private canScope(actor: ActorState): boolean {
    const weapon = getActiveWeapon(actor);
    return Boolean(
      actor.alive &&
      actor.deployment === "grounded" &&
      weapon &&
      weapon.reloadSeconds <= 0 &&
      WEAPONS[weapon.weaponId]?.scopeFov !== undefined
    );
  }

  private readonly preventContextMenu = (event: MouseEvent): void => event.preventDefault();
}

export function supportsTouchInput(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(pointer: coarse)").matches
    : navigator.maxTouchPoints > 0;
}
