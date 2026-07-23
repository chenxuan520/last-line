import { describe, expect, it } from "vitest";
import { brandSignPositionClear, getBrandSignPlacements } from "../../src/client/brandSigns";
import { createMapLayout } from "../../src/config/map";

describe("brand sign placement", () => {
  it("places all five signs clear of authoritative geometry across representative seeds", () => {
    for (const seed of [0, 1, 7, 14, 19, 42, 99, 237, 331, 859]) {
      const layout = createMapLayout(seed);
      const placements = getBrandSignPlacements(layout);
      expect(placements, `seed ${seed}`).toHaveLength(5);
      for (const [index, sign] of placements.entries()) {
        expect(
          brandSignPositionClear(sign.x, sign.z, sign.width, layout, placements.slice(0, index)),
          `${seed}:${sign.assetId}`,
        ).toBe(true);
      }
    }
  }, 30_000);
});
