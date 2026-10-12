import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { createMapLayout } from "../../src/config/map";
import { createRoadSurfacePixels } from "../../src/client/render/UltraTerrainPresentation";
import { describe, expect, it } from "vitest";
import { createUltraMaterialAdapter } from "../../src/client/render/UltraLightingPresentation";
import { bindGeneratedSurfaceNormal, surfaceNormalPixels } from "../../src/client/render/UltraPresentation";

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

  it("binds generated normals onto standard materials before PBR conversion", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const source = new Texture(null, scene);
    const normal = new Texture(null, scene);
    const wall = new StandardMaterial("building-material", scene);
    wall.diffuseTexture = source;
    const mesh = CreateBox("wall", {}, scene);
    mesh.material = wall;

    bindGeneratedSurfaceNormal(scene, source, normal);
    expect(wall.bumpTexture).toBe(normal);

    const adapter = createUltraMaterialAdapter(scene);
    adapter.convertScene();
    const converted = mesh.material as PBRMaterial;
    expect(converted).toBeInstanceOf(PBRMaterial);
    expect(converted.bumpTexture).toBe(normal);

    const later = new Texture(null, scene);
    const lateNormal = new Texture(null, scene);
    const already = new PBRMaterial("already-converted", scene);
    already.albedoTexture = later;
    bindGeneratedSurfaceNormal(scene, later, lateNormal);
    expect(already.bumpTexture).toBe(lateNormal);

    scene.dispose();
    engine.dispose();
  });
});

describe("ultra PBR material adapter", () => {
  it("isolates ground loot fill from matching world shader cache entries with and without vertex colors", async () => {
    for (const vertexColors of [true, false]) {
      const engine = new NullEngine();
      const scene = new Scene(engine);
      const camera = new FreeCamera("camera", new Vector3(0, 0, -4), scene);
      camera.setTarget(Vector3.Zero());
      const loot = CreateBox("loot", {}, scene);
      const floor = CreateBox("floor", {}, scene);
      for (const mesh of [loot, floor]) {
        if (vertexColors) mesh.setVerticesData("color", new Float32Array(mesh.getTotalVertices() * 4).fill(0.5));
        mesh.material = new StandardMaterial(mesh === loot ? "loot-model-material-armor-1" : "building-floor-material", scene);
      }
      const adapter = createUltraMaterialAdapter(scene);
      adapter.convertScene();
      const lootMaterial = loot.material as PBRMaterial;
      const floorMaterial = floor.material as PBRMaterial;
      await lootMaterial.forceCompilationAsync(loot);
      await floorMaterial.forceCompilationAsync(floor);
      scene.render();
      const lootEffect = loot.subMeshes![0]!.effect;
      const floorEffect = floor.subMeshes![0]!.effect;
      expect(lootEffect).toBeTruthy();
      expect(floorEffect).toBeTruthy();
      expect(lootEffect).not.toBe(floorEffect);
      expect(lootEffect!.defines).toContain("#define ULTRA_LOOT_FILL");
      expect(floorEffect!.defines).not.toContain("#define ULTRA_LOOT_FILL");
      scene.dispose(); engine.dispose();
    }
  });

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

describe("ultra continuous roads", () => {
  it("covers diagonal roads and junctions with filtered edges without changing the layout", () => {
    const layout = { ...createMapLayout("town", 7),
      roadSegments: [[-100, -100, 100, 100], [-100, 100, 100, -100], [200, 200, 200, 200]] as const,
    };
    const before = JSON.stringify(layout);
    const size = 2_048;
    const pixels = createRoadSurfacePixels(layout, size);
    const sample = (x: number, z: number, channel = 0): number => {
      const px = Math.floor((x / 2_400 + 0.5) * size);
      const pz = Math.floor((z / 2_400 + 0.5) * size);
      return pixels[(pz * size + px) * 2 + channel]!;
    };
    expect(sample(0, 0)).toBe(255);
    expect(sample(50, 50)).toBe(255);
    expect(sample(50, -50)).toBe(255);
    expect(sample(0, 20)).toBe(0);
    expect(sample(200, 200)).toBe(0);
    expect(sample(50, 57, 1)).toBeGreaterThan(sample(50, 57));
    expect(pixels.some((coverage) => coverage > 0 && coverage < 255)).toBe(true);
    expect(JSON.stringify(layout)).toBe(before);
    expect(Buffer.from(createRoadSurfacePixels(layout, size)).equals(Buffer.from(pixels))).toBe(true);
  });
});
