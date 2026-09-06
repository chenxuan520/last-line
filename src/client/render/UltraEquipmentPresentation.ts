import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import type { Scene } from "@babylonjs/core/scene";

// 顶点色保留物品模板的单材质合批与掉落记录复用。
export function colorEquipmentPart(mesh: Mesh, itemId: string): void {
  const part = mesh.name.slice(itemId.length + 1);
  let color = "#444d43";
  if (itemId.startsWith("weapon.")) color = /stock|grip|pump|mag/.test(part) ? "#33352f" : "#727c80";
  else if (itemId.startsWith("ammo.")) color = /cartridge/.test(part) ? (itemId === "ammo.shell" ? "#ad5145" : "#b8a16c") : /lid/.test(part) ? "#777b62" : "#494f3d";
  else if (itemId === "medkit") color = /cross/.test(part) ? "#f3e9d5" : /handle/.test(part) ? "#303835" : "#a44838";
  else if (itemId === "bandage") color = /wrap/.test(part) ? "#717e62" : "#dfd9bd";
  else if (itemId.startsWith("armor.")) color = /plate|pouch/.test(part) ? "#626451" : "#343e36";
  else if (itemId.startsWith("helmet.")) color = /visor|rim/.test(part) ? "#303c3e" : "#727661";
  else if (itemId === "grenade.frag") color = /fuse|lever/.test(part) ? "#9c9f94" : "#4e5940";
  const rgb = Color3.FromHexString(color);
  const colors = new Float32Array(mesh.getTotalVertices() * 4);
  for (let i = 0; i < colors.length; i += 4) colors.set([rgb.r, rgb.g, rgb.b, 1], i);
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
}

function chamferBox(mesh: Mesh, width: number, height: number, depth: number): void {
  const b = Math.min(width, height, depth) * 0.12;
  const x = width / 2, y = height / 2, z = depth / 2;
  const ring = (inset: number, at: number): number[][] => [
    [-x + b, -y + inset, at], [x - b, -y + inset, at], [x - inset, -y + b, at], [x - inset, y - b, at],
    [x - b, y - inset, at], [-x + b, y - inset, at], [-x + inset, y - b, at], [-x + inset, -y + b, at],
  ];
  const rings = [ring(b * 0.5, -z), ring(0, -z + b), ring(0, z - b), ring(b * 0.5, z)];
  const positions: number[] = [], indices: number[] = [], normals: number[] = [];
  const face = (points: number[][]): void => {
    const start = positions.length / 3;
    positions.push(...points.flat());
    for (let i = 1; i < points.length - 1; i += 1) indices.push(start, start + i + 1, start + i);
  };
  face([...rings[0]!].reverse());
  face(rings[3]!);
  for (let r = 0; r < 3; r += 1) for (let i = 0; i < 8; i += 1) {
    const j = (i + 1) % 8;
    face([rings[r]![i]!, rings[r]![j]!, rings[r + 1]![j]!, rings[r + 1]![i]!]);
  }
  VertexData.ComputeNormals(positions, indices, normals);
  const data = new VertexData();
  data.positions = positions; data.indices = indices; data.normals = normals;
  data.uvs = new Float32Array(positions.length / 3 * 2);
  data.applyToMesh(mesh);
}

