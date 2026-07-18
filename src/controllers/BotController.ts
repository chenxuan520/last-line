import { GridNavigator } from "../ai/navigation/GridNavigator";
import { ITEMS } from "../config/items";
import {
  createMapLayout,
  getTerrainHeight,
  LANDING_ZONE_COUNT,
  LOOT_SPAWN_POINTS,
} from "../config/map";
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
import { SPRINT_SPEED } from "../game/systems/MovementSystem";

const WAYPOINT_REACHED_DISTANCE = 0.5;
const LOOT_INTERACTION_DISTANCE = 3;
const LATE_GAME_PATROL_RADIUS = 350;
const LATE_GAME_PATROL_ACTORS = 12;
const DAMAGE_INVESTIGATION_SECONDS = 2.5;
const DAMAGE_INVESTIGATION_DISTANCE = 30;

export class BotController {
  private navigator = new GridNavigator();
  private navigatorSeed = 0;
  private dropProgress: number | null = null;
  private readonly dropProgressJitter: number;
  private readonly landingPoiSlot: number;
  private readonly landingPoiWave: number;
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
  private lootTargetId: string | null = null;
  private patrolTarget: Vector3State | null = null;
  private patrolSequence = 0;
  private lastObservedDamageElapsedSeconds = -1;
  private damageInvestigationTarget: Vector3State | null = null;
  private damageInvestigationDirection: Vector3State | null = null;
  private damageInvestigationUntilSeconds = -1;
  private navigationProgressKey: string | null = null;
  private navigationProgressDistance = Number.POSITIVE_INFINITY;
  private navigationNoProgressDecisions = 0;
  private updateDeltaSeconds = 0;
  private lastDecisionPosition: Vector3State | null = null;
  private stalledDecisions = 0;

  public constructor(index = 0, private readonly random: () => number = Math.random) {
    this.dropProgressJitter = randomBetween(this.random, -0.045, 0.045);
    this.landingPoiSlot = Math.max(0, index - 1) % LANDING_ZONE_COUNT;
    this.landingPoiWave = Math.floor(Math.max(0, index - 1) / LANDING_ZONE_COUNT);
    this.landingTarget = { ...(LOOT_SPAWN_POINTS[(index * 4) % LOOT_SPAWN_POINTS.length] ?? { x: 0, y: 1.76, z: 0 }) };
  }

