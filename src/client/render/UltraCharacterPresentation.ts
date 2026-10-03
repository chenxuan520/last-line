import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { chamferBox } from "./UltraEquipmentPresentation";

type Surface = "uniform" | "uniformDark" | "uniformLight" | "armor" | "strap" | "skin" | "helmet" | "lens";
type Ring = readonly [x: number, y: number, z: number, radiusX: number, radiusZ: number];

// 在已经校验的 GLB 模板实例化前替换几何，保留挂点、装备分组和远处 LOD。
export function enhanceCharacterContainer(container: AssetContainer): void {
  const surfaces: Surface[] = ["uniform", "uniformDark", "uniformLight", "armor", "strap", "skin", "helmet", "lens"];
  const targets = surfaces.map((surface) => container.meshes.find((mesh) => mesh.name === `character-merged-${surface}`));
  if (targets.some((mesh) => !(mesh instanceof Mesh))) return;
  const scene = container.scene;
  const parts = new Map<Surface, Mesh[]>(surfaces.map((surface) => [surface, []]));
  const add = (mesh: Mesh, surface: Surface): Mesh => {
    mesh.material = container.materials.find((material) => material.name === surface)!;
    parts.get(surface)!.push(mesh);
    return mesh;
  };
  const box = (surface: Surface, x: number, y: number, z: number, w: number, h: number, d: number, bevel = true): Mesh => {
    const mesh = CreateBox(`ultra-character-${surface}`, { width: w, height: h, depth: d }, scene);
    if (bevel && Math.min(w, h, d) > 0.035) chamferBox(mesh, w, h, d);
    mesh.position.set(x, y, z);
    return add(mesh, surface);
  };
  const loft = (surface: Surface, rings: readonly Ring[], segments = 12): void => {
    const positions: number[] = [], indices: number[] = [], uvs: number[] = [], normals: number[] = [];
    for (const [row, [x, y, z, rx, rz]] of rings.entries()) {
      for (let column = 0; column <= segments; column += 1) {
        const angle = column / segments * Math.PI * 2;
        positions.push(x + Math.sin(angle) * rx, y, z + Math.cos(angle) * rz);
        uvs.push(column / segments * 2, y * 3);
        if (row < rings.length - 1 && column < segments) {
          const a = row * (segments + 1) + column, b = a + segments + 1;
          indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    }
    VertexData.ComputeNormals(positions, indices, normals);
    const data = new VertexData();
    data.positions = positions; data.indices = indices; data.normals = normals; data.uvs = uvs;
    const mesh = new Mesh(`ultra-character-${surface}`, scene);
    data.applyToMesh(mesh);
    add(mesh, surface);
  };

  // 以脚底为零点的连续截面：裤腿有膝部收束，肩颈和腰部不再是方盒。
  loft("uniform", [[0, 0.74, 0, 0.19, 0.13], [0, 0.83, 0, 0.22, 0.15], [0, 0.94, 0, 0.20, 0.135], [0, 1.05, 0, 0.235, 0.15], [0, 1.22, -0.01, 0.275, 0.17], [0, 1.32, -0.01, 0.27, 0.145], [0, 1.38, 0, 0.15, 0.10], [0, 1.40, 0, 0.085, 0.075]], 16);
  loft("uniformDark", [[0, 1.34, 0, 0.09, 0.085], [0, 1.43, 0, 0.085, 0.08]], 12);
  for (const side of [-1, 1]) {
    const x = side * 0.125;
    loft("uniform", [[x, 0.13, 0.02, 0.07, 0.075], [x, 0.19, 0.02, 0.075, 0.08], [x, 0.23, 0.015, 0.09, 0.095], [x, 0.27, 0.015, 0.078, 0.085], [x, 0.37, 0.025, 0.095, 0.10], [x, 0.45, 0.035, 0.08, 0.09], [x, 0.49, 0.045, 0.095, 0.10], [x, 0.54, 0.035, 0.09, 0.095], [x, 0.64, 0.01, 0.11, 0.12], [x, 0.78, 0, 0.115, 0.14], [x, 0.87, 0, 0.105, 0.12]]);
    loft("uniformDark", [[x, 0.01, 0.07, 0.085, 0.16], [x, 0.055, 0.07, 0.088, 0.16], [x, 0.10, 0.055, 0.083, 0.145], [x, 0.16, 0.015, 0.072, 0.09], [x, 0.24, 0.01, 0.07, 0.08]]);
    box("strap", x, 0.035, 0.07, 0.18, 0.045, 0.32);
    box("strap", x, 0.475, 0.129, 0.15, 0.15, 0.055);
    box("uniformLight", side * 0.225, 0.67, 0.01, 0.065, 0.18, 0.16);
    box("strap", side * 0.258, 0.735, 0.014, 0.013, 0.024, 0.15, false);
    for (let i = 0; i < 4; i += 1) box("strap", x, 0.13 + i * 0.019, 0.10 - i * 0.009, 0.10, 0.009, 0.009, false);
    // 手臂向持枪点自然收拢，前臂和手套与上臂连续。
    const wristX = side === 1 ? 0.30 : 0.08;
    const wristZ = side === 1 ? 0.29 : 0.39;
    loft("uniformLight", [[wristX, 0.92, wristZ, 0.055, 0.06], [side * 0.32, 0.99, 0.19, 0.075, 0.08], [side * 0.36, 1.04, 0.08, 0.085, 0.095], [side * 0.36, 1.08, 0.015, 0.085, 0.09], [side * 0.34, 1.18, 0, 0.10, 0.10], [side * 0.30, 1.30, -0.005, 0.105, 0.105], [side * 0.25, 1.33, 0, 0.075, 0.08]]);
    box("strap", wristX, 0.94, wristZ, 0.125, 0.045, 0.13);
    box("uniformDark", wristX, 0.90, wristZ + 0.045, 0.115, 0.105, 0.15);
    box("strap", side * 0.385, 1.065, 0.07, 0.05, 0.12, 0.12);
    box("strap", side * 0.18, 1.265, 0.168, 0.07, 0.18, 0.03);
  }
  box("strap", 0, 0.885, 0.01, 0.44, 0.065, 0.31);
  box("helmet", 0, 0.882, 0.18, 0.06, 0.04, 0.018);
  box("uniformDark", 0, 1.13, -0.215, 0.33, 0.40, 0.18);
  box("uniformLight", 0, 1.10, -0.315, 0.27, 0.22, 0.05);
  box("strap", 0, 1.31, -0.225, 0.14, 0.025, 0.07);
  for (const x of [-0.11, 0.11]) box("strap", x, 1.12, -0.347, 0.035, 0.33, 0.014, false);

  loft("armor", [[0, 0.94, 0, 0.215, 0.175], [0, 1.03, 0, 0.245, 0.19], [0, 1.24, 0, 0.26, 0.19], [0, 1.30, 0, 0.20, 0.17]], 12);
  box("armor", 0, 1.14, 0.191, 0.34, 0.27, 0.06);
  for (const x of [-0.13, 0, 0.13]) {
    box("armor", x, 1.005, 0.23, 0.112, 0.16, 0.075);
    box("armor", x, 1.07, 0.274, 0.095, 0.027, 0.015, false);
  }
  for (const y of [1.13, 1.18, 1.23]) box("armor", 0, y, 0.232, 0.30, 0.017, 0.012, false);
  box("armor", -0.22, 1.22, 0.13, 0.08, 0.15, 0.085);
  box("armor", -0.22, 1.34, 0.13, 0.009, 0.14, 0.009, false);

  // 头部采用下颌、颧部和额头截面，面罩与护目镜保留清晰的面部层次。
  loft("skin", [[0, 1.405, 0.015, 0.06, 0.065], [0, 1.435, 0.025, 0.09, 0.09], [0, 1.50, 0.015, 0.115, 0.105], [0, 1.56, 0.005, 0.123, 0.115], [0, 1.64, 0, 0.115, 0.105], [0, 1.69, -0.01, 0.09, 0.085], [0, 1.715, -0.01, 0.025, 0.035]], 20);
  loft("uniformDark", [[0, 1.40, 0.025, 0.075, 0.075], [0, 1.435, 0.035, 0.097, 0.095], [0, 1.49, 0.03, 0.121, 0.111], [0, 1.525, 0.016, 0.125, 0.118]], 20);
  box("skin", 0, 1.542, 0.116, 0.045, 0.06, 0.048);
  for (const side of [-1, 1]) {
    box("strap", side * 0.067, 1.581, 0.109, 0.116, 0.077, 0.063);
    box("lens", side * 0.067, 1.583, 0.144, 0.096, 0.055, 0.012);
    box("uniformDark", side * 0.124, 1.573, -0.005, 0.018, 0.035, 0.22, false);
  }
  box("strap", 0, 1.58, 0.137, 0.045, 0.025, 0.022);
  loft("helmet", [[0, 1.615, -0.008, 0.145, 0.147], [0, 1.645, -0.015, 0.153, 0.152], [0, 1.705, -0.022, 0.139, 0.143], [0, 1.755, -0.02, 0.095, 0.106], [0, 1.777, -0.02, 0.035, 0.045], [0, 1.78, -0.02, 0.001, 0.001]], 20);
  box("helmet", 0, 1.661, 0.139, 0.06, 0.075, 0.018);
  for (const side of [-1, 1]) box("helmet", side * 0.146, 1.639, -0.025, 0.025, 0.045, 0.17);

  let weave = scene.getTextureByName("ultra-character-fabric") as RawTexture | null;
  if (!weave) {
    const size = 64, pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      const value = 224 + ((x * 17 + y * 31) % 13) + ((x + y) % 4 === 0 ? 12 : 0);
      pixels.set([value, value, value, 255], (y * size + x) * 4);
    }
    weave = RawTexture.CreateRGBATexture(pixels, size, size, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
    weave.name = "ultra-character-fabric";
    weave.uScale = weave.vScale = 6;
  }
  for (const [index, surface] of surfaces.entries()) {
    const merged = Mesh.MergeMeshes(parts.get(surface)!, true, true)!;
    const target = targets[index] as Mesh;
    const data = VertexData.ExtractFromMesh(merged);
    // GLB 顶点使用右手坐标；导入根节点负责坐标转换，维持原有正面绕序。
    const indices = Array.from(data.indices!);
    for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2]!, indices[i + 1]!];
    data.indices = indices;
    data.applyToMesh(target);
    const material = target.material as PBRMaterial;
    material.metallic = surface === "lens" ? 0.30 : 0;
    material.roughness = surface === "lens" ? 0.16 : surface === "helmet" ? 0.65 : 0.92;
    if (surface === "uniformDark" || surface === "strap") material.albedoColor.scaleInPlace(0.55);
    material.albedoColor.toLinearSpaceToRef(material.albedoColor);
    if (["uniform", "uniformDark", "uniformLight", "armor"].includes(surface)) material.albedoTexture = weave;
    target.metadata = { ...target.metadata, ultraCharacter: true };
    merged.dispose();
  }
}
