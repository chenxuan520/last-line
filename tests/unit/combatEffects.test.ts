import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it } from "vitest";
import { CombatEffects } from "../../src/client/render/CombatEffects";
import type { GameEvent } from "../../src/game/state/types";

describe("CombatEffects", () => {
  it("keeps every visual pool bounded and recycles expired effects", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const effects = new CombatEffects(scene);
    const allocatedMeshCount = scene.meshes.length;

    expect(effects.counters).toMatchObject({
      tracerCapacity: 16,
      muzzleCapacity: 4,
      impactCapacity: 12,
      particleCapacity: 32,
      decalCapacity: 20,
    });
    expect(scene.meshes.every((mesh) => !mesh.isPickable && !mesh.checkCollisions)).toBe(true);

    const events = Array.from({ length: 1_000 }, (_, index): GameEvent => environmentTrace(index));
    effects.handleEvents(events, "player");

    expect(scene.meshes).toHaveLength(allocatedMeshCount);
    expect(effects.counters).toMatchObject({
      activeTracers: 16,
      activeMuzzles: 2,
      activeImpacts: 12,
      activeParticles: 32,
      activeDecals: 20,
    });

    effects.update(0.5);

    expect(effects.counters).toMatchObject({
      activeTracers: 0,
      activeMuzzles: 0,
      activeImpacts: 0,
      activeParticles: 0,
      activeDecals: 20,
    });

    effects.update(8);
    expect(effects.counters.activeDecals).toBe(0);

    effects.dispose();
    expect(scene.meshes).toHaveLength(0);
    expect(scene.materials).toHaveLength(0);
    scene.dispose();
    engine.dispose();
  });

  it("uses distinct actor-hit feedback and ignores unrelated events", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const effects = new CombatEffects(scene);

    effects.handleEvents([{ type: "shot-fired", actorId: "player" }], "player");
    expect(effects.counters.activeTracers).toBe(0);

    effects.handleEvents([actorTrace("bot")], "player");
    const actorMaterial = activeImpactMaterialName(scene);
    expect(actorMaterial).toBe("combat-effects-actor-hit-material");
    expect(effects.counters.activeParticles).toBe(0);
    expect(effects.counters.activeDecals).toBe(0);

    effects.update(0.5);
    effects.handleEvents([actorTrace("player")], "player");
    expect(activeImpactMaterialName(scene)).toBe("combat-effects-player-hit-material");

    effects.dispose();
    scene.dispose();
    engine.dispose();
  });

  it("creates one muzzle flash for a multi-pellet shot", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const effects = new CombatEffects(scene);

    effects.handleEvents(Array.from({ length: 8 }, () => actorTrace("bot")), "player");

    expect(effects.counters.activeTracers).toBe(8);
    expect(effects.counters.activeMuzzles).toBe(1);
    effects.dispose();
    scene.dispose();
    engine.dispose();
  });
});

function environmentTrace(index: number): GameEvent {
  return {
    type: "shot-traced",
    actorId: index % 2 === 0 ? "player" : "bot",
    origin: { x: 0, y: 1.5, z: 0 },
    end: { x: index % 7, y: 0, z: 20 },
    normal: { x: 0, y: 1, z: 0 },
    hitType: "environment",
    targetId: null,
  };
}

function actorTrace(targetId: string): GameEvent {
  return {
    type: "shot-traced",
    actorId: "player",
    origin: { x: 0, y: 1.5, z: 0 },
    end: { x: 0, y: 1.2, z: 10 },
    normal: { x: 0, y: 0, z: -1 },
    hitType: "actor",
    targetId,
  };
}

function activeImpactMaterialName(scene: Scene): string | undefined {
  return scene.meshes.find((mesh) => mesh.name.startsWith("combat-effect-impact-") && mesh.isEnabled())?.material
    ?.name;
}
