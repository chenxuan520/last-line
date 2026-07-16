import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { describe, expect, it } from "vitest";
import { AssetCatalog } from "../../src/assets/AssetCatalog";
import { createIslandScene } from "../../src/client/render/scenes/IslandScene";
import { createBattleRoyaleState } from "../../src/game/modes/BattleRoyaleMode";

describe("IslandScene lifecycle", () => {
  it("releases scenes and loot marker references across restarts", async () => {
    const engine = new NullEngine();
    const assets = createAssets();

    for (let restart = 0; restart < 4; restart += 1) {
      const state = createBattleRoyaleState("player", undefined, () => 0.5);
      const bundle = await createIslandScene(engine, assets, state.actors, state.groundLoot);
      expect(engine.scenes).toHaveLength(1);
      expect(bundle.lootMeshes.size).toBe(Object.keys(state.groundLoot).length);

      bundle.scene.dispose();

      expect(engine.scenes).toHaveLength(0);
      expect(bundle.lootMeshes.size).toBe(0);
    }
    engine.dispose();
  });
});

function createAssets(): AssetCatalog {
  return new AssetCatalog({
    version: 1,
    assets: [
      { id: "fallback.ui", type: "svg", url: "/fallback.svg" },
      { id: "fallback.model", type: "procedural-model", metadata: { color: "#cf4b3f" } },
      { id: "ui.crosshair", type: "svg", url: "/crosshair.svg", fallback: "fallback.ui" },
      { id: "ui.weapon.rifle", type: "svg", url: "/rifle.svg", fallback: "fallback.ui" },
      { id: "model.character.player", type: "procedural-model", fallback: "fallback.model", metadata: { color: "#809d5e" } },
      { id: "model.character.enemy", type: "procedural-model", fallback: "fallback.model", metadata: { color: "#bd6357" } },
      { id: "model.weapon.rifle", type: "procedural-model", fallback: "fallback.model", metadata: { color: "#283126" } },
    ],
  });
}
