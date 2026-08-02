import { describe, expect, it } from "vitest";
import {
  normalizeTouchJoystick,
  TouchInputAdapter,
  type TouchInputSink,
} from "../../src/controllers/TouchInputAdapter";

describe("touch input adapter", () => {
  it("applies a dead zone and maps upward movement to forward", () => {
    expect(normalizeTouchJoystick(2, -2, 50)).toMatchObject({
      right: 0,
      forward: 0,
      magnitude: 0,
    });

    const forward = normalizeTouchJoystick(0, -25, 50);
    expect(forward.right).toBeCloseTo(0);
    expect(forward.forward).toBeGreaterThan(0);
    expect(forward.magnitude).toBeLessThan(1);
  });

  it("clamps diagonal movement to the joystick radius", () => {
    const state = normalizeTouchJoystick(100, -100, 50);

    expect(state.magnitude).toBe(1);
    expect(Math.hypot(state.right, state.forward)).toBeCloseTo(1);
    expect(Math.hypot(state.knobX, state.knobY)).toBeCloseTo(50);
  });

  it("tracks movement, look, and dual fire pointers independently", () => {
    const knob = { style: { translate: "" } };
    const root = new EventTarget() as HTMLElement;
    Object.assign(root, {
      dataset: {} as DOMStringMap,
      closest: () => root,
      setPointerCapture: () => undefined,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 120, height: 120 }),
      querySelector: () => knob,
    });
    const movement: Array<readonly [number, number, number]> = [];
    const looks: Array<readonly [number, number]> = [];
    const fire: boolean[] = [];
    const sink: TouchInputSink = {
      setTouchMovement: (right, forward, magnitude) => movement.push([right, forward, magnitude]),
      applyTouchLook: (x, y) => looks.push([x, y]),
      setTouchFire: (held) => fire.push(held),
      triggerTouchAction: () => undefined,
    };
    const adapter = new TouchInputAdapter(root, sink);

    root.dataset.touchRole = "move";
    root.dispatchEvent(pointerEvent("pointerdown", 1, 60, 20));
    root.dataset.touchRole = "look";
    root.dispatchEvent(pointerEvent("pointerdown", 2, 200, 100));
    delete root.dataset.touchRole;
    root.dataset.touchAction = "fire";
    root.dataset.touchRole = "fire-look";
    root.dispatchEvent(pointerEvent("pointerdown", 3, 300, 100));
    root.dispatchEvent(pointerEvent("pointermove", 2, 230, 90));
    root.dispatchEvent(pointerEvent("pointermove", 3, 320, 110));
    root.dataset.touchRole = "fire";
    root.dispatchEvent(pointerEvent("pointerdown", 4, 80, 100));

    expect(movement.at(-1)?.[1]).toBeGreaterThan(0);
    expect(looks).toContainEqual([30, -10]);
    expect(looks).toContainEqual([20, 10]);
    expect(fire).toContain(true);

    root.dispatchEvent(pointerEvent("pointerup", 1, 60, 20));
    root.dispatchEvent(pointerEvent("pointerup", 3, 300, 100));
    expect(movement.at(-1)).toEqual([0, 0, 0]);
    expect(fire.at(-1)).toBe(true);
    root.dispatchEvent(pointerEvent("pointerup", 4, 80, 100));
    expect(fire.at(-1)).toBe(false);
    expect(knob.style.translate).toBe("0 0");
    adapter.dispose();
  });

  it("releases dual fire through cancellation, capture loss, reset, and disposal", () => {
    const root = createTouchRoot();
    const fire: boolean[] = [];
    const adapter = new TouchInputAdapter(root, {
      setTouchMovement: () => undefined,
      applyTouchLook: () => undefined,
      setTouchFire: (held) => fire.push(held),
      triggerTouchAction: () => undefined,
    });

    pressFire(root, 1, "fire-look");
    pressFire(root, 2, "fire");
    root.dispatchEvent(pointerEvent("pointercancel", 1, 0, 0));
    expect(fire.at(-1)).toBe(true);
    root.dispatchEvent(pointerEvent("lostpointercapture", 2, 0, 0));
    expect(fire.at(-1)).toBe(false);

    pressFire(root, 3, "fire-look");
    pressFire(root, 4, "fire");
    root.dispatchEvent(pointerEvent("lostpointercapture", 4, 0, 0));
    expect(fire.at(-1)).toBe(true);
    root.dispatchEvent(pointerEvent("pointercancel", 3, 0, 0));
    expect(fire.at(-1)).toBe(false);

    pressFire(root, 5, "fire-look");
    pressFire(root, 6, "fire");
    adapter.reset();
    expect(fire.at(-1)).toBe(false);

    pressFire(root, 7, "fire-look");
    pressFire(root, 8, "fire");
    adapter.dispose();
    expect(fire.at(-1)).toBe(false);
  });
});

function pointerEvent(type: string, pointerId: number, clientX: number, clientY: number): Event {
  return Object.assign(new Event(type, { cancelable: true }), {
    pointerId,
    pointerType: "touch",
    clientX,
    clientY,
  });
}

function createTouchRoot(): HTMLElement {
  const root = new EventTarget() as HTMLElement;
  Object.assign(root, {
    dataset: {} as DOMStringMap,
    closest: () => root,
    setPointerCapture: () => undefined,
    querySelector: () => null,
  });
  return root;
}

function pressFire(root: HTMLElement, pointerId: number, role: "fire" | "fire-look"): void {
  root.dataset.touchAction = "fire";
  root.dataset.touchRole = role;
  root.dispatchEvent(pointerEvent("pointerdown", pointerId, pointerId * 10, 20));
}