  public update(
    actor: ActorState,
    state: MatchState,
    world: CombatWorld,
    deltaSeconds: number,
    playerId: string,
  ): ActorCommand {
    this.updateDeltaSeconds = deltaSeconds;
    const layout = createMapLayout(state.mapSeed);
    if (state.mapSeed !== this.navigatorSeed) {
      this.navigator = new GridNavigator(layout.obstacles, layout.roofRamps, layout.wallSegments);
      this.navigatorSeed = state.mapSeed;
      this.waypoint = null;
      this.navigationPath = [];
      this.navigationTarget = null;
      this.lootTargetId = null;
      this.patrolTarget = null;
      this.damageInvestigationTarget = null;
      this.damageInvestigationDirection = null;
      this.damageInvestigationUntilSeconds = -1;
      this.resetNavigationProgress();
    }
    if (!actor.alive) {
      return createIdleCommand();
    }
    if (actor.deployment === "aircraft") {
      const landingTarget = this.findLandingTarget(state);
      this.dropProgress ??= this.getDropProgress(state, landingTarget);
      return { ...createIdleCommand(), jump: state.flight.progress >= this.dropProgress };
    }
    if (actor.deployment === "parachuting") {
      return this.moveToward(actor, this.findLandingTarget(state), false);
    }

    if (
      actor.lastDamageDirection &&
      actor.lastDamageElapsedSeconds > this.lastObservedDamageElapsedSeconds
    ) {
      this.lastObservedDamageElapsedSeconds = actor.lastDamageElapsedSeconds;
      this.damageInvestigationDirection = { ...actor.lastDamageDirection };
      const horizontalDirection = normalizeFlat(actor.lastDamageDirection);
      const x = actor.position.x + horizontalDirection.x * DAMAGE_INVESTIGATION_DISTANCE;
      const z = actor.position.z + horizontalDirection.z * DAMAGE_INVESTIGATION_DISTANCE;
      this.damageInvestigationTarget = { x, y: getTerrainHeight(x, z, layout) + 1.76, z };
      this.damageInvestigationUntilSeconds = state.elapsedSeconds + DAMAGE_INVESTIGATION_SECONDS;
      this.decisionSeconds = 0;
      this.lootTargetId = null;
      this.patrolTarget = null;
      this.clearNavigation();
    }

    const player = state.actors[playerId];
    const playerDistance = player?.alive ? horizontalDistance(actor.position, player.position) : Number.POSITIVE_INFINITY;
    this.decisionSeconds -= deltaSeconds;
    this.fireSeconds -= deltaSeconds;
    const interval = playerDistance < 80 ? 0.08 : 0.22 + (numericId(actor.id) % 4) * 0.04;
    if (this.decisionSeconds > 0) {
      const command = {
        ...this.cached,
        fire: false,
        reload: false,
        jump: false,
        interact: false,
        switchWeapon: null,
        useItem: null,
        dropItem: null,
      };
      if (this.navigationPath.length > 0) {
        this.updateNavigationMovement(actor, command);
      }
      return command;
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
        this.lootTargetId = null;
        this.patrolTarget = null;
        this.resetNavigationProgress();
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
    const outsideZone = horizontalDistance(actor.position, state.safeZone.center) > state.safeZone.radius;
    if (outsideZone) {
      this.lootTargetId = null;
      this.patrolTarget = null;
      return this.cache(this.navigate(actor, state.safeZone.center, command));
    }

    const target = this.findVisibleTarget(actor, state, world);
    if (target && activeWeapon && canFight) {
      this.damageInvestigationTarget = null;
      this.damageInvestigationDirection = null;
      this.damageInvestigationUntilSeconds = -1;
      this.lootTargetId = null;
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
        this.clearNavigation();
        command.move = scale(normalizeFlat(toTarget), -1);
      } else {
        this.clearNavigation();
        const forward = normalizeFlat(toTarget);
        command.move = { x: forward.z, y: 0, z: -forward.x };
      }
      return this.cache(command);
    }

    if (
      !target &&
      this.damageInvestigationTarget &&
      this.damageInvestigationDirection &&
      state.elapsedSeconds <= this.damageInvestigationUntilSeconds
    ) {
      command.aimDirection = { ...this.damageInvestigationDirection };
      const path = this.navigator.findPath(actor.position, this.damageInvestigationTarget);
      if (path.length > 0) {
        return this.cache(this.navigate(actor, this.damageInvestigationTarget, command, path, true));
      }
      command.move = normalizeFlat(this.damageInvestigationDirection);
      command.sprint = true;
      return this.cache(command);
    }
    if (state.elapsedSeconds > this.damageInvestigationUntilSeconds) {
      this.damageInvestigationTarget = null;
      this.damageInvestigationDirection = null;
    }
    if (actor.health < 38 && getItemQuantity(actor, "medkit") > 0) {
      this.clearNavigation();
      command.useItem = "medkit";
      return this.cache(command);
    }
    if (actor.health < 72 && getItemQuantity(actor, "bandage") > 0) {
      this.clearNavigation();
      command.useItem = "bandage";
      return this.cache(command);
    }

    if (!getActiveWeapon(actor) && Object.values(state.groundLoot).some((loot) =>
      loot.available && ITEMS[loot.itemId]?.kind === "weapon" && distanceSquared(actor.position, loot.position) <= LOOT_INTERACTION_DISTANCE ** 2
    )) {
      this.clearNavigation();
      command.interact = true;
      return this.cache(command);
    }

    if (activeWeapon?.ammoInMagazine === 0) {
      const config = WEAPONS[activeWeapon.weaponId];
      command.reload = Boolean(config && getItemQuantity(actor, config.ammoItemId) > 0);
    }
    const lootSelection = this.findUsefulLoot(actor, state);
    if (lootSelection) {
      const { loot, path } = lootSelection;
      if (distanceSquared(actor.position, loot.position) <= LOOT_INTERACTION_DISTANCE ** 2) {
        this.clearNavigation();
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
    this.lootTargetId = null;
    const patrol = this.findPatrolTarget(actor, state, layout);
    if (patrol) return this.cache(this.navigate(actor, patrol.target, command, patrol.path));
    this.patrolTarget = null;
    return this.cache(this.navigate(actor, state.safeZone.center, command));
  }

  private findPatrolTarget(
    actor: ActorState,
    state: MatchState,
    layout: ReturnType<typeof createMapLayout>,
  ): { target: Vector3State; path: Vector3State[] } | null {
    const livingActors = Object.values(state.actors).filter((candidate) => candidate.alive).length;
    const lateGame = livingActors <= LATE_GAME_PATROL_ACTORS || state.safeZone.radius <= LATE_GAME_PATROL_RADIUS;
    if (
      this.patrolTarget &&
      horizontalDistance(actor.position, this.patrolTarget) >= 2 &&
      horizontalDistance(this.patrolTarget, state.safeZone.center) <= state.safeZone.radius * 0.82
    ) {
      const path = this.navigationTarget?.x === this.patrolTarget.x &&
        this.navigationTarget.z === this.patrolTarget.z &&
        this.navigationPath.length > 0
        ? this.navigationPath
        : this.navigator.findPath(actor.position, this.patrolTarget);
      if (path.length > 0) return { target: this.patrolTarget, path };
    }

    this.patrolTarget = null;
    this.patrolSequence += 1;
    const usableRadius = Math.max(0, Math.min(state.safeZone.radius * 0.68 - 1, lateGame ? 260 : 180));
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const angle = numericId(actor.id) * 2.399963 + (this.patrolSequence + attempt) * 1.618034;
      const radiusScale = 0.35 + ((numericId(actor.id) + this.patrolSequence + attempt * 3) % 6) * 0.1;
      const radius = usableRadius * radiusScale;
      const x = state.safeZone.center.x + Math.cos(angle) * radius;
      const z = state.safeZone.center.z + Math.sin(angle) * radius;
      const candidate = { x, y: getTerrainHeight(x, z, layout) + 1.76, z };
      const path = this.navigator.findPath(actor.position, candidate);
      if (path.length === 0 || horizontalDistance(actor.position, candidate) < 2) continue;
      this.patrolTarget = candidate;
      return { target: candidate, path };
    }
    return null;
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
    const isUseful = (loot: GroundLootState): boolean => {
      if (!loot.available) return false;
      const item = ITEMS[loot.itemId];
      if (!item) return false;
      const existingStack = actor.inventory.backpack.find((stack) => stack.itemId === item.id);
      const canCarry = Boolean(existingStack && existingStack.quantity < item.maxStack) ||
        actor.inventory.backpack.length < actor.inventory.maxBackpackStacks;
      return hasWeapon
        ? (item.kind === "ammo" && (!needsAmmo || item.id === weaponConfig?.ammoItemId) && (needsAmmo || canCarry)) ||
          (item.kind === "medical" && actor.health < 90) ||
          (item.kind === "armor" && (
            (item.level ?? 0) > actor.inventory.armorLevel ||
            ((item.level ?? 0) === actor.inventory.armorLevel && actor.armor < actor.maxArmor)
          )) ||
          (item.kind === "helmet" && (item.level ?? 0) > actor.inventory.helmetLevel)
        : item.kind === "weapon";
    };
    const currentTarget = this.lootTargetId ? state.groundLoot[this.lootTargetId] : undefined;
    if (currentTarget && isUseful(currentTarget)) {
      const currentDistance = horizontalDistance(actor.position, currentTarget.position);
      const nearestUsefulDistance = hasWeapon
        ? currentDistance
        : Object.values(state.groundLoot).reduce((nearest, loot) =>
            isUseful(loot) ? Math.min(nearest, horizontalDistance(actor.position, loot.position)) : nearest,
          Number.POSITIVE_INFINITY);
      const significantlyBetterTargetExists = nearestUsefulDistance + 30 < currentDistance * 0.9;
      if (!significantlyBetterTargetExists) {
        if (this.navigationPath.length > 0 || distanceSquared(actor.position, currentTarget.position) <= LOOT_INTERACTION_DISTANCE ** 2) {
          return { loot: currentTarget, path: this.navigationPath };
        }
        const path = this.navigator.findPath(actor.position, currentTarget.position);
        if (path.length > 0) return { loot: currentTarget, path };
      }
      this.clearNavigation();
    }
    this.lootTargetId = null;
    const candidates: { loot: GroundLootState; distance: number }[] = [];
    for (const loot of Object.values(state.groundLoot)) {
      if (!isUseful(loot)) continue;
      const distance = horizontalDistance(actor.position, loot.position);
      if (hasWeapon && !needsAmmo && distance >= 85) continue;
      candidates.push({ loot, distance });
    }
    candidates.sort((left, right) => left.distance - right.distance || left.loot.id.localeCompare(right.loot.id));
    const nearbyCandidateCount = Math.min(3, candidates.length);
    const candidateOffset = hasWeapon || nearbyCandidateCount === 0
      ? 0
      : (numericId(actor.id) * 7 + this.landingPoiWave) % nearbyCandidateCount;
    const orderedCandidates = candidateOffset === 0
      ? candidates
      : [
          ...candidates.slice(candidateOffset, nearbyCandidateCount),
          ...candidates.slice(0, candidateOffset),
          ...candidates.slice(nearbyCandidateCount),
        ];
    for (const candidate of orderedCandidates) {
      const path = this.navigator.findPath(actor.position, candidate.loot.position);
      if (path.length > 0) {
        this.lootTargetId = candidate.loot.id;
        return { loot: candidate.loot, path };
      }
    }
    return null;
  }

  private findLandingTarget(state: MatchState): Vector3State {
    if (this.weaponLandingTarget) return this.weaponLandingTarget;
    const layout = createMapLayout(state.mapSeed);
    const weaponLoot = Object.values(state.groundLoot)
      .filter((loot) => ITEMS[loot.itemId]?.kind === "weapon")
      .sort((left, right) => left.id.localeCompare(right.id));
    const outdoorWeaponLoot = weaponLoot.filter((loot) => !pointInsideBuilding(loot.position, layout));
    const availableWeaponLoot = outdoorWeaponLoot.length > 0 ? outdoorWeaponLoot : weaponLoot;
    if (availableWeaponLoot.length === 0) return this.landingTarget;
    const poiIndex = (this.landingPoiSlot + state.mapSeed) % layout.landingZones.length;
    const assignedPoi = layout.landingZones[poiIndex] ?? layout.landingZones[0];
    const localWeaponLoot = assignedPoi
      ? availableWeaponLoot.filter((loot) => lootZoneIndex(numericId(loot.id), layout.lootZoneCounts) === poiIndex)
      : [];
    const targetPool = (localWeaponLoot.length > 0 ? localWeaponLoot : availableWeaponLoot)
      .sort((left, right) =>
        horizontalDistance(left.position, assignedPoi?.position ?? left.position) -
        horizontalDistance(right.position, assignedPoi?.position ?? right.position) ||
        left.id.localeCompare(right.id),
      )
      .slice(0, 6);
    const poiRotation = ((state.mapSeed ^ Math.imul(poiIndex + 1, 0x9e3779b1)) >>> 0) % targetPool.length;
    const targetIndex = (this.landingPoiWave + poiRotation) % targetPool.length;
    const target = targetPool[targetIndex]?.position;
    this.weaponLandingTarget = target ? { ...target } : this.landingTarget;
    return this.weaponLandingTarget;
  }

  private getDropProgress(state: MatchState, target: Vector3State): number {
    const deltaX = state.flight.end.x - state.flight.start.x;
    const deltaZ = state.flight.end.z - state.flight.start.z;
    const lengthSquared = deltaX * deltaX + deltaZ * deltaZ;
    const projected = lengthSquared === 0
      ? 0.5
      : ((target.x - state.flight.start.x) * deltaX + (target.z - state.flight.start.z) * deltaZ) / lengthSquared;
    return clamp(projected + this.dropProgressJitter, 0.12, 0.88);
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
      this.resetNavigationProgress();
    }
    this.updateNavigationMovement(actor, command);
    return command;
  }

