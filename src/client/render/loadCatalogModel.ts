import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Scene } from "@babylonjs/core/scene";
import type { AssetCatalog } from "../../assets/AssetCatalog";
import type { AssetEntry } from "../../assets/types";

let gltfLoaderRequest: Promise<void> | null = null;

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
    await loadGltfLoader();
    const { LoadAssetContainerAsync } = await import("@babylonjs/core/Loading/sceneLoader");
    const payload = assets.getPayload(descriptor.id) ?? await assets.loadPayload(descriptor.id);
    const source = payload ? new Uint8Array(payload) : descriptor.url;
    container = await LoadAssetContainerAsync(source, scene, {
      pluginExtension: ".glb",
      name: `${descriptor.id}.glb`,
    });
    if (!container.meshes.some((mesh) => mesh.getTotalVertices() > 0)) {
      throw new Error("模型不包含可渲染 mesh");
    }
    validateModelContract(container, descriptor);
    return { container, descriptor };
  } catch (error) {
    container?.dispose();
    console.error(`模型 ${assetId} 加载或校验失败，使用程序化 fallback`, error);
    return null;
  }
}

async function loadGltfLoader(): Promise<void> {
  if (gltfLoaderRequest) return gltfLoaderRequest;
  gltfLoaderRequest = import("@babylonjs/loaders/glTF").then(() => undefined).catch((error) => {
    gltfLoaderRequest = null;
    throw error;
  });
  return gltfLoaderRequest;
}

function validateModelContract(container: AssetContainer, descriptor: AssetEntry): void {
  const required = descriptor.metadata?.requiredNodes;
  if (typeof required === "string" && required.trim() !== "") {
    const names = new Set(container.getNodes().map((node) => node.name));
    const missing = metadataNames(descriptor, "requiredNodes").filter((name) => !names.has(name));
    if (missing.length > 0) {
      throw new Error(`缺少节点: ${missing.join(", ")}`);
    }
  }

  const renderableMeshNames = new Set(
    container.meshes.filter((mesh) => mesh.getTotalVertices() > 0).map((mesh) => mesh.name),
  );
  for (const metadataName of ["armorMeshes", "helmetMeshes"] as const) {
    const declaredNames = metadataNames(descriptor, metadataName);
    if (descriptor.id.startsWith("model.character.") && declaredNames.length === 0) {
      throw new Error(`角色模型缺少非空 ${metadataName}`);
    }
    const missing = declaredNames.filter((name) => !renderableMeshNames.has(name));
    if (missing.length > 0) {
      throw new Error(`缺少 ${metadataName}: ${missing.join(", ")}`);
    }
  }
}

function metadataNames(descriptor: AssetEntry, name: string): string[] {
  const value = descriptor.metadata?.[name];
  return typeof value === "string"
    ? value.split(",").map((entry) => entry.trim()).filter(Boolean)
    : [];
}
