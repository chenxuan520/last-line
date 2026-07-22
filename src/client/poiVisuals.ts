export type PoiVisualType = "harbor" | "town" | "warehouse" | "station" | "hospital";

const POI_VISUAL_TYPES: Readonly<Record<string, PoiVisualType>> = {
  北港: "harbor",
  灰脊镇: "town",
  旧仓区: "warehouse",
  高地站: "station",
  南岸村: "town",
  雷达哨: "station",
  西风农场: "warehouse",
  东岭营地: "town",
  医院: "hospital",
};

export function getPoiVisualType(name: string): PoiVisualType | null {
  return POI_VISUAL_TYPES[name] ?? null;
}

export function getPoiDecalAssetId(name: string): string | null {
  const type = getPoiVisualType(name);
  return type ? `decal.poi.${type}` : null;
}
