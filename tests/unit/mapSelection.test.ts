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
    [0, "b99c10c8e5e6779b288e984031b6238e4ff34ba24f661920074f7ef26e8dfa6b"],
    [42, "4a1aafba8d644166dacad0ca3a0591e3266893ed3139111e15d3a6027bacb56f"],
    [2026, "4f22c9c209b0e9a5a78929033dc7d3c7f9fdb34528eb3b13dbd87ca23ce44b35"],
  ])("locks the island non-stair geometry and first 250 loot points for seed %i", (seed, expectedHash) => {
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
      ammunitionDepot: layout.ammunitionDepot,
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

  it.each([
    ["town", 0, "73eb50e3be7401454cfb7aaa205a025cb1ec9a9d177768241897e58b08e4b077"],
    ["town", 42, "619a798013b967733e87edbcbbdac34780fcd6aad92117a39bbffb2a8ce65d17"],
    ["town", 2026, "3355e35c9bbed40eb4208496a6ed48e7250334a78d79f484bd3cf7c9f718bcd8"],
    ["mixed", 0, "38355d72b284b1337f1fe78b532eedab37ee256014dd5db735effceb3f59cb0c"],
    ["mixed", 42, "bf9aeb62566b9a80eefdfcd8927599aa343823793c87dbdf51f33cdbd0531dc6"],
    ["mixed", 2026, "ede142eb3a04e05d071cdeaba01bc7dcd0b2436f4e025713bfe5bded22c30512"],
  ] as const)("preserves the complete %s layout for seed %i", (mapId, seed, expectedHash) => {
    expect(createHash("sha256").update(JSON.stringify(createMapLayout(mapId, seed))).digest("hex"))
      .toBe(expectedHash);
  });
});
