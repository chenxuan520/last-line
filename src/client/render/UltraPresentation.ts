import { enhanceViewEquipment } from "./UltraEquipmentPresentation";
import { enhanceLighting, type UltraMaterialAdapter } from "./UltraLightingPresentation";
import { enhanceVegetation } from "./UltraVegetationPresentation";
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
import { getTerrainHeight, type MapLayout } from "../../config/map";
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

  createSampleDetails(scene, layout);
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
    const bind = (): void => {
      if (scene.isDisposed || source.loadingError) return;
      for (const material of scene.materials) {
        if (material instanceof PBRMaterial && material.albedoTexture === source) material.bumpTexture = normal;
      }
    };
    if (source.isReady()) bind();
    else source.onLoadObservable.addOnce(bind);
  } catch {
    // 图片解码或凹凸增强不可用时保留原材质，权威几何始终可见。
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

function createSampleDetails(scene: Scene, layout: MapLayout): void {
  const buildings = [...layout.obstacles]
    .filter((building) => (building.footprint ?? "rectangle") === "rectangle" &&
      building.id !== layout.hospital.buildingId && building.id !== layout.ammunitionDepot.buildingId)
    .sort((left, right) => Math.hypot(left.center.x, left.center.z) - Math.hypot(right.center.x, right.center.z))
    .slice(0, 6);
  const sampleIds = new Set(buildings.map((building) => building.id));
  const trimTransforms: number[] = [];
  const jointTransforms: number[] = [];
  const add = (target: number[], x: number, y: number, z: number, width: number, height: number, depth: number, yaw = 0): void => {
    Matrix.Compose(new Vector3(width, height, depth), Quaternion.FromEulerAngles(0, yaw, 0), new Vector3(x, y, z)).copyToArray(target, target.length);
  };
  for (const wall of layout.wallSegments) {
    if (!sampleIds.has(wall.obstacleId) || wall.role !== "facade" || wall.height < 1) continue;
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
    const mesh = CreateBox(name, { size: 1 }, scene);
    const material = new StandardMaterial(`${name}-material`, scene);
    material.diffuseColor = Color3.FromHexString(color);
    material.specularColor.setAll(0.04);
    mesh.material = material;
    mesh.thinInstanceSetBuffer("matrix", new Float32Array(transforms), 16, true);
    mesh.thinInstanceRefreshBoundingInfo(true);
    mesh.isPickable = false;
    mesh.checkCollisions = false;
    mesh.metadata = { decoration: "ultra-town-detail", sourceCount: transforms.length / 16 };
    mesh.freezeWorldMatrix();
  };
  addBatch("ultra-town-facade-trim", trimTransforms, "#777b77");
  addBatch("ultra-town-facade-joints", jointTransforms, "#474b49");

  // 城市长条铺装只适用于灰炉城；山坡与乡村继续使用贴合地形的原道路。
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
  const roads = [...layout.roadSegments].map((road) => {
    const [x1, z1, x2, z2] = road;
    const length = Math.hypot(x2 - x1, z2 - z1);
    const progress = Math.max(0, Math.min(1, -(x1 * (x2 - x1) + z1 * (z2 - z1)) / (length * length)));
    return { road, length, progress, distance: Math.hypot(x1 + (x2 - x1) * progress, z1 + (z2 - z1) * progress) };
  }).sort((left, right) => left.distance - right.distance).slice(0, 4);
  const pavements: Mesh[] = [];
  const pavingJoints: number[] = [];
  for (const { road: [x1, z1, x2, z2], length, progress } of roads) {
    const from = Math.max(0, progress * length - 48);
    const to = Math.min(length, progress * length + 48);
    const dx = (x2 - x1) / length;
    const dz = (z2 - z1) / length;
    const yaw = Math.atan2(dx, dz);
    for (const side of [-1, 1]) {
      const x = x1 + dx * (from + to) / 2 + dz * side * 4.85;
      const z = z1 + dz * (from + to) / 2 - dx * side * 4.85;
      const mesh = CreateBox("ultra-town-pavement", { width: 2.1, height: 0.025, depth: to - from }, scene);
      mesh.position.set(x, getTerrainHeight(x, z, layout) + 0.03, z);
      mesh.rotation.y = yaw;
      mesh.material = pavement;
      applyWorldSurfaceUvs(mesh);
      pavements.push(mesh);
      for (let offset = from + 1.5; offset < to; offset += 3) {
        const jointX = x1 + dx * offset + dz * side * 4.85;
        const jointZ = z1 + dz * offset - dx * side * 4.85;
        add(pavingJoints, jointX, getTerrainHeight(jointX, jointZ, layout) + 0.046, jointZ, 2.1, 0.005, 0.018, yaw);
      }
    }
  }
  const merged = Mesh.MergeMeshes(pavements, true, true);
  if (merged) {
    merged.name = "ultra-town-pavement";
    merged.isPickable = false;
    merged.checkCollisions = false;
    merged.metadata = { decoration: "ultra-town-detail", sourceCount: pavements.length };
    merged.freezeWorldMatrix();
  }
  addBatch("ultra-town-paving-joints", pavingJoints, "#555952");
}
