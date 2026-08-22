import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { FRAG_GRENADE_CONFIG } from "../../config/throwables";
import type { EntityId, GameEvent } from "../../game/state/types";

const TRACER_CAPACITY = 16;
const MUZZLE_CAPACITY = 4;
const IMPACT_CAPACITY = 12;
const PARTICLE_CAPACITY = 32;
const DECAL_CAPACITY = 20;
const EXPLOSION_CAPACITY = 4;
const PARTICLES_PER_ENVIRONMENT_HIT = 4;
const PARTICLES_PER_GRENADE_EXPLOSION = 8;

const TRACER_LIFETIME_SECONDS = 0.08;
const MUZZLE_LIFETIME_SECONDS = 0.06;
const IMPACT_LIFETIME_SECONDS = 0.16;
const DECAL_LIFETIME_SECONDS = 8;
const EXPLOSION_LIFETIME_SECONDS = 0.34;
const GRENADE_EXPLOSION_INITIAL_RADIUS = 0.6;
const GRENADE_PARTICLE_LIFETIME_SECONDS = 0.52;

type ShotTracedEvent = Extract<GameEvent, { type: "shot-traced" }>;

interface TimedMeshSlot {
  readonly mesh: Mesh;
  remainingSeconds: number;
  finalFrame: boolean;
}

interface ParticleSlot extends TimedMeshSlot {
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  gravity: number;
  holdFinalFrame: boolean;
}

interface EffectMaterials {
  readonly localTracer: StandardMaterial;
  readonly remoteTracer: StandardMaterial;
  readonly muzzle: StandardMaterial;
  readonly environmentImpact: StandardMaterial;
  readonly actorHit: StandardMaterial;
  readonly playerHit: StandardMaterial;
  readonly spark: StandardMaterial;
  readonly dust: StandardMaterial;
  readonly decal: StandardMaterial;
  readonly explosion: StandardMaterial;
}

export interface CombatEffectsCounters {
  readonly tracerCapacity: number;
  readonly muzzleCapacity: number;
  readonly impactCapacity: number;
  readonly particleCapacity: number;
  readonly decalCapacity: number;
  readonly explosionCapacity: number;
  readonly materialCapacity: number;
  readonly activeTracers: number;
  readonly activeMuzzles: number;
  readonly activeImpacts: number;
  readonly activeParticles: number;
  readonly activeDecals: number;
  readonly activeExplosions: number;
}

export class CombatEffects {
  private readonly materials: EffectMaterials;
  private readonly materialPool: readonly StandardMaterial[];
  private readonly tracers: TimedMeshSlot[];
  private readonly muzzleFlashes: TimedMeshSlot[];
  private readonly impacts: TimedMeshSlot[];
  private readonly particles: ParticleSlot[];
  private readonly decals: TimedMeshSlot[];
  private readonly explosions: TimedMeshSlot[];
  private readonly lookTarget = new Vector3();
  private readonly surfaceNormal = new Vector3();
  private tracerCursor = 0;
  private muzzleCursor = 0;
  private impactCursor = 0;
  private particleCursor = 0;
  private decalCursor = 0;
  private explosionCursor = 0;
  private disposed = false;

