import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BATTLE_ROYALE_CONFIG } from "../../src/config/battleRoyale";
import { createBattleRoyaleState } from "../../src/game/modes/BattleRoyaleMode";
import { createIslandScene } from "../../src/client/render/scenes/IslandScene";
import { createAssets, createProductionGlbAssets } from "../fixtures/islandSceneAssets";

describe("IslandScene creation recovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("releases detached character containers when scene preparation fails", async () => {
    const engine = new NullEngine();
    const assets = createProductionGlbAssets();
    const resolveAsset = assets.resolve.bind(assets);
    const failure = new Error("character palette failed");
    vi.spyOn(assets, "resolve").mockImplementation((id, type) => {
      const entry = resolveAsset(id, type);
      if (id !== "model.character.enemy") return entry;
      const metadata = { ...entry.metadata };
      Object.defineProperty(metadata, "uniformDarkColor", { get: () => { throw failure; } });
      return { ...entry, metadata };
    });
    const dispose = vi.spyOn(AssetContainer.prototype, "dispose");
    const state = createBattleRoyaleState("player", { ...BATTLE_ROYALE_CONFIG, participantCount: 2 }, () => 0);
    try {
      await expect(createIslandScene(engine, assets, state.actors, state.groundLoot, 0, true, "player", "high"))
        .rejects.toBe(failure);
      expect(dispose).toHaveBeenCalledTimes(2);
      expect(engine.scenes).toHaveLength(0);
    } finally {
      dispose.mockRestore();
      engine.dispose();
    }
  }, 30_000);

  it("rebuilds the selected Ultra scene after a native light uniform allocation failure", async () => {
    const engine = new NullEngine();
    const keys = ["supportsUniformBuffers", "getRenderingCanvas", "createUniformBuffer"] as const;
    const descriptors = keys.map((key) => Object.getOwnPropertyDescriptor(engine, key));
    const createUniformBuffer = engine.createUniformBuffer;
    let allocations = 0;
    // Vitest 的强 mock 注册表会保留 instance spy 目标；大场景仅局部包装。
    Object.defineProperty(engine, "supportsUniformBuffers", {
      configurable: true,
      get: () => !engine.disableUniformBuffers,
    });
    engine.getRenderingCanvas = () => ({
      getContext: () => ({ isContextLost: () => false }),
    } as unknown as HTMLCanvasElement);
    engine.createUniformBuffer = (...args) => {
      allocations += 1;
      if (allocations === 1) throw new Error("Unable to create uniform buffer");
      return createUniformBuffer.apply(engine, args);
    };
    const state = createBattleRoyaleState("player", { ...BATTLE_ROYALE_CONFIG, participantCount: 2 }, () => 0);
    const before = JSON.stringify(state);
    try {
      const bundle = await createIslandScene(engine, createAssets(), state.actors, state.groundLoot, 0, true, "player", "ultra");
      expect(allocations).toBe(1);
      expect(engine.disableUniformBuffers).toBe(true);
      expect(engine.scenes).toEqual([bundle.scene]);
      expect(bundle.scene.getLightByName("island-ambient")).not.toBeNull();
      expect(bundle.scene.getMeshByName("tree-foliage-template")?.material).toBeInstanceOf(PBRMaterial);
      expect(bundle.scene.textures.some((texture) => texture.name === "ultra-town-static-shadows")).toBe(true);
      expect(JSON.stringify(state)).toBe(before);
      bundle.scene.dispose();
      expect(engine.scenes).toHaveLength(0);
    } finally {
      keys.forEach((key, index) => {
        const descriptor = descriptors[index];
        if (descriptor) Object.defineProperty(engine, key, descriptor);
        else Reflect.deleteProperty(engine, key);
      });
      engine.dispose();
    }
  }, 60_000);
});
