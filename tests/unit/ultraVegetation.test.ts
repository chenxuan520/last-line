import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { expect, it } from "vitest";
import { enhanceVegetation } from "../../src/client/render/UltraVegetationPresentation";
import { createUltraMaterialAdapter } from "../../src/client/render/UltraLightingPresentation";

it("shares bounded ultra plants and mineral surfaces while preserving obstacle transforms and grounding", () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const trunk = CreateCylinder("tree-trunk-template", { height: 5.8, diameter: 1.1, tessellation: 7 }, scene);
    const crown = CreateSphere("tree-foliage-template", { diameter: 7, segments: 6 }, scene);
    const shrub = CreateSphere("shrub-template", { diameter: 1, segments: 6 }, scene);
    const rock = CreateSphere("rock-template", { diameter: 1, segments: 5 }, scene);
    for (const [mesh, name] of [[trunk, "tree-trunk-material"], [crown, "tree-foliage-material"],
      [shrub, "shrub-material"], [rock, "rock-material"]] as const) {
      mesh.material = new StandardMaterial(name, scene);
      mesh.isVisible = false;
    }
    const tree = trunk.createInstance("authoritative-tree"), stone = rock.createInstance("authoritative-rock");
    tree.position.set(5, 7, 9); tree.scaling.set(1, 1.3, 0.8);
    stone.position.set(2, 4, 8); stone.scaling.set(3, 1.4, 2);
    const plants = [shrub.createInstance("short-shrub"), shrub.createInstance("tall-shrub")];
    plants.forEach((plant, index) => {
      plant.position.set(index * 7, 10 + 0.68, index * 3);
      plant.scaling.set(2.1, index ? 1.29 : 1.05, 1.8);
      plant.freezeWorldMatrix();
    });
    const transforms = [tree, stone].map((mesh) => [mesh.position.asArray(), mesh.scaling.asArray()]);
    const originalIndices = Array.from(rock.getIndices()!), originalVertices = rock.getTotalVertices();
    const originalRock = Array.from(rock.getVerticesData("position")!);
    enhanceVegetation(scene);
    expect([tree, stone].map((mesh) => [mesh.position.asArray(), mesh.scaling.asArray()])).toEqual(transforms);
    expect(Array.from(rock.getIndices()!)).toEqual(originalIndices);
    expect(rock.getTotalVertices()).toBe(originalVertices);
    expect(rock.getVerticesData("position")).not.toEqual(originalRock);
    expect(trunk.getTotalVertices()).toBeLessThanOrEqual(80);
    const trunkBox = trunk.getBoundingInfo().boundingBox;
    expect(trunkBox.minimum.y).toBeCloseTo(-2.9, 5);
    expect(trunkBox.maximum.y).toBeCloseTo(2.9, 5);
    expect(trunkBox.minimum.x).toBeCloseTo(-0.55, 5);
    expect(trunkBox.maximum.x).toBeCloseTo(0.55, 5);
    expect(crown.getTotalVertices()).toBeLessThanOrEqual(872);
    expect(shrub.getTotalVertices()).toBeLessThanOrEqual(128);
    const farCrown = crown.getLODLevelAtDistance(100)!;
    const farShrub = shrub.getLODLevelAtDistance(40)!;
    expect(farCrown.getTotalVertices()).toBeLessThan(crown.getTotalVertices() / 3);
    expect(farShrub.getTotalVertices()).toBeLessThanOrEqual(shrub.getTotalVertices() / 4);
    for (const [near, distant] of [[crown, farCrown], [shrub, farShrub]]) {
      const box = near!.getBoundingInfo().boundingBox;
      const positions = distant!.getVerticesData("position")!;
      for (let index = 0; index < positions.length; index += 3) {
        const point = Vector3.FromArray(positions, index);
        expect(point.x).toBeGreaterThanOrEqual(box.minimum.x - 1e-5);
        expect(point.y).toBeGreaterThanOrEqual(box.minimum.y - 1e-5);
        expect(point.z).toBeGreaterThanOrEqual(box.minimum.z - 1e-5);
        expect(point.x).toBeLessThanOrEqual(box.maximum.x + 1e-5);
        expect(point.y).toBeLessThanOrEqual(box.maximum.y + 1e-5);
        expect(point.z).toBeLessThanOrEqual(box.maximum.z + 1e-5);
      }
      expect(distant!.isPickable).toBe(false);
      expect(distant!.checkCollisions).toBe(false);
      expect(distant!.material).toBe(near!.material);
    }
    for (const plant of plants) {
      expect(plant.isWorldMatrixFrozen).toBe(true);
      expect(plant.getBoundingInfo().boundingBox.minimumWorld.y).toBeCloseTo(10, 5);
      expect(plant.sourceMesh).toBe(shrub);
    }
    createUltraMaterialAdapter(scene).convertScene();
    for (const mesh of [crown, shrub]) {
      expect(mesh.material!.needAlphaTesting()).toBe(true);
      expect(mesh.material!.needAlphaBlending()).toBe(false);
      expect(mesh.material!.backFaceCulling).toBe(false);
    }
    const textures = scene.textures.filter((texture) => texture.name.startsWith("ultra-"));
    expect(textures.map((texture) => texture.name).sort()).toEqual([
      "ultra-rock-mineral", "ultra-rock-normal", "ultra-tree-bark", "ultra-tree-bark-normal",
      "ultra-tree-needles", "ultra-understory-leaves",
    ]);
    for (const texture of textures.filter((texture) => texture.name.endsWith("normal"))) {
      expect(texture.gammaSpace).toBe(false);
      expect(texture.getSize()).toEqual({ width: 128, height: 128 });
    }
    for (const texture of textures) {
      const repeat = /bark|rock/.test(texture.name);
      expect(texture.wrapU).toBe(repeat ? Texture.WRAP_ADDRESSMODE : Texture.CLAMP_ADDRESSMODE);
      expect(texture.wrapV).toBe(texture.wrapU);
    }
    expect(scene.materials).toHaveLength(4);
    scene.dispose();
    expect(textures.every((texture) => texture.getInternalTexture() === null)).toBe(true);
  } finally {
    scene.dispose(); engine.dispose();
  }
});
