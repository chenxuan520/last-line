import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateCylinderVertexData } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Material } from "@babylonjs/core/Materials/material";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import { ULTRA_PRESENTATION } from "../../config/ultraPresentation";

export function enhanceVegetation(scene: Scene): void {
  const foliage = scene.getMeshByName("tree-foliage-template") as Mesh | null;
  const trunk = scene.getMeshByName("tree-trunk-template") as Mesh | null;
  if (!foliage || !trunk) return;
  const size = 256, pixels = new Uint8Array(size * size * 4);
  const line = (ax: number, ay: number, bx: number, by: number, color: readonly number[], width: number): void => {
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 1.5);
    for (let step = 0; step <= steps; step += 1) {
      const x = Math.round(ax + (bx - ax) * step / steps), y = Math.round(ay + (by - ay) * step / steps);
      for (let dy = -width; dy <= width; dy += 1) for (let dx = -width; dx <= width; dx += 1) {
        if (x + dx < 0 || x + dx >= size || y + dy < 0 || y + dy >= size) continue;
        pixels.set(color, ((y + dy) * size + x + dx) * 4);
      }
    }
  };
  // 枝轴向尖端弯曲，针叶有明暗和长度差；透明区域只做 alpha test。
  line(128, 8, 128, 246, [94, 76, 49, 255], 1);
  for (let tier = 0; tier < 10; tier += 1) for (const side of [-1, 1]) {
    const y = 35 + tier * 21 + side * ((tier * 7) % 9), length = 24 + tier * 6.5 + Math.sin(tier * 9 + side) * 5;
    const endX = 126 + side * length, endY = y + 25 + Math.sin(tier * 5) * 7;
    line(127, y, endX, endY, [69, 85, 43, 255], 1);
    for (let needle = 0; needle < 14; needle += 1) {
      const t = (needle + 0.5) / 14, x = 127 + side * length * t;
      const atY = y + (endY - y) * t;
      for (let tuft = 0; tuft < 5; tuft += 1) {
        const angle = tuft * 1.23 + needle * 0.7 + tier * 0.31;
        const reach = 5 + (needle * 7 + tier * 11 + tuft * 3) % 6;
        const light = (needle * 13 + tier * 7 + tuft * 11) % 30;
        line(x, atY, x + Math.cos(angle) * reach, atY + Math.sin(angle) * reach,
          [55 + light, 82 + light, 36 + light, 255], 0);
      }
    }
  }
  const needles = RawTexture.CreateRGBATexture(pixels, size, size, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  needles.name = "ultra-tree-needles";
  needles.hasAlpha = true;
  needles.wrapU = needles.wrapV = Texture.CLAMP_ADDRESSMODE;
  const leafMaterial = foliage.material as StandardMaterial;
  leafMaterial.diffuseTexture = needles;
  leafMaterial.useAlphaFromDiffuseTexture = true;
  leafMaterial.transparencyMode = Material.MATERIAL_ALPHATEST;
  leafMaterial.backFaceCulling = false;
  leafMaterial.twoSidedLighting = true;
  leafMaterial.diffuseColor.set(1, 1, 1);
  leafMaterial.specularColor.setAll(0.04);

  const createCrown = (tiers: number, branches: number): VertexData => {
    const positions: number[] = [], indices: number[] = [], normals: number[] = [], uvs: number[] = [], colors: number[] = [];
    for (let tier = 0; tier < tiers; tier += 1) {
      const level = tier / (tiers - 1), y = -4.5 + level * 11.2;
      for (let branch = 0; branch < branches; branch += 1) {
        const reach = 3.45 * (1 - level * 0.875) * (0.88 + Math.sin(branch * 13 + tier) * 0.12);
        const atY = y + Math.sin(branch * 5 + tier * 3) * 0.35;
        const angle = branch * Math.PI * 2 / branches + tier * 2.399;
        const radialX = Math.sin(angle), radialZ = Math.cos(angle);
        // 每根枝条仍只有两片，改变生长方向与下垂幅度，避免圆锥式等距层叠。
        for (const tilt of [-1.1, 1.15]) {
          const start = positions.length / 3, width = reach * 0.34;
          const rootX = radialX * 0.06, rootZ = radialZ * 0.06;
          const endX = radialX * reach, endZ = radialZ * reach;
          const endY = atY - reach * (0.16 + 0.09 * Math.sin(tier * 7 + branch));
          const dx = radialZ * width, dz = -radialX * width;
          positions.push(rootX - dx * 0.08, atY, rootZ - dz * 0.08, rootX + dx * 0.08, atY, rootZ + dz * 0.08,
            endX + dx, endY + width * tilt, endZ + dz, endX - dx, endY - width * tilt, endZ - dz);
          uvs.push(0.46, 0, 0.54, 0, 1, 1, 0, 1);
          indices.push(start, start + 2, start + 1, start, start + 3, start + 2);
          const shade = 0.75 + ((tier * 3 + branch * 7) % 9) * 0.03;
          for (let vertex = 0; vertex < 4; vertex += 1) colors.push(shade, shade, shade, 1);
        }
      }
    }
    // 树冠中的中央木质轴连接各层枝条，避免枝叶悬空；共享同一树冠批次。
    for (let side = 0; side < 8; side += 1) {
      const a = side * Math.PI / 4, b = (side + 1) * Math.PI / 4, start = positions.length / 3;
      positions.push(Math.sin(a) * 0.18, -5.7, Math.cos(a) * 0.18, Math.sin(b) * 0.18, -5.7, Math.cos(b) * 0.18,
        Math.sin(b) * 0.018, 7.4, Math.cos(b) * 0.018, Math.sin(a) * 0.018, 7.4, Math.cos(a) * 0.018);
      uvs.push(0.498, 0.2, 0.502, 0.2, 0.502, 0.8, 0.498, 0.8);
      indices.push(start, start + 2, start + 1, start, start + 3, start + 2);
      for (let vertex = 0; vertex < 4; vertex += 1) colors.push(1, 0.82, 0.65, 1);
    }
    VertexData.ComputeNormals(positions, indices, normals);
    const crown = new VertexData();
    crown.positions = positions; crown.indices = indices; crown.normals = normals; crown.uvs = uvs; crown.colors = colors;
    return crown;
  };
  createCrown(15, 7).applyToMesh(foliage);
  // 原生实例 LOD 复用一份远景几何，保留树冠高度与针叶外观，减少远处枝片重叠。
  const distant = new Mesh("ultra-tree-foliage-lod", scene);
  createCrown(6, 4).applyToMesh(distant);
  distant.material = leafMaterial;
  distant.isPickable = false;
  distant.checkCollisions = false;
  distant.metadata = { decoration: "vegetation", visualLod: "distant" };
  foliage.addLODLevel(ULTRA_PRESENTATION.foliageLodDistance, distant);
  foliage.refreshBoundingInfo();
  for (const instance of foliage.instances) instance.refreshBoundingInfo();

  const barkSize = 128, barkPixels = new Uint8Array(barkSize * barkSize * 4);
  for (let y = 0; y < barkSize; y += 1) for (let x = 0; x < barkSize; x += 1) {
    const groove = Math.sin(x * Math.PI * 24 / barkSize + Math.sin(y * Math.PI * 2 / barkSize) * 0.8);
    const grain = Math.sin(x * Math.PI * 42 / barkSize + y * Math.PI * 10 / barkSize) * 4;
    const fissure = groove < -0.82 ? 13 : 0;
    const flake = wrappedNoise(x, y, barkSize, 16, 4) * 19;
    const shade = Math.round(130 + groove * 12 + grain + flake - fissure);
    barkPixels.set([shade, Math.round(shade * 0.89), Math.round(shade * 0.72), 255], (y * barkSize + x) * 4);
  }
  const bark = RawTexture.CreateRGBATexture(barkPixels, barkSize, barkSize, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  bark.name = "ultra-tree-bark";
  bark.wrapU = bark.wrapV = Texture.WRAP_ADDRESSMODE;
  bark.uScale = 2; bark.vScale = 4;
  const trunkMaterial = trunk.material as StandardMaterial;
  trunkMaterial.diffuseTexture = bark;
  const barkNormal = createSurfaceNormal(scene, barkPixels, barkSize, "ultra-tree-bark-normal", 1.8);
  barkNormal.uScale = bark.uScale; barkNormal.vScale = bark.vScale;
  barkNormal.level = 0.45;
  trunkMaterial.bumpTexture = barkNormal;
  trunkMaterial.diffuseColor.set(0.85, 0.83, 0.78);
  trunkMaterial.specularColor.setAll(0.03);
  // 只替换共享渲染模板，保持树干的外径、高度、实例变换及权威记录。
  CreateCylinderVertexData({ height: 5.8, diameterTop: 0.55, diameterBottom: 1.1, tessellation: 16 }).applyToMesh(trunk);
  trunk.refreshBoundingInfo();
  for (const instance of trunk.instances) instance.refreshBoundingInfo();
  enhanceUnderstory(scene);
  enhanceRocks(scene);
}

function wrappedNoise(x: number, y: number, size: number, frequencyX: number, frequencyY: number): number {
  const ax = x * frequencyX / size, ay = y * frequencyY / size;
  const ix = Math.floor(ax), iy = Math.floor(ay), tx = ax - ix, ty = ay - iy;
  const u = tx * tx * (3 - 2 * tx), v = ty * ty * (3 - 2 * ty);
  const hash = (gx: number, gy: number): number => {
    const value = Math.sin((gx % frequencyX) * 127.1 + (gy % frequencyY) * 311.7) * 43758.5453;
    return value - Math.floor(value);
  };
  const a = hash(ix, iy) * (1 - u) + hash(ix + 1, iy) * u;
  const b = hash(ix, iy + 1) * (1 - u) + hash(ix + 1, iy + 1) * u;
  return a * (1 - v) + b * v;
}

function createSurfaceNormal(scene: Scene, pixels: Uint8Array, size: number, name: string, strength: number): RawTexture {
  const normals = new Uint8Array(pixels.length);
  const height = (x: number, y: number): number => pixels[(((y + size) % size) * size + (x + size) % size) * 4]! / 255;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const nx = (height(x - 1, y) - height(x + 1, y)) * strength;
    const ny = (height(x, y - 1) - height(x, y + 1)) * strength;
    const inverse = 1 / Math.hypot(nx, ny, 1);
    normals.set([Math.round((nx * inverse * 0.5 + 0.5) * 255), Math.round((ny * inverse * 0.5 + 0.5) * 255),
      Math.round((inverse * 0.5 + 0.5) * 255), 255], (y * size + x) * 4);
  }
  const texture = RawTexture.CreateRGBATexture(normals, size, size, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  texture.name = name;
  texture.gammaSpace = false;
  texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
  return texture;
}

function enhanceRocks(scene: Scene): void {
  const rock = scene.getMeshByName("rock-template") as Mesh | null;
  if (!rock) return;
  const data = VertexData.ExtractFromMesh(rock), positions = data.positions!;
  const colors: number[] = [];
  // 同位置重复顶点用连续函数变形，避免球体 UV 接缝撕裂；不增加三角形。
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index]!, y = positions[index + 1]!, z = positions[index + 2]!;
    const shape = 0.82 + Math.sin(x * 9 + z * 4) * Math.cos(y * 7 - z * 5) * 0.18;
    positions[index] = x * shape + y * 0.11;
    positions[index + 1] = y < -0.27 ? -0.56 : y * (1 + Math.cos(x * 6 - z * 8) * 0.16 * (1 - Math.abs(y) * 2));
    positions[index + 2] = z * shape - y * 0.07;
    const mineral = 0.86 + Math.sin(x * 13 + y * 9 + z * 7) * 0.09;
    const moss = Math.max(0, -y - 0.12) * 0.25;
    colors.push(mineral - moss, mineral, mineral - moss * 1.5, 1);
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, data.indices!, normals);
  data.normals = normals;
  data.colors = colors;
  data.applyToMesh(rock);
  rock.refreshBoundingInfo();
  for (const instance of rock.instances) instance.refreshBoundingInfo();
  const size = 128, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const broad = wrappedNoise(x, y, size, 4, 4), grain = wrappedNoise(x, y, size, 32, 32);
    const seam = wrappedNoise(x, y, size, 8, 8), fissure = Math.abs(seam - 0.46) < 0.035 ? 13 : 0;
    const shade = Math.round(105 + broad * 34 + grain * 23 - fissure);
    pixels.set([shade, Math.round(shade * 0.98), Math.round(shade * 0.92), 255], (y * size + x) * 4);
  }
  const texture = RawTexture.CreateRGBATexture(pixels, size, size, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  texture.name = "ultra-rock-mineral";
  texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.uScale = texture.vScale = 2;
  const material = rock.material as StandardMaterial;
  material.diffuseTexture = texture;
  material.diffuseColor.set(1, 1, 1);
  material.specularColor.setAll(0.025);
  const normal = createSurfaceNormal(scene, pixels, size, "ultra-rock-normal", 1.4);
  normal.uScale = normal.vScale = 2;
  material.bumpTexture = normal;
}

