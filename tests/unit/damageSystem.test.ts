import { describe, expect, it } from "vitest";
import { createActorState, type GameEvent, type MatchState } from "../../src/game/state/types";
import { DamageSystem } from "../../src/game/systems/DamageSystem";

function createState(): MatchState {
  const target = createActorState("target", "player", { x: 0, y: 0, z: 0 });
  return {
    mapSeed: 0,
    phase: "combat",
    elapsedSeconds: 0,
    actors: { target },
    groundLoot: {},
    safeZone: {
      center: { x: 0, y: 0, z: 0 },
      radius: 100,
      startCenter: { x: 0, y: 0, z: 0 },
      startRadius: 100,
      targetCenter: { x: 0, y: 0, z: 0 },
      targetRadius: 100,
      stageIndex: 0,
      status: "waiting",
      secondsRemaining: 60,
      damagePerSecond: 0,
    },
    flight: {
      start: { x: 0, y: 100, z: 0 },
      end: { x: 100, y: 100, z: 0 },
      durationSeconds: 30,
      progress: 0,
    },
    result: null,
  };
}

describe("DamageSystem", () => {
  it.each([
    { helmetLevel: 0 as const, expectedHealthDamage: 80 },
    { helmetLevel: 1 as const, expectedHealthDamage: 70 },
    { helmetLevel: 2 as const, expectedHealthDamage: 60 },
  ])(
    "applies level $helmetLevel helmet reduction before armor absorption",
    ({ helmetLevel, expectedHealthDamage }) => {
      const state = createState();
      const target = state.actors.target;
      const events: GameEvent[] = [];
      target.inventory.helmetLevel = helmetLevel;
      target.armor = 20;

      const damage = new DamageSystem().applyDamage(state, target.id, 100, null, events);

      expect(target.armor).toBe(0);
      expect(target.health).toBe(100 - expectedHealthDamage);
      expect(damage).toBe(expectedHealthDamage);
      expect(events).toEqual([
        { type: "actor-damaged", actorId: target.id, sourceId: null, damage: expectedHealthDamage },
      ]);
    },
  );

  it("bypasses helmet reduction and armor absorption for zone damage", () => {
    const state = createState();
    const target = state.actors.target;
    const events: GameEvent[] = [];
    target.inventory.helmetLevel = 2;
    target.armor = 20;

    const damage = new DamageSystem().applyDamage(state, target.id, 30, null, events, true);

    expect(target.armor).toBe(20);
    expect(target.health).toBe(70);
    expect(damage).toBe(30);
    expect(events).toEqual([{ type: "actor-damaged", actorId: target.id, sourceId: null, damage: 30 }]);
  });
});
