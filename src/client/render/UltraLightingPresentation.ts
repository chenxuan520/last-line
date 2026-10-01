import { Constants } from "@babylonjs/core/Engines/constants";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import type { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import type { Material } from "@babylonjs/core/Materials/material";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
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

export const ULTRA_SHADOW_MAP_NAME = "ultra-town-static-shadows";
export const ULTRA_ENVIRONMENT_NAME = "ultra-sky-environment";
export const ULTRA_PIPELINE_NAME = "ultra-pipeline";
export const ULTRA_SSAO_NAME = "ultra-ssao";
export const ULTRA_ACTOR_SHADOW_DISTANCE = 40;
export const ULTRA_SKY_OCCLUSION_NAME = "ultra-sky-occlusion";
const ULTRA_INDOOR_SKY_LIGHT = 0.45;
const SKY_OCCLUSION_DETAIL_TYPES = new Set(["floor-slabs", "roof-slabs", "hospital-surfaces", "ammunition-depot-surfaces"]);
const SHADOW_TILE_SIZE = 8;
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
  new GammaVertexColorPlugin(target);
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

// 天空环境光本身不知道室内外；天空遮挡光排在最后，光照循环结束时的 shadow 即“头顶是否有楼板／屋顶”。
class SkyOcclusionPlugin extends MaterialPluginBase {
  public constructor(material: PBRMaterial) {
    super(material, "UltraSkyOcclusion", 210, undefined, true, true);
  }

  public override getClassName(): string {
    return "UltraSkyOcclusionPlugin";
  }

  public override getCustomCode(shaderType: string): Nullable<Record<string, string>> {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: `
#if !defined(UNLIT) && defined(REFLECTION)
float ultraSkyVisibility = mix(${ULTRA_INDOOR_SKY_LIGHT.toFixed(2)}, 1.0, shadow);
finalIrradiance *= ultraSkyVisibility;
finalRadianceScaled *= ultraSkyVisibility;
#endif
`,
    };
  }
}

export function addSkyOcclusion(material: PBRMaterial): void {
  if (!material.pluginManager?.getPlugin("UltraSkyOcclusion")) new SkyOcclusionPlugin(material);
}

// Standard 材质把顶点色当作 gamma 空间乘数；PBR 在线性空间相乘，因此逐像素换算以保持原配色。
class GammaVertexColorPlugin extends MaterialPluginBase {
  public constructor(material: PBRMaterial) {
    super(material, "UltraGammaVertexColor", 200, undefined, true, true);
  }

  public override getClassName(): string {
    return "UltraGammaVertexColorPlugin";
  }

  public override getCustomCode(shaderType: string): Nullable<Record<string, string>> {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_UPDATE_ALBEDO: `
#if defined(VERTEXCOLOR)
surfaceAlbedo *= toLinearSpace(max(vColor.rgb, vec3(0.0001))) / max(vColor.rgb, vec3(0.0001));
#endif
`,
    };
  }
}

function configureFog(scene: Scene): void {
  const skyAssetId = String(scene.getMeshByName("island-sky-dome")?.metadata?.skyAssetId);
  const [r, g, b] = SKY_FOG_COLORS[skyAssetId] ?? SKY_FOG_COLORS["texture.sky.overcast"]!;
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.00072;
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
  const ssao = !touch && SSAO2?.IsSupported
    ? new SSAO2(ULTRA_SSAO_NAME, scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, [camera], false, Constants.TEXTURETYPE_HALF_FLOAT)
    : null;
  if (ssao) {
    ssao.radius = 2;
    ssao.totalStrength = 2.2;
    ssao.base = 0.02;
    ssao.samples = 16;
    ssao.maxZ = 140;
    ssao.expensiveBlur = true;
    // 启用 SSAO 后场景先渲染到预渲染目标，多重采样由它承担。
    ssao.textureSamples = 4;
  }
  const textureType = !touch && engine.getCaps().textureHalfFloatRender
    ? Constants.TEXTURETYPE_HALF_FLOAT
    : Constants.TEXTURETYPE_UNSIGNED_BYTE;
  const pipeline = new PostProcessRenderPipeline(engine, ULTRA_PIPELINE_NAME);
  const bloom = touch ? null : new BloomEffect(scene, 0.5, 0.16, 48, textureType, false);
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

// 静态投影只在跨越 8m 分区时刷新；桌面端近距离有角色时逐帧刷新，角色离开后再刷新一次恢复缓存。
function createShadows(scene: Scene, options: UltraLightingOptions, touch: boolean): void {
  const { sun, actorVisualRoots, localActorId } = options;
  sun.shadowFrustumSize = touch ? 192 : 384;
  sun.shadowMinZ = 1;
  sun.shadowMaxZ = touch ? 400 : 560;
  const shadows = new ShadowGenerator(touch ? 2048 : 4096, sun);
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

  // 只写楼板与屋顶的俯视遮挡图，光强为 0，不照亮任何表面，只给环境光提供室内判断。
  const sky = new DirectionalLight(ULTRA_SKY_OCCLUSION_NAME, new Vector3(0.0001, -1, 0.0001), scene);
  sky.intensity = 0;
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
      shadowMap.renderList = staticCasters.concat(casterIds.flatMap((actorId) => actorVisualRoots.get(actorId)?.getChildMeshes(false) ?? []));
      refresh = true;
    }
    if (refresh || casterIds.length > 0) shadowMap.resetRefreshCounter();
  });
}
