import type { ActorCommand } from "../game/commands/ActorCommand";
import { createIdleCommand } from "../game/commands/ActorCommand";
import { WEAPONS } from "../config/weapons";
import { getActiveWeapon, getItemQuantity, type ActorState, type WeaponSlot } from "../game/state/types";

const MOVEMENT_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "ShiftRight"]);
export type SpectatorSwitchDirection = -1 | 1;

export class HumanController {
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

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    private sensitivity = 1,
  ) {
    document.addEventListener("keydown", this.handleKeyDown);
    document.addEventListener("keyup", this.handleKeyUp);
    document.addEventListener("mousemove", this.handleMouseMove);
    document.addEventListener("mousedown", this.handleMouseDown);
    document.addEventListener("mouseup", this.handleMouseUp);
    document.addEventListener("pointerlockchange", this.handlePointerLockChange);
    document.addEventListener("wheel", this.handleWheel, { passive: false });
    canvas.addEventListener("contextmenu", this.preventContextMenu);
  }

  public createCommand(actor: ActorState): ActorCommand {
    const command = createIdleCommand();
    if (actor.alive && document.pointerLockElement === this.canvas) {
      const forwardInput = Number(this.pressedKeys.has("KeyW")) - Number(this.pressedKeys.has("KeyS"));
      const rightInput = Number(this.pressedKeys.has("KeyD")) - Number(this.pressedKeys.has("KeyA"));
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
      command.sprint = this.pressedKeys.has("ShiftLeft") || this.pressedKeys.has("ShiftRight");
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
    document.removeEventListener("keydown", this.handleKeyDown);
    document.removeEventListener("keyup", this.handleKeyUp);
    document.removeEventListener("mousemove", this.handleMouseMove);
    document.removeEventListener("mousedown", this.handleMouseDown);
    document.removeEventListener("mouseup", this.handleMouseUp);
    document.removeEventListener("pointerlockchange", this.handlePointerLockChange);
    document.removeEventListener("wheel", this.handleWheel);
    this.canvas.removeEventListener("contextmenu", this.preventContextMenu);
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
    if (document.pointerLockElement !== this.canvas) {
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
    if (event.code === "KeyR") {
      this.reloadRequestTicks = 9;
      this.scopeHeld = false;
    }
    if (event.code === "KeyF") this.interactRequested = true;
    if (event.code === "Digit1" || event.code === "Numpad1") {
      this.switchWeaponRequested = 0;
      this.scopeHeld = false;
      this.reloadRequestTicks = 0;
    }
    if (event.code === "Digit2" || event.code === "Numpad2") {
      this.switchWeaponRequested = 1;
      this.scopeHeld = false;
      this.reloadRequestTicks = 0;
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
    const scale = 0.0021 * this.sensitivity * (this.lastActor && this.isScoped(this.lastActor) ? 0.38 : 1);
    this.yaw += event.movementX * scale;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + event.movementY * scale));
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
    const actor = this.lastActor;
    if (!actor) {
      return;
    }
    const nextSlot: WeaponSlot = actor.inventory.activeWeaponSlot === 0 ? 1 : 0;
    if (actor.inventory.weaponSlots[nextSlot]) {
      this.switchWeaponRequested = nextSlot;
      this.scopeHeld = false;
      this.reloadRequestTicks = 0;
    }
  };

  private readonly handlePointerLockChange = (): void => {
    if (document.pointerLockElement === this.canvas) {
      return;
    }
    this.pressedKeys.clear();
    this.suppressedMovementKeys.clear();
    this.fireHeld = false;
    this.fireSuppressedUntilRelease = false;
    this.scopeHeld = false;
    this.reloadRequestTicks = 0;
    this.leaderboardHeld = false;
    this.jumpRequested = false;
    this.interactRequested = false;
    this.switchWeaponRequested = null;
    this.useItemRequested = null;
    this.dropItemRequested = null;
  };

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
    this.fireSuppressedUntilRelease = this.fireHeld;
    this.fireHeld = false;
    this.useItemRequested = itemId;
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
