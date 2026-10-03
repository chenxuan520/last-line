import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSceneWithUniformFallback } from "../../src/client/render/SceneCreation";

describe("Scene creation recovery", () => {
  afterEach(() => vi.restoreAllMocks());

  it("cleans failed scenes without switching capabilities after preparation or unsafe failures", async () => {
    for (const kind of ["late", "prepared-before", "unrelated", "lost", "no-canvas", "other-scene", "disabled", "disposed", "cleanup"] as const) {
      const engine = new NullEngine();
      vi.spyOn(engine, "supportsUniformBuffers", "get").mockImplementation(() => !engine.disableUniformBuffers);
      vi.spyOn(engine, "getRenderingCanvas").mockReturnValue(kind === "no-canvas" ? null : {
        getContext: () => ({ isContextLost: () => kind === "lost" }),
      } as unknown as HTMLCanvasElement);
      const releaseEffects = vi.spyOn(engine, "releaseEffects");
      if (kind === "prepared-before") {
        const previousScene = await createSceneWithUniformFallback(engine, () => undefined, async (scene) => scene);
        previousScene.dispose();
      }
      const original = new Error(kind === "unrelated" ? "asset initialization failed" : "Unable to create uniform buffer");
      const previous = kind === "other-scene" ? new Scene(engine) : null;
      if (kind === "disabled") engine.disableUniformBuffers = true;
      const cleanupError = new Error("disposal failed");
      const dispose = kind === "cleanup" ? vi.spyOn(Scene.prototype, "dispose").mockImplementationOnce(() => { throw cleanupError; }) : null;
      const initialize = vi.fn(() => {
        if (kind === "disposed") engine.dispose();
        if (kind !== "late") throw original;
        return "initialized";
      });
      const prepare = vi.fn(async () => { throw original; });
      try {
        const result = createSceneWithUniformFallback(engine, initialize, prepare);
        if (kind === "cleanup") {
          await expect(result).rejects.toMatchObject({ errors: [original, cleanupError], cause: original });
        } else {
          await expect(result).rejects.toBe(original);
        }
        expect(initialize).toHaveBeenCalledOnce();
        expect(prepare).toHaveBeenCalledTimes(kind === "late" ? 1 : 0);
        expect(releaseEffects).toHaveBeenCalledTimes(kind === "disposed" ? 1 : 0);
        expect(engine.disableUniformBuffers).toBe(kind === "disabled");
        if (kind !== "cleanup") expect(engine.scenes).toEqual(previous ? [previous] : []);
        expect(previous?.isDisposed ?? false).toBe(false);
      } finally {
        dispose?.mockRestore();
        engine.dispose();
        vi.restoreAllMocks();
      }
    }
  });

  it("retries early native uniform errors only once and disposes the second failure", async () => {
    const engine = new NullEngine();
    vi.spyOn(engine, "supportsUniformBuffers", "get").mockImplementation(() => !engine.disableUniformBuffers);
    vi.spyOn(engine, "getRenderingCanvas").mockReturnValue({
      getContext: () => ({ isContextLost: () => false }),
    } as unknown as HTMLCanvasElement);
    const release = vi.spyOn(engine, "releaseEffects");
    const failure = new Error("Unable to create dynamic uniform buffer");
    const initialize = vi.fn(() => { throw failure; });
    const prepare = vi.fn(async (scene: Scene) => scene);
    try {
      await expect(createSceneWithUniformFallback(engine, initialize, prepare)).rejects.toBe(failure);
      expect(initialize).toHaveBeenCalledTimes(2);
      expect(prepare).not.toHaveBeenCalled();
      expect(engine.disableUniformBuffers).toBe(true);
      expect(release).toHaveBeenCalledOnce();
      expect(engine.scenes).toHaveLength(0);
    } finally {
      engine.dispose();
    }
  });

  it("rejects a completed preparation when its scene was disposed during loading", async () => {
    const engine = new NullEngine();
    const prepare = vi.fn(async (scene: Scene) => { scene.dispose(); return scene; });
    try {
      await expect(createSceneWithUniformFallback(engine, () => undefined, prepare))
        .rejects.toThrow("战场加载已取消");
      expect(prepare).toHaveBeenCalledOnce();
      expect(engine.scenes).toHaveLength(0);
      expect(engine.disableUniformBuffers).toBe(false);
    } finally {
      engine.dispose();
    }
  });
});
