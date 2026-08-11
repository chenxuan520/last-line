import { describe, expect, it } from "vitest";
import { GridNavigator } from "../../src/ai/navigation/GridNavigator";
import { createSinglePlayerBotControllers } from "../../src/app/BattleRoyaleSession";
import { createMapLayout } from "../../src/config/map";
import { createBattleRoyaleState } from "../../src/game/modes/BattleRoyaleMode";
import { MatchRuntime } from "../../src/server/MatchRuntime";

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

  it("shares one navigation index across authoritative room bots", () => {
    let navigatorBuilds = 0;

    const runtime = new MatchRuntime({
      humanActorIds: ["player"],
      seed: 7,
      startWithBandage: false,
      disableAiSnipers: true,
      createBotNavigator: (layout) => {
        navigatorBuilds += 1;
        return new GridNavigator(layout);
      },
    });

    expect(Object.values(runtime.state.actors).filter((actor) => actor.kind === "bot")).toHaveLength(49);
    expect(navigatorBuilds).toBe(1);
  }, 30_000);
});
