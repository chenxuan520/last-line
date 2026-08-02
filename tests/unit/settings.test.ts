import { describe, expect, it } from "vitest";
import {
  normalizeSensitivity,
  renderHardwareScalingLevel,
  usesMobileDevicePixels,
} from "../../src/config/settings";

describe("game settings", () => {
  it("normalizes stored sensitivity to the supported range", () => {
    expect(normalizeSensitivity(undefined)).toBe(1);
    expect(normalizeSensitivity(Number.NaN)).toBe(1);
    expect(normalizeSensitivity(Number.POSITIVE_INFINITY)).toBe(1);
    expect(normalizeSensitivity(0.1)).toBe(0.4);
    expect(normalizeSensitivity(3)).toBe(2);
    expect(normalizeSensitivity(1.3)).toBe(1.3);
  });

  it("selects device-pixel rendering only for coarse pointers", () => {
    expect(usesMobileDevicePixels(undefined)).toBe(false);
    expect(usesMobileDevicePixels(() => ({ matches: false }))).toBe(false);
    expect(usesMobileDevicePixels((query) => ({ matches: query === "(pointer: coarse)" }))).toBe(true);
  });

  it("uses mobile device pixels without allowing unbounded render resolution", () => {
    expect(renderHardwareScalingLevel("high", 1, true)).toBe(1);
    expect(renderHardwareScalingLevel("high", 2, true)).toBeCloseTo(0.5);
    expect(renderHardwareScalingLevel("high", 3, true)).toBeCloseTo(0.5);
    expect(renderHardwareScalingLevel("medium", 3, true)).toBeCloseTo(0.675);
    expect(renderHardwareScalingLevel("low", 3, true)).toBeCloseTo(0.875);
    expect(renderHardwareScalingLevel("medium", 3, false)).toBe(1.35);
  });
});
