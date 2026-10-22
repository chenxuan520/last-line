import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetCatalog } from "../../src/assets/AssetCatalog";
import { GameApp } from "../../src/app/GameApp";
import { BattleRoyaleSession } from "../../src/app/BattleRoyaleSession";
import { MultiplayerSession } from "../../src/app/MultiplayerSession";
import type { GameSession } from "../../src/app/GameSession";

const engineState = vi.hoisted(() => ({ render: null as (() => void) | null }));

vi.mock("@babylonjs/core/Engines/engine", () => ({
  Engine: class {
    maxFPS = 90;
    setHardwareScalingLevel = vi.fn();
    runRenderLoop(callback: () => void) { engineState.render = callback; }
    stopRenderLoop = vi.fn();
    getDeltaTime() { return 16; }
    getFps() { return 60; }
    dispose = vi.fn();
    resize = vi.fn();
  },
}));

interface AppInternals {
  startSinglePlayerFromUserGesture(): void;
  startMatch(): Promise<void>;
  startMultiplayerSession(connection: unknown, initial: unknown): Promise<void>;
  returnToMenu(): void;
  starting: boolean;
  singlePlayerStart: AbortController | null;
  session: GameSession | null;
  renderMenu: () => void;
  renderError: (error: unknown) => void;
  startAds: { request: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> };
  mobileFullscreen: {
    activateFromUserGesture: ReturnType<typeof vi.fn>;
    activateWithoutUserGesture: ReturnType<typeof vi.fn>;
    deactivate: ReturnType<typeof vi.fn>;
    exitAfterFailure: ReturnType<typeof vi.fn>;
    waitForFailureExit: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };
  menuAudio: { setVolume: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> };
}

