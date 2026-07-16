import type { ActorCommand } from "../game/commands/ActorCommand";
import { createIdleCommand } from "../game/commands/ActorCommand";
import { getActiveWeapon, type ActorState, type WeaponSlot } from "../game/state/types";

export class HumanController {
  private readonly pressedKeys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private fireHeld = false;
  private reloadRequested = false;
  private jumpRequested = false;
  private interactRequested = false;
  private switchWeaponRequested: WeaponSlot | null = null;
  private useItemRequested: string | null = null;
  private dropItemRequested: string | null = null;

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    private sensitivity = 1,
  ) {
    document.addEventListener("keydown", this.handleKeyDown);
    document.addEventListener("keyup", this.handleKeyUp);
    document.addEventListener("mousemove", this.handleMouseMove);
    document.addEventListener("mousedown", this.handleMouseDown);
    document.addEventListener("mouseup", this.handleMouseUp);
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
      command.reload = this.reloadRequested;
      command.sprint = this.pressedKeys.has("ShiftLeft") || this.pressedKeys.has("ShiftRight");
      command.jump = this.jumpRequested;
      command.interact = this.interactRequested;
      command.switchWeapon = this.switchWeaponRequested;
      command.useItem = this.useItemRequested;
      command.dropItem = this.dropItemRequested;
    }

    this.reloadRequested = false;
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

  public dispose(): void {
    document.removeEventListener("keydown", this.handleKeyDown);
    document.removeEventListener("keyup", this.handleKeyUp);
    document.removeEventListener("mousemove", this.handleMouseMove);
    document.removeEventListener("mousedown", this.handleMouseDown);
    document.removeEventListener("mouseup", this.handleMouseUp);
    this.canvas.removeEventListener("contextmenu", this.preventContextMenu);
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    this.pressedKeys.add(event.code);
    if (event.repeat) {
      return;
    }
    if (event.code === "Space") this.jumpRequested = true;
    if (event.code === "KeyR") this.reloadRequested = true;
    if (event.code === "KeyF") this.interactRequested = true;
    if (event.code === "Digit1") this.switchWeaponRequested = 0;
    if (event.code === "Digit2") this.switchWeaponRequested = 1;
    if (event.code === "KeyQ") this.useItemRequested = "bandage";
    if (event.code === "KeyH") this.useItemRequested = "medkit";
    if (event.code === "KeyG") {
      const actor = this.lastActor;
      const weapon = actor ? getActiveWeapon(actor) : null;
      this.dropItemRequested = weapon ? `weapon.${weapon.weaponId}` : null;
    }
  };

  private lastActor: ActorState | null = null;

  public rememberActor(actor: ActorState): void {
    this.lastActor = actor;
  }

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.pressedKeys.delete(event.code);
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (document.pointerLockElement !== this.canvas) {
      return;
    }
    const scale = 0.0021 * this.sensitivity;
    this.yaw += event.movementX * scale;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + event.movementY * scale));
  };

  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (event.button === 0) this.fireHeld = true;
  };

  private readonly handleMouseUp = (event: MouseEvent): void => {
    if (event.button === 0) this.fireHeld = false;
  };

  private readonly preventContextMenu = (event: MouseEvent): void => event.preventDefault();
}
