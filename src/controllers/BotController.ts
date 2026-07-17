import { GridNavigator } from "../ai/navigation/GridNavigator";
import { ITEMS } from "../config/items";
import { createMapLayout, getTerrainHeight, LOOT_SPAWN_POINTS } from "../config/map";
import { WEAPONS } from "../config/weapons";
import type { ActorCommand } from "../game/commands/ActorCommand";
import { createIdleCommand } from "../game/commands/ActorCommand";
import {
  getActiveWeapon,
  getItemQuantity,
  type ActorState,
  type GroundLootState,
  type MatchState,
  type Vector3State,
} from "../game/state/types";
import type { CombatWorld } from "../game/systems/CombatSystem";

const WAYPOINT_REACHED_DISTANCE = 0.5;

export class BotController {
  private navigator = new GridNavigator();
  private navigatorSeed = 0;
  private readonly dropProgress: number;
  private readonly landingTarget: Vector3State;
  private weaponLandingTarget: Vector3State | null = null;
  private decisionSeconds = 0;
  private fireSeconds = 0;
  private cached = createIdleCommand();
  private waypoint: Vector3State | null = null;
  private navigationPath: Vector3State[] = [];
  private waypointIndex = 0;
  private navigationPreservesAim = false;
  private navigationTarget: Vector3State | null = null;
  private lastDecisionPosition: Vector3State | null = null;
  private stalledDecisions = 0;

  public constructor(index = 0, private readonly random: () => number = Math.random) {
    this.dropProgress = 0.12 + (index / 19) * 0.72;
    this.landingTarget = { ...(LOOT_SPAWN_POINTS[(index * 4) % LOOT_SPAWN_POINTS.length] ?? { x: 0, y: 1.76, z: 0 }) };
  }

  public update(
    actor: ActorState,
    state: MatchState,
    world: CombatWorld,
    deltaSeconds: number,
    playerId: string,
  ): ActorCommand {
    const layout = createMapLayout(state.mapSeed);
    if (state.mapSeed !== this.navigatorSeed) {
      this.navigator = new GridNavigator(layout.obstacles, layout.roofRamps);
      this.navigatorSeed = state.mapSeed;
      this.waypoint = null;
      this.navigationPath = [];
      this.navigationTarget = null;
    }
    if (!actor.alive) {
      return createIdleCommand();
    }
    if (actor.deployment === "aircraft") {
      return { ...createIdleCommand(), jump: state.flight.progress >= this.dropProgress };
    }
    if (actor.deployment === "parachuting") {
      return this.moveToward(actor, this.findLandingTarget(actor, state), false);
    }

    const player = state.actors[playerId];
    const playerDistance = player?.alive ? horizontalDistance(actor.position, player.position) : Number.POSITIVE_INFINITY;
    this.decisionSeconds -= deltaSeconds;
    this.fireSeconds -= deltaSeconds;
    const interval = playerDistance < 80 ? 0.08 : 0.22 + (numericId(actor.id) % 4) * 0.04;
    if (this.decisionSeconds > 0) {
      return {
        ...this.cached,
        fire: false,
        reload: false,
        jump: false,
        interact: false,
        switchWeapon: null,
        useItem: null,
        dropItem: null,
      };
    }
    this.decisionSeconds = interval;
    if (this.lastDecisionPosition) {
      const moved = horizontalDistance(actor.position, this.lastDecisionPosition);
      const wasMoving = Math.hypot(this.cached.move.x, this.cached.move.z) > 0.1;
      this.stalledDecisions = wasMoving && moved < 0.18 ? this.stalledDecisions + 1 : 0;
      if (this.stalledDecisions >= 3) {
        this.waypoint = null;
        this.navigationPath = [];
        this.navigationTarget = null;
        this.weaponLandingTarget = null;
        this.stalledDecisions = 0;
      }
    }
    this.lastDecisionPosition = { ...actor.position };

    const command = createIdleCommand();
    const activeWeapon = getActiveWeapon(actor);
    const activeWeaponConfig = activeWeapon ? WEAPONS[activeWeapon.weaponId] : undefined;
    const reserveAmmo = activeWeaponConfig ? getItemQuantity(actor, activeWeaponConfig.ammoItemId) : 0;
    const canFight = Boolean(activeWeapon && (activeWeapon.ammoInMagazine > 0 || reserveAmmo > 0));
    if (actor.health < 38 && getItemQuantity(actor, "medkit") > 0) {
      command.useItem = "medkit";
      return this.cache(command);
    }
    if (actor.health < 72 && getItemQuantity(actor, "bandage") > 0) {
      command.useItem = "bandage";
      return this.cache(command);
    }

    const target = this.findVisibleTarget(actor, state, world);
    if (target && activeWeapon && canFight) {
      const toTarget = subtract(target.position, actor.position);
      const distance = horizontalDistance(actor.position, target.position);
      const weapon = WEAPONS[activeWeapon.weaponId];
      command.aimDirection = normalize({
        x: toTarget.x + randomBetween(this.random, -0.45, 0.45),
        y: toTarget.y + randomBetween(this.random, -0.25, 0.25),
        z: toTarget.z + randomBetween(this.random, -0.45, 0.45),
      });
      command.fire = Boolean(weapon && activeWeapon.ammoInMagazine > 0 && distance <= weapon.range && this.fireSeconds <= 0);
      if (command.fire) {
        this.fireSeconds = 0.18 + this.random() * 0.24;
      }
      command.reload = activeWeapon.ammoInMagazine === 0 && getItemQuantity(actor, weapon?.ammoItemId ?? "") > 0;
      const actorElevated = actor.position.y - getTerrainHeight(actor.position.x, actor.position.z, layout) > 2;
      const targetElevated = target.position.y - getTerrainHeight(target.position.x, target.position.z, layout) > 2;
      if (distance > 26 || actorElevated || targetElevated) {
        this.navigate(actor, target.position, command, undefined, true);
        command.sprint = distance > 55;
      } else if (distance < 11) {
        command.move = scale(normalizeFlat(toTarget), -1);
      } else {
        const forward = normalizeFlat(toTarget);
        command.move = { x: forward.z, y: 0, z: -forward.x };
      }
      return this.cache(command);
    }

    if (activeWeapon?.ammoInMagazine === 0) {
      const config = WEAPONS[activeWeapon.weaponId];
      command.reload = Boolean(config && getItemQuantity(actor, config.ammoItemId) > 0);
    }
    const outsideZone = horizontalDistance(actor.position, state.safeZone.center) > state.safeZone.radius * 0.88;
    if (outsideZone) {
      return this.cache(this.navigate(actor, state.safeZone.center, command));
    }

    const lootSelection = this.findUsefulLoot(actor, state);
    if (lootSelection) {
      const { loot, path } = lootSelection;
      if (horizontalDistance(actor.position, loot.position) <= 2.6) {
        const item = ITEMS[loot.itemId];
        const existingStack = actor.inventory.backpack.find((stack) => stack.itemId === loot.itemId);
        if (
          item?.kind === "ammo" &&
          !existingStack &&
          actor.inventory.backpack.length >= actor.inventory.maxBackpackStacks
        ) {
          command.dropItem = actor.inventory.backpack.find((stack) => stack.itemId !== loot.itemId)?.itemId ?? null;
        }
        command.interact = true;
        return this.cache(command);
      }
      return this.cache(this.navigate(actor, loot.position, command, path));
    }
    return this.cache(this.navigate(actor, state.safeZone.center, command));
  }