describe("GameApp single-player ad startup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    engineState.render = null;
  });

  it("preserves single-click start and initial input when ads are skipped", async () => {
    for (const ad of [null, Promise.resolve(false)]) {
      const environment = await createEnvironment(ad);
      const prepared = deferred<BattleRoyaleSession>();
      const session = createSession();
      vi.spyOn(BattleRoyaleSession, "create").mockReturnValueOnce(prepared.promise);
      environment.internal.startSinglePlayerFromUserGesture();
      expect(environment.canvas.requestPointerLock).toHaveBeenCalledOnce();
      expect(environment.internal.mobileFullscreen.activateFromUserGesture).toHaveBeenCalledOnce();
      environment.internal.startSinglePlayerFromUserGesture();
      await settle();
      engineState.render?.();
      expect(session.start).not.toHaveBeenCalled();
      expect(session.update).not.toHaveBeenCalled();
      expect(environment.canvas.requestPointerLock).toHaveBeenCalledOnce();
      prepared.resolve(session as unknown as BattleRoyaleSession);
      await settle();
      expect(session.start).toHaveBeenCalledOnce();
      expect(environment.internal.session).toBe(session);
      expect(environment.internal.starting).toBe(false);
      expect(environment.root.innerHTML).not.toContain("进入战场");
      engineState.render?.();
      expect(session.update).toHaveBeenCalledOnce();
      expect(session.scene.render).toHaveBeenCalledOnce();
      expect(environment.internal.mobileFullscreen.deactivate).not.toHaveBeenCalled();
      environment.app.dispose();
    }
  });

  it("waits for an ad and a fresh entry click after preparation finishes first", async () => {
    const ad = deferred<boolean>();
    const environment = await createEnvironment(ad.promise);
    const session = createSession();
    vi.spyOn(BattleRoyaleSession, "create").mockResolvedValueOnce(session as unknown as BattleRoyaleSession);
    environment.internal.startSinglePlayerFromUserGesture();
    const signal = environment.internal.startAds.request.mock.calls[0]![0] as AbortSignal;
    const beforeAd = environment.internal.startAds.request.mock.calls[0]![1] as () => void;
    beforeAd();
    expect(environment.documentTarget.pointerLockElement).toBeNull();
    environment.documentTarget.pointerLockElement = environment.canvas;
    environment.documentTarget.dispatchEvent(new Event("pointerlockchange"));
    expect(environment.documentTarget.pointerLockElement).toBeNull();
    expect(environment.internal.menuAudio.setVolume).toHaveBeenCalledWith(0);
    expect(environment.internal.mobileFullscreen.deactivate).toHaveBeenCalledOnce();
    await settle();
    expect(environment.root.innerHTML).toContain("100%");
    expect(environment.root.innerHTML).toContain("比赛尚未开始");
    engineState.render?.();
    expect(session.start).not.toHaveBeenCalled();
    expect(session.update).not.toHaveBeenCalled();
    expect(session.scene.render).not.toHaveBeenCalled();
    ad.resolve(true);
    await settle();
    const button = environment.root.panel.children.at(-1)!;
    expect(button.dataset.action).toBe("enter-battlefield");
    expect(button.disabled).toBe(false);
    expect(environment.root.innerHTML).toContain("广告已结束");
    expect(signal.aborted).toBe(false);
    expect(session.start).not.toHaveBeenCalled();
    button.dispatchEvent(new Event("click"));
    button.dispatchEvent(new Event("click"));
    expect(environment.canvas.requestPointerLock).toHaveBeenCalledTimes(2);
    expect(environment.internal.mobileFullscreen.activateFromUserGesture).toHaveBeenCalledTimes(2);
    await settle();
    expect(session.start).toHaveBeenCalledOnce();
    environment.documentTarget.dispatchEvent(new Event("pointerlockchange"));
    expect(environment.documentTarget.pointerLockElement).toBe(environment.canvas);
    expect(environment.internal.starting).toBe(false);
    environment.app.dispose();
  });

  it("does not offer entry until preparation finishes when the ad ends first", async () => {
    const environment = await createEnvironment(Promise.resolve(true));
    const prepared = deferred<BattleRoyaleSession>();
    const session = createSession();
    vi.spyOn(BattleRoyaleSession, "create").mockReturnValueOnce(prepared.promise);
    environment.internal.startSinglePlayerFromUserGesture();
    await settle();
    expect(environment.root.innerHTML).toContain("92%");
    expect(environment.root.panel.children).toHaveLength(0);
    expect(session.start).not.toHaveBeenCalled();
    prepared.resolve(session as unknown as BattleRoyaleSession);
    await settle();
    expect(environment.root.innerHTML).toContain("战场已就绪");
    const button = environment.root.panel.children.at(-1)!;
    button.dispatchEvent(new Event("click"));
    await settle();
    expect(session.start).toHaveBeenCalledOnce();
    environment.app.dispose();
  });

  it("aborts ads on preparation failure without changing the original error recovery", async () => {
    const ad = deferred<boolean>();
    const environment = await createEnvironment(ad.promise);
    const error = new Error("scene failed");
    vi.spyOn(BattleRoyaleSession, "create").mockRejectedValueOnce(error);
    environment.internal.startSinglePlayerFromUserGesture();
    const signal = environment.internal.startAds.request.mock.calls[0]![0] as AbortSignal;
    await settle();
    expect(signal.aborted).toBe(true);
    expect(environment.internal.session).toBeNull();
    expect(environment.internal.mobileFullscreen.exitAfterFailure).toHaveBeenCalledOnce();
    expect(environment.internal.renderError).toHaveBeenCalledWith(error);
    expect(environment.internal.starting).toBe(false);
    ad.resolve(true);
    await settle();
    expect(environment.root.panel.children).toHaveLength(0);
    environment.app.dispose();
  });

  it("disposes late preparations after application disposal without starting or rendering them", async () => {
    const environment = await createEnvironment(null);
    const prepared = deferred<BattleRoyaleSession>();
    const session = createSession();
    vi.spyOn(BattleRoyaleSession, "create").mockReturnValueOnce(prepared.promise);
    environment.internal.startSinglePlayerFromUserGesture();
    await settle();
    environment.app.dispose();
    prepared.resolve(session as unknown as BattleRoyaleSession);
    await settle();
    expect(session.dispose).toHaveBeenCalledOnce();
    expect(session.start).not.toHaveBeenCalled();
    expect(environment.internal.renderError).not.toHaveBeenCalled();
    expect(environment.internal.startAds.dispose).toHaveBeenCalledOnce();
  });

  it("invalidates a waiting entry without letting its cleanup reset a newer attempt", async () => {
    const environment = await createEnvironment(Promise.resolve(true));
    const first = createSession();
    const second = createSession();
    const prepared = deferred<BattleRoyaleSession>();
    const fullscreen = deferred<void>();
    environment.internal.mobileFullscreen.waitForFailureExit.mockReturnValueOnce(fullscreen.promise);
    vi.spyOn(BattleRoyaleSession, "create")
      .mockResolvedValueOnce(first as unknown as BattleRoyaleSession)
      .mockReturnValueOnce(prepared.promise);
    environment.internal.startSinglePlayerFromUserGesture();
    await settle();
    const oldButton = environment.root.panel.children.at(-1)!;
    environment.internal.returnToMenu();
    environment.internal.startAds.request.mockReturnValue(null);
    environment.internal.startSinglePlayerFromUserGesture();
    await settle();
    fullscreen.resolve();
    oldButton.dispatchEvent(new Event("click"));
    await settle();
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(first.start).not.toHaveBeenCalled();
    expect(environment.internal.starting).toBe(true);
    expect(oldButton.disabled).toBe(true);
    prepared.resolve(second as unknown as BattleRoyaleSession);
    await settle();
    expect(second.start).toHaveBeenCalledOnce();
    environment.app.dispose();
  });

  it("does not request single-player ads during multiplayer scene startup", async () => {
    const environment = await createEnvironment(Promise.resolve(true));
    const session = createSession();
    vi.spyOn(MultiplayerSession, "create").mockResolvedValueOnce(session as unknown as MultiplayerSession);
    const connection = { setMessageHandler: vi.fn(), setStatusHandler: vi.fn(), close: vi.fn() };
    await environment.internal.startMultiplayerSession(connection, {});
    expect(environment.internal.startAds.request).not.toHaveBeenCalled();
    expect(environment.root.innerHTML).not.toContain("进入战场");
    expect(session.start).toHaveBeenCalledOnce();
    environment.app.dispose();
  });
});

