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
    expect(mapDisplayName("island")).toBe("苍岬岛");
    expect(mapDisplayName("town")).toBe("灰炉城");
  });

  it("keeps the legacy seed-only factory equivalent to explicit island", () => {
    const legacy = createMapLayout(42);
    const explicit = createMapLayout("island", 42);

    expect(explicit).toBe(legacy);
    expect(explicit.mapId).toBe("island");
    expect(explicit.displayName).toBe("苍岬岛");
    expect(explicit.skybridges).toEqual([]);
  });

  it.each([
    [0, "82798bfb431d6ff854764c8056a1ca814e18b9a0c28f67f94a85874680e0ab1e"],
    [42, "ecaddfb71b4a189a9ef8e04f0e7c3de25f1556b719be9e8baef535b6e5f699a1"],
    [2026, "441e50c64bb714978fb40d745e6ad2db0560dbc800fef8008600e0ed6f256698"],
  ])("preserves the island layout payload for seed %i", (seed, expectedHash) => {
    const layout = createMapLayout("island", seed);
    const {
      mapId: _mapId,
      displayName: _displayName,
      roadSegments: _roadSegments,
      skybridges: _skybridges,
      ...legacyPayload
    } = layout;

    expect(createHash("sha256").update(JSON.stringify(legacyPayload)).digest("hex")).toBe(expectedHash);
  });
});
