import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Material } from "@babylonjs/core/Materials/material";
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
  // 透明针叶枝片在启动时生成一次；枝片只有 alpha test，不进入透明排序。
  line(128, 245, 128, 12, [92, 81, 56, 255], 1);
  for (let tier = 0; tier < 11; tier += 1) for (const side of [-1, 1]) {
    const y = 225 - tier * 18, length = 89 - tier * 5;
    const endX = 128 + side * length, endY = y - 48;
    line(128, y, endX, endY, [64, 79, 46, 255], 1);
    for (let needle = 0; needle < 15; needle += 1) {
      const t = (needle + 1) / 16, x = 128 + side * length * t, atY = y - 48 * t;
      const light = (needle * 13 + tier * 7) % 28;
      line(x, atY, x + side * (9 + t * 9), atY - 15, [79 + light, 104 + light, 57 + light, 255], 1);
      line(x, atY, x + side * 14, atY + 6, [50 + light, 75 + light, 35 + light, 255], 0);
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
      const level = tier * 14 / (tiers - 1);
      const y = -4.5 + level * 0.8;
      for (let branch = 0; branch < branches; branch += 1) {
        const reach = 3.45 * (1 - level / 16) * (0.88 + Math.sin(branch * 13 + tier) * 0.12);
        const atY = y + Math.sin(branch * 5 + tier * 3) * 0.35;
        const angle = branch * Math.PI * 2 / branches + level * 2.399;
        const radialX = Math.sin(angle), radialZ = Math.cos(angle);
        for (const tilt of [-0.95, 0.95]) {
          const start = positions.length / 3, width = reach * 0.48;
          const rootX = radialX * 0.08, rootZ = radialZ * 0.08;
          const endX = radialX * reach, endZ = radialZ * reach;
          const endY = atY - 0.25 + Math.sin(tier + branch) * 0.3;
          const dx = radialZ * width, dz = -radialX * width;
          positions.push(rootX - dx * 0.13, atY, rootZ - dz * 0.13, rootX + dx * 0.13, atY, rootZ + dz * 0.13,
            endX + dx, endY + width * tilt, endZ + dz, endX - dx, endY - width * tilt, endZ - dz);
          uvs.push(0.38, 1, 0.62, 1, 1, 0, 0, 0);
          indices.push(start, start + 2, start + 1, start, start + 3, start + 2);
          const shade = 0.70 + ((tier * 3 + branch * 7) % 9) * 0.035;
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
    const groove = Math.sin(x * 0.74 + Math.sin(y * 0.09) * 1.5);
    const grain = ((x * 37 + y * 17) % 19) - 9;
    const shade = Math.round(108 + groove * 27 + grain);
    barkPixels.set([shade, Math.round(shade * 0.89), Math.round(shade * 0.72), 255], (y * barkSize + x) * 4);
  }
  const bark = RawTexture.CreateRGBATexture(barkPixels, barkSize, barkSize, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  bark.name = "ultra-tree-bark";
  bark.uScale = 2; bark.vScale = 4;
  const trunkMaterial = trunk.material as StandardMaterial;
  trunkMaterial.diffuseTexture = bark;
  trunkMaterial.diffuseColor.set(0.85, 0.83, 0.78);
  trunkMaterial.specularColor.setAll(0.03);
}
