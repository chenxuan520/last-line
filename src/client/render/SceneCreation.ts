import type { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";

const preparedEngines = new WeakSet<Engine>();

export function isUniformBufferAllocationError(error: unknown): error is Error {
  return error instanceof Error && (
    error.message === "Unable to create uniform buffer"
    || error.message === "Unable to create dynamic uniform buffer"
  );
}

// initialize 仅同步创建基础灯；材质／后处理及异步编译必须留在 prepare。
export async function createSceneWithUniformFallback<T, C>(
  engine: Engine,
  initialize: (scene: Scene) => C,
  prepare: (scene: Scene, initialized: C) => Promise<T>,
): Promise<T> {
  let failedBeforePreparation = false;
  const create = async (): Promise<T> => {
    if (engine.isDisposed) throw new Error("图形引擎已关闭");
    const scene = new Scene(engine);
    let initialized = false;
    try {
      const context = initialize(scene);
      initialized = true;
      preparedEngines.add(engine);
      const result = await prepare(scene, context);
      if (scene.isDisposed || engine.isDisposed) throw new Error("战场加载已取消");
      return result;
    } catch (error) {
      failedBeforePreparation = !initialized;
      try { scene.dispose(); } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "场景初始化失败，图形资源未能释放", { cause: error });
      }
      throw error;
    }
  };
  try {
    return await create();
  } catch (error) {
    if (!failedBeforePreparation || preparedEngines.has(engine) || !isUniformBufferAllocationError(error) || engine.isDisposed || !engine.supportsUniformBuffers || engine.scenes.length) throw error;
    // 上下文丢失或仍有其他场景时，不能切换共享引擎的着色路径。
    let context: WebGL2RenderingContext | null | undefined;
    try { context = engine.getRenderingCanvas()?.getContext("webgl2"); } catch { throw error; }
    if (!context || context.isContextLost()) throw error;
    engine.disableUniformBuffers = true;
    engine.releaseEffects();
    engine.wipeCaches(true);
    return create();
  }
}
