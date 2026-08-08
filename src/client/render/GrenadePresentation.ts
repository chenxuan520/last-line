import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { FRAG_GRENADE_CONFIG } from "../../config/throwables";
import type { ActiveGrenadeState, EntityId, Vector3State } from "../../game/state/types";

const ACTIVE_GRENADE_CAPACITY = 20;
const TRAJECTORY_POINT_CAPACITY = 24;

interface GrenadeSlot {
  mesh: Mesh;
  grenadeId: EntityId | null;
  stateSignature: string;
  velocity: Vector3State;
}

export interface GrenadePresentationCounters {
  activeGrenadeCapacity: number;
  trajectoryPointCapacity: number;
  activeGrenades: number;
  activeTrajectoryPoints: number;
}

export class GrenadePresentation {
  private readonly grenadeMaterial: StandardMaterial;
  private readonly trajectoryMaterial: StandardMaterial;
  private readonly grenades: GrenadeSlot[];
  private readonly trajectoryPoints: Mesh[];
  private readonly slotByGrenadeId = new Map<EntityId, GrenadeSlot>();

  public constructor(scene: Scene) {
    this.grenadeMaterial = createMaterial(scene, "grenade-material", "#485348", 1);
    this.trajectoryMaterial = createMaterial(scene, "grenade-trajectory-material", "#e8d47a", 0.72);
    this.grenades = Array.from({ length: ACTIVE_GRENADE_CAPACITY }, (_, index) => {
      const mesh = CreateSphere(
        `active-grenade-${index}`,
        { diameter: FRAG_GRENADE_CONFIG.collisionRadius * 2, segments: 8 },
        scene,
      );
      mesh.material = this.grenadeMaterial;
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      mesh.setEnabled(false);
      return {
        mesh,
        grenadeId: null,
        stateSignature: "",
        velocity: { x: 0, y: 0, z: 0 },
      };
    });
    this.trajectoryPoints = Array.from({ length: TRAJECTORY_POINT_CAPACITY }, (_, index) => {
      const mesh = CreateSphere(`grenade-trajectory-${index}`, { diameter: 0.12, segments: 4 }, scene);
      mesh.material = this.trajectoryMaterial;
      mesh.isPickable = false;
      mesh.checkCollisions = false;
      mesh.setEnabled(false);
      return mesh;
    });
  }

  public get counters(): GrenadePresentationCounters {
    return {
      activeGrenadeCapacity: this.grenades.length,
      trajectoryPointCapacity: this.trajectoryPoints.length,
      activeGrenades: this.grenades.filter((slot) => slot.grenadeId !== null).length,
      activeTrajectoryPoints: this.trajectoryPoints.filter((mesh) => mesh.isEnabled()).length,
    };
  }

  public sync(activeGrenades: Readonly<Record<EntityId, ActiveGrenadeState>>, deltaSeconds: number): void {
    const visibleIds = new Set(Object.keys(activeGrenades));
    for (const [grenadeId, slot] of this.slotByGrenadeId) {
      if (visibleIds.has(grenadeId)) continue;
      this.releaseSlot(slot);
    }

    for (const grenade of Object.values(activeGrenades).sort((left, right) => left.id.localeCompare(right.id))) {
      let slot = this.slotByGrenadeId.get(grenade.id);
      if (!slot) {
        slot = this.grenades.find((candidate) => candidate.grenadeId === null);
        if (!slot) continue;
        slot.grenadeId = grenade.id;
        this.slotByGrenadeId.set(grenade.id, slot);
        slot.mesh.setEnabled(true);
      }
      const signature = grenadeStateSignature(grenade);
      if (slot.stateSignature !== signature) {
        slot.mesh.position.set(grenade.position.x, grenade.position.y, grenade.position.z);
        slot.velocity = { ...grenade.velocity };
        slot.stateSignature = signature;
      } else if (deltaSeconds > 0) {
        const elapsed = Math.min(0.1, deltaSeconds);
        slot.velocity.y -= FRAG_GRENADE_CONFIG.gravity * elapsed;
        slot.mesh.position.x += slot.velocity.x * elapsed;
        slot.mesh.position.y += slot.velocity.y * elapsed;
        slot.mesh.position.z += slot.velocity.z * elapsed;
      }
      slot.mesh.rotation.x += Math.min(0.1, Math.max(0, deltaSeconds)) * 8;
      slot.mesh.rotation.z += Math.min(0.1, Math.max(0, deltaSeconds)) * 5;
    }
  }

  public showTrajectory(points: readonly Vector3State[] | null): void {
    if (!points || points.length === 0) {
      for (const mesh of this.trajectoryPoints) mesh.setEnabled(false);
      return;
    }
    const lastPointIndex = Math.max(0, points.length - 1);
    for (let index = 0; index < this.trajectoryPoints.length; index += 1) {
      const mesh = this.trajectoryPoints[index];
      if (index >= points.length) {
        mesh.setEnabled(false);
        continue;
      }
      const sourceIndex = this.trajectoryPoints.length >= points.length
        ? index
        : Math.round(index / (this.trajectoryPoints.length - 1) * lastPointIndex);
      const point = points[sourceIndex];
      if (!point) {
        mesh.setEnabled(false);
        continue;
      }
      mesh.position.set(point.x, point.y, point.z);
      mesh.scaling.setAll(index === Math.min(points.length, this.trajectoryPoints.length) - 1 ? 1.8 : 1);
      mesh.setEnabled(true);
    }
  }

  public dispose(): void {
    this.slotByGrenadeId.clear();
    for (const slot of this.grenades) slot.mesh.dispose();
    for (const mesh of this.trajectoryPoints) mesh.dispose();
    this.grenadeMaterial.dispose();
    this.trajectoryMaterial.dispose();
  }

  private releaseSlot(slot: GrenadeSlot): void {
    if (slot.grenadeId !== null) this.slotByGrenadeId.delete(slot.grenadeId);
    slot.grenadeId = null;
    slot.stateSignature = "";
    slot.velocity = { x: 0, y: 0, z: 0 };
    slot.mesh.setEnabled(false);
  }
}

function grenadeStateSignature(grenade: ActiveGrenadeState): string {
  return [
    grenade.position.x,
    grenade.position.y,
    grenade.position.z,
    grenade.velocity.x,
    grenade.velocity.y,
    grenade.velocity.z,
    grenade.fuseSeconds,
  ].join(":");
}

function createMaterial(
  scene: Scene,
  name: string,
  colorValue: string,
  alpha: number,
): StandardMaterial {
  const color = Color3.FromHexString(colorValue);
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = color;
  material.emissiveColor = color.scale(0.16);
  material.specularColor = Color3.Black();
  material.alpha = alpha;
  return material;
}
