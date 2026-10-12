import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { Material } from "@babylonjs/core/Materials/material";
import type { Geometry } from "@babylonjs/core/Meshes/geometry";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";

const uniformColors = new WeakSet<Geometry>();
const observed = new WeakSet<Geometry>();
const revoked = new WeakSet<Geometry>();
const PLANT_TEMPLATES = new Set(["tree-foliage-template", "ultra-tree-foliage-lod", "shrub-template", "ultra-understory-lod"]);

function isStaticSurface(mesh: Mesh): boolean {
  return !mesh.skeleton && !mesh.morphTargetManager && !mesh.bakedVertexAnimationManager &&
    !mesh.getVertexBuffer(VertexBuffer.ColorKind)?.isUpdatable() &&
    (PLANT_TEMPLATES.has(mesh.name) || mesh.name.startsWith("building-walls-") ||
      ["floor-slabs", "roof-slabs", "openings"].includes(mesh.metadata?.detailType));
}

function revoke(geometry: Geometry): void {
  // GPU-only 索引更新不会同步 CPU 数据；同一几何以后保守使用原路径，不重新登记。
  revoked.add(geometry);
  if (!uniformColors.delete(geometry)) return;
  const materials = new Set<Material>();
  for (const owner of geometry.meshes) {
    for (const subMesh of owner.subMeshes ?? []) {
      const material = subMesh.getMaterial();
      if (material) materials.add(material);
    }
  }
  // 包括冻结材质及其全部共享变体；只在第一次失效时执行，不随后续动态更新重复扫描。
  for (const material of materials) material.markDirty(true);
}

// 只登记当前自有静态几何；每个三角形的 RGB 必须严格相同，才能把纠正移到插值之前。
export function registerStaticUniformVertexColors(mesh: Mesh): void {
  const geometry = mesh.geometry;
  if (!geometry || revoked.has(geometry) || !isStaticSurface(mesh) || geometry.meshes.some((owner) => !isStaticSurface(owner))) return;
  const colors = mesh.getVerticesData(VertexBuffer.ColorKind);
  const indices = mesh.getIndices();
  const vertices = mesh.getTotalVertices();
  if (!colors || !indices?.length || indices.length % 3 || colors.length !== vertices * 4) return;
  for (let index = 0; index < indices.length; index += 3) {
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = indices[index + corner]!;
      if (!Number.isInteger(vertex) || vertex < 0 || vertex >= vertices) return;
    }
    const a = indices[index]! * 4, b = indices[index + 1]! * 4, c = indices[index + 2]! * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      const value = colors[a + channel];
      if (!Number.isFinite(value) || value !== colors[b + channel] || value !== colors[c + channel]) return;
    }
  }
  uniformColors.add(geometry);
  if (!observed.has(geometry)) {
    observed.add(geometry);
    const previous = geometry.onGeometryUpdated;
    geometry.onGeometryUpdated = (updated, kind) => {
      revoke(updated);
      previous?.call(updated, updated, kind);
    };
    const updateIndices = geometry.updateIndices;
    geometry.updateIndices = function (this: Geometry, ...args): void {
      revoke(this);
      updateIndices.apply(this, args);
    };
  }
}

export function usesUniformVertexColors(mesh: AbstractMesh): boolean {
  const source = mesh instanceof InstancedMesh ? mesh.sourceMesh : mesh instanceof Mesh ? mesh : null;
  return Boolean(source?.geometry && uniformColors.has(source.geometry) && isStaticSurface(source));
}
