export type AssetType = "svg" | "image" | "model" | "procedural-model";

export interface AssetEntry {
  id: string;
  type: AssetType;
  url?: string;
  fallback?: string;
  metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface AssetManifest {
  version: number;
  assets: AssetEntry[];
}
