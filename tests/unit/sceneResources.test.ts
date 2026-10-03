import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { EngineStore } from "@babylonjs/core/Engines/engineStore";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it, vi } from "vitest";
import { bindSceneEnvironmentBrdf } from "../../src/client/render/SceneResources";

describe("Scene resource ownership", () => {
  it("keeps one native BRDF owner across failed scenes and releases it with the engine", () => {
    const engine = new NullEngine();
    const first = new Scene(engine);
    const initialFrames = engine.onBeginFrameObservable.observers.length;
    try {
      bindSceneEnvironmentBrdf(first);
      const texture = first.environmentBRDFTexture;
      const owner = texture.getScene()!;
      const disposal = vi.spyOn(texture, "dispose");
      expect(owner).not.toBe(first);
      expect(engine.scenes).toEqual([first]);
      expect(EngineStore.LastCreatedScene).toBe(first);
      expect(first.textures).not.toContain(texture);
      expect(new PBRMaterial("first", first).environmentBRDFTexture).toBe(texture);
      first.dispose();
      expect(disposal).not.toHaveBeenCalled();
      expect(owner.isDisposed).toBe(false);
      expect(texture.getScene()).toBe(owner);
      const second = new Scene(engine);
      bindSceneEnvironmentBrdf(second);
      expect(second.environmentBRDFTexture).toBe(texture);
      expect(new PBRMaterial("second", second).environmentBRDFTexture).toBe(texture);
      expect(owner.textures).toEqual([texture]);
      expect(engine.onBeginFrameObservable.observers).toHaveLength(initialFrames);
      // 恢复期间仅驱动 SDK 的准备回调，普通帧没有转发。
      const pending = owner.onBeforeRenderObservable.addOnce(() => undefined);
      engine.onContextRestoredObservable.notifyObservers(engine);
      expect(engine.onBeginFrameObservable.observers).toHaveLength(initialFrames + 1);
      engine.onBeginFrameObservable.notifyObservers(engine);
      expect(pending?._willBeUnregistered).toBe(true);
      expect(engine.onBeginFrameObservable.observers.filter((observer) => !observer._willBeUnregistered)).toHaveLength(initialFrames);
      second.dispose();
      expect(disposal).not.toHaveBeenCalled();
      engine.dispose();
      expect(owner.isDisposed).toBe(true);
      expect(disposal).toHaveBeenCalledOnce();
      expect(texture.getScene()).toBeNull();
    } finally {
      engine.dispose();
      vi.restoreAllMocks();
    }
  });
});
