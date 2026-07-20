import { describe, expect, it } from "vitest";
import { BATTLE_ROYALE_CONFIG } from "../../src/config/battleRoyale";
import {
  createBattleRoyaleState,
  createBattleRoyaleStateForHumans,
} from "../../src/game/modes/BattleRoyaleMode";

describe("multiplayer battle royale state", () => {
  it("preserves the existing single-player factory output", () => {
    const left = createBattleRoyaleState("player", BATTLE_ROYALE_CONFIG, seededRandom(7));
    const right = createBattleRoyaleStateForHumans(["player"], BATTLE_ROYALE_CONFIG, seededRandom(7));
    expect(right).toEqual(left);
  });

  it.each([
    { humans: 2, bots: 48 },
    { humans: 10, bots: 40 },
  ])("creates $humans humans and fills the match with $bots bots", ({ humans, bots }) => {
    const humanIds = Array.from({ length: humans }, (_, index) => `human-${index + 1}`);
    const state = createBattleRoyaleStateForHumans(humanIds, BATTLE_ROYALE_CONFIG, seededRandom(humans));

    expect(Object.values(state.actors).filter((actor) => actor.kind === "player")).toHaveLength(humans);
    expect(Object.values(state.actors).filter((actor) => actor.kind === "bot")).toHaveLength(bots);
    expect(Object.keys(state.actors)).toHaveLength(50);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it("rejects duplicate, reserved, empty, and oversized human rosters", () => {
    expect(() => createBattleRoyaleStateForHumans([], BATTLE_ROYALE_CONFIG, seededRandom(1))).toThrow();
    expect(() => createBattleRoyaleStateForHumans(["same", "same"], BATTLE_ROYALE_CONFIG, seededRandom(1))).toThrow();
    expect(() => createBattleRoyaleStateForHumans(["bot-1", "human-2"], BATTLE_ROYALE_CONFIG, seededRandom(1))).toThrow();
    expect(() => createBattleRoyaleStateForHumans(
      Array.from({ length: 51 }, (_, index) => `human-${index}`),
      BATTLE_ROYALE_CONFIG,
      seededRandom(1),
    )).toThrow();
  });
});

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}