  private findVisibleTarget(actor: ActorState, state: MatchState, world: CombatWorld): ActorState | null {
    let nearest: ActorState | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    const facing = { x: Math.sin(actor.yaw), y: 0, z: Math.cos(actor.yaw) };
    for (const candidate of Object.values(state.actors)) {
      if (!candidate.alive || candidate.id === actor.id || candidate.deployment !== "grounded") continue;
      const offset = subtract(candidate.position, actor.position);
      const distance = Math.hypot(offset.x, offset.z);
      if (distance > 150 || distance >= nearestDistance) continue;
      const direction = normalizeFlat(offset);
      const inView = distance < 12 || direction.x * facing.x + direction.z * facing.z > -0.2;
      if (!inView || world.hasLineOfSight?.(actor.id, candidate.id) === false) continue;
      nearest = candidate;
      nearestDistance = distance;
    }
    return nearest;
  }

  private findUsefulLoot(
    actor: ActorState,
    state: MatchState,
  ): { loot: GroundLootState; path: Vector3State[] } | null {
    const hasWeapon = actor.inventory.weaponSlots.some((weapon) => weapon !== null);
    const activeWeapon = getActiveWeapon(actor);
    const weaponConfig = activeWeapon ? WEAPONS[activeWeapon.weaponId] : undefined;
    const needsAmmo = Boolean(
      activeWeapon &&
      weaponConfig &&
      activeWeapon.ammoInMagazine === 0 &&
      getItemQuantity(actor, weaponConfig.ammoItemId) === 0
    );
    const candidates: { loot: GroundLootState; distance: number }[] = [];
    for (const loot of Object.values(state.groundLoot)) {
      if (!loot.available) continue;
      const item = ITEMS[loot.itemId];
      if (!item) continue;
      const existingStack = actor.inventory.backpack.find((stack) => stack.itemId === item.id);
      const canCarry = Boolean(existingStack && existingStack.quantity < item.maxStack) ||
        actor.inventory.backpack.length < actor.inventory.maxBackpackStacks;
      const useful = hasWeapon
        ? (item.kind === "ammo" && (!needsAmmo || item.id === weaponConfig?.ammoItemId) && (needsAmmo || canCarry)) ||
          (item.kind === "medical" && actor.health < 90) ||
          (item.kind === "armor" && (item.level ?? 0) > actor.inventory.armorLevel) ||
          (item.kind === "helmet" && (item.level ?? 0) > actor.inventory.helmetLevel)
        : item.kind === "weapon";
      if (!useful) continue;
      const distance = horizontalDistance(actor.position, loot.position);
      if (hasWeapon && !needsAmmo && distance >= 85) continue;
      candidates.push({ loot, distance });
    }
    candidates.sort((left, right) => left.distance - right.distance || left.loot.id.localeCompare(right.loot.id));
    for (const candidate of candidates) {
      const path = this.navigator.findPath(actor.position, candidate.loot.position);
      if (path.length > 0) {
        return { loot: candidate.loot, path };
      }
    }
    return null;
  }

