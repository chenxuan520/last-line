import { describe, expect, it } from "vitest";
import { GridNavigator } from "../../src/ai/navigation/GridNavigator";
import { createSinglePlayerBotControllers } from "../../src/app/BattleRoyaleSession";
import { createMapLayout } from "../../src/config/map";
import { createBattleRoyaleState } from "../../src/game/modes/BattleRoyaleMode";

describe("runtime performance contracts", () => {
  it("builds one shared navigation index for all 49 single-player bots", () => {
    const state = createBattleRoyaleState("player", undefined, () => 7 / 4_294_967_296, {
      mapId: "town",
    });
    const layout = createMapLayout(state.mapId, state.mapSeed);
    let navigatorBuilds = 0;

    const controllers = createSinglePlayerBotControllers(
      state.actors,
      layout,
      true,
      () => 0.5,
      (currentLayout) => {
        navigatorBuilds += 1;
        return new GridNavigator(currentLayout);
      },
    );

    expect(controllers.size).toBe(49);
    expect(navigatorBuilds).toBe(1);
  }, 30_000);
});
