import { describe, expect, it } from "vitest";
import { createMinimapView, projectToMinimap } from "../../src/client/ui/minimap";
import {
  combatCounterLabel,
  createMinimapSignature,
  pickupPromptSignature,
  pickupPromptText,
  sortLeaderboardActors,
} from "../../src/client/ui/GameHud";
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

  it("uses the viewed spectator actor for the minimap marker and cache signature", () => {
    const state = createBattleRoyaleState("player", undefined, () => 0.5);
    const player = state.actors.player;
    const spectator = state.actors["bot-1"];
    if (!player || !spectator) throw new Error("actors missing");
    player.alive = false;
    player.position = { x: -500, y: 1.76, z: -500 };
    spectator.position = { x: 300, y: 1.76, z: 400 };
    spectator.yaw = Math.PI;

    const spectatorView = createMinimapView(state, spectator);

    expect(spectatorView.player).toMatchObject({
      ...projectToMinimap(spectator.position, true),
      rotationDegrees: 180,
    });
    expect(createMinimapSignature(state, spectator)).not.toBe(createMinimapSignature(state, player));
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

  it("switches the flight counter to kills as soon as the player lands", () => {
    const state = createBattleRoyaleState("player", undefined, () => 0.5);
    const player = state.actors.player;
    if (!player) throw new Error("player missing");
    state.phase = "flight";
    player.deployment = "parachuting";
    state.actors["bot-1"]!.deployment = "parachuting";

    expect(combatCounterLabel(state, player)).toBe("已跳伞 2 / 50");

    player.deployment = "grounded";
    player.kills = 3;
    expect(combatCounterLabel(state, player)).toBe("3 击杀");

    player.deployment = "parachuting";
    player.alive = false;
    state.phase = "combat";
    expect(combatCounterLabel(state, player)).toBe("3 击杀");
  });

  it("refreshes the pickup prompt when same-level armor becomes usable", () => {
    const state = createBattleRoyaleState("player", undefined, () => 0.5);
    const player = state.actors.player;
    if (!player) throw new Error("player missing");
    player.deployment = "grounded";
    player.inventory.armorLevel = 2;
    player.maxArmor = 100;
    player.armor = 100;
    state.groundLoot = {
      armor: {
        id: "armor",
        itemId: "armor.2",
        quantity: 1,
        position: { x: player.position.x, y: player.position.y - 1.31, z: player.position.z },
        available: true,
      },
    };
    const fullArmorSignature = pickupPromptSignature(player, state.groundLoot);
    expect(pickupPromptText(player, state.groundLoot)).toContain("当前无法拾取");

    player.armor = 0;

    expect(pickupPromptSignature(player, state.groundLoot)).not.toBe(fullArmorSignature);
    expect(pickupPromptText(player, state.groundLoot)).toBe("F 拾取 二级护甲");
  });

  it("refreshes the pickup prompt when backpack capacity increases", () => {
    const state = createBattleRoyaleState("player", undefined, () => 0.5);
    const player = state.actors.player;
    if (!player) throw new Error("player missing");
    player.deployment = "grounded";
    player.inventory.maxBackpackStacks = 1;
    player.inventory.backpack = [{ itemId: "bandage", quantity: 5 }];
    state.groundLoot = {
      ammo: {
        id: "ammo",
        itemId: "ammo.rifle",
        quantity: 30,
        position: { x: player.position.x, y: player.position.y - 1.31, z: player.position.z },
        available: true,
      },
    };
    const fullBackpackSignature = pickupPromptSignature(player, state.groundLoot);
    expect(pickupPromptText(player, state.groundLoot)).toContain("当前无法拾取");

    player.inventory.maxBackpackStacks = 2;

    expect(pickupPromptSignature(player, state.groundLoot)).not.toBe(fullBackpackSignature);
    expect(pickupPromptText(player, state.groundLoot)).toBe("F 拾取 步枪弹");
  });
});
