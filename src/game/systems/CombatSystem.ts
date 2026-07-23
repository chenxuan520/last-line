import type { WeaponConfig } from "../../config/weapons";
import type { ActorCommand } from "../commands/ActorCommand";
import { calculateProtectedDamage } from "../rules/damage";
import { selectSimultaneousSurvivor } from "../rules/resolveSimultaneous";
import {
  getActiveWeapon,
  getItemQuantity,
  type ActorState,
  type EntityId,
  type GameEvent,
  type MatchState,
  type Vector3State,
  type WeaponState,
} from "../state/types";
import { DamageSystem } from "./DamageSystem";

export interface ShotTrace {
  shooterId: EntityId;
  origin: Vector3State;
  direction: Vector3State;
  range: number;
}

export interface ShotResult {
  targetId: EntityId | null;
  point: Vector3State;
  normal: Vector3State;
  hitType: "actor" | "environment" | "miss";
}

export interface CombatWorld {
  traceShot(trace: ShotTrace): EntityId | null;
  traceShotDetailed?(trace: ShotTrace): ShotResult;
  hasLineOfSight?(observerId: EntityId, targetId: EntityId): boolean;
}

interface PendingDamage {
  targetId: EntityId;
  sourceId: EntityId;
  amount: number;
  weaponId: string;
}

const TIMER_EPSILON_SECONDS = 1e-9;

export class CombatSystem {
  public constructor(
    private readonly weapons: Readonly<Record<string, WeaponConfig>>,
    private readonly damage = new DamageSystem(),
    private readonly random: () => number = Math.random,
  ) {}

  public update(state: MatchState, deltaSeconds: number, events: GameEvent[]): void {
    const elapsedSeconds = Math.max(0, deltaSeconds);
    const actors = Object.values(state.actors).sort((left, right) => compareIds(left.id, right.id));
    for (const actor of actors) {
      for (const weapon of actor.inventory.weaponSlots) {
        if (!weapon) {
          continue;
        }
        weapon.cooldownSeconds = Math.max(weapon.cooldownSeconds - elapsedSeconds, -elapsedSeconds);
        if (weapon.reloadSeconds <= 0) {
          continue;
        }
        weapon.reloadSeconds = Math.max(0, weapon.reloadSeconds - elapsedSeconds);
        if (weapon.reloadSeconds <= TIMER_EPSILON_SECONDS) {
          weapon.reloadSeconds = 0;
          this.completeReload(actor, weapon);
          events.push({ type: "reload-completed", actorId: actor.id });
        }
      }
    }
  }

  public processCommands(
    state: MatchState,
    commands: ReadonlyMap<EntityId, ActorCommand>,
    world: CombatWorld,
    events: GameEvent[],
    orderedEntries?: readonly (readonly [EntityId, ActorCommand])[],
  ): void {
    const pendingDamage: PendingDamage[] = [];
    const orderedCommands = orderedEntries ?? [...commands].sort(([leftId], [rightId]) => compareIds(leftId, rightId));
    for (const [actorId, command] of orderedCommands) {
      this.collectCommand(state, actorId, command, world, events, pendingDamage);
    }
    this.applyPendingDamage(state, pendingDamage, events);
  }

  public processCommand(
    state: MatchState,
    actorId: EntityId,
    command: ActorCommand,
    world: CombatWorld,
    events: GameEvent[],
  ): void {
    this.processCommands(state, new Map([[actorId, command]]), world, events);
  }

  private collectCommand(
    state: MatchState,
    actorId: EntityId,
    command: ActorCommand,
    world: CombatWorld,
    events: GameEvent[],
    pendingDamage: PendingDamage[],
  ): void {
    const actor = state.actors[actorId];
    if (!actor?.alive || actor.deployment !== "grounded") {
      return;
    }
    if (command.reload) {
      this.startReload(actor, events);
    }
    if (command.fire) {
      this.fire(actor, command, world, events, pendingDamage);
    }
  }

  private startReload(actor: ActorState, events: GameEvent[]): void {
    const weapon = getActiveWeapon(actor);
    const config = weapon ? this.weapons[weapon.weaponId] : undefined;
    if (
      !weapon ||
      !config ||
      weapon.reloadSeconds > 0 ||
      weapon.ammoInMagazine >= config.magazineSize ||
      getItemQuantity(actor, config.ammoItemId) <= 0
    ) {
      return;
    }
    weapon.reloadSeconds = config.reloadSeconds;
    events.push({ type: "reload-started", actorId: actor.id });
  }

  private completeReload(actor: ActorState, weapon: WeaponState): void {
    const config = this.weapons[weapon.weaponId];
    if (!config) {
      return;
    }
    const stack = actor.inventory.backpack.find((candidate) => candidate.itemId === config.ammoItemId);
    if (!stack) {
      return;
    }
    const roundsLoaded = Math.min(config.magazineSize - weapon.ammoInMagazine, stack.quantity);
    weapon.ammoInMagazine += roundsLoaded;
    stack.quantity -= roundsLoaded;
    actor.inventory.backpack = actor.inventory.backpack.filter((candidate) => candidate.quantity > 0);
  }

