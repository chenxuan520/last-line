import { Constants } from "@babylonjs/core/Engines/constants";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { Scene } from "@babylonjs/core/scene";
import { MAP_SIZE, type MapLayout } from "../../config/map";
import { MIXED_ROAD_HALF_WIDTH, MIXED_ROAD_SHOULDER_HALF_WIDTH } from "../../config/mixedMap";
import { TOWN_ROAD_HALF_WIDTH, TOWN_ROAD_SHOULDER_HALF_WIDTH } from "../../config/townMap";
import { ULTRA_PRESENTATION } from "../../config/ultraPresentation";
import { getPoiVisualType } from "../poiVisuals";

export const ULTRA_ROAD_MASK_NAME = "ultra-road-surface-mask";

// 只在道路包围盒内栅格化，交叉口取最大覆盖；不按每个像素扫描整张路网。
export function createRoadSurfacePixels(layout: MapLayout, size = ULTRA_PRESENTATION.roadMaskSize): Uint8Array {
  const data = new Uint8Array(size * size * 2);
  const pixelMeters = MAP_SIZE / size;
  const road = layout.mapId === "mixed" ? MIXED_ROAD_HALF_WIDTH : TOWN_ROAD_HALF_WIDTH;
  const shoulder = layout.mapId === "mixed" ? MIXED_ROAD_SHOULDER_HALF_WIDTH : TOWN_ROAD_SHOULDER_HALF_WIDTH;
  const pixelIndex = (coordinate: number): number => (coordinate / MAP_SIZE + 0.5) * size;
  const coverage = (distance: number, halfWidth: number): number =>
    Math.round(Math.max(0, Math.min(1, (halfWidth - distance) / pixelMeters + 0.5)) * 255);
  const paint = (minX: number, minZ: number, maxX: number, maxZ: number, distance: (x: number, z: number) => number,
    roadWidth: number, shoulderWidth: number): void => {
    const fromX = Math.max(0, Math.floor(pixelIndex(minX - pixelMeters)));
    const toX = Math.min(size - 1, Math.ceil(pixelIndex(maxX + pixelMeters)));
    const fromZ = Math.max(0, Math.floor(pixelIndex(minZ - pixelMeters)));
    const toZ = Math.min(size - 1, Math.ceil(pixelIndex(maxZ + pixelMeters)));
    for (let z = fromZ; z <= toZ; z += 1) {
      const worldZ = (z + 0.5) * pixelMeters - MAP_SIZE / 2;
      for (let x = fromX; x <= toX; x += 1) {
        const d = distance((x + 0.5) * pixelMeters - MAP_SIZE / 2, worldZ);
        const offset = (z * size + x) * 2;
        data[offset] = Math.max(data[offset]!, coverage(d, roadWidth));
        data[offset + 1] = Math.max(data[offset + 1]!, coverage(d, shoulderWidth));
      }
    }
  };
  for (const [ax, az, bx, bz] of layout.roadSegments) {
    const dx = bx - ax, dz = bz - az, squared = dx * dx + dz * dz;
    if (squared === 0) continue;
    paint(Math.min(ax, bx) - shoulder, Math.min(az, bz) - shoulder,
      Math.max(ax, bx) + shoulder, Math.max(az, bz) + shoulder, (x, z) => {
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / squared));
        return Math.hypot(x - ax - t * dx, z - az - t * dz);
      }, road, shoulder);
  }
  if (layout.mapId === "island") {
    for (const point of layout.mapPoints) {
      const type = getPoiVisualType(point.name);
      if (!type) continue;
      const halfX = (type === "harbor" ? 138 : 126) / 2;
      const halfZ = (type === "town" ? 118 : 106) / 2;
      const { x, z } = point.position;
      paint(x - halfX, z - halfZ, x + halfX, z + halfZ,
        (px, pz) => Math.max(Math.abs(px - x) - halfX, Math.abs(pz - z) - halfZ), 0, 1);
    }
  }
  return data;
}

class RoadSurfacePlugin extends MaterialPluginBase {
  public constructor(material: PBRMaterial, private readonly mask: Texture, private readonly asphalt: Texture | null) {
    super(material, "UltraRoadSurface", 220, undefined, true, true);
  }

  public override getSamplers(samplers: string[]): void {
    samplers.push("ultraRoadMaskSampler", "ultraAsphaltSampler");
  }

