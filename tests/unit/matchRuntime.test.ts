import { describe, expect, it } from "vitest";
import { createIdleCommand } from "../../src/game/commands/ActorCommand";
import { MATCH_CHECKPOINT_VERSION, MatchRuntime } from "../../src/server/MatchRuntime";

describe("MatchRuntime", () => {
  it("runs a 10-human authoritative room with 40 bots", () => {
    const humanActorIds = Array.from({ length: 10 }, (_, index) => `human-${index + 1}`);
    const runtime = new MatchRuntime({
      humanActorIds,
      seed: 2026,
      startWithBandage: true,
      disableAiSnipers: true,
    });
    expect(Object.values(runtime.state.actors).filter((actor) => actor.kind === "player")).toHaveLength(10);
    expect(Object.values(runtime.state.actors).filter((actor) => actor.kind === "bot")).toHaveLength(40);

    expect(runtime.submitInput("human-1", 1, { ...createIdleCommand(), jump: true })).toBe(true);
    runtime.step();
    expect(runtime.acknowledge("human-1")).toBe(1);
    expect(runtime.tick).toBe(1);
    expect(runtime.takeFrame(123).actors).toBe(runtime.state.actors);
  });

  it("restores checkpoints and keeps disconnected human identities", () => {
    const runtime = new MatchRuntime({
      humanActorIds: ["human-1", "human-2"],
      seed: 7,
      startWithBandage: false,
      disableAiSnipers: true,
    });
    runtime.setConnected("human-2", false);
    for (let tick = 0; tick < 151; tick += 1) runtime.step();
    expect(runtime.state.actors["human-2"]?.kind).toBe("player");
    const checkpoint = runtime.checkpoint();
    expect(checkpoint.version).toBe(MATCH_CHECKPOINT_VERSION);
    const restored = new MatchRuntime({
      humanActorIds: ["human-1", "human-2"],
      seed: 7,
      startWithBandage: false,
      disableAiSnipers: true,
      ...checkpoint,
    });
    expect(restored.tick).toBe(runtime.tick);
    expect(restored.state).toEqual(checkpoint.state);
  });

  it("redacts distant actors and only replicates nearby loot", () => {
    const runtime = new MatchRuntime({
      humanActorIds: ["human-1", "human-2"],
      seed: 11,
      startWithBandage: true,
      disableAiSnipers: true,
    });
    const viewer = runtime.state.actors["human-1"];
    const distant = runtime.state.actors["human-2"];
    const loot = Object.values(runtime.state.groundLoot)[0];
    if (!viewer || !distant || !loot) throw new Error("test state missing");
    viewer.deployment = "grounded";
    viewer.position = { x: 0, y: 1.76, z: 0 };
    distant.deployment = "grounded";
    distant.position = { x: 1_000, y: 1.76, z: 1_000 };
    loot.position = { x: 2, y: 0.45, z: 2 };

    const projected = runtime.projectState(viewer.id);

    expect(projected.actors[distant.id]?.position.y).toBe(-10_000);
    expect(projected.actors[distant.id]?.inventory.weaponSlots).toEqual([null, null]);
    expect(projected.groundLoot[loot.id]).toEqual(loot);
    expect(Object.values(projected.groundLoot).every((entry) =>
      Math.hypot(entry.position.x - viewer.position.x, entry.position.z - viewer.position.z) <= 60
    )).toBe(true);
  });
});