  public constructor(scene: Scene) {
    this.materials = {
      localTracer: effectMaterial(scene, "combat-effects-local-tracer-material", "#ffe287", 0.92),
      remoteTracer: effectMaterial(scene, "combat-effects-remote-tracer-material", "#ff8a5b", 0.86),
      muzzle: effectMaterial(scene, "combat-effects-muzzle-material", "#fff2ad", 0.96),
      environmentImpact: effectMaterial(scene, "combat-effects-environment-impact-material", "#d8b27a", 0.88),
      actorHit: effectMaterial(scene, "combat-effects-actor-hit-material", "#62dce8", 0.92),
      playerHit: effectMaterial(scene, "combat-effects-player-hit-material", "#ff595e", 0.94),
      spark: effectMaterial(scene, "combat-effects-spark-material", "#ffd166", 0.96),
      dust: effectMaterial(scene, "combat-effects-dust-material", "#9d866a", 0.68),
      decal: effectMaterial(scene, "combat-effects-decal-material", "#24221f", 0.82),
      explosion: effectMaterial(scene, "combat-effects-explosion-material", "#ff9d3f", 0.9),
    };
    this.materials.decal.backFaceCulling = false;
    this.materialPool = Object.values(this.materials);

    this.tracers = Array.from({ length: TRACER_CAPACITY }, (_, index) => {
      const mesh = CreateBox(
        `combat-effect-tracer-${index}`,
        { width: 0.025, height: 0.025, depth: 1 },
        scene,
      );
      mesh.material = this.materials.localTracer;
      return pooledMesh(mesh);
    });
    this.muzzleFlashes = Array.from({ length: MUZZLE_CAPACITY }, (_, index) => {
      const mesh = CreateSphere(`combat-effect-muzzle-${index}`, { diameter: 0.16, segments: 6 }, scene);
      mesh.material = this.materials.muzzle;
      return pooledMesh(mesh);
    });
    this.impacts = Array.from({ length: IMPACT_CAPACITY }, (_, index) => {
      const mesh = CreateSphere(`combat-effect-impact-${index}`, { diameter: 0.18, segments: 6 }, scene);
      mesh.material = this.materials.environmentImpact;
      return pooledMesh(mesh);
    });
    this.particles = Array.from({ length: PARTICLE_CAPACITY }, (_, index) => {
      const mesh = CreateSphere(`combat-effect-particle-${index}`, { diameter: 0.08, segments: 4 }, scene);
      mesh.material = this.materials.spark;
      return {
        ...pooledMesh(mesh),
        velocityX: 0,
        velocityY: 0,
        velocityZ: 0,
        gravity: 0,
        holdFinalFrame: false,
      };
    });
    this.decals = Array.from({ length: DECAL_CAPACITY }, (_, index) => {
      const mesh = CreateDisc(`combat-effect-decal-${index}`, { radius: 0.11, tessellation: 12 }, scene);
      mesh.material = this.materials.decal;
      return pooledMesh(mesh);
    });
    this.explosions = Array.from({ length: EXPLOSION_CAPACITY }, (_, index) => {
      const mesh = CreateSphere(`combat-effect-explosion-${index}`, { diameter: 1, segments: 8 }, scene);
      mesh.material = this.materials.explosion;
      return pooledMesh(mesh);
    });
  }

  public get counters(): CombatEffectsCounters {
    return {
      tracerCapacity: this.tracers.length,
      muzzleCapacity: this.muzzleFlashes.length,
      impactCapacity: this.impacts.length,
      particleCapacity: this.particles.length,
      decalCapacity: this.decals.length,
      explosionCapacity: this.explosions.length,
      materialCapacity: this.materialPool.length,
      activeTracers: countActive(this.tracers),
      activeMuzzles: countActive(this.muzzleFlashes),
      activeImpacts: countActive(this.impacts),
      activeParticles: countActive(this.particles),
      activeDecals: countActive(this.decals),
      activeExplosions: countActive(this.explosions),
    };
  }

  public handleEvents(events: readonly GameEvent[], playerId: EntityId): void {
    if (this.disposed) return;

    const flashedActors = new Set<EntityId>();
    for (const event of events) {
      if (event.type === "grenade-exploded") {
        this.showGrenadeExplosion(event.position);
        continue;
      }
      if (event.type !== "shot-traced") continue;
      if (!flashedActors.has(event.actorId)) {
        this.showMuzzleFlash(event);
        flashedActors.add(event.actorId);
      }
      this.showTracer(event, playerId);
      if (event.hitType === "environment") {
        this.showEnvironmentImpact(event);
      } else if (event.hitType === "actor") {
        this.showActorImpact(event, playerId);
      }
    }
  }

  public handleImpacts(events: readonly GameEvent[], playerId: EntityId): void {
    if (this.disposed) return;
    for (const event of events) {
      if (event.type !== "shot-traced") continue;
      if (event.hitType === "environment") {
        this.showEnvironmentImpact(event);
      } else if (event.hitType === "actor") {
        this.showActorImpact(event, playerId);
      }
    }
  }

