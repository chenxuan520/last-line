import type { WeaponConfig } from "../../config/weapons";
import type { ActorCommand } from "../commands/ActorCommand";
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
  ): void {
    const pendingDamage: PendingDamage[] = [];
    const orderedCommands = [...commands].sort(([leftId], [rightId]) => compareIds(leftId, rightId));
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
    events.push({ type: "shot-fired", actorId: actor.id });
    for (let pellet = 0; pellet < config.pellets; pellet += 1) {
      const direction = addSpread(normalize(command.aimDirection), config.spreadRadians, this.random);
      const trace = {
        shooterId: actor.id,
        origin: { x: actor.position.x, y: actor.position.y, z: actor.position.z },
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
  }

  private applyPendingDamage(state: MatchState, pendingDamage: readonly PendingDamage[], events: GameEvent[]): void {
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
  }
}

function compareIds(left: EntityId, right: EntityId): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function wouldBeLethal(actor: ActorState, rawDamage: number): boolean {
  if (rawDamage <= 0) {
    return false;
  }
  const helmetReduction = actor.inventory.helmetLevel === 2 ? 0.2 : actor.inventory.helmetLevel === 1 ? 0.1 : 0;
  const reducedDamage = rawDamage * (1 - helmetReduction);
  const armorRate = actor.inventory.armorLevel === 2 ? 0.55 : 0.45;
  const armorAbsorption = Math.min(actor.armor, reducedDamage * armorRate);
  return reducedDamage - armorAbsorption >= actor.health;
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
