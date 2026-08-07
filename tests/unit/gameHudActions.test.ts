import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  GameHud,
  getBackpackItemQuantity,
  hudRootClassName,
  leaderboardScrollPixels,
  pauseExitLabel,
} from "../../src/client/ui/GameHud";
import { FRAG_GRENADE_ITEM_ID } from "../../src/config/throwables";
import { createActorState } from "../../src/game/state/types";

describe("GameHud actions", () => {
  it("uses mode-specific pause exit labels", () => {
    expect(pauseExitLabel(false)).toBe("返回大厅");
    expect(pauseExitLabel(true)).toBe("返回联机大厅");
  });

  it("adds a separate lobby exit only to single-player results", () => {
    const onExit = vi.fn();
    const singlePlayerCard = vi.fn();
    GameHud.prototype.showResult.call({
      options: { onExit },
      showResultCard: singlePlayerCard,
    } as unknown as GameHud, { winnerId: "player", reason: "last-alive" }, "player", 3);
    expect(singlePlayerCard).toHaveBeenCalledWith(
      "最后防线",
      "成功存活 · 3 次淘汰",
      "再来一局",
      undefined,
      onExit,
    );

    const multiplayerCard = vi.fn();
    GameHud.prototype.showResult.call({
      options: { online: true, onExit },
      showResultCard: multiplayerCard,
    } as unknown as GameHud, { winnerId: "player", reason: "last-alive" }, "player", 3);
    expect(multiplayerCard).toHaveBeenCalledWith(
      "最后防线",
      "成功存活 · 3 次淘汰",
      "返回联机大厅",
      undefined,
      undefined,
    );
  });

  it("normalizes pixel, line, and page wheel deltas for leaderboard scrolling", () => {
    expect(leaderboardScrollPixels(12, 0, 400)).toBe(12);
    expect(leaderboardScrollPixels(3, 1, 400)).toBe(48);
    expect(leaderboardScrollPixels(-1, 2, 400)).toBe(-400);
  });

  it("adds the high-quality HUD layer only for high quality", () => {
    expect(hudRootClassName(false, "high")).toBe("is-playing is-high-quality-hud");
    expect(hudRootClassName(true, "high")).toBe("is-playing is-touch-input is-high-quality-hud");
    expect(hudRootClassName(false, "medium")).toBe("is-playing");
    expect(hudRootClassName(true, "low")).toBe("is-playing is-touch-input");
  });

  it("sums every matching grenade stack for HUD counts", () => {
    const actor = createActorState("player", "player", { x: 0, y: 1.76, z: 0 });
    actor.inventory.backpack = [
      { itemId: FRAG_GRENADE_ITEM_ID, quantity: 3 },
      { itemId: "bandage", quantity: 2 },
      { itemId: FRAG_GRENADE_ITEM_ID, quantity: 2 },
    ];

    expect(getBackpackItemQuantity(actor, FRAG_GRENADE_ITEM_ID)).toBe(5);
    actor.inventory.backpack.shift();
    expect(getBackpackItemQuantity(actor, FRAG_GRENADE_ITEM_ID)).toBe(2);
  });

  it("keeps native settings selects readable in dark menus", async () => {
    const stylesheet = await readFile(resolve(process.cwd(), "src/styles/main.css"), "utf8");
    expect(stylesheet).toMatch(/\.settings-grid select\s*\{[^}]*color-scheme:\s*dark;/s);
    const optionRule = stylesheet.match(/\.settings-grid select option\s*\{(?<body>[^}]*)\}/s)?.groups?.body;
    expect(optionRule).toMatch(/color:\s*var\(--ink\);/);
    expect(optionRule).toMatch(/background:\s*#111714;/);
  });
});
