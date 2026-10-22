import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Engine } from "@babylonjs/core/Engines/engine";
import type { MobileFullscreenController } from "../../src/client/ui/MobileFullscreenController";
import type { AudioFeedback } from "../../src/client/audio/AudioFeedback";
import { AssetCatalog } from "../../src/assets/AssetCatalog";
import { BattleRoyaleSession } from "../../src/app/BattleRoyaleSession";
import { DEFAULT_SETTINGS } from "../../src/config/settings";
import type { MatchState } from "../../src/game/state/types";

const hud = vi.hoisted(() => ({ created: vi.fn(), disposed: vi.fn() }));

vi.mock("../../src/client/ui/GameHud", () => ({
  GameHud: class {
    constructor() { hud.created(); }
    handleEvents = vi.fn();
    update = vi.fn();
    dispose = hud.disposed;
  },
}));

vi.mock("../../src/client/render/scenes/IslandScene", () => ({
  createIslandScene: async (engine: Engine) => {
    const scene = new Scene(engine);
    return {
      scene,
      camera: new UniversalCamera("camera", Vector3.Zero(), scene),
      actorRoots: new Map(),
      actorVisualRoots: new Map(),
      lootMeshes: new Map(),
      syncLootMeshes: vi.fn(),
      viewWeaponRoot: new TransformNode("weapon", scene),
      firstPerson: { updateCamera: vi.fn(), updateWeapon: vi.fn() },
      aircraftInteriorRoot: new TransformNode("aircraft", scene),
      syncAircraftVisual: vi.fn(),
      syncSafeZoneRing: vi.fn(),
    };
  },
  setActorWeaponVisual: vi.fn(),
  setActorParachuteVisual: vi.fn(),
  setActorEquipmentVisual: vi.fn(),
  applyActorVisualPose: vi.fn(),
}));

describe("BattleRoyaleSession startup", () => {
  afterEach(() => {
    hud.created.mockClear();
    hud.disposed.mockClear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not create input or HUD or advance simulation before explicit start", async () => {
    const environment = createEnvironment();
    const engine = new NullEngine();
    const session = await createSession(engine, environment.canvas);
    const state = (session as unknown as { simulation: { state: MatchState } }).simulation.state;
    try {
      expect(state.phase).toBe("ready");
      expect(state.elapsedSeconds).toBe(0);
      expect(environment.add).not.toHaveBeenCalled();
      expect(hud.created).not.toHaveBeenCalled();
      session.update(10, 60);
      expect(state.phase).toBe("ready");
      expect(state.elapsedSeconds).toBe(0);
      session.start();
      expect(state.phase).toBe("flight");
      expect(hud.created).toHaveBeenCalledOnce();
      expect(environment.add.mock.calls.some(([name]) => name === "keydown")).toBe(true);
      session.start();
      expect(hud.created).toHaveBeenCalledOnce();
    } finally {
      session.dispose();
      expect(session.scene.isDisposed).toBe(true);
      expect(environment.remove.mock.calls.some(([name]) => name === "keydown")).toBe(true);
      expect(engine.scenes).toEqual([]);
      engine.dispose();
    }
  });

  it("can dispose a prepared session without ever creating input or a HUD", async () => {
    const environment = createEnvironment();
    const engine = new NullEngine();
    const session = await createSession(engine, environment.canvas);
    try {
      session.dispose();
      expect(session.scene.isDisposed).toBe(true);
      expect(environment.add).not.toHaveBeenCalled();
      expect(hud.created).not.toHaveBeenCalled();
      expect(hud.disposed).not.toHaveBeenCalled();
      expect(engine.scenes).toEqual([]);
    } finally {
      engine.dispose();
    }
  });
});

function createEnvironment() {
  const canvas = new EventTarget() as HTMLCanvasElement;
  const documentTarget = Object.assign(new EventTarget(), { pointerLockElement: canvas });
  const windowTarget = Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false }) });
  vi.stubGlobal("document", documentTarget);
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("navigator", { maxTouchPoints: 0 });
  vi.stubGlobal("__SINGLE_PLAYER_DEBUG__", false);
  return {
    canvas,
    add: vi.spyOn(documentTarget, "addEventListener"),
    remove: vi.spyOn(documentTarget, "removeEventListener"),
  };
}

function createSession(engine: NullEngine, canvas: HTMLCanvasElement): Promise<BattleRoyaleSession> {
  return BattleRoyaleSession.create(
    engine as Engine,
    canvas,
    new EventTarget() as HTMLDivElement,
    new AssetCatalog({ version: 1, assets: [] }),
    { ...DEFAULT_SETTINGS },
    { start: vi.fn(), handleEvents: vi.fn() } as unknown as AudioFeedback,
    { requestFromUserGesture: vi.fn() } as unknown as MobileFullscreenController,
    vi.fn(),
    vi.fn(),
  );
}
