import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createMapLayout } from "../../src/config/map";
import {
  DEFAULT_MAP_ID,
  mapDisplayName,
  normalizeMapId,
} from "../../src/config/maps";
import { DEFAULT_SETTINGS } from "../../src/config/settings";

describe("map selection", () => {
  it("keeps island as the compatibility default", () => {
    expect(DEFAULT_MAP_ID).toBe("island");
    expect(DEFAULT_SETTINGS.mapId).toBe("island");
    expect(normalizeMapId(undefined)).toBe("island");
    expect(normalizeMapId("invalid")).toBe("island");
    expect(normalizeMapId("town")).toBe("town");
    expect(normalizeMapId("mixed")).toBe("mixed");
    expect(mapDisplayName("island")).toBe("苍岬岛");
    expect(mapDisplayName("town")).toBe("灰炉城");
    expect(mapDisplayName("mixed")).toBe("烬岚郡");
  });

  it("keeps the legacy seed-only factory equivalent to explicit island", () => {
    const legacy = createMapLayout(42);
    const explicit = createMapLayout("island", 42);

    expect(explicit).toBe(legacy);
    expect(explicit.mapId).toBe("island");
    expect(explicit.displayName).toBe("苍岬岛");
    expect(explicit.skybridges).toEqual([]);
  });

  it("keeps all map families isolated for the same seed", () => {
    const island = createMapLayout("island", 42);
    const town = createMapLayout("town", 42);
    const mixed = createMapLayout("mixed", 42);

    expect(new Set([island, town, mixed]).size).toBe(3);
    expect(mixed.mapId).toBe("mixed");
    expect(mixed.displayName).toBe("烬岚郡");
    expect(createMapLayout("mixed", 42)).toBe(mixed);
    expect(mixed).not.toEqual(island);
    expect(mixed).not.toEqual(town);
  }, 30_000);

  it.each([
    [0, "ef5662a40cbad541a7aefe729cfbad581326d364544defdaa34d16aa088a05bd"],
    [42, "e3ab2f3cc0e8cd4919c82442c169add18daab7b509a78e8fcba82c60d03f4e40"],
    [2026, "63cf0791cf78a613ac7cb6ddc4e4c623e33683e0b66d1e1a5bbc9bc145e6c40e"],
  ])("preserves the island non-stair geometry and first 250 loot points for seed %i", (seed, expectedHash) => {
    const layout = createMapLayout("island", seed);
    const stablePayload = {
      mapPoints: layout.mapPoints,
      landingZones: layout.landingZones,
      terrainHills: layout.terrainHills,
      obstacles: layout.obstacles.map((building) => ({
        id: building.id,
        ...(building.regionId ? { regionId: building.regionId } : {}),
        center: building.center,
        width: building.width,
        height: building.height,
        depth: building.depth,
        baseY: building.baseY,
        storyCount: building.storyCount,
        storyHeight: building.storyHeight,
        ...(building.townKind ? { townKind: building.townKind } : {}),
      })),
      hospital: layout.hospital,
      rocks: layout.rockObstacles,
      trees: layout.treeTrunks,
      covers: layout.coverObstacles,
      loot: layout.lootSpawnPoints.slice(0, 250),
      lootZoneCounts: layout.lootZoneCounts,
      roads: layout.roadSegments,
      urbanRoads: layout.urbanRoadSegments,
      skybridges: layout.skybridges,
    };

    expect(createHash("sha256").update(JSON.stringify(stablePayload)).digest("hex")).toBe(expectedHash);
  });
});