  private findLandingTarget(actor: ActorState, state: MatchState): Vector3State {
    if (this.weaponLandingTarget) return this.weaponLandingTarget;
    const weaponLoot = Object.values(state.groundLoot)
      .filter((loot) => ITEMS[loot.itemId]?.kind === "weapon")
      .sort((left, right) => left.id.localeCompare(right.id));
    if (weaponLoot.length === 0) return this.landingTarget;
    const target = weaponLoot[(Math.max(1, numericId(actor.id)) - 1) % weaponLoot.length]?.position;
    this.weaponLandingTarget = target ? { ...target } : this.landingTarget;
    return this.weaponLandingTarget;
  }

  private navigate(
    actor: ActorState,
    target: Vector3State,
    command: ActorCommand,
    validatedPath?: readonly Vector3State[],
    preserveAim = false,
  ): ActorCommand {
    const targetChanged = this.navigationTarget?.x !== target.x || this.navigationTarget.z !== target.z;
    const navigationModeChanged = this.navigationPreservesAim !== preserveAim;
    if (this.navigationPath.length === 0 || navigationModeChanged || (targetChanged && !preserveAim)) {
      const path = validatedPath ?? this.navigator.findPath(actor.position, target);
      this.navigationTarget = { ...target };
      this.navigationPreservesAim = preserveAim;
      this.navigationPath = path.map((point) => ({ ...point }));
      this.waypointIndex = Math.min(1, Math.max(0, this.navigationPath.length - 1));
    }
    while (
      this.waypointIndex < this.navigationPath.length &&
      horizontalDistance(actor.position, this.navigationPath[this.waypointIndex] as Vector3State) < WAYPOINT_REACHED_DISTANCE
    ) {
      this.waypointIndex += 1;
    }
    this.waypoint = this.navigationPath[this.waypointIndex] ?? null;
    if (!this.waypoint) {
      this.navigationPath = [];
      return command;
    }
    command.move = normalizeFlat(subtract(this.waypoint, actor.position));
    if (!preserveAim) command.aimDirection = { ...command.move };
    command.sprint = true;
    return command;
  }

  private moveToward(actor: ActorState, target: Vector3State, sprint: boolean): ActorCommand {
    const command = createIdleCommand();
    command.move = normalizeFlat(subtract(target, actor.position));
    command.aimDirection = { ...command.move };
    command.sprint = sprint;
    return command;
  }

  private cache(command: ActorCommand): ActorCommand {
    this.cached = command;
    return command;
  }
}

function subtract(a: Vector3State, b: Vector3State): Vector3State {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(value: Vector3State, amount: number): Vector3State {
  return { x: value.x * amount, y: value.y * amount, z: value.z * amount };
}

function normalize(value: Vector3State): Vector3State {
  const length = Math.hypot(value.x, value.y, value.z);
  return length > 0 ? scale(value, 1 / length) : { x: 0, y: 0, z: 1 };
}

function normalizeFlat(value: Vector3State): Vector3State {
  const length = Math.hypot(value.x, value.z);
  return length > 0 ? { x: value.x / length, y: 0, z: value.z / length } : { x: 0, y: 0, z: 0 };
}

function horizontalDistance(a: Vector3State, b: Vector3State): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function randomBetween(random: () => number, minimum: number, maximum: number): number {
  return minimum + random() * (maximum - minimum);
}

function numericId(id: string): number {
  const match = /\d+$/.exec(id);
  return match ? Number(match[0]) : 0;
}