async function createEnvironment(ad: Promise<boolean> | null) {
  const documentTarget = Object.assign(new EventTarget(), {
    title: "",
    pointerLockElement: null as unknown,
    fullscreenElement: null,
    fullscreenEnabled: false,
    documentElement: new FakeElement(),
    createElement: () => new FakeElement(),
    exitPointerLock: vi.fn(() => { documentTarget.pointerLockElement = null; }),
  });
  const windowTarget = Object.assign(new EventTarget(), {
    matchMedia: () => ({ matches: false }),
    devicePixelRatio: 1,
  });
  vi.stubGlobal("document", documentTarget);
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("navigator", { maxTouchPoints: 0 });
  vi.stubGlobal("localStorage", { getItem: () => null });
  vi.stubGlobal("__SINGLE_PLAYER_DEBUG__", false);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  const canvas = Object.assign(new FakeElement(), {
    requestPointerLock: vi.fn(() => { documentTarget.pointerLockElement = canvas; }),
  });
  const root = Object.assign(new FakeElement(), { panel: new FakeElement() });
  root.querySelector = () => root.panel;
  const app = new GameApp(canvas as unknown as HTMLCanvasElement, root as unknown as HTMLDivElement);
  const internal = app as unknown as AppInternals;
  internal.renderMenu = vi.fn();
  internal.renderError = vi.fn();
  internal.startAds = { request: vi.fn(() => ad), dispose: vi.fn() };
  internal.mobileFullscreen = {
    activateFromUserGesture: vi.fn(),
    activateWithoutUserGesture: vi.fn(),
    deactivate: vi.fn(),
    exitAfterFailure: vi.fn(),
    waitForFailureExit: vi.fn(async () => undefined),
    dispose: vi.fn(),
  };
  internal.menuAudio = { setVolume: vi.fn(), start: vi.fn(), dispose: vi.fn() };
  vi.spyOn(AssetCatalog, "load").mockResolvedValue(new AssetCatalog({ version: 1, assets: [] }));
  await app.initialize();
  return { app, internal, root, canvas, documentTarget };
}

class FakeElement extends EventTarget {
  className = "";
  innerHTML = "";
  isConnected = true;
  disabled = false;
  type = "";
  textContent = "";
  dataset: Record<string, string> = {};
  children: FakeElement[] = [];
  focus = vi.fn();
  setAttribute = vi.fn();
  removeAttribute = vi.fn();
  append(...children: FakeElement[]) { this.children.push(...children); }
  querySelector(): FakeElement | null { return null; }
}

function createSession() {
  return { start: vi.fn(), update: vi.fn(), dispose: vi.fn(), scene: { render: vi.fn() } };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}
