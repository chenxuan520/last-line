import { describe, expect, it, vi } from "vitest";
import { MobileFullscreenController } from "../../src/client/ui/MobileFullscreenController";

describe("MobileFullscreenController", () => {
  it("requests fullscreen synchronously and locks landscape after entry", async () => {
    const environment = createEnvironment();
    const controller = new MobileFullscreenController(environment.options);

    controller.activateFromUserGesture();

    expect(environment.requestFullscreen).toHaveBeenCalledOnce();
    await settle();
    expect(environment.lock).toHaveBeenCalledWith("landscape");
    expect(controller.needsAction(false)).toBe(false);

    environment.setFullscreenElement(null);
    expect(controller.needsAction(false)).toBe(true);
  });

  it("exposes a retry after rejection and clears it after success", async () => {
    const environment = createEnvironment();
    environment.requestFullscreen.mockRejectedValueOnce(new Error("denied"));
    const controller = new MobileFullscreenController(environment.options);

    controller.activateFromUserGesture();
    await settle();
    expect(controller.needsAction(true)).toBe(true);

    controller.requestFromUserGesture();
    await settle();
    expect(environment.requestFullscreen).toHaveBeenCalledTimes(2);
    expect(controller.needsAction(false)).toBe(false);
  });

  it("keeps unsupported and desktop browsers on the existing fallback", () => {
    const unsupported = createEnvironment({ requestFullscreen: false });
    const touchController = new MobileFullscreenController(unsupported.options);
    touchController.activateFromUserGesture();
    expect(touchController.needsAction(false)).toBe(false);

    const desktop = createEnvironment({ touchInput: false });
    const desktopController = new MobileFullscreenController(desktop.options);
    desktopController.activateFromUserGesture();
    expect(desktop.requestFullscreen).not.toHaveBeenCalled();
    expect(desktopController.needsAction(false)).toBe(false);
  });

  it("activates multiplayer without fabricating a user gesture", () => {
    const environment = createEnvironment();
    const controller = new MobileFullscreenController(environment.options);

    controller.activateWithoutUserGesture();

    expect(environment.requestFullscreen).not.toHaveBeenCalled();
    expect(controller.needsAction(false)).toBe(true);
  });

  it("unlocks and ignores stale async completion after deactivation", async () => {
    let resolveRequest = (): void => {
      throw new Error("fullscreen request was not started");
    };
    const environment = createEnvironment();
    environment.requestFullscreen.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveRequest = resolve;
    }));
    const controller = new MobileFullscreenController(environment.options);
    controller.activateFromUserGesture();
    controller.deactivate();
    resolveRequest();
    await settle();

    expect(environment.lock).not.toHaveBeenCalled();
    expect(controller.needsAction(false)).toBe(false);
  });

  it("releases a landscape lock that resolves after deactivation", async () => {
    let resolveLock = (): void => {
      throw new Error("orientation lock was not started");
    };
    const environment = createEnvironment();
    environment.lock.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveLock = resolve;
    }));
    const controller = new MobileFullscreenController(environment.options);
    controller.activateFromUserGesture();
    await settle();
    controller.deactivate();
    resolveLock();
    await settle();

    expect(environment.unlock).toHaveBeenCalledOnce();
  });

  it("releases an acquired landscape lock when lobby gameplay is cancelled", async () => {
    const environment = createEnvironment();
    const controller = new MobileFullscreenController(environment.options);
    controller.activateFromUserGesture();
    await settle();

    controller.deactivate();

    expect(environment.unlock).toHaveBeenCalledOnce();
    expect(controller.needsAction(false)).toBe(false);
  });
});

function createEnvironment(overrides: { touchInput?: boolean; requestFullscreen?: boolean } = {}) {
  let fullscreenElement: Element | null = null;
  const requestFullscreen = vi.fn(async () => {
    fullscreenElement = target as unknown as Element;
  });
  const target = {
    ...(overrides.requestFullscreen === false ? {} : { requestFullscreen }),
  } as unknown as HTMLElement;
  const documentTarget = {
    documentElement: target,
    fullscreenEnabled: overrides.requestFullscreen !== false,
    get fullscreenElement() {
      return fullscreenElement;
    },
  } as unknown as Document;
  const lock = vi.fn(async (_orientation: OrientationLockType): Promise<void> => undefined);
  const unlock = vi.fn();
  const screenTarget = { orientation: { lock, unlock } } as unknown as Screen;
  return {
    requestFullscreen,
    lock,
    unlock,
    setFullscreenElement(value: Element | null) {
      fullscreenElement = value;
    },
    options: {
      document: documentTarget,
      screen: screenTarget,
      target,
      touchInput: overrides.touchInput ?? true,
    },
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
