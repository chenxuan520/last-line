import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Frustum } from "@babylonjs/core/Maths/math.frustum";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Scene } from "@babylonjs/core/scene";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addSkyOcclusion, createShadowOnlyLight, filterStaticShadowCasters, ULTRA_ACTOR_SHADOW_NAME, ULTRA_SKY_OCCLUSION_NAME } from "../../src/client/render/UltraLightingPresentation";
import { createSurfaceNormalCache } from "../../src/client/render/UltraPresentation";

describe("ultra rendering work reuse", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("reuses concurrent normal derivation while keeping UV variants, late binds and disposal safe", async () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const close = vi.fn();
    const decode = vi.fn(async () => ({ close }));
    vi.stubGlobal("createImageBitmap", decode);
    vi.stubGlobal("OffscreenCanvas", class {
      getContext(): unknown {
        return { drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(256 * 256 * 4).fill(128) }) };
      }
    });
    const bind = createSurfaceNormalCache(scene);
    const payload = new ArrayBuffer(4);
    const sources = Array.from({ length: 4 }, () => {
      const texture = new Texture(null, scene);
      texture.name = "texture.terrain.concrete-urban";
      return texture;
    });
    sources[2]!.uScale = sources[2]!.vScale = 3;
    const materials = sources.map((source) => {
      const material = new StandardMaterial("surface", scene);
      material.diffuseTexture = source;
      return material;
    });
    const converted = new PBRMaterial("converted", scene);
    converted.albedoTexture = sources[1]!;
    for (const source of sources.slice(0, 3)) vi.spyOn(source, "isReady").mockReturnValue(true);
    await Promise.all(sources.map((source) => bind(source, payload)));
    expect(decode).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(materials[0]!.bumpTexture).toBeTruthy();
    expect(materials[1]!.bumpTexture).toBe(materials[0]!.bumpTexture);
    expect(converted.bumpTexture).toBe(materials[0]!.bumpTexture);
    expect(materials[2]!.bumpTexture).not.toBe(materials[0]!.bumpTexture);
    expect(materials[2]!.bumpTexture).toMatchObject({ uScale: 3, vScale: 3 });
    expect(materials[3]!.bumpTexture).toBeNull();
    sources[3]!.onLoadObservable.notifyObservers(sources[3]!);
    expect(materials[3]!.bumpTexture).toBe(materials[0]!.bumpTexture);
    expect(scene.textures.filter((texture) => texture.name.endsWith(".normal"))).toHaveLength(2);
    decode.mockRejectedValueOnce(new Error("decode failure"));
    await bind(sources[0]!, new ArrayBuffer(1));
    expect(scene.textures.filter((texture) => texture.name.endsWith(".normal"))).toHaveLength(2);
    let release!: (value: { close: typeof close }) => void;
    decode.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const pending = bind(sources[0]!, new ArrayBuffer(2));
    scene.dispose();
    release({ close });
    await pending;
    expect(close).toHaveBeenCalledTimes(2);
    expect(scene.textures).toHaveLength(0);
    engine.dispose();
  });

  it("keeps the same compiled effect when actor shadow sampling becomes active and empty again", async () => {
    const engine = new NullEngine();
    engine._features.supportShadowSamplers = true;
    const scene = new Scene(engine);
    const camera = new FreeCamera("camera", new Vector3(0, 1, -5), scene);
    camera.setTarget(Vector3.Zero());
    const mesh = CreateBox("receiver", {}, scene);
    const material = new PBRMaterial("receiver", scene);
    mesh.material = material; mesh.receiveShadows = true;
    const sun = new DirectionalLight("sun", new Vector3(1, -1, 1), scene);
    const actor = createShadowOnlyLight(ULTRA_ACTOR_SHADOW_NAME, sun.direction.clone(), scene, "actor");
    const sky = createShadowOnlyLight(ULTRA_SKY_OCCLUSION_NAME, new Vector3(0.01, -1, 0), scene, "sky");
    for (const light of [sun, actor, sky]) {
      const generator = new ShadowGenerator(32, light);
      generator.usePercentageCloserFiltering = true;
      generator.getShadowMap()!.renderList = [];
    }
    addSkyOcclusion(material);
    await material.forceCompilationAsync(mesh);
    scene.render();
    const effect = mesh.subMeshes![0]!.effect;
    expect(effect).toBeTruthy();
    expect(effect!._fragmentSourceCode).toContain("ultraActorShadowActive > 0.5");
    expect(effect!._fragmentSourceCode).toContain("else { shadow = 1.0; }");
    expect(effect!.defines).toContain("#define ULTRA_ACTOR_SHADOW_LIGHT1");
    expect(effect!.defines).toContain("#define ULTRA_SHADOW_ONLY_LIGHT1");
    expect(effect!.defines).toContain("#define ULTRA_SHADOW_ONLY_LIGHT2");
    expect(effect!.defines).not.toContain("#define ULTRA_SHADOW_ONLY_LIGHT0");
    expect(effect!._fragmentSourceCode).toContain("info.clearCoat = vec4(0.0, 0.0, 0.0, 1.0);");
    const plugin = material.pluginManager!.getPlugin("UltraSkyOcclusion")!;
    const buffer = new UniformBuffer(engine);
    buffer.bindToEffect(effect!, "Material");
    const active = vi.spyOn(buffer, "updateFloat");
    const map = actor.getShadowGenerator()!.getShadowMap()!;
    for (const casters of [[], [mesh], []]) {
      map.renderList = casters;
      scene.render();
      plugin.bindForSubMesh(buffer, scene, engine, mesh.subMeshes![0]!);
      expect(active).toHaveBeenLastCalledWith("ultraActorShadowActive", casters.length ? 1 : 0);
      expect(mesh.subMeshes![0]!.effect).toBe(effect);
      expect(actor.isEnabled()).toBe(true);
    }
    const alternate = mesh.clone("alternate")!;
    alternate.lightSources.splice(0, 2, actor, sun);
    alternate._markSubMeshesAsLightDirty();
    await material.forceCompilationAsync(alternate);
    scene.render();
    const alternateEffect = alternate.subMeshes![0]!.effect;
    expect(alternate.geometry).toBe(mesh.geometry);
    expect(alternateEffect).toBeTruthy();
    expect(alternateEffect).not.toBe(effect);
    expect(alternateEffect!.defines).toContain("#define ULTRA_ACTOR_SHADOW_LIGHT0");
    expect(alternateEffect!.defines).not.toContain("#define ULTRA_ACTOR_SHADOW_LIGHT1");
    expect(alternateEffect!.defines).toContain("#define ULTRA_SHADOW_ONLY_LIGHT0");
    expect(alternateEffect!.defines).not.toContain("#define ULTRA_SHADOW_ONLY_LIGHT1");
    mesh.lightSources.splice(0, 2, actor, sun);
    mesh._markSubMeshesAsLightDirty();
    scene.render();
    expect(mesh.subMeshes![0]!.effect).toBe(alternateEffect);
    const unrelated = new DirectionalLight(ULTRA_ACTOR_SHADOW_NAME, sun.direction.clone(), scene);
    unrelated.intensity = 0;
    alternate.lightSources.splice(0, 1, unrelated);
    alternate._markSubMeshesAsLightDirty();
    await material.forceCompilationAsync(alternate);
    scene.render();
    expect(alternate.subMeshes![0]!.effect!.defines).not.toContain("#define ULTRA_SHADOW_ONLY_LIGHT0");
    expect(alternate.subMeshes![0]!.effect!.defines).toContain("#define ULTRA_SHADOW_ONLY_LIGHT2");
    buffer.dispose(); scene.dispose(); engine.dispose();
  });

  it("identifies shadow roles by factory identity despite renaming and colliding external light names", async () => {
    const engine = new NullEngine();
    engine._features.supportShadowSamplers = true;
    const scene = new Scene(engine);
    const camera = new FreeCamera("camera", new Vector3(0, 1, -5), scene);
    camera.setTarget(Vector3.Zero());
    const mesh = CreateBox("receiver", {}, scene);
    const material = new PBRMaterial("receiver", scene);
    mesh.material = material;
    mesh.receiveShadows = true;
    const direction = new Vector3(1, -1, 1);
    const externalActor = new DirectionalLight(ULTRA_ACTOR_SHADOW_NAME, direction.clone(), scene);
    const externalSky = new DirectionalLight(ULTRA_SKY_OCCLUSION_NAME, direction.clone(), scene);
    externalActor.intensity = externalSky.intensity = 0;
    const actor = createShadowOnlyLight("renamed-actor", direction.clone(), scene, "actor");
    const sky = createShadowOnlyLight("renamed-sky", direction.clone(), scene, "sky");
    const buffer = new UniformBuffer(engine);
    try {
      for (const light of [externalActor, externalSky, actor, sky]) {
        const generator = new ShadowGenerator(32, light);
        generator.usePercentageCloserFiltering = true;
        generator.getShadowMap()!.renderList = light === actor ? [] : [mesh];
      }
      addSkyOcclusion(material);
      await material.forceCompilationAsync(mesh);
      scene.render();
      const effect = mesh.subMeshes![0]!.effect!;
      expect(effect.defines).toContain("#define ULTRA_ACTOR_SHADOW_LIGHT2");
      expect(effect.defines).toContain("#define ULTRA_SHADOW_ONLY_LIGHT2");
      expect(effect.defines).toContain("#define ULTRA_SHADOW_ONLY_LIGHT3");
      expect(effect.defines).not.toContain("#define ULTRA_ACTOR_SHADOW_LIGHT0");
      expect(effect.defines).not.toContain("#define ULTRA_SHADOW_ONLY_LIGHT0");
      expect(effect.defines).not.toContain("#define ULTRA_SHADOW_ONLY_LIGHT1");
      const plugin = material.pluginManager!.getPlugin("UltraSkyOcclusion")!;
      const indices = vi.spyOn(buffer, "updateFloat2");
      const active = vi.spyOn(buffer, "updateFloat");
      buffer.bindToEffect(effect, "Material");
      plugin.bindForSubMesh(buffer, scene, engine, mesh.subMeshes![0]!);
      expect(indices).toHaveBeenLastCalledWith("ultraShadowIndices", 2, 3);
      expect(active).toHaveBeenLastCalledWith("ultraActorShadowActive", 0);
      actor.getShadowGenerator()!.getShadowMap()!.renderList = [mesh];
      scene.render();
      plugin.bindForSubMesh(buffer, scene, engine, mesh.subMeshes![0]!);
      expect(active).toHaveBeenLastCalledWith("ultraActorShadowActive", 1);
      expect(mesh.subMeshes![0]!.effect).toBe(effect);
      actor.setEnabled(false);
      sky.setEnabled(false);
      await material.forceCompilationAsync(mesh);
      scene.render();
      const externalEffect = mesh.subMeshes![0]!.effect!;
      expect(externalEffect.defines).not.toContain("#define ULTRA_ACTOR_SHADOW_LIGHT");
      expect(externalEffect.defines).not.toContain("#define ULTRA_SHADOW_ONLY_LIGHT");
      plugin.bindForSubMesh(buffer, scene, engine, mesh.subMeshes![0]!);
      expect(indices).toHaveBeenLastCalledWith("ultraShadowIndices", -1, -1);
      expect(active).toHaveBeenLastCalledWith("ultraActorShadowActive", 0);
    } finally {
      buffer.dispose(); scene.dispose(); engine.dispose();
    }
  });

  it("culls only outside the light volume and restores distant casters after moving the cached shadow tile", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const camera = new FreeCamera("camera", new Vector3(0, 0, -5), scene);
    camera.setTarget(Vector3.Zero());
    const sun = new DirectionalLight("sun", new Vector3(0.01, -1, 0), scene);
    sun.position.set(0, 100, 0);
    sun.shadowFrustumSize = 32; sun.shadowMinZ = 1; sun.shadowMaxZ = 200;
    const shadow = new ShadowGenerator(32, sun);
    shadow.normalBias = 0.06;
    const center = CreateBox("center", {}, scene);
    const behindCamera = CreateBox("behind-camera", {}, scene);
    behindCamera.position.set(0, 0, -12);
    const boundary = CreateBox("boundary", { size: 4 }, scene);
    boundary.position.set(17, 0, 0);
    const distant = CreateBox("distant", {}, scene);
    distant.position.set(80, 0, 0);
    const batch = CreateBox("large-batch", { width: 200 }, scene);
    const biasedEdge = CreateBox("biased-edge", { size: 0.01 }, scene);
    const edge = Frustum.GetPlanes(shadow.getTransformMatrix()).find((plane) => Math.abs(plane.normal.x) > 0.9)!;
    biasedEdge.position.x = -edge.d / edge.normal.x - Math.sign(edge.normal.x) * 0.025;
    biasedEdge.computeWorldMatrix(true);
    expect(biasedEdge.getBoundingInfo().boundingBox.isInFrustum(Frustum.GetPlanes(shadow.getTransformMatrix()))).toBe(false);
    const original = [center, behindCamera, boundary, distant, batch, biasedEdge];
    const map = shadow.getShadowMap()!;
    map.renderList = [...original];
    filterStaticShadowCasters(shadow);
    const dirty = vi.spyOn(center, "_markSubMeshesAsLightDirty");
    const selected = (): string[] => map.getCustomRenderList!(0, map.renderList, map.renderList!.length)!.map((mesh) => mesh.name);
    scene.render();
    expect(selected()).toEqual([center, behindCamera, boundary, batch, biasedEdge].map((mesh) => mesh.name));
    const prepare = vi.spyOn(center, "computeWorldMatrix");
    for (let i = 0; i < 3; i += 1) {
      scene.incrementRenderId();
      map.onBeforeRenderObservable.notifyObservers(0);
    }
    expect(prepare).not.toHaveBeenCalled();
    sun.position.x = 80; map.resetRefreshCounter();
    scene.render();
    expect(selected()).toEqual([distant, batch].map((mesh) => mesh.name));
    sun.position.x = 0; sun.position.y = 108; map.resetRefreshCounter();
    scene.render();
    expect(selected()).toEqual([center, behindCamera, boundary, batch, biasedEdge].map((mesh) => mesh.name));
    expect([...map.renderList!]).toEqual(original);
    expect(dirty).not.toHaveBeenCalled();
    expect(original).toHaveLength(6);
    scene.dispose(); engine.dispose();
  });
});