  private updateNavigationMovement(actor: ActorState, command: ActorCommand): void {
    while (
      this.waypointIndex < this.navigationPath.length &&
      horizontalDistance(actor.position, this.navigationPath[this.waypointIndex] as Vector3State) < WAYPOINT_REACHED_DISTANCE
    ) {
      this.waypointIndex += 1;
    }
    this.waypoint = this.navigationPath[this.waypointIndex] ?? null;
    if (!this.waypoint) {
      this.navigationPath = [];
      this.resetNavigationProgress();
      command.move = { x: 0, y: 0, z: 0 };
      return;
    }
    const waypointKey = `${this.waypointIndex}:${this.waypoint.x}:${this.waypoint.z}`;
    const waypointDistance = horizontalDistance(actor.position, this.waypoint);
    if (waypointKey !== this.navigationProgressKey) {
      this.navigationProgressKey = waypointKey;
      this.navigationProgressDistance = waypointDistance;
      this.navigationNoProgressDecisions = 0;
    } else {
      this.navigationNoProgressDecisions = waypointDistance < this.navigationProgressDistance - 0.08
        ? 0
        : this.navigationNoProgressDecisions + 1;
      this.navigationProgressDistance = waypointDistance;
      if (this.navigationNoProgressDecisions >= 4) {
        this.navigationPath = [];
        this.navigationTarget = null;
        this.resetNavigationProgress();
        command.move = { x: 0, y: 0, z: 0 };
        return;
      }
    }
    const direction = normalizeFlat(subtract(this.waypoint, actor.position));
    const maximumStepDistance = SPRINT_SPEED * this.updateDeltaSeconds;
    command.move = maximumStepDistance > 0 && waypointDistance < maximumStepDistance
      ? scale(direction, waypointDistance / maximumStepDistance)
      : direction;
    if (!this.navigationPreservesAim) command.aimDirection = { ...command.move };
    command.sprint = true;
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

  private resetNavigationProgress(): void {
    this.navigationProgressKey = null;
    this.navigationProgressDistance = Number.POSITIVE_INFINITY;
    this.navigationNoProgressDecisions = 0;
  }

  private clearNavigation(): void {
    this.waypoint = null;
    this.navigationPath = [];
    this.navigationTarget = null;
    this.resetNavigationProgress();
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

function distanceSquared(a: Vector3State, b: Vector3State): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
}

function pointInsideBuilding(point: Vector3State, layout: ReturnType<typeof createMapLayout>): boolean {
  return layout.obstacles.some(
    (obstacle) =>
      Math.abs(point.x - obstacle.center.x) < obstacle.width / 2 - 0.6 &&
      Math.abs(point.z - obstacle.center.z) < obstacle.depth / 2 - 0.6,
  );
}

function randomBetween(random: () => number, minimum: number, maximum: number): number {
  return minimum + random() * (maximum - minimum);
}

function lootZoneIndex(lootIndex: number, counts: readonly number[]): number {
  let start = 0;
  for (let zoneIndex = 0; zoneIndex < counts.length; zoneIndex += 1) {
    start += counts[zoneIndex] ?? 0;
    if (lootIndex < start) return zoneIndex;
  }
  return Math.max(0, counts.length - 1);
}

function numericId(id: string): number {
  const match = /\d+$/.exec(id);
  return match ? Number(match[0]) : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
