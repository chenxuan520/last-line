export type MapId = "island" | "town" | "mixed";

export const DEFAULT_MAP_ID: MapId = "island";

export const MAP_DISPLAY_NAMES: Readonly<Record<MapId, string>> = {
  island: "苍岬岛",
  town: "灰炉城",
  mixed: "烬岚郡",
};

export function normalizeMapId(value: unknown): MapId {
  return value === "town" || value === "mixed" ? value : DEFAULT_MAP_ID;
}

export function mapDisplayName(mapId: MapId): string {
  return MAP_DISPLAY_NAMES[mapId];
}
