import { describe, expect, it } from "vitest";
import { surfaceNormalPixels } from "../../src/client/render/UltraPresentation";

describe("ultra town surface normals", () => {
  it("keeps flat surfaces flat and derives finite wrapped normals without mutating source pixels", () => {
    const pixels = new Uint8ClampedArray(4 * 4 * 4).fill(128);
    const original = pixels.slice();
    const flat = surfaceNormalPixels(pixels, 4);
    for (let offset = 0; offset < flat.length; offset += 4) {
      expect([...flat.slice(offset, offset + 4)]).toEqual([128, 128, 255, 255]);
    }
    expect(pixels).toEqual(original);
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        pixels.fill(x * 60, (y * 4 + x) * 4, (y * 4 + x) * 4 + 3);
      }
    }
    const slope = surfaceNormalPixels(pixels, 4);
    expect(slope[4]).toBeLessThan(128);
    expect(slope[0]).toBeGreaterThan(128);
    expect(slope[5]).toBe(128);
    expect(slope).toEqual(surfaceNormalPixels(pixels, 4));
  });
});
