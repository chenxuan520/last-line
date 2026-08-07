import { describe, expect, it } from "vitest";
import { brandSignPositionClear, getBrandSignPlacements } from "../../src/client/brandSigns";
import { createMapLayout } from "../../src/config/map";
import type { MapId } from "../../src/config/maps";
import { MIXED_ROAD_SHOULDER_HALF_WIDTH } from "../../src/config/mixedMap";
import { TOWN_ROAD_SHOULDER_HALF_WIDTH } from "../../src/config/townMap";

describe("brand sign placement", () => {
  const assetIds = [
    "decal.brand.drop-zone",
    "decal.brand.island-operations",
    "decal.brand.property-ll01",
    "decal.brand.restricted-area",
    "decal.brand.supply",
  ];
  const semanticAnchors: Readonly<Record<MapId, Readonly<Record<string, string>>>> = {
    island: {
      "decal.brand.property-ll01": "北港",
      "decal.brand.restricted-area": "雷达哨",
      "decal.brand.supply": "旧仓区",
    },
    town: {
      "decal.brand.property-ll01": "工人住宅区",
      "decal.brand.restricted-area": "铸造工业园",
      "decal.brand.supply": "仓储港区",
    },
    mixed: {
      "decal.brand.property-ll01": "赤钟城区",
      "decal.brand.restricted-area": "沉杉岭",
      "decal.brand.supply": "风穗乡",
    },
  };

  it("places every brand sign at a clear semantic anchor on every map", () => {
    for (const mapId of ["island", "town", "mixed"] as const) {
      for (const seed of [0, 1, 11, 16, 38, 42, 2026]) {
        const layout = createMapLayout(mapId, seed);
        const placements = getBrandSignPlacements(layout);
        expect(placements, `${mapId}:${seed}`).toHaveLength(assetIds.length);
        expect(placements.map((sign) => sign.assetId), `${mapId}:${seed}:assets`).toEqual(assetIds);
        expect(getBrandSignPlacements(layout), `${mapId}:${seed}:deterministic`).toEqual(placements);
        for (const [index, sign] of placements.entries()) {
          expect(
            brandSignPositionClear(sign.x, sign.z, sign.width, layout, placements.slice(0, index)),
            `${mapId}:${seed}:${sign.assetId}`,
          ).toBe(true);
          const roadClearance = sign.width / 2 + 1 + (
            mapId === "mixed" ? MIXED_ROAD_SHOULDER_HALF_WIDTH : TOWN_ROAD_SHOULDER_HALF_WIDTH
          );
          expect(layout.roadSegments.every(([startX, startZ, endX, endZ]) =>
            independentPointToSegmentDistance(
              sign.x,
              sign.z,
              startX,
              startZ,
              endX,
              endZ,
            ) > roadClearance
          ), `${mapId}:${seed}:${sign.assetId}:road`).toBe(true);
          const anchorName = semanticAnchors[mapId][sign.assetId];
          if (!anchorName) continue;
          const anchor = layout.mapPoints.find((point) => point.name === anchorName);
          expect(anchor, `${mapId}:${seed}:${anchorName}`).toBeDefined();
          expect(Math.hypot(
            sign.x - (anchor?.position.x ?? 0),
            sign.z - (anchor?.position.z ?? 0),
          )).toBeLessThan(55);
        }
      }
    }
  }, 120_000);
});

function independentPointToSegmentDistance(
  x: number,
  z: number,
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
): number {
  const deltaX = endX - startX;
  const deltaZ = endZ - startZ;
  const lengthSquared = deltaX ** 2 + deltaZ ** 2;
  const progress = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((x - startX) * deltaX + (z - startZ) * deltaZ) / lengthSquared));
  return Math.hypot(
    x - startX - deltaX * progress,
    z - startZ - deltaZ * progress,
  );
}