export function enhanceViewEquipment(scene: Scene): void {
  const root = scene.getTransformNodeByName("view-weapon-root");
  if (!root) return;
  const makeMaterial = (name: string, hex: string, specular: number, power: number): StandardMaterial => {
    const material = new StandardMaterial(`ultra-equipment-${name}`, scene);
    material.diffuseColor = Color3.FromHexString(hex);
    material.specularColor.setAll(specular);
    material.specularPower = power;
    return material;
  };
  const steel = makeMaterial("steel", "#666e72", 0.55, 96);
  const polymer = makeMaterial("polymer", "#353a32", 0.09, 24);
  const detail = makeMaterial("detail", "#242b2f", 0.3, 72);
  const glass = makeMaterial("lens", "#254b50", 0.8, 128);
  for (const weaponId of ["rifle", "smg", "shotgun", "sniper", "grenade.frag"]) {
    const originals = root.getChildMeshes(false).filter((mesh) => mesh.metadata?.weaponId === weaponId);
    const enabled = originals.some((mesh) => mesh.isEnabled(false));
    const parts: Mesh[] = [];
    for (const original of originals) {
      if (weaponId === "rifle" && /(?:front|rear)-sight$/.test(original.name)) {
        original.dispose();
        continue;
      }
      const half = original.getBoundingInfo().boundingBox.extendSize;
      const scope = weaponId === "sniper" && original.name === "view-sniper-scope";
      const mesh = scope
        ? CreateCylinder("ultra-sniper-scope-body", { diameter: 0.16, height: 0.46, tessellation: 24 }, scene)
        : original.clone(`${original.name}-ultra`, null) as Mesh;
      if (scope) {
        mesh.position.copyFrom(original.position);
        mesh.rotation.x = Math.PI / 2;
      }
      mesh.parent = null;
      mesh.makeGeometryUnique();
      if (!scope && original.getTotalVertices() === 24) chamferBox(mesh, half.x * 2, half.y * 2, half.z * 2);
      mesh.material = /stock|grip|pump|mag|grenade-body/.test(original.name) ? polymer : steel;
      mesh.setEnabled(true);
      parts.push(mesh);
      original.dispose();
    }
    const box = (name: string, x: number, y: number, z: number, w: number, h: number, d: number, material = detail): void => {
      const mesh = CreateBox(`ultra-${weaponId}-${name}`, { width: w, height: h, depth: d }, scene);
      chamferBox(mesh, w, h, d);
      mesh.position.set(0.38 + x, -0.34 + y, 0.72 + z);
      mesh.material = material;
      parts.push(mesh);
    };
    if (weaponId !== "grenade.frag") {
      const receiverHalf = weaponId === "smg" ? 0.13 : weaponId === "shotgun" ? 0.12 : 0.11;
      box("ejection-port", -receiverHalf - 0.002, 0.025, 0.09, 0.008, 0.065, 0.19);
      box("charging-handle", -receiverHalf - 0.025, 0.01, -0.05, 0.075, 0.035, 0.055, steel);
      box("grip", 0, -0.23, -0.23, 0.14, 0.3, 0.18, polymer);
      box("trigger-guard", 0, -0.17, -0.04, 0.09, 0.025, 0.2);
      for (let i = 0; i < 8; i += 1) {
        if (weaponId === "shotgun") box(`pump-rib-${i}`, 0, -0.12, 0.39 + i * 0.037, 0.274, 0.15, 0.012, polymer);
        else if (weaponId !== "sniper") box(`rail-tooth-${i}`, 0, weaponId === "rifle" ? 0.158 : 0.137, -0.12 + i * 0.055, 0.15, 0.024, 0.025, steel);
      }
      for (const z of [-0.2, 0.23]) {
        const pin = CreateCylinder(`ultra-${weaponId}-pin`, { diameter: 0.025, height: 0.008, tessellation: 12 }, scene);
        pin.rotation.z = Math.PI / 2;
        pin.position.set(0.38 - receiverHalf - 0.006, -0.37, 0.72 + z);
        pin.material = steel;
        parts.push(pin);
      }
      if (weaponId === "rifle") {
        for (const [z, base] of [[-0.05, 0.155], [0.7, 0.11]]) {
          box("sight-base", 0, base!, z!, 0.11, 0.022, 0.046);
          for (const x of [-0.042, 0.042]) box("sight-ear", x, base! + 0.04, z!, 0.02, 0.066, 0.03);
          if (z === 0.7) box("sight-post", 0, base! + 0.037, z, 0.015, 0.06, 0.02, steel);
        }
      }
      if (weaponId === "sniper") {
        box("barrel-shank", 0, 0.04, 0.55, 0.10, 0.10, 0.36, steel);
        for (const z of [-0.12, 0.20]) box("scope-mount", 0, 0.13, z, 0.13, 0.08, 0.06);
        const lens = CreateCylinder("ultra-sniper-lens", { diameter: 0.127, height: 0.004, tessellation: 24 }, scene);
        lens.rotation.x = Math.PI / 2;
        lens.position.set(0.38, -0.12, 0.488);
        lens.material = glass;
        parts.push(lens);
      }
    }
    for (const material of [steel, polymer, detail, glass]) {
      const group = parts.filter((mesh) => mesh.material === material);
      if (!group.length) continue;
      const merged = Mesh.MergeMeshes(group, true, true);
      if (!merged) throw new Error(`Unable to merge ultra equipment ${weaponId}`);
      merged.name = `ultra-view-${weaponId}-${material.name}`;
      merged.parent = root;
      merged.position.z = 0.18;
      merged.material = material;
      merged.isPickable = false;
      merged.metadata = { actorVisual: "weapon", weaponId, weaponFallback: true };
      merged.setEnabled(enabled);
    }
  }
}
