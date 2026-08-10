import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it } from "vitest";
import { GrenadePresentation } from "../../src/client/render/GrenadePresentation";
import type { ActiveGrenadeState } from "../../src/game/state/types";

describe("GrenadePresentation", () => {
  it("keeps active grenade and trajectory resources bounded and reusable", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const presentation = new GrenadePresentation(scene);
    const allocatedMeshes = scene.meshes.length;
    const grenades = Object.fromEntries(Array.from({ length: 30 }, (_, index) => {
      const grenade: ActiveGrenadeState = {
        id: `grenade-${index}`,
        ownerId: "player",
        aiControlled: false,
        position: { x: index, y: 2, z: 0 },
        velocity: { x: 1, y: 2, z: 3 },
        fuseSeconds: 2,
      };
      return [grenade.id, grenade];
    }));

    presentation.sync(grenades, 1 / 60);
    presentation.showTrajectory(Array.from({ length: 100 }, (_, index) => ({
      x: index,
      y: index * 0.1,
      z: 0,
    })));

    expect(scene.meshes).toHaveLength(allocatedMeshes);
    expect(presentation.counters).toEqual({
      activeGrenadeCapacity: 20,
      trajectoryPointCapacity: 24,
      activeGrenades: 20,
      activeTrajectoryPoints: 24,
    });

    presentation.sync({}, 1 / 60);
    presentation.showTrajectory(null);
    expect(presentation.counters).toMatchObject({
      activeGrenades: 0,
      activeTrajectoryPoints: 0,
    });

    presentation.dispose();
    expect(scene.meshes).toHaveLength(0);
    expect(scene.materials).toHaveLength(0);
    scene.dispose();
    engine.dispose();
  });
});
