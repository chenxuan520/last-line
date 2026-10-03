import { Constants } from "@babylonjs/core/Engines/constants";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import type { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import type { Material } from "@babylonjs/core/Materials/material";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Frustum } from "@babylonjs/core/Maths/math.frustum";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { CubeMapToSphericalPolynomialTools } from "@babylonjs/core/Misc/HighDynamicRange/cubemapToSphericalPolynomial";
import { ReflectionProbe } from "@babylonjs/core/Probes/reflectionProbe";
import { BloomEffect } from "@babylonjs/core/PostProcesses/bloomEffect";
import { ImageProcessingPostProcess } from "@babylonjs/core/PostProcesses/imageProcessingPostProcess";
import type { SSAO2RenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline";
import { PostProcessRenderEffect } from "@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderEffect";
import { PostProcessRenderPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipeline";
import "@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent";
import { Scene } from "@babylonjs/core/scene";
import type { Nullable } from "@babylonjs/core/types";
import { usesMobileDevicePixels } from "../../config/settings";
import type { EntityId } from "../../game/state/types";
import { ULTRA_PRESENTATION } from "../../config/ultraPresentation";
import { addSsaoDistanceOptimization } from "./UltraSsaoOptimization";
import { registerStaticUniformVertexColors, usesUniformVertexColors } from "./UltraVertexColorOptimization";

export const ULTRA_SHADOW_MAP_NAME = "ultra-town-static-shadows";
export const ULTRA_ENVIRONMENT_NAME = "ultra-sky-environment";
export const ULTRA_PIPELINE_NAME = "ultra-pipeline";
export const ULTRA_SSAO_NAME = "ultra-ssao";
export const ULTRA_ACTOR_SHADOW_DISTANCE = ULTRA_PRESENTATION.actorShadowDistance;
export const ULTRA_ACTOR_SHADOW_NAME = "ultra-actor-shadows";
export const ULTRA_SKY_OCCLUSION_NAME = "ultra-sky-occlusion";
const ULTRA_INDOOR_SKY_LIGHT = 0.45;
const SKY_OCCLUSION_DETAIL_TYPES = new Set(["floor-slabs", "roof-slabs", "hospital-surfaces", "ammunition-depot-surfaces"]);
const SHADOW_TILE_SIZE = 8;
const SHADOW_ONLY_LIGHTS = new WeakSet<DirectionalLight>();
const ACTOR_SLOT_DEFINES = ["ULTRA_ACTOR_SHADOW_LIGHT0", "ULTRA_ACTOR_SHADOW_LIGHT1", "ULTRA_ACTOR_SHADOW_LIGHT2", "ULTRA_ACTOR_SHADOW_LIGHT3"] as const;
const SHADOW_ONLY_SLOT_DEFINES = ["ULTRA_SHADOW_ONLY_LIGHT0", "ULTRA_SHADOW_ONLY_LIGHT1", "ULTRA_SHADOW_ONLY_LIGHT2", "ULTRA_SHADOW_ONLY_LIGHT3"] as const;

// 此模块自有的遮挡灯始终为零强度；仅凭名称不允许跳过其他灯的光照。
export function createShadowOnlyLight(name: string, direction: Vector3, scene: Scene): DirectionalLight {
  const light = new DirectionalLight(name, direction, scene);
  light.intensity = 0;
  SHADOW_ONLY_LIGHTS.add(light);
  return light;
}
const SKY_FOG_COLORS: Readonly<Record<string, readonly [number, number, number]>> = {
  "texture.sky.clearing": [0.64, 0.68, 0.71],
  "texture.sky.overcast": [0.56, 0.59, 0.60],
  "texture.sky.storm": [0.47, 0.51, 0.53],
};
// 这些材质属于 HUD 式标记或碰撞辅助体，保持原有不受环境光影响的读法。
const STANDARD_MATERIAL_NAMES = new Set([
  "loot-marker-material",
  "death-loot-marker-material",
  "player-hitbox-material",
]);
const STATIC_SHADOW_DETAIL_TYPES = new Set(["floor-slabs", "roof-slabs", "hospital-surfaces", "ammunition-depot-surfaces"]);
const STATIC_SHADOW_DECORATIONS = new Set(["roof-ramp", "vegetation", "cover-prop", "poi"]);

export interface UltraMaterialAdapter {
  adapt(material: Material): Material;
  convertScene(): void;
}

export interface UltraLightingOptions {
  sun: DirectionalLight;
  ambient: HemisphericLight;
  actorVisualRoots: ReadonlyMap<EntityId, TransformNode>;
  localActorId: EntityId;
  materials: UltraMaterialAdapter;
}

export function prefersTouchPresentation(): boolean {
  const matchMedia = typeof globalThis.matchMedia === "function" ? globalThis.matchMedia.bind(globalThis) : undefined;
  return usesMobileDevicePixels(matchMedia);
}

type SSAO2Pipeline = typeof SSAO2RenderingPipeline;

export async function enhanceLighting(scene: Scene, options: UltraLightingOptions): Promise<void> {
  const touch = prefersTouchPresentation();
  // SSAO2 与 Babylon 核心共享 pass 后处理；按需加载才能保持入口 chunk 不被拆散。失败时只放弃环境光遮蔽。
  const ssao = touch
    ? null
    : await import("@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline")
      .then((module) => module.SSAO2RenderingPipeline, () => null);
  if (scene.isDisposed) return;
  options.materials.convertScene();
  options.sun.intensity = 3.4;
  options.sun.diffuse.set(1, 0.93, 0.82);
  options.ambient.intensity = 0.95;
  scene.environmentIntensity = 1.25;
  configureFog(scene);
  createPostProcessing(scene, touch, ssao);
  createSkyEnvironment(scene, options.ambient);
  createShadows(scene, options, touch);
  warmUpDeferredMaterials(scene, options.actorVisualRoots);
}

// 角色与第一人称武器在飞行阶段隐藏；预渲染变体编译较慢，首次出现时会只见阴影不见网格，所以提前异步编译。
function warmUpDeferredMaterials(scene: Scene, actorVisualRoots: ReadonlyMap<EntityId, TransformNode>): void {
  const meshes = [
    ...[...actorVisualRoots.values()].flatMap((root) => root.getChildMeshes(false)),
    ...(scene.getTransformNodeByName("view-weapon-root")?.getChildMeshes(false) ?? []),
  ];
  const compiled = new Set<Material>();
  for (const mesh of meshes) {
    const material = mesh.material;
    if (!material || compiled.has(material) || mesh.getTotalVertices() === 0) continue;
    compiled.add(material);
    void material.forceCompilationAsync(mesh).catch(() => undefined);
  }
}

// 物资标记会在运行时换材质，因此构建期与运行期共享同一份 Standard→PBR 映射。
export function createUltraMaterialAdapter(scene: Scene): UltraMaterialAdapter {
  const converted = new Map<StandardMaterial, PBRMaterial>();
  let sceneConverted = false;
  const adapt = (material: Material): Material => {
    if (!(material instanceof StandardMaterial) || keepsStandardMaterial(material)) return material;
    const existing = converted.get(material);
    if (existing) return existing;
    const target = convertStandardMaterial(scene, material);
    converted.set(material, target);
    // 场景转换后才出现的原材质尚未挂到任何网格，可立即释放。
    if (sceneConverted) material.dispose();
    return target;
  };
  scene.onDisposeObservable.addOnce(() => converted.clear());
  return {
    adapt,
    convertScene(): void {
      for (const mesh of scene.meshes) {
        if (mesh instanceof InstancedMesh || !mesh.material) continue;
        if (mesh instanceof Mesh) registerStaticUniformVertexColors(mesh);
        if (mesh.material instanceof MultiMaterial) {
          const multi = mesh.material;
          multi.subMaterials = multi.subMaterials.map((material) => material ? adapt(material) : material);
        } else {
          mesh.material = adapt(mesh.material);
        }
      }
      sceneConverted = true;
      for (const source of converted.keys()) source.dispose();
      for (const material of scene.materials) {
        if (material instanceof PBRMaterial) addSkyOcclusion(material);
      }
    },
  };
}

export function keepsStandardMaterial(material: StandardMaterial): boolean {
  return material.disableLighting || material.alpha < 0.01 || STANDARD_MATERIAL_NAMES.has(material.name);
}

export function pbrSurfaceProfile(material: StandardMaterial): { metallic: number; roughness: number; albedoScale?: number } {
  const key = `${material.name} ${material.diffuseTexture?.name ?? ""}`;
  if (/window|lens/.test(key)) return { metallic: 0, roughness: 0.06 };
  if (key.includes("road-wet")) return { metallic: 0, roughness: 0.16 };
  if (key.includes("wet-shore")) return { metallic: 0, roughness: 0.4 };
  // 枪械钢件是暗色磷化表面；保留原亮度会整片反射天空，看起来像浅色塑料。
  if (key.includes("steel")) return { metallic: 0.8, roughness: 0.46, albedoScale: 0.55 };
  if (/metal|ammunition-depot-surface/.test(key)) return { metallic: 0.5, roughness: 0.56 };
  if (/^weapon-|equipment-detail/.test(material.name)) return { metallic: 0.55, roughness: 0.44 };
  if (/poi-accent|brand-sign-post/.test(key)) return { metallic: 0.25, roughness: 0.62 };
  const specular = Math.max(material.specularColor.r, material.specularColor.g, material.specularColor.b);
  const roughness = Math.max(0.45, Math.min(0.93, 0.93 - specular * 1.3));
  // 针叶、树皮与林地／泥地贴图按旧的 gamma 光照绘制得很深，转到线性空间后会被 ACES 暗部压成黑色。
  if (material.name === "tree-foliage-material") return { metallic: 0, roughness, albedoScale: 2.2 };
  if (material.name === "tree-trunk-material") return { metallic: 0, roughness, albedoScale: 1.5 };
  if (/^terrain-surface-.*(?:forest|mud)/.test(material.name)) return { metallic: 0, roughness, albedoScale: 1.7 };
  return { metallic: 0, roughness };
}

function convertStandardMaterial(scene: Scene, source: StandardMaterial): PBRMaterial {
  const target = new PBRMaterial(source.name, scene);
  source.diffuseColor.toLinearSpaceToRef(target.albedoColor);
  source.emissiveColor.toLinearSpaceToRef(target.emissiveColor);
  target.albedoTexture = source.diffuseTexture;
  target.bumpTexture = source.bumpTexture;
  target.emissiveTexture = source.emissiveTexture;
  target.useAlphaFromAlbedoTexture = source.useAlphaFromDiffuseTexture;
  target.alpha = source.alpha;
  target.transparencyMode = source.transparencyMode;
  target.alphaCutOff = source.alphaCutOff;
  target.backFaceCulling = source.backFaceCulling;
  target.twoSidedLighting = source.twoSidedLighting;
  target.sideOrientation = source.sideOrientation;
  target.zOffset = source.zOffset;
  target.disableDepthWrite = source.disableDepthWrite;
  target.fogEnabled = source.fogEnabled;
  target.maxSimultaneousLights = source.maxSimultaneousLights;
  const { metallic, roughness, albedoScale } = pbrSurfaceProfile(source);
  target.metallic = metallic;
  target.roughness = roughness;
  if (albedoScale !== undefined) target.albedoColor.scaleInPlace(albedoScale);
  const glass = /window|lens/.test(source.name) || source.name.includes("road-wet");
  if (source.alpha < 1 && !glass) {
    // 污渍、标线等半透明贴层只改变底色，不在透明区域叠加完整反射。
    target.useRadianceOverAlpha = false;
    target.useSpecularOverAlpha = false;
  }
  if (source.name.includes("industrial-light")) target.emissiveIntensity = 2.6;
  const groundLoot = /^loot-model-(?:death-material|material)-/.test(source.name);
  // 拾取物保留受光材质，只给暗部补光；死亡色调沿用底色，不能把部件统一洗白。
  if (groundLoot) target.albedoColor.scaleToRef(ULTRA_PRESENTATION.lootFillIntensity, target.emissiveColor);
  new GammaVertexColorPlugin(target, groundLoot);
  addSkyOcclusion(target);
  // 贴图与透明度来源在场景建好后才异步绑定到原材质，这里同步转发到 PBR 材质。
  Object.defineProperty(source, "diffuseTexture", {
    configurable: true,
    get: () => target.albedoTexture,
    set: (texture: Nullable<BaseTexture>) => { target.albedoTexture = texture; },
  });
  Object.defineProperty(source, "useAlphaFromDiffuseTexture", {
    configurable: true,
    get: () => target.useAlphaFromAlbedoTexture,
    set: (value: boolean) => { target.useAlphaFromAlbedoTexture = value; },
  });
  Object.defineProperty(source, "bumpTexture", {
    configurable: true,
    get: () => target.bumpTexture,
    set: (texture: Nullable<BaseTexture>) => { target.bumpTexture = texture; },
  });
  return target;
}

// 按网格实际灯源索引读取两种遮挡，避免依赖灯光在循环中的最后一个位置。
class SkyOcclusionPlugin extends MaterialPluginBase {
  public constructor(material: PBRMaterial) {
    super(material, "UltraSkyOcclusion", 210, {
      ULTRA_ACTOR_SHADOW_LIGHT0: false, ULTRA_ACTOR_SHADOW_LIGHT1: false,
      ULTRA_ACTOR_SHADOW_LIGHT2: false, ULTRA_ACTOR_SHADOW_LIGHT3: false,
      ULTRA_SHADOW_ONLY_LIGHT0: false, ULTRA_SHADOW_ONLY_LIGHT1: false,
      ULTRA_SHADOW_ONLY_LIGHT2: false, ULTRA_SHADOW_ONLY_LIGHT3: false,
    }, true, true);
  }

  public override getClassName(): string {
    return "UltraSkyOcclusionPlugin";
  }

  public override prepareDefines(defines: MaterialDefines, _scene: Scene, mesh: AbstractMesh): void {
    for (let index = 0; index < 4; index += 1) {
      const light = index < (this._material as PBRMaterial).maxSimultaneousLights ? mesh.lightSources[index] : undefined;
      defines[ACTOR_SLOT_DEFINES[index]!] = light?.name === ULTRA_ACTOR_SHADOW_NAME;
      defines[SHADOW_ONLY_SLOT_DEFINES[index]!] = light instanceof DirectionalLight && SHADOW_ONLY_LIGHTS.has(light);
    }
  }

  public override getUniforms(): ReturnType<MaterialPluginBase["getUniforms"]> {
    return {
      ubo: [{ name: "ultraShadowIndices", size: 2, type: "vec2" }, { name: "ultraActorShadowActive", size: 1, type: "float" }],
      fragment: "uniform vec2 ultraShadowIndices; uniform float ultraActorShadowActive;",
    };
  }

  public override bindForSubMesh(buffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, subMesh: SubMesh): void {
    const lights = subMesh.getMesh().lightSources;
    let actorIndex = -1, skyIndex = -1;
    for (let index = 0; index < lights.length; index += 1) {
      if (lights[index]!.name === ULTRA_ACTOR_SHADOW_NAME) actorIndex = index;
      if (lights[index]!.name === ULTRA_SKY_OCCLUSION_NAME) skyIndex = index;
    }
    buffer.updateFloat2("ultraShadowIndices", actorIndex, skyIndex);
    const actorMap = lights[actorIndex]?.getShadowGenerator()?.getShadowMap();
    buffer.updateFloat("ultraActorShadowActive", actorMap?.renderList?.length ? 1 : 0);
  }

  public override getCustomCode(shaderType: string): Nullable<Record<string, string>> {
    if (shaderType !== "fragment") return null;
    const code: Record<string, string> = {
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: "float ultraActorVisibility = 1.0; float ultraSkyOcclusion = 1.0; float ultraLightIndex = -1.0;",
      // 阴影仍执行；完整初始化每个条件字段，防止复用上一盏灯的 lightingInfo。
      "!#elif defined\\(PBR\\)\\n(?=#ifdef SPOTLIGHT([0-3]))": `
#elif defined(PBR) && defined(ULTRA_SHADOW_ONLY_LIGHT$1) && !defined(CUSTOMUSERLIGHTING)
info.diffuse = vec3(0.0);
#ifdef SS_TRANSLUCENCY
info.diffuseTransmission = vec3(0.0);
#endif
#ifdef SPECULARTERM
info.specular = vec3(0.0);
#endif
#ifdef SHEEN
info.sheen = vec3(0.0);
#endif
#ifdef CLEARCOAT
info.clearCoat = vec4(0.0, 0.0, 0.0, 1.0);
#endif
$0`,
      // 保留灯源与 defines，只跳过空角色图；进入投影范围时不用重新编译全场景。
      "!shadow=computeShadowWithPCF[135]\\(vPositionFromLight([0-3]),[^;]+\\);": `
#ifdef ULTRA_ACTOR_SHADOW_LIGHT$1
if (ultraActorShadowActive > 0.5) { $0 }
else { shadow = 1.0; }
#else
$0
#endif
`,
      "!aggShadow\\+=shadow;numLights\\+=1\\.0;": `$0
if (abs(ultraLightIndex - ultraShadowIndices.x) < 0.5) ultraActorVisibility = shadow;
if (abs(ultraLightIndex - ultraShadowIndices.y) < 0.5) ultraSkyOcclusion = shadow;
`,
      CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: `
#if !defined(UNLIT)
finalDiffuse *= ultraActorVisibility;
#ifdef SPECULARTERM
finalSpecularScaled *= ultraActorVisibility;
#endif
#endif
#if !defined(UNLIT) && defined(REFLECTION)
float ultraSkyVisibility = mix(${ULTRA_INDOOR_SKY_LIGHT.toFixed(2)}, 1.0, ultraSkyOcclusion);
finalIrradiance *= ultraSkyVisibility;
finalRadianceScaled *= ultraSkyVisibility;
#endif
`,
    };
    for (let index = 0; index < 4; index += 1) code[`CUSTOM_LIGHT${index}_COLOR`] = `ultraLightIndex = ${index.toFixed(1)};`;
    return code;
  }
}

export function addSkyOcclusion(material: PBRMaterial): void {
  if (!material.pluginManager?.getPlugin("UltraSkyOcclusion")) new SkyOcclusionPlugin(material);
}

// Standard 顶点色使用 gamma 空间；静态且每个三角形 RGB 恒定时提前纠正，否则保留逐像素换算。
class GammaVertexColorPlugin extends MaterialPluginBase {
  public constructor(material: PBRMaterial, private readonly groundLoot = false) {
    super(material, "UltraGammaVertexColor", 200, { ULTRA_LOOT_FILL: false, ULTRA_VERTEX_GAMMA: false }, true, true);
  }

  public override getClassName(): string {
    return "UltraGammaVertexColorPlugin";
  }

  public override prepareDefines(defines: MaterialDefines, _scene: Scene, mesh: AbstractMesh): void {
    defines.ULTRA_LOOT_FILL = this.groundLoot;
    defines.ULTRA_VERTEX_GAMMA = !this.groundLoot && !defines.DECAL && !defines.DETAIL && usesUniformVertexColors(mesh);
  }

  public override getCustomCode(shaderType: string): Nullable<Record<string, string>> {
    if (shaderType === "vertex") return {
      CUSTOM_VERTEX_MAIN_END: `
#if defined(VERTEXCOLOR) && defined(ULTRA_VERTEX_GAMMA)
vColor.rgb *= toLinearSpace(max(vColor.rgb, vec3(0.0001))) / max(vColor.rgb, vec3(0.0001));
#endif
`,
    };
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_UPDATE_ALBEDO: `
#if defined(VERTEXCOLOR) && !defined(ULTRA_VERTEX_GAMMA)
surfaceAlbedo *= toLinearSpace(max(vColor.rgb, vec3(0.0001))) / max(vColor.rgb, vec3(0.0001));
#endif
`,
      // Effect 缓存只按 defines 区分；同类插件必须提供一致源码，再用 define 隔离补光。
      CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: `
#if defined(ULTRA_LOOT_FILL) && defined(VERTEXCOLOR)
finalEmissive = mix(finalEmissive, surfaceAlbedo * ${ULTRA_PRESENTATION.lootFillIntensity.toFixed(2)}, ${(1 - ULTRA_PRESENTATION.lootFillMinimum).toFixed(2)});
#endif
`,
    };
  }
}

function configureFog(scene: Scene): void {
  const skyAssetId = String(scene.getMeshByName("island-sky-dome")?.metadata?.skyAssetId);
  const [r, g, b] = SKY_FOG_COLORS[skyAssetId] ?? SKY_FOG_COLORS["texture.sky.overcast"]!;
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogStart = ULTRA_PRESENTATION.fogStart;
  scene.fogEnd = ULTRA_PRESENTATION.fogEnd;
  scene.fogColor.set(r, g, b);
}

// 色调映射始终由后处理完成，材质与天空探针都输出线性颜色，避免探针内容被重复映射。
function createPostProcessing(scene: Scene, touch: boolean, SSAO2: SSAO2Pipeline | null): void {
  const camera = scene.activeCamera;
  if (!camera) return;
  const engine = scene.getEngine();
  const processing = scene.imageProcessingConfiguration;
  processing.isEnabled = true;
  processing.toneMappingEnabled = true;
  processing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  processing.exposure = 1.55;
  processing.contrast = 1.1;
  processing.ditheringEnabled = true;
  processing.vignetteEnabled = false;
  const previousPasses = new Set(camera._postProcesses);
  const ssao = !touch && SSAO2?.IsSupported
    ? new SSAO2(ULTRA_SSAO_NAME, scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, [camera], false, Constants.TEXTURETYPE_HALF_FLOAT)
    : null;
  if (ssao) {
    ssao.radius = 2;
    ssao.totalStrength = 2.2;
    ssao.base = 0.02;
    ssao.samples = 8;
    ssao.maxZ = 90;
    ssao.expensiveBlur = false;
    // 启用 SSAO 后场景先渲染到预渲染目标，多重采样由它承担。
    ssao.textureSamples = 4;
    const pass = camera._postProcesses.find((process) => process?.name === "ssao" && !previousPasses.has(process));
    if (pass) addSsaoDistanceOptimization(pass);
  }
  const textureType = !touch && engine.getCaps().textureHalfFloatRender
    ? Constants.TEXTURETYPE_HALF_FLOAT
    : Constants.TEXTURETYPE_UNSIGNED_BYTE;
  const pipeline = new PostProcessRenderPipeline(engine, ULTRA_PIPELINE_NAME);
  const bloom = touch ? null : new BloomEffect(scene, 0.25, 0.12, 24, textureType, false);
  if (bloom) {
    bloom.threshold = 0.9;
    pipeline.addEffect(bloom);
  }
  const imageProcessing = new ImageProcessingPostProcess(
    "ultra-image-processing",
    1,
    null,
    Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
    engine,
    false,
    textureType,
    processing,
  );
  pipeline.addEffect(new PostProcessRenderEffect(engine, "ultra-image-processing", () => imageProcessing, true));
  scene.postProcessRenderPipelineManager.addPipeline(pipeline);
  scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline(ULTRA_PIPELINE_NAME, camera);
  if (!ssao) {
    // 后处理接管主画面后，画布自带的多重采样失效，由第一个后处理输入纹理承担。
    const first = bloom?.getPostProcesses(camera)?.[0] ?? imageProcessing;
    first.samples = 4;
  }
  scene.onDisposeObservable.addOnce(() => {
    scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline(ULTRA_PIPELINE_NAME, camera);
    bloom?.disposeEffects(camera);
    imageProcessing.dispose(camera);
    pipeline.dispose();
    ssao?.dispose();
  });
}

// 探针只渲染当前天空穹顶，镜面反射与可见天空一致；球谐在挂载前算好，避免材质等待期间隐藏网格。
function createSkyEnvironment(scene: Scene, ambient: HemisphericLight): void {
  const sky = scene.getMeshByName("island-sky-dome");
  const skyTexture = scene.textures.find((texture) => texture.name === sky?.metadata?.skyAssetId);
  if (!sky || !skyTexture) return;
  whenTextureReady(scene, skyTexture, () => {
    const skyMaterial = sky.material as { diffuseTexture?: Nullable<BaseTexture> } | null;
    if (!skyMaterial?.diffuseTexture) return;
    const probe = new ReflectionProbe(ULTRA_ENVIRONMENT_NAME, 256, scene, true, true, true);
    probe.renderList!.push(sky);
    probe.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    const cube = probe.cubeTexture;
    // 场景只会渲染材质直接引用的探针；挂载环境前需要显式加入一次渲染目标。
    scene.customRenderTargets.push(cube);
    const observer = cube.onAfterRenderObservable.add((face) => {
      if (face !== 5) return;
      cube.onAfterRenderObservable.remove(observer);
      scene.onAfterRenderObservable.addOnce(() => {
        const index = scene.customRenderTargets.indexOf(cube);
        if (index !== -1) scene.customRenderTargets.splice(index, 1);
      });
      void CubeMapToSphericalPolynomialTools.ConvertCubeMapTextureToSphericalPolynomial(cube)
        ?.then((polynomial) => {
          if (scene.isDisposed || !polynomial) return;
          cube.sphericalPolynomial = polynomial;
          scene.environmentTexture = cube;
          ambient.setEnabled(false);
        })
        .catch(() => undefined);
    });
  });
}

function whenTextureReady(scene: Scene, texture: BaseTexture, run: () => void): void {
  const runIfLoaded = (): void => {
    if (!scene.isDisposed && !texture.loadingError && texture.isReady()) run();
  };
  if (texture.isReady()) {
    runIfLoaded();
    return;
  }
  const loadable = texture as BaseTexture & { onLoadObservable?: { addOnce(callback: () => void): unknown } };
  loadable.onLoadObservable?.addOnce(runIfLoaded);
}

function sameIds(left: readonly EntityId[], right: readonly EntityId[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

// 建筑包含真实开口；不使用整栋盒状代理，避免把门窗和楼梯投成实心阴影。
function isStaticShadowCaster(mesh: AbstractMesh): boolean {
  if (mesh.metadata?.actorId || mesh.metadata?.decoration === "ultra-town-detail") return false;
  return mesh.name.startsWith("building-walls-") ||
    STATIC_SHADOW_DETAIL_TYPES.has(mesh.metadata?.detailType) ||
    STATIC_SHADOW_DECORATIONS.has(mesh.metadata?.decoration) ||
    (mesh.metadata?.decoration === "natural-detail" && mesh.metadata?.detailType === "rock");
}

// 以光源视锥而非相机视锥裁剪，保留离屏但能投影入图的物体与跨界大批次。
export function filterStaticShadowCasters(generator: ShadowGenerator): void {
  const light = generator.getLight();
  if (!(light instanceof DirectionalLight) || light.shadowFrustumSize <= 0) return;
  const map = generator.getShadowMap()!;
  const casters = [...map.renderList!];
  const planes = Frustum.GetPlanes(Matrix.Identity());
  const lastTransform = Matrix.Zero();
  const visible = [...casters];
  let matrixVersion = -1;
  let lastMargin = Number.NaN;
  // renderList 保留全量且不改 RTT hook 过的数组，避免跨分区把全场景灯光标为 dirty。
  map.getCustomRenderList = () => visible;
  // 此 observer 排在生成器矩阵更新之后；重复 readiness 检查复用相同光矩阵的列表。
  map.onBeforeRenderObservable.add(() => {
    const transform = generator.getTransformMatrix();
    const camera = light.getScene().activeCamera;
    const depthSpan = Math.abs((light.shadowMaxZ ?? camera?.maxZ ?? 0) - (light.shadowMinZ ?? camera?.minZ ?? 0));
    // 投影顶点带法线／深度偏移，另留两个 texel，不能用未偏移的几何边缘精确裁切。
    const margin = Math.abs(generator.normalBias) + Math.abs(generator.bias) * depthSpan +
      2 * light.shadowFrustumSize / map.getSize().width;
    // Babylon 可能在新 renderId 重写数值相同的矩阵，updateFlag 本身不是内容版本。
    if (margin === lastMargin && (transform.updateFlag === matrixVersion || transform.equals(lastTransform))) {
      matrixVersion = transform.updateFlag;
      return;
    }
    matrixVersion = transform.updateFlag; lastMargin = margin;
    lastTransform.copyFrom(transform);
    Frustum.GetPlanesToRef(transform, planes);
    for (const plane of planes) plane.d += margin;
    visible.length = 0;
    for (const mesh of casters) {
      mesh.computeWorldMatrix();
      const box = mesh.getBoundingInfo().boundingBox;
      const min = box.minimumWorld, max = box.maximumWorld;
      const reliable = Number.isFinite(min.x + min.y + min.z + max.x + max.y + max.z);
      if (!reliable || box.isInFrustum(planes)) visible.push(mesh);
    }
  });
}

// 静态图仅跨分区刷新；桌面角色使用独立小图，逐帧只绘制附近角色。
function createShadows(scene: Scene, options: UltraLightingOptions, touch: boolean): void {
  const { sun, actorVisualRoots, localActorId } = options;
  sun.shadowFrustumSize = touch ? 192 : ULTRA_PRESENTATION.staticShadowSpan;
  sun.shadowMinZ = 1;
  sun.shadowMaxZ = touch ? 400 : 560;
  const shadows = new ShadowGenerator(ULTRA_PRESENTATION.staticShadowSize, sun);
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = touch ? ShadowGenerator.QUALITY_LOW : ShadowGenerator.QUALITY_MEDIUM;
  shadows.bias = touch ? 0.0004 : 0.0003;
  shadows.normalBias = 0.06;
  shadows.setDarkness(0);
  const shadowMap = shadows.getShadowMap()!;
  shadowMap.name = ULTRA_SHADOW_MAP_NAME;
  shadowMap.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
  const staticCasters = scene.meshes.filter(isStaticShadowCaster);
  shadowMap.renderList = [...staticCasters];
  filterStaticShadowCasters(shadows);

  // 只写楼板与屋顶的俯视遮挡图，光强为 0，不照亮任何表面，只给环境光提供室内判断。
  const sky = createShadowOnlyLight(ULTRA_SKY_OCCLUSION_NAME, new Vector3(0.0001, -1, 0.0001), scene);
  sky.diffuse.set(0, 0, 0);
  sky.specular.set(0, 0, 0);
  sky.renderPriority = -1;
  sky.shadowFrustumSize = sun.shadowFrustumSize;
  sky.shadowMinZ = 1;
  sky.shadowMaxZ = 320;
  const skyShadows = new ShadowGenerator(touch ? 512 : 1024, sky);
  skyShadows.usePercentageCloserFiltering = true;
  skyShadows.filteringQuality = ShadowGenerator.QUALITY_LOW;
  skyShadows.bias = 0.002;
  skyShadows.setDarkness(0);
  const skyMap = skyShadows.getShadowMap()!;
  skyMap.name = ULTRA_SKY_OCCLUSION_NAME;
  skyMap.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
  skyMap.renderList = scene.meshes.filter((mesh) =>
    SKY_OCCLUSION_DETAIL_TYPES.has(mesh.metadata?.detailType) || mesh.metadata?.decoration === "roof-ramp");
  filterStaticShadowCasters(skyShadows);

  const receivers = [
    ...[...actorVisualRoots.values()].flatMap((root) => root.getChildMeshes(false)),
    ...(scene.getTransformNodeByName("view-weapon-root")?.getChildMeshes(false) ?? []),
  ];
  for (const mesh of receivers) {
    if (mesh instanceof InstancedMesh) mesh.sourceMesh.receiveShadows = true;
    else mesh.receiveShadows = true;
  }

  const actorEntries = touch
    ? []
    : [...actorVisualRoots].filter(([actorId]) => actorId !== localActorId);
  const actorLight = touch ? null : createShadowOnlyLight(ULTRA_ACTOR_SHADOW_NAME, sun.direction.clone(), scene);
  const actorShadows = actorLight ? new ShadowGenerator(ULTRA_PRESENTATION.actorShadowSize, actorLight) : null;
  const actorMap = actorShadows?.getShadowMap() ?? null;
  if (actorLight && actorShadows && actorMap) {
    actorLight.renderPriority = 0;
    actorLight.shadowFrustumSize = ULTRA_PRESENTATION.actorShadowSpan;
    actorLight.shadowMinZ = 1;
    actorLight.shadowMaxZ = 200;
    actorShadows.usePercentageCloserFiltering = true;
    actorShadows.filteringQuality = ShadowGenerator.QUALITY_LOW;
    actorShadows.bias = 0.001;
    actorShadows.normalBias = 0.04;
    actorMap.name = ULTRA_ACTOR_SHADOW_NAME;
    actorMap.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
    actorMap.renderList = [];
  }
  const actorOffset = actorLight?.direction.scale(80);
  let casterIds: EntityId[] = [];
  const nearIds: EntityId[] = [];
  let tileX = Number.NaN;
  let tileY = Number.NaN;
  let tileZ = Number.NaN;
  const distanceSquared = ULTRA_ACTOR_SHADOW_DISTANCE * ULTRA_ACTOR_SHADOW_DISTANCE;
  scene.onBeforeRenderObservable.add(() => {
    const position = scene.activeCamera?.globalPosition;
    if (!position) return;
    let refresh = false;
    const x = Math.floor(position.x / SHADOW_TILE_SIZE) * SHADOW_TILE_SIZE;
    const y = Math.floor(position.y / SHADOW_TILE_SIZE) * SHADOW_TILE_SIZE;
    const z = Math.floor(position.z / SHADOW_TILE_SIZE) * SHADOW_TILE_SIZE;
    if (x !== tileX || y !== tileY || z !== tileZ) {
      tileX = x;
      tileY = y;
      tileZ = z;
      sun.position.set(x - sun.direction.x * 160, y - sun.direction.y * 160, z - sun.direction.z * 160);
      sky.position.set(x, y + 150, z);
      skyMap.resetRefreshCounter();
      refresh = true;
    }
    nearIds.length = 0;
    for (const [actorId, root] of actorEntries) {
      if (!root.isEnabled()) continue;
      // 角色根节点由会话每帧直接写入世界坐标；子节点的世界矩阵要到本帧渲染时才会刷新。
      const actor = (root.parent as TransformNode | null)?.position ?? root.position;
      const dx = actor.x - position.x;
      const dy = actor.y - position.y;
      const dz = actor.z - position.z;
      if (dx * dx + dy * dy + dz * dz <= distanceSquared) nearIds.push(actorId);
    }
    if (!sameIds(nearIds, casterIds)) {
      casterIds = [...nearIds];
      if (actorMap) {
        actorMap.renderList = casterIds.flatMap((actorId) => actorVisualRoots.get(actorId)?.getChildMeshes(false) ?? []);
        if (casterIds.length === 0) actorMap.resetRefreshCounter();
      }
    }
    if (refresh) shadowMap.resetRefreshCounter();
    if (actorLight && actorMap && actorOffset && casterIds.length > 0) {
      actorLight.position.copyFrom(position).subtractInPlace(actorOffset);
      actorMap.resetRefreshCounter();
    }
  });
}
