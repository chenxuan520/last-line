import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { GetEnvironmentBRDFTexture } from "@babylonjs/core/Misc/brdfTextureTools";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { Scene } from "@babylonjs/core/scene";

const resources = new WeakMap<AbstractEngine, { owner: Scene; texture: BaseTexture }>();

// SDK 的 RGBD 解码会跨异步编译访问纹理所属场景；由引擎自有的虚拟场景承载，
// 战场加载失败／重试不能提前销毁它。虚拟场景不加入 engine.scenes，也不渲染。
export function bindSceneEnvironmentBrdf(scene: Scene): void {
  const engine = scene.getEngine();
  if (engine.isDisposed || scene.isDisposed) throw new Error("图形资源加载已取消");
  let entry = resources.get(engine);
  if (!entry) {
    const owner = new Scene(engine, { virtual: true });
    owner.detachControl();
    let texture: BaseTexture;
    try {
      texture = GetEnvironmentBRDFTexture(owner);
    } catch (error) {
      owner.dispose();
      throw error;
    }
    entry = { owner, texture };
    resources.set(engine, entry);
    let frame: Observer<AbstractEngine> | null = null;
    const stopForwarding = (): void => {
      engine.onBeginFrameObservable.remove(frame);
      frame = null;
    };
    // SDK 恢复时把解码准备登记到 owner.beforeRender；仅在恢复期间转发，
    // 完成登记的准备后移除。普通稳态没有新的逐帧 observer。
    const restore = engine.onContextRestoredObservable.add(() => {
      stopForwarding();
      frame = engine.onBeginFrameObservable.add(() => {
        if (!owner.isDisposed && !engine.isDisposed) owner.onBeforeRenderObservable.notifyObservers(owner);
        if (owner.isDisposed || !owner.onBeforeRenderObservable.hasObservers()) stopForwarding();
      });
    });
    owner.onDisposeObservable.addOnce(() => {
      stopForwarding();
      engine.onContextRestoredObservable.remove(restore);
      resources.delete(engine);
    });
  }
  scene.environmentBRDFTexture = entry.texture;
}
