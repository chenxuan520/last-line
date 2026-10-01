import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Scene } from "@babylonjs/core/scene";
import { describe, expect, it } from "vitest";
import { createUltraMaterialAdapter } from "../../src/client/render/UltraLightingPresentation";
import { surfaceNormalPixels } from "../../src/client/render/UltraPresentation";

describe("ultra town surface normals", () => {
  it("keeps flat surfaces flat and derives finite wrapped normals without mutating source pixels", () => {
    const pixels = new Uint8ClampedArray(4 * 4 * 4).fill(128);
    const original = pixels.slice();
    const flat = surfaceNormalPixels(pixels, 4);
    for (let offset = 0; offset < flat.length; offset += 4) {
      expect([...flat.slice(offset, offset + 4)]).toEqual([128, 128, 255, 255]);
    }
    expect(pixels).toEqual(original);
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        pixels.fill(x * 60, (y * 4 + x) * 4, (y * 4 + x) * 4 + 3);
      }
    }
    const slope = surfaceNormalPixels(pixels, 4);
    expect(slope[4]).toBeLessThan(128);
    expect(slope[0]).toBeGreaterThan(128);
    expect(slope[5]).toBe(128);
    expect(slope).toEqual(surfaceNormalPixels(pixels, 4));
  });
});

describe("ultra PBR material adapter", () => {
  it("forwards late texture binds, converts shared and multi materials once, and keeps HUD-style materials", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const wall = new StandardMaterial("building-material-texture-brick", scene);
    wall.diffuseColor = Color3.FromHexString("#808080");
    const glass = new StandardMaterial("town-window-material", scene);
    glass.alpha = 0.16;
    const marker = new StandardMaterial("loot-marker-material", scene);
    const trail = new StandardMaterial("aircraft-trail-material", scene);
    trail.disableLighting = true;
    const terrain = new StandardMaterial("terrain-surface-texture-terrain-forest-humus-material", scene);
    const multi = new MultiMaterial("island-ground-material", scene);
    multi.subMaterials = [terrain];
    const first = CreateBox("first", {}, scene);
    const second = CreateBox("second", {}, scene);
    const pane = CreateBox("pane", {}, scene);
    const loot = CreateBox("loot", {}, scene);
    const aircraft = CreateBox("aircraft", {}, scene);
    const ground = CreateBox("ground", {}, scene);
    first.material = wall;
    second.material = wall;
    pane.material = glass;
    loot.material = marker;
    aircraft.material = trail;
    ground.material = multi;

    const adapter = createUltraMaterialAdapter(scene);
    adapter.convertScene();

    const converted = first.material as PBRMaterial;
    expect(converted).toBeInstanceOf(PBRMaterial);
    expect(second.material).toBe(converted);
    expect(converted.name).toBe(wall.name);
    expect(converted.albedoColor.r).toBeCloseTo(Color3.FromHexString("#808080").toLinearSpace().r, 5);
    expect(converted.metallic).toBe(0);
    expect(scene.materials).not.toContain(wall);
    const texture = new Texture(null, scene);
    wall.diffuseTexture = texture;
    wall.useAlphaFromDiffuseTexture = true;
    expect(converted.albedoTexture).toBe(texture);
    expect(converted.useAlphaFromAlbedoTexture).toBe(true);

    const convertedGlass = pane.material as PBRMaterial;
    expect(convertedGlass.alpha).toBeCloseTo(0.16, 5);
    expect(convertedGlass.roughness).toBeLessThan(0.1);
    expect(convertedGlass.useRadianceOverAlpha).toBe(true);
    expect(loot.material).toBe(marker);
    expect(aircraft.material).toBe(trail);
    const convertedTerrain = multi.subMaterials[0] as PBRMaterial;
    expect(convertedTerrain).toBeInstanceOf(PBRMaterial);
    expect(convertedTerrain.albedoColor.r).toBeGreaterThan(1);
    expect(convertedTerrain.pluginManager?.getPlugin("UltraGammaVertexColor")).toBeTruthy();

    const runtime = new StandardMaterial("loot-model-death-material-medkit", scene);
    const runtimeTarget = adapter.adapt(runtime);
    expect(runtimeTarget).toBeInstanceOf(PBRMaterial);
    expect(adapter.adapt(runtime)).toBe(runtimeTarget);
    expect(adapter.adapt(runtimeTarget)).toBe(runtimeTarget);
    expect(scene.materials).not.toContain(runtime);
    expect(adapter.adapt(marker)).toBe(marker);

    scene.dispose();
    engine.dispose();
  });
});
