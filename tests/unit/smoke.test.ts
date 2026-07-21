import { describe, expect, it } from "vitest";
import { AudioFeedback, gunshotDistanceGain } from "../../src/client/audio/AudioFeedback";
import { DEFAULT_SETTINGS } from "../../src/config/settings";

describe("project smoke test", () => {
  it("runs the test environment", () => {
    expect(true).toBe(true);
  });

  it("starts new users muted", () => {
    expect(DEFAULT_SETTINGS.volume).toBe(0);
  });

  it("enables the shared starter bandage for new users", () => {
    expect(DEFAULT_SETTINGS.startWithBandage).toBe(true);
  });

  it("disables AI sniper use for new users", () => {
    expect(DEFAULT_SETTINGS.disableAiSnipers).toBe(true);
  });

  it("shows low-poly ground loot models for new users", () => {
    expect(DEFAULT_SETTINGS.showGroundLootModels).toBe(true);
  });

  it("attenuates remote gunshots by distance", () => {
    expect(gunshotDistanceGain(0, 300)).toBe(1);
    expect(gunshotDistanceGain(150, 300)).toBeCloseTo(0.25);
    expect(gunshotDistanceGain(300, 300)).toBe(0);
  });

  it("does not create audio resources while muted", () => {
    const audio = new AudioFeedback(0);
    expect(() => {
      audio.start();
      audio.handleEvents([{
        type: "shot-fired",
        actorId: "bot-1",
        weaponId: "rifle",
        origin: { x: 0, y: 1.76, z: 0 },
      }], {
        playerId: "player",
        observerId: "player",
        position: { x: 0, y: 1.76, z: 10 },
      });
    }).not.toThrow();
  });
});
