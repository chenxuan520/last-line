import { getTerrainHeight, MAP_HALF_SIZE, type MapLayout, type MapPoint } from "../config/map";
import type { MapId } from "../config/maps";
import { MIXED_ROAD_SHOULDER_HALF_WIDTH } from "../config/mixedMap";
import { TOWN_ROAD_SHOULDER_HALF_WIDTH } from "../config/townMap";

export interface BrandSignPlacement {
  assetId: string;
  x: number;
  z: number;
  yaw: number;
  width: number;
  height: number;
}

interface BrandSignDefinition {
  assetId: string;
  resolvePoint(layout: MapLayout): MapPoint | undefined;
  offsetX: number;
  offsetZ: number;
  width: number;
  height: number;
}

const DEFINITIONS: readonly BrandSignDefinition[] = [
  { assetId: "decal.brand.drop-zone", resolvePoint: (layout) => layout.landingZones[8] ?? layout.landingZones[0], offsetX: 18, offsetZ: 10, width: 7, height: 3.5 },
  { assetId: "decal.brand.island-operations", resolvePoint: (layout) => layout.hospital, offsetX: -16, offsetZ: -18, width: 4.2, height: 4.2 },
  { assetId: "decal.brand.property-ll01", resolvePoint: namedPoint({ island: "北港", town: "工人住宅区", mixed: "赤钟城区" }), offsetX: 16, offsetZ: -16, width: 7, height: 3.5 },
  { assetId: "decal.brand.restricted-area", resolvePoint: namedPoint({ island: "雷达哨", town: "铸造工业园", mixed: "沉杉岭" }), offsetX: -18, offsetZ: 12, width: 7, height: 3.5 },
  { assetId: "decal.brand.supply", resolvePoint: namedPoint({ island: "旧仓区", town: "仓储港区", mixed: "风穗乡" }), offsetX: 18, offsetZ: 14, width: 7, height: 3.5 },
];

export function getBrandSignPlacements(layout: MapLayout): BrandSignPlacement[] {
  const placements: BrandSignPlacement[] = [];
  for (const definition of DEFINITIONS) {
    const point = definition.resolvePoint(layout);
    if (!point) throw new Error(`Brand sign anchor missing: ${layout.mapId}:${definition.assetId}`);
    const baseAngle = Math.atan2(definition.offsetZ, definition.offsetX);
    const baseRadius = Math.hypot(definition.offsetX, definition.offsetZ);
    let selected: { x: number; z: number } | null = null;
    for (const radiusScale of [1, 1.35, 1.7, 2.1]) {
      for (let step = 0; step < 16; step += 1) {
        const angle = baseAngle + step * Math.PI / 8;
        const x = point.position.x + Math.cos(angle) * baseRadius * radiusScale;
        const z = point.position.z + Math.sin(angle) * baseRadius * radiusScale;
        if (brandSignPositionClear(x, z, definition.width, layout, placements)) {
          selected = { x, z };
          break;
        }
      }
      if (selected) break;
    }
    if (!selected) throw new Error(`Brand sign placement failed: ${layout.mapId}:${definition.assetId}`);
    const facing = Math.atan2(point.position.x - selected.x, point.position.z - selected.z);
    placements.push({
      assetId: definition.assetId,
      x: selected.x,
      z: selected.z,
      yaw: facing + Math.PI,
      width: definition.width,
      height: definition.height,
    });
  }
  return placements;
}

export function brandSignPositionClear(
  x: number,
  z: number,
  width: number,
  layout: MapLayout,
  existing: readonly BrandSignPlacement[] = [],
): boolean {
  const radius = width / 2 + 1;
  if (Math.abs(x) + radius >= MAP_HALF_SIZE || Math.abs(z) + radius >= MAP_HALF_SIZE) return false;
  if ([...layout.obstacles, ...layout.rockObstacles, ...layout.coverObstacles, ...layout.treeTrunks].some((obstacle) =>
    Math.abs(x - obstacle.center.x) <= obstacle.width / 2 + radius &&
    Math.abs(z - obstacle.center.z) <= obstacle.depth / 2 + radius
  )) return false;
  if (layout.roofRamps.some((ramp) =>
    Math.abs(x - ramp.centerX) <= ramp.width / 2 + radius &&
    z >= Math.min(ramp.startZ, ramp.endZ) - radius &&
    z <= Math.max(ramp.startZ, ramp.endZ) + radius
  )) return false;
  const roadClearance = radius + (
    layout.mapId === "mixed" ? MIXED_ROAD_SHOULDER_HALF_WIDTH : TOWN_ROAD_SHOULDER_HALF_WIDTH
  );
  if (layout.roadSegments.some(([startX, startZ, endX, endZ]) =>
    pointToSegmentDistance(x, z, startX, startZ, endX, endZ) <= roadClearance
  )) return false;
  if (existing.some((sign) => Math.hypot(x - sign.x, z - sign.z) <= radius + sign.width / 2 + 2)) return false;
  const centerHeight = getTerrainHeight(x, z, layout);
  return [
    getTerrainHeight(x + radius, z, layout),
    getTerrainHeight(x - radius, z, layout),
    getTerrainHeight(x, z + radius, layout),
    getTerrainHeight(x, z - radius, layout),
  ].every((height) => Math.abs(height - centerHeight) <= 1.2);
}

function namedPoint(names: Readonly<Record<MapId, string>>): (layout: MapLayout) => MapPoint | undefined {
  return (layout) => layout.mapPoints.find((point) => point.name === names[layout.mapId]);
}

function pointToSegmentDistance(
  x: number,
  z: number,
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
): number {
  const deltaX = endX - startX;
  const deltaZ = endZ - startZ;
  const lengthSquared = deltaX * deltaX + deltaZ * deltaZ;
  const progress = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((x - startX) * deltaX + (z - startZ) * deltaZ) / lengthSquared));
  return Math.hypot(x - (startX + deltaX * progress), z - (startZ + deltaZ * progress));
}
