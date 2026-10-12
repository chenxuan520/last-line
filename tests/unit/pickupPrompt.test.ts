import { describe, expect, it } from "vitest";
import { pickupPromptText } from "../../src/client/ui/GameHud";
import { createActorState, type GroundLootState } from "../../src/game/state/types";

describe("pickup prompt", () => {
  it("scans world loot once and keeps current three-dimensional pickup decisions", () => {
    const player = createActorState("player", "player", { x: 0, y: 1.76, z: 0 });
    player.inventory.armorLevel = 2;
    player.maxArmor = player.armor = 100;
    player.inventory.maxBackpackStacks = 1;
    player.inventory.backpack = [{ itemId: "bandage", quantity: 5 }];
    const entries: Record<string, GroundLootState> = {
      armor: { id: "armor", itemId: "armor.2", quantity: 1, available: true, position: { x: 0, y: 0.45, z: 0 } },
      zeta: { id: "zeta", itemId: "ammo.light", quantity: 30, available: true, position: { x: 2, y: 1.76, z: 0 } },
      alpha: { id: "alpha", itemId: "ammo.rifle", quantity: 30, available: true, position: { x: -2, y: 1.76, z: 0 } },
      upstairs: { id: "upstairs", itemId: "medkit", quantity: 1, available: true, position: { x: 0, y: 5, z: 0 } },
      far: { id: "far", itemId: "helmet.2", quantity: 1, available: true, position: { x: 200, y: 1.76, z: 0 } },
    };
    let reads = 0;
    const loot = new Proxy(entries, {
      get(target, key: string) {
        reads += 1;
        return target[key];
      },
    });
    expect(pickupPromptText(player, loot)).toBe("二级护甲 · 当前无法拾取");
    expect(reads).toBe(Object.keys(entries).length);

    player.armor = 50;
    expect(pickupPromptText(player, loot, true)).toBe("拾取 二级护甲");
    player.armor = 100;
    player.inventory.backpack = [];
    expect(pickupPromptText(player, loot)).toBe("F 拾取 步枪弹");
    entries.alpha!.quantity = 0;
    expect(pickupPromptText(player, loot)).toBe("F 拾取 轻型弹");
    entries.zeta!.position.x = 3;
    expect(pickupPromptText(player, loot)).toBe("F 拾取 轻型弹");
    entries.zeta!.position.x = 3.001;
    expect(pickupPromptText(player, loot)).toBe("二级护甲 · 当前无法拾取");
    entries.armor!.available = false;
    expect(pickupPromptText(player, loot)).toBe("");

    reads = 0;
    player.deployment = "parachuting";
    expect(pickupPromptText(player, loot)).toBe("");
    player.deployment = "grounded";
    player.alive = false;
    expect(pickupPromptText(player, loot)).toBe("");
    expect(reads).toBe(0);
  });
});
