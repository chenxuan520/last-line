import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Scene } from "@babylonjs/core/scene";
import type { AssetCatalog } from "../../assets/AssetCatalog";
import type { AssetEntry } from "../../assets/types";

export async function loadCatalogModel(
  scene: Scene,
  assets: AssetCatalog,
  assetId: string,
): Promise<{ container: AssetContainer; descriptor: AssetEntry } | null> {
  const descriptor = assets.resolve(assetId, "model");
  if (descriptor.type !== "model" || !descriptor.url) {
    return null;
  }

  let container: AssetContainer | null = null;
  try {
    await import("@babylonjs/loaders/glTF");
    const { LoadAssetContainerAsync } = await import("@babylonjs/core/Loading/sceneLoader");
    const payload = assets.getPayload(descriptor.id);
    const source = payload ? new Uint8Array(payload) : descriptor.url;
    container = await LoadAssetContainerAsync(source, scene, {
      pluginExtension: ".glb",
      name: `${descriptor.id}.glb`,
    });
    if (!container.meshes.some((mesh) => mesh.getTotalVertices() > 0)) {
      throw new Error("模型不包含可渲染 mesh");
    }
    validateRequiredNodes(container, descriptor);
    return { container, descriptor };
  } catch (error) {
    container?.dispose();
    console.error(`模型 ${assetId} 加载或校验失败，使用程序化 fallback`, error);
    return null;
  }
}

function validateRequiredNodes(container: AssetContainer, descriptor: AssetEntry): void {
  const required = descriptor.metadata?.requiredNodes;
  if (typeof required !== "string" || required.trim() === "") {
    return;
  }
  const names = new Set(container.getNodes().map((node) => node.name));
  const missing = required.split(",").map((name) => name.trim()).filter((name) => name && !names.has(name));
  if (missing.length > 0) {
    throw new Error(`缺少节点: ${missing.join(", ")}`);
  }
}
