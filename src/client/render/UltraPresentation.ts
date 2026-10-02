import { enhanceViewEquipment } from "./UltraEquipmentPresentation";
import { enhanceLighting, type UltraMaterialAdapter } from "./UltraLightingPresentation";
import { enhanceVegetation } from "./UltraVegetationPresentation";
import { createTerrainPavement, enhanceTerrainPresentation } from "./UltraTerrainPresentation";
export { colorEquipmentPart } from "./UltraEquipmentPresentation";
export { enhanceCharacterContainer } from "./UltraCharacterPresentation";
export { createUltraMaterialAdapter } from "./UltraLightingPresentation";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import type { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { AssetCatalog } from "../../assets/AssetCatalog";
import { ULTRA_PRESENTATION } from "../../config/ultraPresentation";
import type { MapLayout } from "../../config/map";
import type { EntityId } from "../../game/state/types";

const WORLD_TEXTURE_IDS = new Set([
  "texture.terrain.concrete-urban",
  "texture.road.asphalt-damaged",
  "texture.building.brick-masonry",
  "texture.building.concrete-wall-aged",
  "texture.building.flat-roof-membrane",
  "texture.industrial.metal-roof-rusted",
  "texture.industrial.metal",
  "texture.terrain.dry-soil",
  "texture.terrain.forest-humus",
  "texture.terrain.forest-moss-wet",
  "texture.terrain.gravel",
  "texture.terrain.mud-sparse-grass",
  "texture.building.wall-plaster-aged",
  "texture.building.roof-tile-gray",
  "texture.building.roof-tile-red-brown",
]);

export interface UltraSceneActors {
  actorVisualRoots: ReadonlyMap<EntityId, TransformNode>;
  localActorId: EntityId;
}

export async function enhanceScenePresentation(
  scene: Scene,
  assets: AssetCatalog,
  sun: DirectionalLight,
  ambient: HemisphericLight,
  layout: MapLayout,
  actors: UltraSceneActors,
  materials: UltraMaterialAdapter,
): Promise<void> {
  ambient.intensity = 0.72;
  ambient.diffuse = new Color3(0.82, 0.88, 1);
  ambient.groundColor = new Color3(0.24, 0.23, 0.21);
  sun.intensity = 1.28;
  sun.diffuse = new Color3(1, 0.95, 0.86);
  sun.direction.set(-0.65, -1, 0.45);
  if (layout.mapId !== "town") {
    ambient.diffuse.set(0.88, 0.92, 0.87);
    ambient.groundColor.set(0.22, 0.25, 0.20);
    sun.intensity = 1.20;
  }

  createBuildingAndStreetDetails(scene, layout);
  enhanceViewEquipment(scene);
  enhanceVegetation(scene);

  for (const mesh of scene.meshes) {
    if (mesh.name.startsWith("building-walls-") || /^building-(floor|roof)-slabs-batch/.test(mesh.name)) {
      if (!mesh.hasThinInstances) applyWorldSurfaceUvs(mesh as Mesh);
    }
    if (mesh.metadata?.collision || ["building-detail", "roof-ramp", "town-visual-detail", "cover-prop", "natural-detail", "vegetation", "ultra-town-detail"].includes(mesh.metadata?.decoration)) {
      if (mesh instanceof InstancedMesh) mesh.sourceMesh.receiveShadows = true;
      else mesh.receiveShadows = true;
    }
  }
  for (const material of scene.materials) {
    if (!(material instanceof StandardMaterial)) continue;
    if (material.name.startsWith("building-material-texture-")) material.diffuseColor.set(0.92, 0.91, 0.88);
    if (material.name === "building-floor-material") material.diffuseColor.set(0.61, 0.62, 0.60);
    if (material.name === "building-trim-material") material.diffuseColor.set(0.62, 0.65, 0.65);
    if (material.name === "actor-gear-material") {
      material.specularColor.set(0.26, 0.28, 0.3);
      material.specularPower = 96;
    }
  }

  // 只从已校验的 payload 派生凹凸，不重新请求图片，也不阻塞场景。
  for (const texture of [...scene.textures]) {
    if (!(texture instanceof Texture) || !WORLD_TEXTURE_IDS.has(texture.name)) continue;
    if (texture.name.startsWith("texture.building.") || texture.name.startsWith("texture.industrial.")) {
      texture.uScale = texture.vScale = 1;
    } else if (texture.uScale > 1) {
      texture.uScale *= 3;
      texture.vScale *= 3;
    }
    const payload = assets.getPayload(texture.name);
    if (payload) void addSurfaceNormal(scene, texture, payload);
  }
  await enhanceLighting(scene, { sun, ambient, ...actors, materials });
  enhanceTerrainPresentation(scene, layout);
}

function applyWorldSurfaceUvs(mesh: Mesh): void {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
  if (!positions || !normals) return;
  const uvs = new Float32Array(positions.length / 3 * 2);
  const world = mesh.computeWorldMatrix(true);
  const position = Vector3.Zero();
  const normal = Vector3.Zero();
  for (let index = 0; index < positions.length; index += 3) {
    Vector3.TransformCoordinatesFromFloatsToRef(positions[index]!, positions[index + 1]!, positions[index + 2]!, world, position);
    Vector3.TransformNormalFromFloatsToRef(normals[index]!, normals[index + 1]!, normals[index + 2]!, world, normal);
    const horizontal = Math.abs(normal.y) > 0.7;
    uvs[index / 3 * 2] = (horizontal || Math.abs(normal.z) > Math.abs(normal.x) ? position.x : position.z) / 3.2;
    uvs[index / 3 * 2 + 1] = (horizontal ? position.z : position.y) / 3.2;
  }
  mesh.setVerticesData(VertexBuffer.UVKind, uvs);
}

async function addSurfaceNormal(scene: Scene, source: Texture, payload: ArrayBuffer): Promise<void> {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") return;
  try {
    const bitmap = await createImageBitmap(new Blob([payload]));
    if (scene.isDisposed) {
      bitmap.close();
      return;
    }
    const size = 256;
    const canvas = new OffscreenCanvas(size, size);
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close();
      return;
    }
    context.drawImage(bitmap, 0, 0, size, size);
    bitmap.close();
    const pixels = context.getImageData(0, 0, size, size).data;
    const data = surfaceNormalPixels(pixels, size);
    const normal = RawTexture.CreateRGBATexture(data, size, size, scene, true, source.invertY, Texture.TRILINEAR_SAMPLINGMODE);
    normal.name = `${source.name}.normal`;
    normal.gammaSpace = false;
    normal.wrapU = normal.wrapV = Texture.WRAP_ADDRESSMODE;
    normal.uScale = source.uScale;
    normal.vScale = source.vScale;
    normal.anisotropicFilteringLevel = 8;
    normal.level = 0.65;
    const bind = (): void => bindGeneratedSurfaceNormal(scene, source, normal);
    if (source.isReady()) bind();
    else source.onLoadObservable.addOnce(bind);
  } catch {
    // 图片解码或凹凸增强不可用时保留原材质，权威几何始终可见。
  }
}

