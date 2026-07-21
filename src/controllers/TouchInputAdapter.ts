export type TouchAction =
  | "fire"
  | "scope"
  | "jump"
  | "interact"
  | "reload"
  | "switch-weapon"
  | "bandage"
  | "medkit"
  | "pause"
  | "spectator-previous"
  | "spectator-next";

export interface TouchInputSink {
  setTouchMovement(right: number, forward: number, magnitude: number): void;
  applyTouchLook(deltaX: number, deltaY: number): void;
  setTouchFire(held: boolean): void;
  triggerTouchAction(action: Exclude<TouchAction, "fire">): void;
}

export interface TouchJoystickState {
  right: number;
  forward: number;
  magnitude: number;
  knobX: number;
  knobY: number;
}

export function normalizeTouchJoystick(
  offsetX: number,
  offsetY: number,
  radius: number,
  deadZone = 0.12,
): TouchJoystickState {
  const safeRadius = Math.max(1, radius);
  const distance = Math.hypot(offsetX, offsetY);
  const clampedDistance = Math.min(distance, safeRadius);
  const directionX = distance > 0 ? offsetX / distance : 0;
  const directionY = distance > 0 ? offsetY / distance : 0;
  const rawMagnitude = clampedDistance / safeRadius;
  const magnitude = rawMagnitude <= deadZone
    ? 0
    : Math.min(1, (rawMagnitude - deadZone) / (1 - deadZone));
  return {
    right: directionX * magnitude,
    forward: -directionY * magnitude,
    magnitude,
    knobX: directionX * clampedDistance,
    knobY: directionY * clampedDistance,
  };
}

export class TouchInputAdapter {
  private movementPointerId: number | null = null;
  private lookPointerId: number | null = null;
  private firePointerId: number | null = null;
  private movementElement: HTMLElement | null = null;
  private movementSuppressed = false;
  private lookX = 0;
  private lookY = 0;

  public constructor(
    private readonly root: HTMLElement,
    private readonly sink: TouchInputSink,
  ) {
    root.addEventListener("pointerdown", this.handlePointerDown, { passive: false });
    root.addEventListener("pointermove", this.handlePointerMove, { passive: false });
    root.addEventListener("pointerup", this.handlePointerEnd, { passive: false });
    root.addEventListener("pointercancel", this.handlePointerEnd, { passive: false });
    root.addEventListener("lostpointercapture", this.handlePointerEnd, { passive: false });
  }

  public suppressMovementUntilRelease(): void {
    if (this.movementPointerId === null) return;
    this.movementSuppressed = true;
    this.sink.setTouchMovement(0, 0, 0);
    this.centerJoystick();
  }

  public reset(): void {
    this.movementPointerId = null;
    this.lookPointerId = null;
    this.firePointerId = null;
    this.movementSuppressed = false;
    this.sink.setTouchMovement(0, 0, 0);
    this.sink.setTouchFire(false);
    this.centerJoystick();
  }

  public dispose(): void {
    this.reset();
    this.root.removeEventListener("pointerdown", this.handlePointerDown);
    this.root.removeEventListener("pointermove", this.handlePointerMove);
    this.root.removeEventListener("pointerup", this.handlePointerEnd);
    this.root.removeEventListener("pointercancel", this.handlePointerEnd);
    this.root.removeEventListener("lostpointercapture", this.handlePointerEnd);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse") return;
    const control = closestControl(event.target);
    if (!control) return;
    const action = control.dataset.touchAction as TouchAction | undefined;
    const role = control.dataset.touchRole;
    if (action) {
      event.preventDefault();
      control.setPointerCapture?.(event.pointerId);
      if (action === "fire") {
        if (this.firePointerId !== null) return;
        this.firePointerId = event.pointerId;
        this.sink.setTouchFire(true);
      } else {
        this.sink.triggerTouchAction(action);
      }
      return;
    }
    if (role === "move" && this.movementPointerId === null) {
      event.preventDefault();
      this.movementPointerId = event.pointerId;
      this.movementElement = control;
      this.movementSuppressed = false;
      control.setPointerCapture?.(event.pointerId);
      this.updateMovement(event.clientX, event.clientY);
      return;
    }
    if (role === "look" && this.lookPointerId === null) {
      event.preventDefault();
      this.lookPointerId = event.pointerId;
      this.lookX = event.clientX;
      this.lookY = event.clientY;
      control.setPointerCapture?.(event.pointerId);
    }
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerId === this.movementPointerId) {
      event.preventDefault();
      if (!this.movementSuppressed) this.updateMovement(event.clientX, event.clientY);
      return;
    }
    if (event.pointerId === this.lookPointerId) {
      event.preventDefault();
      this.sink.applyTouchLook(event.clientX - this.lookX, event.clientY - this.lookY);
      this.lookX = event.clientX;
      this.lookY = event.clientY;
    }
  };

  private readonly handlePointerEnd = (event: PointerEvent): void => {
    if (event.pointerId === this.movementPointerId) {
      event.preventDefault();
      this.movementPointerId = null;
      this.movementSuppressed = false;
      this.sink.setTouchMovement(0, 0, 0);
      this.centerJoystick();
    }
    if (event.pointerId === this.lookPointerId) {
      event.preventDefault();
      this.lookPointerId = null;
    }
    if (event.pointerId === this.firePointerId) {
      event.preventDefault();
      this.firePointerId = null;
      this.sink.setTouchFire(false);
    }
  };

  private updateMovement(clientX: number, clientY: number): void {
    const bounds = this.movementElement?.getBoundingClientRect();
    if (!bounds) return;
    const radius = Math.max(1, Math.min(bounds.width, bounds.height) * 0.32);
    const state = normalizeTouchJoystick(
      clientX - (bounds.left + bounds.width / 2),
      clientY - (bounds.top + bounds.height / 2),
      radius,
    );
    this.sink.setTouchMovement(state.right, state.forward, state.magnitude);
    const knob = this.movementElement?.querySelector<HTMLElement>("[data-touch-knob]");
    if (knob) knob.style.translate = `${state.knobX}px ${state.knobY}px`;
  }

  private centerJoystick(): void {
    const knob = this.movementElement?.querySelector<HTMLElement>("[data-touch-knob]");
    if (knob) knob.style.translate = "0 0";
  }
}

function closestControl(target: EventTarget | null): HTMLElement | null {
  if (!target || typeof (target as HTMLElement).closest !== "function") return null;
  return (target as HTMLElement).closest<HTMLElement>("[data-touch-action], [data-touch-role]");
}
