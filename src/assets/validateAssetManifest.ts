import type { AssetEntry, AssetManifest, AssetType } from "./types";

const ASSET_TYPES = new Set<AssetType>(["svg", "image", "model", "procedural-model"]);

export function validateAssetManifest(value: unknown): AssetManifest {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.assets)) {
    throw new Error("资源清单必须包含 version: 1 和 assets 数组");
  }

  const assets = value.assets.map(validateAssetEntry);
  const ids = new Set<string>();

  for (const asset of assets) {
    if (ids.has(asset.id)) {
      throw new Error(`资源 ID 重复: ${asset.id}`);
    }
    ids.add(asset.id);
  }

  for (const asset of assets) {
    if (asset.fallback && !ids.has(asset.fallback)) {
      throw new Error(`资源 ${asset.id} 的 fallback 不存在: ${asset.fallback}`);
    }
    if (asset.fallback) {
      const fallback = assets.find((candidate) => candidate.id === asset.fallback);
      if (fallback && !isCompatibleFallback(asset.type, fallback.type)) {
        throw new Error(`资源 ${asset.id} 的 fallback 类型不兼容: ${fallback.type}`);
      }
    }
  }

  return { version: 1, assets };
}

function isCompatibleFallback(source: AssetType, fallback: AssetType): boolean {
  if (source === fallback) return true;
  if ((source === "svg" || source === "image") && (fallback === "svg" || fallback === "image")) return true;
  return (source === "model" || source === "procedural-model") &&
    (fallback === "model" || fallback === "procedural-model");
}

function validateAssetEntry(value: unknown): AssetEntry {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) {
    throw new Error("每个资源都必须包含非空 id");
  }

  if (typeof value.type !== "string" || !ASSET_TYPES.has(value.type as AssetType)) {
    throw new Error(`资源 ${value.id} 的 type 无效`);
  }

  const type = value.type as AssetType;
  if (type !== "procedural-model" && typeof value.url !== "string") {
    throw new Error(`资源 ${value.id} 缺少 url`);
  }

  if (value.fallback !== undefined && typeof value.fallback !== "string") {
    throw new Error(`资源 ${value.id} 的 fallback 必须是字符串`);
  }

  const metadata = isRecord(value.metadata)
    ? (value.metadata as Record<string, string | number | boolean>)
    : undefined;

  return {
    id: value.id,
    type,
    ...(typeof value.url === "string" ? { url: value.url } : {}),
    ...(typeof value.fallback === "string" ? { fallback: value.fallback } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
