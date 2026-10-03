import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { expect, it } from "vitest";
import { createIslandScene, setActorWeaponVisual } from "../../src/client/render/scenes/IslandScene";
import { createMapLayout } from "../../src/config/map";
import { createBattleRoyaleState } from "../../src/game/modes/BattleRoyaleMode";
import { SimulationCombatWorld } from "../../src/game/systems/SimulationCombatWorld";
import { createAssets } from "../fixtures/islandSceneAssets";

it.each([
  ["low", "island"], ["medium", "island"], ["high", "town"], ["ultra", "mixed"],
] as const)("protects actual %s hand-held models in the %s scene", async (quality, mapId) => {
  const engine = new NullEngine();
  try {
    const state = createBattleRoyaleState("player", undefined, () => 0, { mapId });
    const scene = await createIslandScene(engine, createAssets(), state.actors, state.groundLoot, 0, true, "player", quality, mapId);
    const layout = createMapLayout(mapId, 0);
    const wall = layout.wallSegments.find(w => w.width > 2 && Math.abs(w.rotationY ?? 0) < 0.001 && w.role !== "architectural")!;
    expect(wall).toBeDefined();
    const eye = new Vector3(wall.center.x, wall.center.y, wall.center.z - wall.depth / 2 - 0.43);
    scene.camera.rotation.set(0, 0, 0);
    const world = new SimulationCombatWorld(state, true, layout);
    const before = JSON.stringify(state);
    scene.viewWeaponRoot.setEnabled(true);
    const resources = [scene.scene.meshes.length, scene.scene.materials.length, scene.scene.textures.length];
    for (const id of ["rifle", "smg", "shotgun", "sniper", "grenade.frag"]) {
      setActorWeaponVisual(scene.viewWeaponRoot, id);
      scene.firstPerson.updateCamera(world, eye, eye, 0);
      scene.firstPerson.updateWeapon(world, id, 0, 0, 0, 1 / 30);
      expect(scene.viewWeaponRoot.position.z, id).toBeLessThan(0);
      const visible = scene.viewWeaponRoot.getChildMeshes(false).filter(mesh => mesh.isEnabled());
      expect(visible.length).toBeGreaterThan(0);
      expect(visible.every(mesh => mesh.renderingGroupId === 1)).toBe(true);
    }
    expect([scene.scene.meshes.length, scene.scene.materials.length, scene.scene.textures.length]).toEqual(resources);
    expect([...scene.lootMeshes.values()].every(mesh => mesh.renderingGroupId === 0)).toBe(true);
    expect(JSON.stringify(state)).toBe(before);
    scene.scene.dispose();
  } finally { engine.dispose(); }
}, 60_000);