// 法线在 PBR 转换前后都可能就绪。转换前必须写到仍在场的 Standard 材质，转换才会把 bumpTexture 拷过去。
export function bindGeneratedSurfaceNormal(scene: Scene, source: Texture, normal: Texture): void {
  if (scene.isDisposed || source.loadingError) return;
  for (const material of scene.materials) {
    if (material instanceof StandardMaterial && material.diffuseTexture === source) material.bumpTexture = normal;
    else if (material instanceof PBRMaterial && material.albedoTexture === source) material.bumpTexture = normal;
  }
}

export function surfaceNormalPixels(pixels: Uint8ClampedArray, size: number): Uint8Array {
  const result = new Uint8Array(size * size * 4);
  const height = (x: number, y: number): number => {
    const offset = ((y + size) % size * size + (x + size) % size) * 4;
    return (pixels[offset]! * 0.2126 + pixels[offset + 1]! * 0.7152 + pixels[offset + 2]! * 0.0722) / 255;
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (height(x - 1, y) - height(x + 1, y)) * 2;
      const dy = (height(x, y - 1) - height(x, y + 1)) * 2;
      const length = Math.hypot(dx, dy, 1);
      const offset = (y * size + x) * 4;
      result[offset] = Math.round((dx / length * 0.5 + 0.5) * 255);
      result[offset + 1] = Math.round((dy / length * 0.5 + 0.5) * 255);
      result[offset + 2] = Math.round((1 / length * 0.5 + 0.5) * 255);
      result[offset + 3] = 255;
    }
  }
  return result;
}

