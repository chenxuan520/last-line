import { describe, expect, it } from "vitest";
import { createMinimapView, projectToMinimap } from "../../src/client/ui/minimap";
import { createBattleRoyaleState } from "../../src/game/modes/BattleRoyaleMode";

describe("minimap projection", () => {
  it("projects map corners and center into the 200px view box", () => {
    expect(projectToMinimap({ x: 0, y: 0, z: 0 })).toEqual({ x: 100, y: 100 });
    expect(projectToMinimap({ x: -400, y: 0, z: 400 })).toEqual({ x: 0, y: 0 });
    expect(projectToMinimap({ x: 400, y: 0, z: -400 })).toEqual({ x: 200, y: 200 });
  });

  it("builds player, route, and safe-zone markers without exposing enemies", () => {
    const state = createBattleRoyaleState("player", undefined, () => 0.5);
    const player = state.actors.player;
    if (!player) throw new Error("player missing");
    player.position = { x: 100, y: 1.76, z: -200 };
    player.yaw = Math.PI / 2;
    state.safeZone.center = { x: 0, y: 0, z: 0 };
    state.safeZone.radius = 100;
    state.safeZone.targetCenter = { x: 40, y: 0, z: 80 };
    state.safeZone.targetRadius = 50;

    const view = createMinimapView(state, player);

    expect(view.player).toEqual({ x: 125, y: 150, rotationDegrees: 90 });
    expect(view.currentZone).toEqual({ x: 100, y: 100, radius: 25 });
    expect(view.targetZone.x).toBeCloseTo(110);
    expect(view.targetZone.y).toBeCloseTo(80);
    expect(view.targetZone.radius).toBeCloseTo(12.5);
    expect(view.outsideZoneMeters).toBeCloseTo(Math.hypot(100, -200) - 100);
    expect(Object.keys(view)).not.toContain("actors");
  });

  it("keeps an aircraft marker visible while retaining the unclipped route", () => {
    const state = createBattleRoyaleState("player", undefined, () => 0);
    const player = state.actors.player;
    if (!player) throw new Error("player missing");
    player.position = { x: -520, y: 180, z: 0 };

    const view = createMinimapView(state, player);

    expect(view.player.x).toBe(5);
    expect(view.flight.start.x).toBeLessThan(0);
    expect(view.flight.end.x).toBeGreaterThan(200);
  });
});
