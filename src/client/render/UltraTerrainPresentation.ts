import { Constants } from "@babylonjs/core/Engines/constants";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { Material } from "@babylonjs/core/Materials/material";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";
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

// 裁切真实地面三角面，而非在长路中点放平板；地面仍只用于表现，不参与权威碰撞。
export function createTerrainPavement(scene: Scene, layout: MapLayout, material: Material): {
  mesh: Mesh; heightAt(x: number, z: number): number;
} {
  const ground = scene.getMeshByName("island-ground")!;
  const groundPositions = ground.getVerticesData(VertexBuffer.PositionKind)!;
  const groundIndices = ground.getIndices()!;
  const cells = Math.round(Math.sqrt(groundPositions.length / 3)) - 1;
  const scale = cells / MAP_SIZE;
  const cellAt = (value: number): number => Math.max(0, Math.min(cells - 1, Math.floor((value + MAP_SIZE / 2) * scale)));
  const triangles = new Int32Array(cells * cells * 2).fill(-1);
  for (let offset = 0; offset < groundIndices.length; offset += 3) {
    const a = groundIndices[offset]! * 3, b = groundIndices[offset + 1]! * 3, c = groundIndices[offset + 2]! * 3;
    const x = cellAt(Math.min(groundPositions[a]!, groundPositions[b]!, groundPositions[c]!));
    const z = cellAt(Math.min(groundPositions[a + 2]!, groundPositions[b + 2]!, groundPositions[c + 2]!));
    const slot = (z * cells + x) * 2;
    triangles[slot + (triangles[slot] === -1 ? 0 : 1)] = offset;
  }
  const heightAt = (x: number, z: number): number => {
    const slot = (cellAt(z) * cells + cellAt(x)) * 2;
    for (let triangle = 0; triangle < 2; triangle += 1) {
      const offset = triangles[slot + triangle]!;
      const a = groundIndices[offset]! * 3, b = groundIndices[offset + 1]! * 3, c = groundIndices[offset + 2]! * 3;
      const ax = groundPositions[a]!, az = groundPositions[a + 2]!;
      const bx = groundPositions[b]! - ax, bz = groundPositions[b + 2]! - az;
      const cx = groundPositions[c]! - ax, cz = groundPositions[c + 2]! - az;
      const determinant = bx * cz - bz * cx;
      const u = ((x - ax) * cz - (z - az) * cx) / determinant;
      const v = (bx * (z - az) - bz * (x - ax)) / determinant;
      if (u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6) {
        return groundPositions[a + 1]! * (1 - u - v) + groundPositions[b + 1]! * u + groundPositions[c + 1]! * v;
      }
    }
    throw new Error("Pavement sample outside rendered terrain");
  };
  type Point = { x: number; y: number; z: number };
  const clip = (polygon: Point[], distance: (point: Point) => number): Point[] => {
    const result: Point[] = [];
    let previous = polygon.at(-1)!;
    let previousDistance = distance(previous);
    for (const point of polygon) {
      const currentDistance = distance(point);
      if ((currentDistance >= 0) !== (previousDistance >= 0)) {
        const t = previousDistance / (previousDistance - currentDistance);
        result.push({ x: previous.x + (point.x - previous.x) * t,
          y: previous.y + (point.y - previous.y) * t, z: previous.z + (point.z - previous.z) * t });
      }
      if (currentDistance >= 0) result.push(point);
      previous = point; previousDistance = currentDistance;
    }
    return result;
  };
  const positions: number[] = [], indices: number[] = [];
  let sourceCount = 0;
  for (const [ax, az, bx, bz] of layout.roadSegments) {
    const length = Math.hypot(bx - ax, bz - az);
    if (!length) continue;
    const dx = (bx - ax) / length, dz = (bz - az) / length;
    for (const side of [-1, 1]) {
      const near = side * 4.85 - 1.05, far = side * 4.85 + 1.05;
      const xs = [ax + dz * near, ax + dz * far, bx + dz * near, bx + dz * far];
      const zs = [az - dx * near, az - dx * far, bz - dx * near, bz - dx * far];
      const along = (point: Point): number => (point.x - ax) * dx + (point.z - az) * dz;
      const across = (point: Point): number => (point.x - ax) * dz - (point.z - az) * dx;
      const boundaries = [(point: Point) => along(point), (point: Point) => length - along(point),
        (point: Point) => across(point) - near, (point: Point) => far - across(point)];
      sourceCount += 1;
      for (let z = cellAt(Math.min(...zs)); z <= cellAt(Math.max(...zs)); z += 1) {
        for (let x = cellAt(Math.min(...xs)); x <= cellAt(Math.max(...xs)); x += 1) {
          for (let triangle = 0; triangle < 2; triangle += 1) {
            const offset = triangles[(z * cells + x) * 2 + triangle]!;
            let polygon = Array.from({ length: 3 }, (_, corner): Point => {
              const index = groundIndices[offset + corner]! * 3;
              return { x: groundPositions[index]!, y: groundPositions[index + 1]!, z: groundPositions[index + 2]! };
            });
            for (const distance of boundaries) {
              polygon = clip(polygon, distance);
              if (polygon.length < 3) break;
            }
            if (polygon.length < 3) continue;
            const start = positions.length / 3;
            for (const point of polygon) positions.push(point.x, point.y + 0.0425, point.z);
            for (let corner = 1; corner < polygon.length - 1; corner += 1) indices.push(start, start + corner, start + corner + 1);
          }
        }
      }
    }
  }
  const data = new VertexData();
  data.positions = positions; data.indices = indices;
  data.normals = []; VertexData.ComputeNormals(positions, indices, data.normals);
  const mesh = new Mesh("ultra-town-pavement", scene);
  data.applyToMesh(mesh); mesh.material = material;
  mesh.isPickable = false; mesh.checkCollisions = false;
  mesh.metadata = { decoration: "ultra-town-detail", sourceCount };
  mesh.freezeWorldMatrix();
  return { mesh, heightAt };
}

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
    super(material, "UltraRoadSurface", 220, { ULTRA_ROAD_GRADIENTS: false }, true, true);
  }

  public override prepareDefines(defines: MaterialDefines, scene: Scene): void {
    const engine = scene.getEngine();
    defines.ULTRA_ROAD_GRADIENTS = "webGLVersion" in engine && engine.webGLVersion === 2;
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
vec2 ultraAsphaltUv = vPositionW.xz / ${ULTRA_PRESENTATION.roadTextureMeters.toFixed(1)};
#ifdef ULTRA_ROAD_GRADIENTS
// 在分支外算导数，路边混合覆盖的片元仍采用原有 mip 与各向异性过滤。
vec2 ultraAsphaltDx = dFdx(ultraAsphaltUv), ultraAsphaltDy = dFdy(ultraAsphaltUv);
if (ultraAsphaltReady > 0.5 && ultraRoadCoverage.r > 0.0) {
  ultraRoadAlbedo = toLinearSpace(textureGrad(ultraAsphaltSampler, ultraAsphaltUv, ultraAsphaltDx, ultraAsphaltDy).rgb) * 0.58;
}
#else
if (ultraAsphaltReady > 0.5) {
  ultraRoadAlbedo = toLinearSpace(texture2D(ultraAsphaltSampler, ultraAsphaltUv).rgb) * 0.58;
}
#endif
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