function enhanceUnderstory(scene: Scene): void {
  const shrub = scene.getMeshByName("shrub-template") as Mesh | null;
  if (!shrub) return;
  const size = 256, pixels = new Uint8Array(size * size * 4);
  const paint = (x: number, y: number, r: number, g: number, b: number): void => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    pixels.set([r, g, b, 255], (Math.floor(y) * size + Math.floor(x)) * 4);
  };
  // 左半张为带叶脉的分枝，右半张为草叶／花穗；全部低矮植物共享一份图集。
  for (let y = 8; y < 244; y += 1) {
    paint(63 + Math.sin(y * 0.025) * 3, y, 101, 93, 49);
    paint(64 + Math.sin(y * 0.025) * 3, y, 85, 83, 40);
  }
  for (let leaf = 0; leaf < 20; leaf += 1) {
    const rootY = 30 + leaf * 10, side = leaf % 2 ? -1 : 1;
    const cx = 64 + side * (18 + (leaf * 7) % 16), cy = rootY + 12;
    for (let t = 0; t < 24; t += 1) paint(64 + side * t, rootY + t * 0.4, 86, 98, 42);
    for (let y = -14; y <= 14; y += 1) for (let x = -18; x <= 18; x += 1) {
      const along = (x * side + y * 0.45) / 19, across = (y - x * side * 0.45) / 8;
      if (along * along + across * across > 1) continue;
      const ridge = Math.abs(across) < 0.1 ? 18 : 0;
      const shade = Math.round(9 * along + ((x * 11 + y * 7 + leaf * 13) % 7));
      paint(cx + x, cy + y, 80 + shade + ridge, 110 + shade + ridge, 48 + shade);
    }
  }
  for (let blade = 0; blade < 11; blade += 1) {
    const startX = 191 + (blade % 3 - 1) * 4, tipX = 139 + blade * 10;
    const tipY = 9 + (blade * 19) % 70;
    for (let y = tipY; y < 244; y += 1) {
      const t = (244 - y) / (244 - tipY), x = startX + (tipX - startX) * t * t;
      const width = Math.max(1, Math.round((1 - t) * 2));
      for (let dx = -width; dx <= width; dx += 1) paint(x + dx, y, 100 + blade * 2, 124 + blade * 2, 49 + blade);
    }
  }
  // 暖白花穗仅画在草叶图块顶部；叶簇仍保持自然的绿色主体。
  for (let flower = 0; flower < 9; flower += 1) {
    const cx = 191 + Math.sin(flower * 2.4) * 11, cy = 20 + flower * 5;
    for (let y = -2; y <= 2; y += 1) for (let x = -3; x <= 3; x += 1) {
      if (x * x / 9 + y * y / 4 <= 1) paint(cx + x, cy + y, 188, 173 + flower * 2, 115);
    }
  }
  const texture = RawTexture.CreateRGBATexture(pixels, size, size, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  texture.name = "ultra-understory-leaves";
  texture.hasAlpha = true;
  texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  const material = shrub.material as StandardMaterial;
  material.diffuseTexture = texture;
  material.diffuseColor.set(1, 1, 1);
  material.specularColor.setAll(0.02);
  material.useAlphaFromDiffuseTexture = true;
  material.transparencyMode = Material.MATERIAL_ALPHATEST;
  material.backFaceCulling = false;
  material.twoSidedLighting = true;
  const createPlant = (sprays: number, grasses: number): VertexData => {
    const positions: number[] = [], indices: number[] = [], normals: number[] = [], uvs: number[] = [], colors: number[] = [];
    for (let index = 0; index < sprays + grasses; index += 1) {
      const grass = index >= sprays, angle = index * 2.399;
      const radius = grass ? 0.36 : 0.09 + (index % 4) * 0.07;
      const x = Math.sin(angle) * radius, z = Math.cos(angle) * radius;
      const height = grass ? 0.42 + (index % 3) * 0.09 : 0.68 + (index % 5) * 0.075;
      const width = grass ? 0.16 : 0.22, dx = Math.cos(angle) * width, dz = -Math.sin(angle) * width;
      const bendX = Math.sin(angle) * 0.11, bendZ = Math.cos(angle) * 0.11, start = positions.length / 3;
      positions.push(x - dx * 0.3, -0.5, z - dz * 0.3, x + dx * 0.3, -0.5, z + dz * 0.3,
        x + dx + bendX, -0.5 + height, z + dz + bendZ, x - dx + bendX, -0.5 + height, z - dz + bendZ);
      const lo = grass ? 0.505 : 0.005, hi = grass ? 0.995 : 0.495;
      uvs.push(lo, 0.96, hi, 0.96, hi, 0.02, lo, 0.02);
      indices.push(start, start + 2, start + 1, start, start + 3, start + 2);
      const shade = 0.8 + (index % 5) * 0.045;
      for (let vertex = 0; vertex < 4; vertex += 1) colors.push(shade, shade, shade, 1);
    }
    VertexData.ComputeNormals(positions, indices, normals);
    const data = new VertexData();
    data.positions = positions; data.indices = indices; data.normals = normals; data.uvs = uvs; data.colors = colors;
    return data;
  };
  createPlant(24, 8).applyToMesh(shrub);
  const distant = new Mesh("ultra-understory-lod", scene);
  createPlant(6, 2).applyToMesh(distant);
  distant.material = material;
  distant.isPickable = false;
  distant.checkCollisions = false;
  distant.metadata = { decoration: "natural-detail", detailType: "shrub", visualLod: "distant" };
  shrub.addLODLevel(ULTRA_PRESENTATION.understoryLodDistance, distant);
  shrub.refreshBoundingInfo();
  // 原球体中心距地面0.68m；叶簇从底部生长，按每个实例高度校准接地。
  for (const instance of shrub.instances as InstancedMesh[]) {
    instance.position.y += instance.scaling.y * 0.5 - 0.68;
    if (instance.isWorldMatrixFrozen) instance.freezeWorldMatrix();
    else instance.computeWorldMatrix(true);
    instance.refreshBoundingInfo();
  }
}