  public update(deltaSeconds: number): void {
    if (this.disposed || !(deltaSeconds > 0)) return;

    updateTimedPool(this.tracers, deltaSeconds);
    updateTimedPool(this.muzzleFlashes, deltaSeconds);
    updateTimedPool(this.impacts, deltaSeconds);
    updateTimedPool(this.decals, deltaSeconds);
    for (const explosion of this.explosions) {
      if (finishFinalFrame(explosion)) continue;
      if (explosion.remainingSeconds <= 0) continue;
      const remainingSeconds = Math.max(0, explosion.remainingSeconds - deltaSeconds);
      const progress = 1 - remainingSeconds / EXPLOSION_LIFETIME_SECONDS;
      const radius = GRENADE_EXPLOSION_INITIAL_RADIUS +
        progress * (FRAG_GRENADE_CONFIG.visualRadius - GRENADE_EXPLOSION_INITIAL_RADIUS);
      explosion.mesh.scaling.setAll(radius * 2);
      explosion.remainingSeconds = remainingSeconds || Number.EPSILON;
      explosion.finalFrame = remainingSeconds === 0;
    }

    for (const particle of this.particles) {
      if (finishFinalFrame(particle)) continue;
      if (particle.remainingSeconds <= 0) continue;
      const elapsedSeconds = Math.min(deltaSeconds, particle.remainingSeconds);
      particle.remainingSeconds -= elapsedSeconds;
      particle.mesh.position.x += particle.velocityX * elapsedSeconds;
      particle.mesh.position.y += particle.velocityY * elapsedSeconds;
      particle.mesh.position.z += particle.velocityZ * elapsedSeconds;
      particle.velocityY -= particle.gravity * elapsedSeconds;
      if (particle.remainingSeconds <= 0) {
        if (particle.holdFinalFrame) {
          particle.remainingSeconds = Number.EPSILON;
          particle.finalFrame = true;
        } else {
          particle.remainingSeconds = 0;
          particle.mesh.setEnabled(false);
        }
      }
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    disposePool(this.tracers);
    disposePool(this.muzzleFlashes);
    disposePool(this.impacts);
    disposePool(this.particles);
    disposePool(this.decals);
    disposePool(this.explosions);
    for (const material of this.materialPool) material.dispose();
  }

  private showTracer(event: ShotTracedEvent, playerId: EntityId): void {
    const dx = event.end.x - event.origin.x;
    const dy = event.end.y - event.origin.y;
    const dz = event.end.z - event.origin.z;
    const fullLength = Math.hypot(dx, dy, dz);
    if (fullLength <= 0.001) return;
    const originOffset = event.actorId === playerId ? Math.min(0.72, fullLength * 0.25) : 0.2;
    const startX = event.origin.x + dx / fullLength * originOffset;
    const startY = event.origin.y + dy / fullLength * originOffset;
    const startZ = event.origin.z + dz / fullLength * originOffset;
    const length = Math.max(0.001, fullLength - originOffset);

    const index = acquireIndex(this.tracers, this.tracerCursor);
    this.tracerCursor = (index + 1) % this.tracers.length;
    const slot = this.tracers[index];
    slot.mesh.position.set(
      (startX + event.end.x) * 0.5,
      (startY + event.end.y) * 0.5,
      (startZ + event.end.z) * 0.5,
    );
    slot.mesh.scaling.set(1, 1, length);
    slot.mesh.lookAt(this.lookTarget.set(event.end.x, event.end.y, event.end.z));
    slot.mesh.material = event.actorId === playerId ? this.materials.localTracer : this.materials.remoteTracer;
    activate(slot, TRACER_LIFETIME_SECONDS);
  }

  private showGrenadeExplosion(position: { x: number; y: number; z: number }): void {
    const index = acquireIndex(this.explosions, this.explosionCursor);
    this.explosionCursor = (index + 1) % this.explosions.length;
    const explosion = this.explosions[index];
    explosion.mesh.position.set(position.x, position.y, position.z);
    explosion.mesh.scaling.setAll(1.2);
    activate(explosion, EXPLOSION_LIFETIME_SECONDS);

    for (let sequence = 0; sequence < PARTICLES_PER_GRENADE_EXPLOSION; sequence += 1) {
      const particleIndex = acquireIndex(this.particles, this.particleCursor);
      this.particleCursor = (particleIndex + 1) % this.particles.length;
      const particle = this.particles[particleIndex];
      const angle = sequence / PARTICLES_PER_GRENADE_EXPLOSION * Math.PI * 2;
      particle.mesh.position.set(position.x, position.y, position.z);
      particle.mesh.scaling.setAll(1.4);
      particle.mesh.material = sequence % 2 === 0 ? this.materials.spark : this.materials.dust;
      const horizontalSpeed = FRAG_GRENADE_CONFIG.visualRadius / GRENADE_PARTICLE_LIFETIME_SECONDS *
        (0.75 + sequence / (PARTICLES_PER_GRENADE_EXPLOSION - 1) * 0.25);
      particle.velocityX = Math.cos(angle) * horizontalSpeed;
      particle.velocityY = 2.2 + (sequence % 3) * 0.6;
      particle.velocityZ = Math.sin(angle) * horizontalSpeed;
      particle.gravity = 5.5;
      particle.holdFinalFrame = true;
      activate(particle, GRENADE_PARTICLE_LIFETIME_SECONDS);
    }
  }

  private showMuzzleFlash(event: ShotTracedEvent): void {
    const index = acquireIndex(this.muzzleFlashes, this.muzzleCursor);
    this.muzzleCursor = (index + 1) % this.muzzleFlashes.length;
    const slot = this.muzzleFlashes[index];
    const dx = event.end.x - event.origin.x;
    const dy = event.end.y - event.origin.y;
    const dz = event.end.z - event.origin.z;
    const length = Math.hypot(dx, dy, dz) || 1;
    slot.mesh.position.set(
      event.origin.x + dx / length * 0.62,
      event.origin.y + dy / length * 0.62,
      event.origin.z + dz / length * 0.62,
    );
    slot.mesh.scaling.setAll(1);
    activate(slot, MUZZLE_LIFETIME_SECONDS);
  }

  private showEnvironmentImpact(event: ShotTracedEvent): void {
    this.setSurfaceNormal(event);
    this.showImpact(event, this.materials.environmentImpact);

    const decalIndex = acquireIndex(this.decals, this.decalCursor);
    this.decalCursor = (decalIndex + 1) % this.decals.length;
    const decal = this.decals[decalIndex];
    decal.mesh.position.set(
      event.end.x + this.surfaceNormal.x * 0.04,
      event.end.y + this.surfaceNormal.y * 0.04,
      event.end.z + this.surfaceNormal.z * 0.04,
    );
    decal.mesh.scaling.setAll(1);
    decal.mesh.lookAt(
      this.lookTarget.set(
        decal.mesh.position.x + this.surfaceNormal.x,
        decal.mesh.position.y + this.surfaceNormal.y,
        decal.mesh.position.z + this.surfaceNormal.z,
      ),
    );
    activate(decal, DECAL_LIFETIME_SECONDS);

    for (let particleIndex = 0; particleIndex < PARTICLES_PER_ENVIRONMENT_HIT; particleIndex += 1) {
      this.showEnvironmentParticle(event, particleIndex);
    }
  }

  private showActorImpact(event: ShotTracedEvent, playerId: EntityId): void {
    this.setSurfaceNormal(event);
    const material = event.targetId === playerId ? this.materials.playerHit : this.materials.actorHit;
    this.showImpact(event, material);
  }

  private showImpact(event: ShotTracedEvent, material: StandardMaterial): void {
    const index = acquireIndex(this.impacts, this.impactCursor);
    this.impactCursor = (index + 1) % this.impacts.length;
    const slot = this.impacts[index];
    slot.mesh.position.set(
      event.end.x + this.surfaceNormal.x * 0.045,
      event.end.y + this.surfaceNormal.y * 0.045,
      event.end.z + this.surfaceNormal.z * 0.045,
    );
    slot.mesh.scaling.setAll(1);
    slot.mesh.material = material;
    activate(slot, IMPACT_LIFETIME_SECONDS);
  }

  private showEnvironmentParticle(event: ShotTracedEvent, sequence: number): void {
    const index = acquireIndex(this.particles, this.particleCursor);
    this.particleCursor = (index + 1) % this.particles.length;
    const slot = this.particles[index];
    const dust = sequence % 2 === 1;
    const angle = sequence * 2.399963;
    const spread = dust ? 0.55 : 1.2;
    const normalSpeed = dust ? 0.45 : 1.65;

    slot.mesh.position.set(
      event.end.x + this.surfaceNormal.x * 0.035,
      event.end.y + this.surfaceNormal.y * 0.035,
      event.end.z + this.surfaceNormal.z * 0.035,
    );
    slot.mesh.scaling.setAll(dust ? 1.35 : 0.58);
    slot.mesh.material = dust ? this.materials.dust : this.materials.spark;
    slot.velocityX = this.surfaceNormal.x * normalSpeed + Math.cos(angle) * spread;
    slot.velocityY = this.surfaceNormal.y * normalSpeed + (dust ? 0.22 : 0.55);
    slot.velocityZ = this.surfaceNormal.z * normalSpeed + Math.sin(angle) * spread;
    slot.gravity = dust ? 0.8 : 4.8;
    slot.holdFinalFrame = false;
    activate(slot, dust ? 0.42 : 0.24);
  }

  private setSurfaceNormal(event: ShotTracedEvent): void {
    this.surfaceNormal.set(event.normal.x, event.normal.y, event.normal.z);
    const lengthSquared = this.surfaceNormal.lengthSquared();
    if (lengthSquared <= 0.000001) {
      this.surfaceNormal.set(0, 1, 0);
    } else {
      this.surfaceNormal.scaleInPlace(1 / Math.sqrt(lengthSquared));
    }
  }
}

function effectMaterial(scene: Scene, name: string, hex: string, alpha: number): StandardMaterial {
  const color = Color3.FromHexString(hex);
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = color;
  material.emissiveColor = color;
  material.specularColor = color.scale(0.05);
  material.disableLighting = true;
  material.alpha = alpha;
  return material;
}

function pooledMesh(mesh: Mesh): TimedMeshSlot {
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  mesh.setEnabled(false);
  return { mesh, remainingSeconds: 0, finalFrame: false };
}

function acquireIndex(pool: readonly TimedMeshSlot[], cursor: number): number {
  for (let offset = 0; offset < pool.length; offset += 1) {
    const index = (cursor + offset) % pool.length;
    if (pool[index].remainingSeconds <= 0) return index;
  }
  return cursor;
}

function activate(slot: TimedMeshSlot, lifetimeSeconds: number): void {
  slot.remainingSeconds = lifetimeSeconds;
  slot.finalFrame = false;
  slot.mesh.setEnabled(true);
}

function finishFinalFrame(slot: TimedMeshSlot): boolean {
  if (!slot.finalFrame) return false;
  slot.finalFrame = false;
  slot.remainingSeconds = 0;
  slot.mesh.setEnabled(false);
  return true;
}

function updateTimedPool(pool: readonly TimedMeshSlot[], deltaSeconds: number): void {
  for (const slot of pool) {
    if (slot.remainingSeconds <= 0) continue;
    slot.remainingSeconds -= deltaSeconds;
    if (slot.remainingSeconds > 0) continue;
    slot.remainingSeconds = 0;
    slot.mesh.setEnabled(false);
  }
}

function countActive(pool: readonly TimedMeshSlot[]): number {
  let active = 0;
  for (const slot of pool) {
    if (slot.remainingSeconds > 0) active += 1;
  }
  return active;
}

function disposePool(pool: readonly TimedMeshSlot[]): void {
  for (const slot of pool) {
    slot.remainingSeconds = 0;
    slot.mesh.dispose();
  }
}