  public override getUniforms(): ReturnType<MaterialPluginBase["getUniforms"]> {
    return { ubo: [{ name: "ultraAsphaltReady", size: 1, type: "float" }], fragment: "uniform float ultraAsphaltReady;" };
  }

  public override bindForSubMesh(buffer: UniformBuffer): void {
    buffer.setTexture("ultraRoadMaskSampler", this.mask);
    buffer.setTexture("ultraAsphaltSampler", this.asphalt ?? this.mask);
    buffer.updateFloat("ultraAsphaltReady", this.asphalt?.isReady() && !this.asphalt.loadingError ? 1 : 0);
  }

  public override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: "uniform sampler2D ultraRoadMaskSampler;\nuniform sampler2D ultraAsphaltSampler;",
      CUSTOM_FRAGMENT_UPDATE_ALBEDO: `
vec2 ultraRoadCoverage = texture2D(ultraRoadMaskSampler, vPositionW.xz / ${MAP_SIZE.toFixed(1)} + vec2(0.5)).rg;
vec3 ultraRoadAlbedo = vec3(0.13, 0.14, 0.15);
if (ultraAsphaltReady > 0.5) {
  ultraRoadAlbedo = toLinearSpace(texture2D(ultraAsphaltSampler, vPositionW.xz / ${ULTRA_PRESENTATION.roadTextureMeters.toFixed(1)}).rgb) * 0.58;
}
surfaceAlbedo = mix(surfaceAlbedo, vec3(0.24, 0.23, 0.20), ultraRoadCoverage.g * 0.65);
surfaceAlbedo = mix(surfaceAlbedo, ultraRoadAlbedo, ultraRoadCoverage.r);
`,
    };
  }
}

// 铺装和分缝在路口让出所有道路，避免长条铺装横穿另一条车道。
class PavementRoadCutoutPlugin extends MaterialPluginBase {
  public constructor(material: PBRMaterial, private readonly mask: Texture) {
    super(material, "UltraPavementRoadCutout", 221, undefined, true, true);
  }

  public override getSamplers(samplers: string[]): void { samplers.push("ultraRoadMaskSampler"); }
  public override bindForSubMesh(buffer: UniformBuffer): void { buffer.setTexture("ultraRoadMaskSampler", this.mask); }
  public override getCustomCode(shaderType: string): Record<string, string> | null {
    return shaderType === "fragment" ? {
      CUSTOM_FRAGMENT_DEFINITIONS: "uniform sampler2D ultraRoadMaskSampler;",
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: `if (texture2D(ultraRoadMaskSampler, vPositionW.xz / ${MAP_SIZE.toFixed(1)} + vec2(0.5)).r > 0.5) discard;`,
    } : null;
  }
}

export function enhanceTerrainPresentation(scene: Scene, layout: MapLayout): void {
  const ground = scene.getMeshByName("island-ground");
  if (!(ground?.material instanceof MultiMaterial)) return;
  const size = ULTRA_PRESENTATION.roadMaskSize;
  const pixels = createRoadSurfacePixels(layout);
  // WebGL1 不提供 RG 格式，使用同样两个采样通道的 RGBA 回退。
  const engine = scene.getEngine();
  const webgl1 = "webGLVersion" in engine && engine.webGLVersion === 1;
  const upload = webgl1 ? new Uint8Array(size * size * 4) : pixels;
  if (webgl1) for (let index = 0; index < size * size; index += 1) {
    upload[index * 4] = pixels[index * 2]!;
    upload[index * 4 + 1] = pixels[index * 2 + 1]!;
    upload[index * 4 + 3] = 255;
  }
  const mask = new RawTexture(upload, size, size, webgl1 ? Constants.TEXTUREFORMAT_RGBA : Constants.TEXTUREFORMAT_RG,
    scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
  mask.name = ULTRA_ROAD_MASK_NAME;
  mask.gammaSpace = false;
  mask.wrapU = mask.wrapV = Texture.CLAMP_ADDRESSMODE;
  const asphalt = scene.textures.find((texture) => texture.name === "texture.road.asphalt-damaged");
  for (const name of ["ultra-town-pavement-material", "ultra-town-paving-joints-material"]) {
    const material = scene.getMaterialByName(name);
    if (material instanceof PBRMaterial) new PavementRoadCutoutPlugin(material, mask);
  }
  for (const material of ground.material.subMaterials) {
    if (material instanceof PBRMaterial) new RoadSurfacePlugin(material, mask, asphalt instanceof Texture ? asphalt : null);
  }
}