  private fire(
    actor: ActorState,
    command: ActorCommand,
    world: CombatWorld,
    events: GameEvent[],
    pendingDamage: PendingDamage[],
  ): void {
    const weapon = getActiveWeapon(actor);
    const config = weapon ? this.weapons[weapon.weaponId] : undefined;
    if (
      !weapon ||
      !config ||
      weapon.cooldownSeconds > TIMER_EPSILON_SECONDS ||
      weapon.reloadSeconds > 0 ||
      weapon.ammoInMagazine <= 0
    ) {
      return;
    }

    weapon.ammoInMagazine -= 1;
    weapon.cooldownSeconds += 60 / config.roundsPerMinute;
    const origin = { x: actor.position.x, y: actor.position.y, z: actor.position.z };
    events.push({ type: "shot-fired", actorId: actor.id, weaponId: config.id, origin });
    for (let pellet = 0; pellet < config.pellets; pellet += 1) {
      const direction = addSpread(normalize(command.aimDirection), config.spreadRadians, this.random);
      const trace = {
        shooterId: actor.id,
        origin,
        direction,
        range: config.range,
      };
      const detailed = world.traceShotDetailed?.(trace);
      const targetId = detailed ? detailed.targetId : world.traceShot(trace);
      if (detailed) {
        events.push({
          type: "shot-traced",
          actorId: actor.id,
          origin: trace.origin,
          end: detailed.point,
          normal: detailed.normal,
          hitType: detailed.hitType,
          targetId: detailed.targetId,
        });
      }
      if (targetId && targetId !== actor.id) {
        pendingDamage.push({ targetId, sourceId: actor.id, amount: config.damage, weaponId: config.id });
      }
    }
    if (weapon.ammoInMagazine === 0 && getItemQuantity(actor, config.ammoItemId) > 0) {
      this.startReload(actor, events);
    }
  }

  private applyPendingDamage(state: MatchState, pendingDamage: readonly PendingDamage[], events: GameEvent[]): void {
    if (pendingDamage.length === 0) return;
    const living = Object.values(state.actors)
      .filter((actor) => actor.alive)
      .sort((left, right) => compareIds(left.id, right.id));
    const damageByTarget = new Map<EntityId, number>();
    for (const damage of pendingDamage) {
      damageByTarget.set(damage.targetId, (damageByTarget.get(damage.targetId) ?? 0) + damage.amount);
    }

    const allWouldDie =
      living.length > 0 &&
      living.every((actor) => wouldBeLethal(actor, damageByTarget.get(actor.id) ?? 0));
    const survivorId = allWouldDie
      ? selectSimultaneousSurvivor(living.map((actor) => actor.id), state.elapsedSeconds)
      : undefined;
    const damageDirections = new Map<EntityId, Vector3State>();
    const damageSources = new Map<EntityId, Set<EntityId>>();
    for (const damage of pendingDamage) {
      const target = state.actors[damage.targetId];
      const source = state.actors[damage.sourceId];
      if (!target || !source || target.deployment === "aircraft") continue;
      const direction = normalize({
        x: source.position.x - target.position.x,
        y: source.position.y - target.position.y,
        z: source.position.z - target.position.z,
      });
      const previous = damageDirections.get(damage.targetId) ?? { x: 0, y: 0, z: 0 };
      damageDirections.set(damage.targetId, {
        x: previous.x + direction.x * damage.amount,
        y: previous.y + direction.y * damage.amount,
        z: previous.z + direction.z * damage.amount,
      });
      const sources = damageSources.get(damage.targetId) ?? new Set<EntityId>();
      sources.add(damage.sourceId);
      damageSources.set(damage.targetId, sources);
    }

    for (const damage of pendingDamage) {
      this.damage.applyDamage(
        state,
        damage.targetId,
        damage.amount,
        damage.sourceId,
        events,
        false,
        damage.targetId === survivorId ? 1 : 0,
        damage.weaponId,
      );
    }
    for (const [targetId, aggregate] of damageDirections) {
      const target = state.actors[targetId];
      if (!target) continue;
      let direction = aggregate;
      let length = Math.hypot(direction.x, direction.y, direction.z);
      if (length <= 1e-9) {
        const selectedSourceId = selectSimultaneousSurvivor(
          [...(damageSources.get(targetId) ?? [])],
          state.elapsedSeconds,
        );
        const selectedSource = selectedSourceId ? state.actors[selectedSourceId] : undefined;
        if (!selectedSource) continue;
        direction = {
          x: selectedSource.position.x - target.position.x,
          y: selectedSource.position.y - target.position.y,
          z: selectedSource.position.z - target.position.z,
        };
        length = Math.hypot(direction.x, direction.y, direction.z);
        if (length <= 1e-9) continue;
      }
      target.lastDamageDirection = {
        x: direction.x / length,
        y: direction.y / length,
        z: direction.z / length,
      };
      target.lastDamageElapsedSeconds = state.elapsedSeconds;
    }
  }
}

function compareIds(left: EntityId, right: EntityId): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function wouldBeLethal(actor: ActorState, rawDamage: number): boolean {
  if (rawDamage <= 0) {
    return false;
  }
  return calculateProtectedDamage(actor, rawDamage).healthDamage >= actor.health;
}

function normalize(value: Vector3State): Vector3State {
  const length = Math.hypot(value.x, value.y, value.z);
  return length === 0
    ? { x: 0, y: 0, z: 1 }
    : { x: value.x / length, y: value.y / length, z: value.z / length };
}

function addSpread(direction: Vector3State, spread: number, random: () => number): Vector3State {
  if (spread === 0) {
    return direction;
  }
  return normalize({
    x: direction.x + (random() * 2 - 1) * spread,
    y: direction.y + (random() * 2 - 1) * spread,
    z: direction.z + (random() * 2 - 1) * spread,
  });
}