function createBuildingAndStreetDetails(scene: Scene, layout: MapLayout): void {
  const buildings = [...layout.obstacles]
    .filter((building) => (building.footprint ?? "rectangle") === "rectangle" &&
      building.id !== layout.hospital.buildingId && building.id !== layout.ammunitionDepot.buildingId)
    .sort((left, right) => left.id.localeCompare(right.id));
  const buildingIds = new Set(buildings.map((building) => building.id));
  const trimTransforms: number[] = [];
  const jointTransforms: number[] = [];
  const add = (target: number[], x: number, y: number, z: number, width: number, height: number, depth: number, yaw = 0, pitch = 0, roll = 0): void => {
    Matrix.Compose(new Vector3(width, height, depth), Quaternion.FromEulerAngles(pitch, yaw, roll), new Vector3(x, y, z)).copyToArray(target, target.length);
  };
  for (const wall of layout.wallSegments) {
    if (!buildingIds.has(wall.obstacleId) || wall.role !== "facade" || wall.height < 1) continue;
    const alongX = wall.width > wall.depth;
    // 所有收边和分缝都限制在真实墙段内，绝不跨过门窗。
    for (const y of [wall.center.y - wall.height / 2 + 0.14, wall.center.y + wall.height / 2 - 0.10]) {
      add(trimTransforms, wall.center.x, y, wall.center.z, wall.width + (alongX ? 0 : 0.035), 0.18, wall.depth + (alongX ? 0.035 : 0));
    }
    const span = alongX ? wall.width : wall.depth;
    const start = (alongX ? wall.center.x : wall.center.z) - span / 2;
    for (let position = Math.ceil((start + 0.1) / 4) * 4; position < start + span - 0.1; position += 4) {
      add(jointTransforms, alongX ? position : wall.center.x, wall.center.y, alongX ? wall.center.z : position,
        alongX ? 0.025 : wall.width + 0.012, wall.height - 0.08, alongX ? wall.depth + 0.012 : 0.025);
    }
  }
  const addBatch = (name: string, transforms: number[], color: string): void => {
    if (!transforms.length) return;
    const material = new StandardMaterial(`${name}-material`, scene);
    material.diffuseColor = Color3.FromHexString(color);
    material.specularColor.setAll(0.04);
    const batches = new Map<string, number[]>();
    for (let offset = 0; offset < transforms.length; offset += 16) {
      const x = Math.floor(transforms[offset + 12]! / ULTRA_PRESENTATION.detailBatchSpan);
      const z = Math.floor(transforms[offset + 14]! / ULTRA_PRESENTATION.detailBatchSpan);
      const key = `${x}:${z}`;
      let batch = batches.get(key);
      if (!batch) { batch = []; batches.set(key, batch); }
      for (let component = 0; component < 16; component += 1) batch.push(transforms[offset + component]!);
    }
    let batchIndex = 0;
    for (const [tile, batch] of batches) {
      // Babylon 薄实例把矩阵属性写进 Geometry，不同分区必须拥有独立几何缓冲。
      const mesh = CreateBox(batchIndex++ === 0 ? name : `${name}-${tile}`, { size: 1 }, scene);
      mesh.material = material;
      mesh.thinInstanceSetBuffer("matrix", new Float32Array(batch), 16, true);
      mesh.thinInstanceRefreshBoundingInfo(true);
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      mesh.metadata = { decoration: "ultra-town-detail", detailBatch: name, sourceCount: batch.length / 16 };
      // 小型收边／分缝按分区进行视锥裁剪，远处无需提交整张地图的实例。
      mesh.addLODLevel(ULTRA_PRESENTATION.detailLodDistance, null);
      mesh.freezeWorldMatrix();
    }
  };
  addBatch("ultra-town-facade-trim", trimTransforms, "#777b77");
  addBatch("ultra-town-facade-joints", jointTransforms, "#474b49");

  // 城市长条铺装只适用于灰炉城；山坡与乡村由地形材质绘制连续道路。
  if (layout.mapId !== "town") return;

  const pavement = new StandardMaterial("ultra-town-pavement-material", scene);
  pavement.diffuseColor = Color3.FromHexString("#92938b");
  pavement.specularColor.setAll(0.035);
  const source = scene.textures.find((texture) => texture.name === "texture.terrain.concrete-urban");
  if (source instanceof Texture) {
    const texture = source.clone();
    texture.name = "texture.terrain.concrete-urban";
    texture.uScale = texture.vScale = 1;
    if (texture.isReady()) pavement.diffuseTexture = texture;
    else texture.onLoadObservable.addOnce(() => { if (!scene.isDisposed && !texture.loadingError) pavement.diffuseTexture = texture; });
  }
  const roads = layout.roadSegments.map((road) => ({
    road, length: Math.hypot(road[2] - road[0], road[3] - road[1]),
  })).filter(({ length }) => length > 0);
  const { mesh: pavementMesh, heightAt } = createTerrainPavement(scene, layout, pavement);
  applyWorldSurfaceUvs(pavementMesh);
  const pavingJoints: number[] = [];
  for (const { road: [x1, z1, x2, z2], length } of roads) {
    const from = 0;
    const to = length;
    const dx = (x2 - x1) / length;
    const dz = (z2 - z1) / length;
    const yaw = Math.atan2(dx, dz);
    for (const side of [-1, 1]) {
      for (let offset = from + 1.5; offset < to; offset += 3) {
        const jointX = x1 + dx * offset + dz * side * 4.85;
        const jointZ = z1 + dz * offset - dx * side * 4.85;
        const acrossRise = heightAt(jointX + dz * 1.05, jointZ - dx * 1.05) - heightAt(jointX - dz * 1.05, jointZ + dx * 1.05);
        const alongRise = heightAt(jointX + dx * 0.1, jointZ + dz * 0.1) - heightAt(jointX - dx * 0.1, jointZ - dz * 0.1);
        add(pavingJoints, jointX, heightAt(jointX, jointZ) + 0.046, jointZ, 2.1, 0.005, 0.018,
          yaw, -Math.atan2(alongRise, 0.2), Math.atan2(acrossRise, 2.1));
      }
    }
  }
  addBatch("ultra-town-paving-joints", pavingJoints, "#555952");
}
