import { describe, expect, it } from "vitest";
import { createMinimapView, projectToMinimap } from "../../src/client/ui/minimap";
import { sortLeaderboardActors } from "../../src/client/ui/GameHud";
import { MAP_HALF_SIZE } from "../../src/config/map";
import { createBattleRoyaleState } from "../../src/game/modes/BattleRoyaleMode";

describe("minimap projection", () => {
  it("projects map corners and center into the 200px view box", () => {
    expect(projectToMinimap({ x: 0, y: 0, z: 0 })).toEqual({ x: 100, y: 100 });
    expect(projectToMinimap({ x: -MAP_HALF_SIZE, y: 0, z: MAP_HALF_SIZE })).toEqual({ x: 0, y: 0 });
    expect(projectToMinimap({ x: MAP_HALF_SIZE, y: 0, z: -MAP_HALF_SIZE })).toEqual({ x: 200, y: 200 });
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

    expect(view.player.x).toBeCloseTo(108.333, 3);
    expect(view.player.y).toBeCloseTo(116.667, 3);
    expect(view.player.rotationDegrees).toBe(90);
    expect(view.currentZone.x).toBe(100);
    expect(view.currentZone.y).toBe(100);
    expect(view.currentZone.radius).toBeCloseTo(8.333, 3);
    expect(view.targetZone.x).toBeCloseTo(103.333, 3);
    expect(view.targetZone.y).toBeCloseTo(93.333, 3);
    expect(view.targetZone.radius).toBeCloseTo(4.167, 3);
    expect(view.outsideZoneMeters).toBeCloseTo(Math.hypot(100, -200) - 100);
    expect(Object.keys(view)).not.toContain("actors");
  });

  it("keeps an aircraft marker visible while retaining the unclipped route", () => {
    const state = createBattleRoyaleState("player", undefined, () => 0);
    const player = state.actors.player;
    if (!player) throw new Error("player missing");
    player.position = { x: -MAP_HALF_SIZE - 120, y: 180, z: 0 };

    const view = createMinimapView(state, player);

    expect(view.player.x).toBe(5);
    expect(view.flight.start.x).toBeLessThan(0);
    expect(view.flight.end.x).toBeGreaterThan(200);
  });

  it("sorts the leaderboard by survival, kills, and stable id", () => {
    const state = createBattleRoyaleState("player", undefined, () => 0.5);
    const player = state.actors.player;
    const bot1 = state.actors["bot-1"];
    const bot2 = state.actors["bot-2"];
    if (!player || !bot1 || !bot2) throw new Error("actors missing");
    player.kills = 2;
    bot1.kills = 4;
    bot2.kills = 9;
    bot2.alive = false;

    expect(sortLeaderboardActors([player, bot2, bot1]).map((actor) => actor.id)).toEqual([
      "bot-1",
      "player",
      "bot-2",
    ]);
  });
});
