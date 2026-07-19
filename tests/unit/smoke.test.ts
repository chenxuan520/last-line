import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/config/settings";

describe("project smoke test", () => {
  it("runs the test environment", () => {
    expect(true).toBe(true);
  });

  it("starts new users muted", () => {
    expect(DEFAULT_SETTINGS.volume).toBe(0);
  });
});
