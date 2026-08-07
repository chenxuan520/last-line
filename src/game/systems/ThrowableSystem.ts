import {
  createGrenadeThrowVelocity,
  FRAG_GRENADE_CONFIG,
  FRAG_GRENADE_ITEM_ID,
  type FragGrenadeConfig,
} from "../../config/throwables";
import type { ActorCommand } from "../commands/ActorCommand";
import { calculateProtectedDamage } from "../rules/damage";
import { selectSimultaneousSurvivor } from "../rules/resolveSimultaneous";
import type {
  ActiveGrenadeState,
  ActorState,
  EntityId,
  GameEvent,
  MatchState,
  Vector3State,
} from "../state/types";
import type { CombatWorld } from "./CombatSystem";
import { DamageSystem } from "./DamageSystem";

const STOP_SPEED = 0.45;
const COLLISION_SEPARATION = 0.01;
const MAX_MOTION_STEP_SECONDS = 1 / 30;
export const MAX_ACTIVE_BOT_GRENADES = 6;

interface PendingExplosionDamage {
  sourceId: EntityId;
  amount: number;
  origin: Vector3State;
}

export class ThrowableSystem {
  public constructor(
    private readonly config: FragGrenadeConfig = FRAG_GRENADE_CONFIG,
    private readonly damage = new DamageSystem(),
  ) {}

  public processCommands(
    state: MatchState,
    commands: ReadonlyMap<EntityId, ActorCommand>,
    events: GameEvent[],
    aiActorIds: ReadonlySet<EntityId> = new Set(
      Object.values(state.actors)
        .filter((actor) => actor.kind === "bot")
        .map((actor) => actor.id),
    ),
  ): void {
    const ordered = [...commands].sort(([leftId], [rightId]) => leftId.localeCompare(rightId));
    let activeBotGrenades = Object.values(state.activeGrenades).filter(
      (grenade) => grenade.aiControlled,
    ).length;
    for (const [actorId, command] of ordered) {
      if (command.throwGrenade === null) continue;
      const actor = state.actors[actorId];
      if (!actor?.alive || actor.deployment !== "grounded" || actor.inventory.usingItem) continue;
      const aiControlled = aiActorIds.has(actor.id);
      if (aiControlled && activeBotGrenades >= MAX_ACTIVE_BOT_GRENADES) continue;
      if (!removeOne(actor, this.config.itemId)) continue;
      const grenadeId = `grenade-${state.nextGrenadeSequence}`;
      state.nextGrenadeSequence += 1;
      const position = {
        x: actor.position.x,
        y: actor.position.y - 0.3,
        z: actor.position.z,
      };
      const velocity = createGrenadeThrowVelocity(command.aimDirection, command.throwGrenade, this.config);
      state.activeGrenades[grenadeId] = {
        id: grenadeId,
        ownerId: actor.id,
        aiControlled,
        position,
        velocity,
        fuseSeconds: this.config.fuseSeconds,
      };
      if (aiControlled) activeBotGrenades += 1;
      events.push({
        type: "grenade-thrown",
        actorId: actor.id,
        grenadeId,
        position: { ...position },
        velocity: { ...velocity },
      });
    }
  }

  public update(
    state: MatchState,
    deltaSeconds: number,
    world: CombatWorld,
    events: GameEvent[],
  ): void {
    const elapsedSeconds = Math.max(0, deltaSeconds);
    if (elapsedSeconds <= 0) return;
    const exploded: ActiveGrenadeState[] = [];
    const grenades = Object.values(state.activeGrenades).sort((left, right) => left.id.localeCompare(right.id));
    for (const grenade of grenades) {
      let remainingSeconds = Math.min(elapsedSeconds, grenade.fuseSeconds);
      while (remainingSeconds > 0) {
        const stepSeconds = Math.min(MAX_MOTION_STEP_SECONDS, remainingSeconds);
        this.advanceGrenade(grenade, stepSeconds, world);
        grenade.fuseSeconds -= stepSeconds;
        remainingSeconds -= stepSeconds;
      }
      if (grenade.fuseSeconds <= 1e-9) exploded.push(grenade);
    }
    this.explodeGrenades(state, exploded, world, events);
  }

  private advanceGrenade(
    grenade: ActiveGrenadeState,
    deltaSeconds: number,
    world: CombatWorld,
  ): void {
    advanceGrenadeMotion(grenade, deltaSeconds, world, this.config);
  }

  private explodeGrenades(
    state: MatchState,
    grenades: readonly ActiveGrenadeState[],
    world: CombatWorld,
    events: GameEvent[],
  ): void {
    if (grenades.length === 0) return;
    const pendingByTarget = new Map<EntityId, PendingExplosionDamage[]>();
    for (const grenade of grenades) {
      delete state.activeGrenades[grenade.id];
      events.push({
        type: "grenade-exploded",
        grenadeId: grenade.id,
        actorId: grenade.ownerId,
        position: { ...grenade.position },
      });
      for (const actor of Object.values(state.actors)) {
        if (!actor.alive || actor.deployment === "aircraft") continue;
        const distance = vectorDistance(grenade.position, actor.position);
        if (distance > this.config.radius) continue;
        if (world.hasExplosionLineOfSight?.(grenade.position, actor.position) === false) continue;
        const amount = grenadeDamage(distance, this.config);
        if (amount <= 0) continue;
        const pending = pendingByTarget.get(actor.id) ?? [];
        pending.push({ sourceId: grenade.ownerId, amount, origin: { ...grenade.position } });
        pendingByTarget.set(actor.id, pending);
      }
    }

    const living = Object.values(state.actors)
      .filter((actor) => actor.alive)
      .sort((left, right) => left.id.localeCompare(right.id));
    const rawDamageByTarget = new Map<EntityId, number>();
    for (const [targetId, pending] of pendingByTarget) {
      rawDamageByTarget.set(targetId, pending.reduce((total, entry) => total + entry.amount, 0));
    }
    const allWouldDie =
      living.length > 0 &&
      living.every((actor) => wouldBeLethal(actor, rawDamageByTarget.get(actor.id) ?? 0));
    const survivorId = allWouldDie
      ? selectSimultaneousSurvivor(living.map((actor) => actor.id), state.elapsedSeconds)
      : undefined;

    for (const target of living) {
      const pending = pendingByTarget.get(target.id);
      if (!pending || pending.length === 0) continue;
      const source = selectDamageSource(pending);
      this.damage.applyDamage(
        state,
        target.id,
        pending.reduce((total, entry) => total + entry.amount, 0),
        source.sourceId,
        events,
        false,
        target.id === survivorId ? 1 : 0,
        FRAG_GRENADE_ITEM_ID,
        source.origin,
      );
    }
  }
}

export function grenadeDamage(
  distance: number,
  config: FragGrenadeConfig = FRAG_GRENADE_CONFIG,
): number {
  if (!Number.isFinite(distance) || distance >= config.radius) return 0;
  if (distance <= config.fullDamageRadius) return config.maximumDamage;
  const falloff = 1 - (distance - config.fullDamageRadius) / (config.radius - config.fullDamageRadius);
  return config.maximumDamage * Math.max(0, falloff);
}

export function sampleGrenadeTrajectory(
  origin: Vector3State,
  velocity: Vector3State,
  world: CombatWorld,
  config: FragGrenadeConfig = FRAG_GRENADE_CONFIG,
  stepSeconds = MAX_MOTION_STEP_SECONDS,
): Vector3State[] {
  const grenade: ActiveGrenadeState = {
    id: "preview",
    ownerId: "preview",
    aiControlled: false,
    position: { ...origin },
    velocity: { ...velocity },
    fuseSeconds: config.fuseSeconds,
  };
  const points = [{ ...grenade.position }];
  const boundedStep = Math.max(1 / 60, Math.min(0.25, stepSeconds));
  while (grenade.fuseSeconds > 0) {
    const elapsed = Math.min(boundedStep, grenade.fuseSeconds);
    advanceGrenadeMotion(grenade, elapsed, world, config);
    grenade.fuseSeconds -= elapsed;
    points.push({ ...grenade.position });
  }
  return points;
}

function advanceGrenadeMotion(
  grenade: ActiveGrenadeState,
  deltaSeconds: number,
  world: CombatWorld,
  config: FragGrenadeConfig,
): void {
  grenade.velocity.y -= config.gravity * deltaSeconds;
  const displacement = scale(grenade.velocity, deltaSeconds);
  const collision = world.traceThrowable?.(
    grenade.position,
    displacement,
    config.collisionRadius,
  );
  if (!collision) {
    grenade.position = add(grenade.position, displacement);
    return;
  }

  grenade.position = add(collision.point, scale(collision.normal, COLLISION_SEPARATION));
  const normalSpeed = dot(grenade.velocity, collision.normal);
  const normalVelocity = scale(collision.normal, normalSpeed);
  const tangentVelocity = subtract(grenade.velocity, normalVelocity);
  grenade.velocity = add(
    scale(tangentVelocity, config.tangentialDamping),
    scale(normalVelocity, -config.restitution),
  );
  if (Math.hypot(grenade.velocity.x, grenade.velocity.y, grenade.velocity.z) < STOP_SPEED) {
    grenade.velocity = { x: 0, y: 0, z: 0 };
  }
}

function removeOne(actor: ActorState, itemId: string): boolean {
  const stackIndex = actor.inventory.backpack.findIndex(
    (stack) => stack.itemId === itemId && stack.quantity > 0,
  );
  const stack = actor.inventory.backpack[stackIndex];
  if (!stack) return false;
  stack.quantity -= 1;
  if (stack.quantity === 0) actor.inventory.backpack.splice(stackIndex, 1);
  return true;
}

function wouldBeLethal(actor: ActorState, rawDamage: number): boolean {
  return calculateProtectedDamage(actor, rawDamage).healthDamage >= actor.health;
}

function selectDamageSource(pending: readonly PendingExplosionDamage[]): PendingExplosionDamage {
  return [...pending].sort(
    (left, right) => right.amount - left.amount || left.sourceId.localeCompare(right.sourceId),
  )[0] as PendingExplosionDamage;
}

function add(left: Vector3State, right: Vector3State): Vector3State {
  return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z };
}

function subtract(left: Vector3State, right: Vector3State): Vector3State {
  return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

function scale(value: Vector3State, amount: number): Vector3State {
  return { x: value.x * amount, y: value.y * amount, z: value.z * amount };
}

function dot(left: Vector3State, right: Vector3State): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function vectorDistance(left: Vector3State, right: Vector3State): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}
