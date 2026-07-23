import { GridNavigator } from "../ai/navigation/GridNavigator";
import { ITEMS } from "../config/items";
import {
  createMapLayout,
  BUILDING_ROOF_CAP_HEIGHT,
  getTerrainHeight,
  LANDING_ZONE_COUNT,
  LOOT_SPAWN_POINTS,
  type MapLayout,
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
const COMBAT_MEMORY_SECONDS = 12;
const ZONE_SAFETY_MARGIN = 30;
const UNARMED_WEAPON_DETOUR_DISTANCE = 120;
const ENDGAME_SEARCH_ACTORS = 3;
const ENDGAME_PATROL_SECONDS = 24;
const LOW_HEALTH_RETREAT_HEALTH = 25;
const RETREAT_COVER_SEARCH_DISTANCE = 85;
const RETREAT_HIDE_CONFIRM_SECONDS = 1;
const MAX_STATIONARY_SECONDS = 45;
const STATIONARY_RADIUS = 3;
const OSCILLATION_WINDOW_SECONDS = 8;
const OSCILLATION_REVERSAL_LIMIT = 6;
const FORCED_RELOCATION_SECONDS = 20;
const FORCED_RELOCATION_CLEAR_DISTANCE = 6;
const FORCED_RELOCATION_PATH_CHECKS = 1;
const ZONE_PATH_RETRY_SECONDS = 2;
const PARACHUTE_TARGET_DEAD_ZONE = 0.75;
const PARACHUTE_APPROACH_DISTANCE = 12;
const ACTOR_EYE_HEIGHT = 1.76;
const ACTOR_HEIGHT = 1.8;
const SNIPER_WEAPON_ITEM_ID = "weapon.sniper";
const SNIPER_AMMO_ITEM_ID = "ammo.sniper";
type LootPurpose = "general" | "medical" | "compatible-ammo";

interface LootSelection {
  loot: GroundLootState;
  generation: number;
  path: Vector3State[];
  replacementItemId: string | null;
}

export class BotController {
  private layout: MapLayout;
  private navigator: GridNavigator;
  private navigatorSeed: number;
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
  private patrolTargetUntilSeconds = -1;
  private patrolSequence = 0;
  private lastObservedDamageElapsedSeconds = -1;
  private damageInvestigationTarget: Vector3State | null = null;
  private damageInvestigationDirection: Vector3State | null = null;
  private damageInvestigationUntilSeconds = -1;
  private combatLastKnownPosition: Vector3State | null = null;
  private combatMemoryUntilSeconds = -1;
  private retreatThreatId: string | null = null;
  private retreatThreatPosition: Vector3State | null = null;
  private retreatCoverTarget: Vector3State | null = null;
  private retreatCoverId: string | null = null;
  private readonly rejectedRetreatCoverIds = new Set<string>();
  private retreatEscapeIndex = 0;
  private retreatUntilSeconds = -1;
  private retreatSafeSinceSeconds = -1;
  private navigationProgressKey: string | null = null;
  private navigationProgressDistance = Number.POSITIVE_INFINITY;
  private navigationNoProgressDecisions = 0;
  private updateDeltaSeconds = 0;
  private lastDecisionPosition: Vector3State | null = null;
  private stalledDecisions = 0;
  private livenessAnchor: Vector3State | null = null;
  private livenessAnchorSeconds = 0;
  private livenessLastPosition: Vector3State | null = null;
  private livenessLastDirection: Vector3State | null = null;
  private oscillationWindowStartedSeconds = 0;
  private oscillationReversals = 0;
  private forcedRelocationOrigin: Vector3State | null = null;
  private forcedRelocationTarget: Vector3State | null = null;
  private forcedRelocationUntilSeconds = -1;
  private forcedRelocationSequence = 0;
  private zonePathRetryAtSeconds = -1;
  private readonly perceptionCandidates: ActorState[] = [];
  private controlledActorId = "";
  private controlledActorNumericId = 0;

  public constructor(
    index = 0,
    private readonly random: () => number = Math.random,
    private readonly disableSnipers = false,
    initialLayout: MapLayout = createMapLayout(0),
  ) {
    this.layout = initialLayout;
    this.navigator = new GridNavigator(initialLayout);
    this.navigatorSeed = initialLayout.seed;
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
    livingActorCount?: number,
  ): ActorCommand {
    this.updateDeltaSeconds = deltaSeconds;
    if (actor.id !== this.controlledActorId) {
      this.controlledActorId = actor.id;
      this.controlledActorNumericId = numericId(actor.id);
    }
    let layout = this.layout;
    if (state.mapSeed !== this.navigatorSeed) {
      layout = createMapLayout(state.mapSeed);
      this.layout = layout;
      this.navigator = new GridNavigator(layout);
      this.navigatorSeed = state.mapSeed;
      this.waypoint = null;
      this.navigationPath = [];
      this.navigationTarget = null;
      this.lootTargetId = null;
      this.patrolTarget = null;
      this.patrolTargetUntilSeconds = -1;
      this.damageInvestigationTarget = null;
      this.damageInvestigationDirection = null;
      this.damageInvestigationUntilSeconds = -1;
      this.clearCombatMemory();
      this.clearRetreat();
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
      return this.glideToward(actor, this.findLandingTarget(state));
    }
    const livenessTriggered = this.updateLiveness(actor, state);

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
      if (actor.health <= LOW_HEALTH_RETREAT_HEALTH) {
        const previousDirection = this.retreatThreatPosition
          ? normalizeFlat(subtract(this.retreatThreatPosition, actor.position))
          : null;
        const directionChanged = previousDirection !== null &&
          previousDirection.x * horizontalDirection.x + previousDirection.z * horizontalDirection.z < 0.2;
        if (!this.retreatThreatPosition || directionChanged) {
          this.retreatThreatId = null;
          this.retreatCoverTarget = null;
          this.retreatCoverId = null;
          this.rejectedRetreatCoverIds.clear();
          this.retreatEscapeIndex = 0;
        }
        this.retreatThreatPosition = { ...this.damageInvestigationTarget };
        this.retreatUntilSeconds = state.elapsedSeconds + COMBAT_MEMORY_SECONDS;
        this.retreatSafeSinceSeconds = -1;
      }
      this.clearCombatMemory();
      this.clearNavigation();
    }

    const player = state.actors[playerId];
    const playerDistance = player?.alive ? horizontalDistance(actor.position, player.position) : Number.POSITIVE_INFINITY;
    const livingActors = livingActorCount ?? Object.values(state.actors).filter((candidate) => candidate.alive).length;
    const endgameSearch = livingActors <= ENDGAME_SEARCH_ACTORS;
    this.decisionSeconds -= deltaSeconds;
    this.fireSeconds -= deltaSeconds;
    const interval = endgameSearch ? 0.1 : playerDistance < 80 ? 0.08 : 0.22 + (this.controlledActorNumericId % 4) * 0.04;
    if (livenessTriggered) this.decisionSeconds = 0;
    if (this.decisionSeconds > 0) {
      const command = {
        ...this.cached,
        fire: false,
        reload: false,
        jump: false,
        interact: false,
        interactLootId: null,
        interactLootGeneration: null,
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
        this.rejectCurrentRetreatCover();
        this.retreatEscapeIndex = (this.retreatEscapeIndex + 1) % 5;
        this.waypoint = null;
        this.navigationPath = [];
        this.navigationTarget = null;
        this.lootTargetId = null;
        this.patrolTarget = null;
        this.patrolTargetUntilSeconds = -1;
        this.resetNavigationProgress();
        this.weaponLandingTarget = null;
        this.retreatCoverTarget = null;
        this.retreatCoverId = null;
        if (state.elapsedSeconds <= this.forcedRelocationUntilSeconds) {
          this.forcedRelocationTarget = null;
          this.forcedRelocationSequence += 1;
        } else {
          this.startForcedRelocation(actor, state);
        }
        this.stalledDecisions = 0;
      }
    }
    this.lastDecisionPosition = { ...actor.position };

    const command = createIdleCommand();
    if (this.disableSnipers && actor.inventory.weaponSlots.some((weapon) => weapon?.weaponId === "sniper")) {
      this.lootTargetId = null;
      this.clearNavigation();
      command.dropItem = SNIPER_WEAPON_ITEM_ID;
      return this.cache(command);
    }
    const activeWeapon = getActiveWeapon(actor);
    const activeWeaponConfig = activeWeapon ? WEAPONS[activeWeapon.weaponId] : undefined;
    const reserveAmmo = activeWeaponConfig ? getItemQuantity(actor, activeWeaponConfig.ammoItemId) : 0;
    const alternateSlot = actor.inventory.activeWeaponSlot === 0 ? 1 : 0;
    const alternateWeapon = actor.inventory.weaponSlots[alternateSlot];
    const alternateWeaponConfig = alternateWeapon ? WEAPONS[alternateWeapon.weaponId] : undefined;
    const alternateReserveAmmo = alternateWeaponConfig
      ? getItemQuantity(actor, alternateWeaponConfig.ammoItemId)
      : 0;
    const canFight = Boolean(activeWeapon && (activeWeapon.ammoInMagazine > 0 || reserveAmmo > 0));
    if (!activeWeapon && alternateWeapon) {
      command.switchWeapon = alternateSlot;
      return this.cache(command);
    }
    const nearbyGroundWeapon = !activeWeapon && !alternateWeapon
      ? Object.values(state.groundLoot)
        .filter((loot) =>
          loot.available &&
          this.isAllowedLoot(loot) &&
          ITEMS[loot.itemId]?.kind === "weapon" &&
          distanceSquared(actor.position, loot.position) <= LOOT_INTERACTION_DISTANCE ** 2
        )
        .sort((left, right) => distanceSquared(actor.position, left.position) - distanceSquared(actor.position, right.position) ||
          left.id.localeCompare(right.id))[0]
      : undefined;
    if (nearbyGroundWeapon) {
      this.clearNavigation();
      command.interact = true;
      command.interactLootId = nearbyGroundWeapon.id;
      command.interactLootGeneration = nearbyGroundWeapon.generation ?? 0;
      return this.cache(command);
    }
    const targetZoneRadius = Math.max(
      0,
      state.safeZone.targetRadius - Math.min(ZONE_SAFETY_MARGIN, state.safeZone.targetRadius * 0.12),
    );
    const outsideTargetZone = horizontalDistance(actor.position, state.safeZone.targetCenter) > targetZoneRadius;
    const outsideCurrentZone = horizontalDistance(actor.position, state.safeZone.center) > state.safeZone.radius;
    const shouldEnterTargetZone = outsideTargetZone && (!endgameSearch || targetZoneRadius >= 24);
    if (outsideCurrentZone && state.elapsedSeconds <= this.forcedRelocationUntilSeconds) {
      this.forcedRelocationOrigin = null;
      this.forcedRelocationTarget = null;
      this.forcedRelocationUntilSeconds = -1;
    }
    if (state.elapsedSeconds <= this.forcedRelocationUntilSeconds) {
      return this.cache(this.forceRelocation(actor, state, command));
    }
    const nearbyWeapon = !activeWeapon && !outsideCurrentZone
      ? this.findUsefulLoot(actor, state, true)
      : null;
    const nearbyWeaponInsideCurrentZone = Boolean(
      nearbyWeapon &&
      horizontalDistance(nearbyWeapon.loot.position, state.safeZone.center) <= state.safeZone.radius,
    );
    const nearbyWeaponPreservesTargetZone = Boolean(
      nearbyWeapon &&
      (outsideTargetZone ||
        horizontalDistance(nearbyWeapon.loot.position, state.safeZone.targetCenter) <= targetZoneRadius),
    );
    if (
      nearbyWeapon &&
      nearbyWeaponInsideCurrentZone &&
      nearbyWeaponPreservesTargetZone &&
      horizontalDistance(actor.position, nearbyWeapon.loot.position) <= UNARMED_WEAPON_DETOUR_DISTANCE
    ) {
      return this.cache(this.moveToLoot(actor, nearbyWeapon, command));
    }
    if (shouldEnterTargetZone || outsideCurrentZone) {
      this.lootTargetId = null;
      this.patrolTarget = null;
      const center = shouldEnterTargetZone ? state.safeZone.targetCenter : state.safeZone.center;
      const radius = shouldEnterTargetZone
        ? targetZoneRadius
        : Math.max(0, state.safeZone.radius - ZONE_SAFETY_MARGIN);
      return this.cache(this.navigateIntoZone(actor, center, radius, command, state.elapsedSeconds));
    }

    const target = this.findVisibleTarget(actor, state, world);
    const lowHealth = actor.health <= LOW_HEALTH_RETREAT_HEALTH;
    if (!lowHealth) this.clearRetreat();
    if (target && lowHealth) {
      if (this.retreatThreatId !== target.id) {
        this.clearNavigation();
        this.rejectedRetreatCoverIds.clear();
        this.retreatEscapeIndex = 0;
        this.retreatCoverTarget = null;
        this.retreatCoverId = null;
      }
      this.retreatThreatId = target.id;
      this.retreatThreatPosition = { ...target.position };
      this.retreatUntilSeconds = state.elapsedSeconds + COMBAT_MEMORY_SECONDS;
      this.retreatSafeSinceSeconds = -1;
      this.clearCombatMemory();
      this.lootTargetId = null;
      this.patrolTarget = null;
      if (
        activeWeapon &&
        activeWeaponConfig &&
        activeWeapon.ammoInMagazine > 0 &&
        vectorDistance(actor.position, target.position) <= activeWeaponConfig.range &&
        this.fireSeconds <= 0
      ) {
        command.fire = true;
        this.fireSeconds = 0.18 + this.random() * 0.24;
      }
      return this.cache(this.retreatFromThreat(actor, state, layout, command));
    }
    if (
      lowHealth &&
      this.retreatThreatPosition &&
      state.elapsedSeconds <= this.retreatUntilSeconds
    ) {
      const threatHasLineOfSight = this.retreatThreatId
        ? world.hasLineOfSight?.(actor.id, this.retreatThreatId) === true
        : !this.retreatCoverTarget || horizontalDistance(actor.position, this.retreatCoverTarget) >= 2;
      if (!threatHasLineOfSight) {
        if (this.retreatSafeSinceSeconds < 0) this.retreatSafeSinceSeconds = state.elapsedSeconds;
        this.clearNavigation();
        if (actor.health < 38 && getItemQuantity(actor, "medkit") > 0) command.useItem = "medkit";
        else if (getItemQuantity(actor, "bandage") > 0) command.useItem = "bandage";
        if (command.useItem) return this.cache(command);
        if (state.elapsedSeconds - this.retreatSafeSinceSeconds < RETREAT_HIDE_CONFIRM_SECONDS) {
          return this.cache(command);
        }
        const medicalLoot = this.findUsefulLoot(actor, state, false, "medical");
        if (medicalLoot) return this.cache(this.moveToLoot(actor, medicalLoot, command));
        this.clearRetreat();
        this.clearCombatMemory();
        this.damageInvestigationTarget = null;
        this.damageInvestigationDirection = null;
      } else {
        this.retreatSafeSinceSeconds = -1;
        return this.cache(this.retreatFromThreat(actor, state, layout, command));
      }
    }
    if (state.elapsedSeconds > this.retreatUntilSeconds) this.clearRetreat();
    if (target && (!activeWeapon || activeWeapon.ammoInMagazine === 0)) {
      if (alternateWeapon?.ammoInMagazine && alternateWeapon.ammoInMagazine > 0) {
        command.switchWeapon = alternateSlot;
        command.aimDirection = normalize(subtract(target.position, actor.position));
        return this.cache(command);
      }
      this.retreatThreatId = target.id;
      this.retreatThreatPosition = { ...target.position };
      this.retreatUntilSeconds = state.elapsedSeconds + COMBAT_MEMORY_SECONDS;
      if (activeWeapon && reserveAmmo > 0) command.reload = true;
      else if (alternateWeapon && alternateReserveAmmo > 0) {
        command.switchWeapon = alternateSlot;
        command.reload = true;
      }
      return this.cache(this.retreatFromThreat(actor, state, layout, command));
    }
    if (target && activeWeapon && canFight) {
      this.combatLastKnownPosition = { ...target.position };
      this.combatMemoryUntilSeconds = state.elapsedSeconds + COMBAT_MEMORY_SECONDS;
      this.damageInvestigationTarget = null;
      this.damageInvestigationDirection = null;
      this.damageInvestigationUntilSeconds = -1;
      this.lootTargetId = null;
      const toTarget = subtract(target.position, actor.position);
      const distance = vectorDistance(actor.position, target.position);
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

    if (!target && (!activeWeapon || activeWeapon.ammoInMagazine === 0)) {
      if (alternateWeapon?.ammoInMagazine && alternateWeapon.ammoInMagazine > 0) {
        command.switchWeapon = alternateSlot;
        return this.cache(command);
      }
      if (activeWeapon && reserveAmmo > 0) {
        command.reload = true;
        return this.cache(command);
      }
      if (alternateWeapon && alternateReserveAmmo > 0) {
        command.switchWeapon = alternateSlot;
        command.reload = true;
        return this.cache(command);
      }
      if (activeWeapon || alternateWeapon) {
        const ammoLoot = this.findUsefulLoot(actor, state, false, "compatible-ammo");
        if (ammoLoot) return this.cache(this.moveToLoot(actor, ammoLoot, command));
        this.clearCombatMemory();
        this.damageInvestigationTarget = null;
        this.damageInvestigationDirection = null;
      }
    }

    if (
      !target &&
      this.combatLastKnownPosition &&
      state.elapsedSeconds <= this.combatMemoryUntilSeconds &&
      spatialDistance(actor.position, this.combatLastKnownPosition) > 2
    ) {
      command.aimDirection = normalize(subtract(this.combatLastKnownPosition, actor.position));
      return this.cache(this.navigate(actor, this.combatLastKnownPosition, command, undefined, true));
    }
    if (
      !target &&
      (state.elapsedSeconds > this.combatMemoryUntilSeconds ||
        (this.combatLastKnownPosition && spatialDistance(actor.position, this.combatLastKnownPosition) <= 2))
    ) {
      this.clearCombatMemory();
    }

    if (
      !target &&
      this.damageInvestigationTarget &&
      this.damageInvestigationDirection &&
      state.elapsedSeconds <= this.damageInvestigationUntilSeconds
    ) {
      command.aimDirection = { ...this.damageInvestigationDirection };
      if (
        this.navigationPreservesAim &&
        this.navigationPath.length > 0 &&
        this.navigationTarget?.x === this.damageInvestigationTarget.x &&
        this.navigationTarget.z === this.damageInvestigationTarget.z &&
        Math.abs((this.navigationTarget?.y ?? this.damageInvestigationTarget.y) - this.damageInvestigationTarget.y) <= 0.2
      ) {
        return this.cache(this.navigate(actor, this.damageInvestigationTarget, command, undefined, true));
      }
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

    if (activeWeapon?.ammoInMagazine === 0) {
      const config = WEAPONS[activeWeapon.weaponId];
      command.reload = Boolean(config && getItemQuantity(actor, config.ammoItemId) > 0);
    }
    const lootSelection = this.findUsefulLoot(actor, state);
    if (lootSelection) return this.cache(this.moveToLoot(actor, lootSelection, command));
    this.lootTargetId = null;
    const patrol = this.findPatrolTarget(actor, state, layout, livingActors);
    if (patrol) return this.cache(this.navigate(actor, patrol.target, command, patrol.path));
    this.patrolTarget = null;
    return this.cache(this.navigateIntoZone(
      actor,
      state.safeZone.targetCenter,
      state.safeZone.targetRadius,
      command,
      state.elapsedSeconds,
    ));
  }

  private findPatrolTarget(
    actor: ActorState,
    state: MatchState,
    layout: ReturnType<typeof createMapLayout>,
    livingActors: number,
  ): { target: Vector3State; path: Vector3State[] } | null {
    const endgameSearch = livingActors <= ENDGAME_SEARCH_ACTORS;
    const searchCurrentZone = endgameSearch && state.safeZone.targetRadius < 24;
    const patrolCenter = searchCurrentZone ? state.safeZone.center : state.safeZone.targetCenter;
    const zoneRadius = searchCurrentZone ? state.safeZone.radius : state.safeZone.targetRadius;
    const patrolRadius = Math.max(
      0,
      zoneRadius - Math.min(ZONE_SAFETY_MARGIN, zoneRadius * 0.12),
    );
    const lateGame = livingActors <= LATE_GAME_PATROL_ACTORS || patrolRadius <= LATE_GAME_PATROL_RADIUS;
    if (
      this.patrolTarget &&
      (!endgameSearch || state.elapsedSeconds <= this.patrolTargetUntilSeconds) &&
      horizontalDistance(actor.position, this.patrolTarget) >= 2 &&
      horizontalDistance(this.patrolTarget, patrolCenter) <= patrolRadius
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
    const usableRadius = Math.max(0, Math.min(
      patrolRadius * (endgameSearch ? 0.9 : 0.68) - 1,
      endgameSearch ? 420 : lateGame ? 260 : 180,
    ));
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const angle = this.controlledActorNumericId * 2.399963 + (this.patrolSequence + attempt) * 1.618034;
      const radiusScale = endgameSearch
        ? [0.82, 0.5, 0.68][(this.controlledActorNumericId + this.patrolSequence + attempt) % 3] ?? 0.68
        : 0.35 + ((this.controlledActorNumericId + this.patrolSequence + attempt * 3) % 6) * 0.1;
      const radius = usableRadius * radiusScale;
      const x = patrolCenter.x + Math.cos(angle) * radius;
      const z = patrolCenter.z + Math.sin(angle) * radius;
      const candidate = { x, y: getTerrainHeight(x, z, layout) + 1.76, z };
      const path = this.navigator.findPath(actor.position, candidate);
      if (path.length === 0 || horizontalDistance(actor.position, candidate) < 2) continue;
      this.patrolTarget = candidate;
      this.patrolTargetUntilSeconds = state.elapsedSeconds + ENDGAME_PATROL_SECONDS;
      return { target: candidate, path };
    }
    return null;
  }

  private findVisibleTarget(actor: ActorState, state: MatchState, world: CombatWorld): ActorState | null {
    this.perceptionCandidates.length = 0;
    const facing = { x: Math.sin(actor.yaw), y: 0, z: Math.cos(actor.yaw) };
    for (const candidate of Object.values(state.actors)) {
      if (!candidate.alive || candidate.id === actor.id || candidate.deployment === "aircraft") continue;
      const offset = subtract(candidate.position, actor.position);
      const distanceSquared = offset.x * offset.x + offset.y * offset.y + offset.z * offset.z;
      if (distanceSquared > 150 ** 2) continue;
      const direction = normalizeFlat(offset);
      const inView = distanceSquared < 12 ** 2 || direction.x * facing.x + direction.z * facing.z > -0.2;
      if (inView) this.perceptionCandidates.push(candidate);
    }
    this.perceptionCandidates.sort((left, right) =>
      distanceSquared(actor.position, left.position) - distanceSquared(actor.position, right.position)
    );
    for (const candidate of this.perceptionCandidates) {
      if (world.hasLineOfSight?.(actor.id, candidate.id) === true) return candidate;
    }
    return null;
  }

  private retreatFromThreat(
    actor: ActorState,
    state: MatchState,
    layout: ReturnType<typeof createMapLayout>,
    command: ActorCommand,
  ): ActorCommand {
    const threat = this.retreatThreatPosition;
    if (!threat) return command;
    command.aimDirection = normalize(subtract(threat, actor.position));
    if (this.retreatCoverTarget && horizontalDistance(actor.position, this.retreatCoverTarget) < 2) {
      this.rejectCurrentRetreatCover();
      this.retreatCoverTarget = null;
      this.retreatCoverId = null;
      this.clearNavigation();
    }
    if (!this.retreatCoverTarget) {
      const cover = this.findRetreatCover(actor, state, layout, threat);
      if (cover) {
        this.retreatCoverTarget = cover.target;
        this.retreatCoverId = cover.coverId;
        return this.navigate(actor, cover.target, command, cover.path, true);
      }
    }
    if (this.retreatCoverTarget) {
      return this.navigate(actor, this.retreatCoverTarget, command, undefined, true);
    }
    this.clearNavigation();
    const away = normalizeFlat(subtract(actor.position, threat));
    const escapeAngles = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2] as const;
    const angle = escapeAngles[this.retreatEscapeIndex] ?? 0;
    command.move = rotateFlat(away, angle);
    command.sprint = true;
    return command;
  }

  private findRetreatCover(
    actor: ActorState,
    state: MatchState,
    layout: ReturnType<typeof createMapLayout>,
    threat: Vector3State,
  ): { coverId: string; target: Vector3State; path: Vector3State[] } | null {
    const actorFeetY = actor.position.y - ACTOR_EYE_HEIGHT;
    const actorTopY = actorFeetY + ACTOR_HEIGHT;
    const blockers = [...layout.wallSegments, ...layout.rockObstacles, ...layout.coverObstacles, ...layout.treeTrunks]
      .filter((obstacle) =>
        obstacle.center.y - obstacle.height / 2 < actorTopY &&
        obstacle.center.y + obstacle.height / 2 > actorFeetY
      )
      .filter((obstacle) => !this.rejectedRetreatCoverIds.has(obstacle.id))
      .map((obstacle) => ({ obstacle, distance: horizontalDistance(actor.position, obstacle.center) }))
      .filter((entry) => entry.distance <= RETREAT_COVER_SEARCH_DISTANCE)
      .sort((left, right) => left.distance - right.distance || left.obstacle.id.localeCompare(right.obstacle.id))
      .slice(0, 8);
    let pathChecks = 0;
    for (const { obstacle } of blockers) {
      const away = normalizeFlat(subtract(obstacle.center, threat));
      if (away.x === 0 && away.z === 0) continue;
      const edgeDistance = Math.min(
        Math.abs(away.x) > 1e-6 ? obstacle.width / 2 / Math.abs(away.x) : Number.POSITIVE_INFINITY,
        Math.abs(away.z) > 1e-6 ? obstacle.depth / 2 / Math.abs(away.z) : Number.POSITIVE_INFINITY,
      );
      const x = obstacle.center.x + away.x * (edgeDistance + 1.15);
      const z = obstacle.center.z + away.z * (edgeDistance + 1.15);
      const target = { x, y: getTerrainHeight(x, z, layout) + 1.76, z };
      if (horizontalDistance(actor.position, target) < 3) continue;
      if (
        state.safeZone.radius > 2 &&
        horizontalDistance(target, state.safeZone.center) > state.safeZone.radius - 1
      ) continue;
      const path = this.navigator.findPath(actor.position, target);
      pathChecks += 1;
      if (path.length > 0) return { coverId: obstacle.id, target, path };
      if (pathChecks >= 4) break;
    }
    return null;
  }

  private findUsefulLoot(
    actor: ActorState,
    state: MatchState,
    allowOutsideTargetZone = false,
    purpose: LootPurpose = "general",
  ): LootSelection | null {
    const hasWeapon = actor.inventory.weaponSlots.some((weapon) => weapon !== null);
    const activeWeapon = getActiveWeapon(actor);
    const weaponConfig = activeWeapon ? WEAPONS[activeWeapon.weaponId] : undefined;
    const needsAmmo = Boolean(
      activeWeapon &&
      weaponConfig &&
      activeWeapon.ammoInMagazine === 0 &&
      getItemQuantity(actor, weaponConfig.ammoItemId) === 0
    );
    const compatibleAmmoItemIds = new Set(actor.inventory.weaponSlots.flatMap((weapon) => {
      const ammoItemId = weapon ? WEAPONS[weapon.weaponId]?.ammoItemId : undefined;
      return ammoItemId ? [ammoItemId] : [];
    }));
    const lootZoneRadius = Math.max(
      0,
      state.safeZone.targetRadius - Math.min(ZONE_SAFETY_MARGIN, state.safeZone.targetRadius * 0.12),
    );
    const replacementItemIdFor = (loot: GroundLootState): string | null | undefined => {
      const item = ITEMS[loot.itemId];
      if (!item) return undefined;
      if (item.kind === "weapon" || item.kind === "armor" || item.kind === "helmet") return null;
      const existingStack = actor.inventory.backpack.find((stack) => stack.itemId === item.id);
      const canCarry = Boolean(existingStack && existingStack.quantity < item.maxStack) ||
        actor.inventory.backpack.length < actor.inventory.maxBackpackStacks;
      if (canCarry) return null;
      if (purpose === "general") return undefined;
      if (purpose === "compatible-ammo") {
        return actor.inventory.backpack.find((stack) =>
          ITEMS[stack.itemId]?.kind === "ammo" && !compatibleAmmoItemIds.has(stack.itemId)
        )?.itemId;
      }
      return actor.inventory.backpack.find((stack) =>
        ITEMS[stack.itemId]?.kind !== "medical" && !compatibleAmmoItemIds.has(stack.itemId)
      )?.itemId ?? actor.inventory.backpack.find((stack) => ITEMS[stack.itemId]?.kind !== "medical")?.itemId;
    };
    const isUseful = (loot: GroundLootState): boolean => {
      if (!loot.available || !this.isAllowedLoot(loot)) return false;
      const insideAllowedZone = purpose === "medical"
        ? horizontalDistance(loot.position, state.safeZone.center) <= state.safeZone.radius
        : allowOutsideTargetZone || horizontalDistance(loot.position, state.safeZone.targetCenter) <= lootZoneRadius;
      if (!insideAllowedZone) return false;
      const item = ITEMS[loot.itemId];
      if (!item) return false;
      const replacementItemId = replacementItemIdFor(loot);
      if (purpose === "medical") {
        return item.kind === "medical" && actor.health < actor.maxHealth && replacementItemId !== undefined;
      }
      if (purpose === "compatible-ammo") {
        return item.kind === "ammo" && compatibleAmmoItemIds.has(item.id) && replacementItemId !== undefined;
      }
      return hasWeapon
        ? (item.kind === "ammo" && (!needsAmmo || item.id === weaponConfig?.ammoItemId) && replacementItemId === null) ||
          (item.kind === "medical" && actor.health < 90 && replacementItemId === null) ||
          (item.kind === "armor" && (
            (item.level ?? 0) > actor.inventory.armorLevel ||
            ((item.level ?? 0) === actor.inventory.armorLevel && actor.armor < actor.maxArmor)
          )) ||
          (item.kind === "helmet" && (item.level ?? 0) > actor.inventory.helmetLevel)
        : item.kind === "weapon";
    };
    const currentTarget = this.lootTargetId ? state.groundLoot[this.lootTargetId] : undefined;
    if (currentTarget && isUseful(currentTarget)) {
      const replacementItemId = replacementItemIdFor(currentTarget);
      if (replacementItemId === undefined) return null;
      const currentDistance = horizontalDistance(actor.position, currentTarget.position);
      const nearestUsefulDistance = hasWeapon
        ? currentDistance
        : Object.values(state.groundLoot).reduce((nearest, loot) =>
            isUseful(loot) ? Math.min(nearest, horizontalDistance(actor.position, loot.position)) : nearest,
          Number.POSITIVE_INFINITY);
      const significantlyBetterTargetExists = nearestUsefulDistance + 30 < currentDistance * 0.9;
      if (!significantlyBetterTargetExists) {
        if (this.navigationPath.length > 0 || distanceSquared(actor.position, currentTarget.position) <= LOOT_INTERACTION_DISTANCE ** 2) {
          return { loot: currentTarget, generation: currentTarget.generation ?? 0, path: this.navigationPath, replacementItemId };
        }
        const path = this.navigator.findPath(actor.position, currentTarget.position);
        if (path.length > 0) return { loot: currentTarget, generation: currentTarget.generation ?? 0, path, replacementItemId };
      }
      this.clearNavigation();
    }
    this.lootTargetId = null;
    const candidates: { loot: GroundLootState; distance: number; replacementItemId: string | null }[] = [];
    for (const loot of Object.values(state.groundLoot)) {
      if (!isUseful(loot)) continue;
      const replacementItemId = replacementItemIdFor(loot);
      if (replacementItemId === undefined) continue;
      const distance = horizontalDistance(actor.position, loot.position);
      if (purpose === "general" && hasWeapon && !needsAmmo && distance >= 85) continue;
      candidates.push({ loot, distance, replacementItemId });
    }
    candidates.sort((left, right) => left.distance - right.distance || left.loot.id.localeCompare(right.loot.id));
    const nearbyCandidateCount = Math.min(3, candidates.length);
    const candidateOffset = hasWeapon || nearbyCandidateCount === 0
      ? 0
      : (this.controlledActorNumericId * 7 + this.landingPoiWave) % nearbyCandidateCount;
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
        return {
          loot: candidate.loot,
          generation: candidate.loot.generation ?? 0,
          path,
          replacementItemId: candidate.replacementItemId,
        };
      }
    }
    return null;
  }

  private moveToLoot(
    actor: ActorState,
    selection: LootSelection,
    command: ActorCommand,
  ): ActorCommand {
    const { loot, path } = selection;
    if (distanceSquared(actor.position, loot.position) > LOOT_INTERACTION_DISTANCE ** 2) {
      return this.navigate(actor, loot.position, command, path);
    }
    this.clearNavigation();
    command.dropItem = selection.replacementItemId;
    command.interact = true;
    command.interactLootId = loot.id;
    command.interactLootGeneration = selection.generation;
    return command;
  }

  private findLandingTarget(state: MatchState): Vector3State {
    if (this.weaponLandingTarget) return this.weaponLandingTarget;
    const layout = this.layout;
    const weaponLoot = Object.values(state.groundLoot)
      .filter((loot) => this.isAllowedLoot(loot) && ITEMS[loot.itemId]?.kind === "weapon")
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
    const targetChanged = this.navigationTarget?.x !== target.x ||
      this.navigationTarget.z !== target.z ||
      Math.abs((this.navigationTarget?.y ?? target.y) - target.y) > 0.2;
    const targetSurfaceChanged = Boolean(
      this.navigationTarget && navigationSurfaceKey(this.navigationTarget, this.layout) !== navigationSurfaceKey(target, this.layout)
    );
    const navigationModeChanged = this.navigationPreservesAim !== preserveAim;
    if (
      this.navigationPath.length === 0 ||
      navigationModeChanged ||
      (targetChanged && (!preserveAim || targetSurfaceChanged))
    ) {
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
      spatialDistance(actor.position, this.navigationPath[this.waypointIndex] as Vector3State) < WAYPOINT_REACHED_DISTANCE
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
    const waypointKey = `${this.waypointIndex}:${this.waypoint.x}:${this.waypoint.y}:${this.waypoint.z}`;
    const waypointDistance = spatialDistance(actor.position, this.waypoint);
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

  private updateLiveness(actor: ActorState, state: MatchState): boolean {
    const elapsedSeconds = state.elapsedSeconds;
    if (!this.livenessAnchor) {
      this.livenessAnchor = { ...actor.position };
      this.livenessAnchorSeconds = elapsedSeconds;
      this.livenessLastPosition = { ...actor.position };
      this.oscillationWindowStartedSeconds = elapsedSeconds;
      return false;
    }
    if (
      this.forcedRelocationOrigin &&
      horizontalDistance(actor.position, this.forcedRelocationOrigin) >= FORCED_RELOCATION_CLEAR_DISTANCE
    ) {
      this.clearForcedRelocation();
    }
    const anchorDistance = horizontalDistance(actor.position, this.livenessAnchor);
    if (anchorDistance >= STATIONARY_RADIUS) {
      this.livenessAnchor.x = actor.position.x;
      this.livenessAnchor.y = actor.position.y;
      this.livenessAnchor.z = actor.position.z;
      this.livenessAnchorSeconds = elapsedSeconds;
    }
    if (this.livenessLastPosition) {
      const displacementX = actor.position.x - this.livenessLastPosition.x;
      const displacementZ = actor.position.z - this.livenessLastPosition.z;
      const distance = Math.hypot(displacementX, displacementZ);
      if (distance >= 0.08) {
        const directionX = displacementX / distance;
        const directionZ = displacementZ / distance;
        if (elapsedSeconds - this.oscillationWindowStartedSeconds > OSCILLATION_WINDOW_SECONDS) {
          this.oscillationWindowStartedSeconds = elapsedSeconds;
          this.oscillationReversals = 0;
        }
        if (
          this.livenessLastDirection &&
          directionX * this.livenessLastDirection.x + directionZ * this.livenessLastDirection.z < -0.6
        ) {
          this.oscillationReversals += 1;
        }
        if (this.livenessLastDirection) {
          this.livenessLastDirection.x = directionX;
          this.livenessLastDirection.z = directionZ;
        } else {
          this.livenessLastDirection = { x: directionX, y: 0, z: directionZ };
        }
      }
    }
    if (this.livenessLastPosition) {
      this.livenessLastPosition.x = actor.position.x;
      this.livenessLastPosition.y = actor.position.y;
      this.livenessLastPosition.z = actor.position.z;
    }
    const stationary = elapsedSeconds - this.livenessAnchorSeconds >= MAX_STATIONARY_SECONDS;
    const oscillating = this.oscillationReversals >= OSCILLATION_REVERSAL_LIMIT &&
      elapsedSeconds - this.oscillationWindowStartedSeconds <= OSCILLATION_WINDOW_SECONDS;
    if (
      (stationary || oscillating) &&
      elapsedSeconds > this.forcedRelocationUntilSeconds
    ) {
      this.startForcedRelocation(actor, state);
      return true;
    }
    return false;
  }

  private startForcedRelocation(actor: ActorState, state: MatchState): void {
    this.forcedRelocationOrigin = { ...actor.position };
    this.forcedRelocationTarget = null;
    this.forcedRelocationUntilSeconds = state.elapsedSeconds + FORCED_RELOCATION_SECONDS;
    this.forcedRelocationSequence += 1;
    this.oscillationWindowStartedSeconds = state.elapsedSeconds;
    this.oscillationReversals = 0;
    this.livenessLastDirection = null;
    this.lootTargetId = null;
    this.patrolTarget = null;
    this.patrolTargetUntilSeconds = -1;
    this.damageInvestigationTarget = null;
    this.damageInvestigationDirection = null;
    this.clearCombatMemory();
    this.clearRetreat();
    this.clearNavigation();
  }

  private clearForcedRelocation(): void {
    this.forcedRelocationOrigin = null;
    this.forcedRelocationTarget = null;
    this.forcedRelocationUntilSeconds = -1;
  }

  private forceRelocation(actor: ActorState, state: MatchState, command: ActorCommand): ActorCommand {
    this.clearCombatMemory();
    this.damageInvestigationTarget = null;
    this.damageInvestigationDirection = null;
    if (this.retreatThreatPosition) this.clearRetreat();
    if (
      this.forcedRelocationTarget &&
      horizontalDistance(actor.position, this.forcedRelocationTarget) >= 3
    ) {
      return this.navigate(actor, this.forcedRelocationTarget, command);
    }
    this.forcedRelocationTarget = null;
    this.clearNavigation();
    const outsideCurrentZone = horizontalDistance(actor.position, state.safeZone.center) > state.safeZone.radius;
    const center = outsideCurrentZone ? state.safeZone.center : state.safeZone.targetCenter;
    const radius = outsideCurrentZone ? state.safeZone.radius : state.safeZone.targetRadius;
    const candidates: Vector3State[] = [];
    if (outsideCurrentZone && radius > 0) {
      const fromCenter = normalizeFlat(subtract(actor.position, center));
      candidates.push({
        x: center.x + fromCenter.x * radius * 0.55,
        y: center.y,
        z: center.z + fromCenter.z * radius * 0.55,
      });
    }
    candidates.push({ ...center });
    for (let offset = 0; offset < 3; offset += 1) {
      const angle = this.controlledActorNumericId * 2.399963 +
        (this.forcedRelocationSequence + offset) * Math.PI / 6;
      const targetRadius = Math.min(60, Math.max(18, radius * 0.58));
      candidates.push({
        x: center.x + Math.cos(angle) * targetRadius,
        y: center.y,
        z: center.z + Math.sin(angle) * targetRadius,
      });
    }
    let pathChecks = 0;
    for (const candidate of candidates) {
      const target = {
        x: candidate.x,
        y: getTerrainHeight(candidate.x, candidate.z, this.layout) + 1.76,
        z: candidate.z,
      };
      if (horizontalDistance(actor.position, target) < 8) continue;
      if (pathChecks >= FORCED_RELOCATION_PATH_CHECKS) break;
      pathChecks += 1;
      const path = this.navigator.findPath(actor.position, target);
      if (path.length === 0) continue;
      this.forcedRelocationTarget = target;
      return this.navigate(actor, target, command, path);
    }
    const escapeAngles = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI] as const;
    const towardCenter = normalizeFlat(subtract(center, actor.position));
    command.move = rotateFlat(towardCenter, escapeAngles[this.forcedRelocationSequence % escapeAngles.length] ?? 0);
    command.aimDirection = { ...command.move };
    command.sprint = true;
    return command;
  }

  private glideToward(actor: ActorState, target: Vector3State): ActorCommand {
    const command = createIdleCommand();
    const offset = subtract(target, actor.position);
    const distance = Math.hypot(offset.x, offset.z);
    if (distance <= PARACHUTE_TARGET_DEAD_ZONE) {
      command.aimDirection = { x: Math.sin(actor.yaw), y: 0, z: Math.cos(actor.yaw) };
      return command;
    }
    const direction = normalizeFlat(offset);
    const inputScale = clamp(
      (distance - PARACHUTE_TARGET_DEAD_ZONE) / PARACHUTE_APPROACH_DISTANCE,
      0,
      1,
    );
    command.move = { x: direction.x * inputScale, y: 0, z: direction.z * inputScale };
    command.aimDirection = { ...direction };
    return command;
  }

  private navigateIntoZone(
    actor: ActorState,
    center: Vector3State,
    radius: number,
    command: ActorCommand,
    elapsedSeconds: number,
  ): ActorCommand {
    if (
      this.navigationPath.length > 0 &&
      !this.navigationPreservesAim &&
      this.navigationTarget &&
      horizontalDistance(this.navigationTarget, center) <= Math.max(2, radius)
    ) {
      this.updateNavigationMovement(actor, command);
      command.sprint = true;
      return command;
    }
    if (elapsedSeconds < this.zonePathRetryAtSeconds) {
      return this.moveDirectlyIntoZone(actor, center, command);
    }
    const fromCenter = normalizeFlat(subtract(actor.position, center));
    const entryRadius = Math.max(0, radius * 0.72);
    const candidates: Vector3State[] = [{
      x: center.x + fromCenter.x * entryRadius,
      y: center.y,
      z: center.z + fromCenter.z * entryRadius,
    }, { ...center }];
    for (let offset = 0; offset < 8 && radius > 0; offset += 1) {
      const angle = this.controlledActorNumericId * 2.399963 + offset * Math.PI / 4;
      candidates.push({
        x: center.x + Math.cos(angle) * radius * 0.55,
        y: center.y,
        z: center.z + Math.sin(angle) * radius * 0.55,
      });
    }
    for (const candidate of candidates) {
      const path = this.navigator.findPath(actor.position, candidate);
      if (path.length > 0) {
        this.zonePathRetryAtSeconds = -1;
        return this.navigate(actor, candidate, command, path);
      }
    }
    this.zonePathRetryAtSeconds = elapsedSeconds + ZONE_PATH_RETRY_SECONDS;
    return this.moveDirectlyIntoZone(actor, center, command);
  }

  private moveDirectlyIntoZone(
    actor: ActorState,
    center: Vector3State,
    command: ActorCommand,
  ): ActorCommand {
    this.clearNavigation();
    command.move = normalizeFlat(subtract(center, actor.position));
    command.aimDirection = { ...command.move };
    command.sprint = true;
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

  private clearCombatMemory(): void {
    this.combatLastKnownPosition = null;
    this.combatMemoryUntilSeconds = -1;
  }

  private clearRetreat(): void {
    if (this.retreatCoverTarget) this.clearNavigation();
    this.retreatThreatId = null;
    this.retreatThreatPosition = null;
    this.retreatCoverTarget = null;
    this.retreatCoverId = null;
    this.rejectedRetreatCoverIds.clear();
    this.retreatEscapeIndex = 0;
    this.retreatUntilSeconds = -1;
    this.retreatSafeSinceSeconds = -1;
  }

  private rejectCurrentRetreatCover(): void {
    if (!this.retreatCoverId) return;
    this.rejectedRetreatCoverIds.add(this.retreatCoverId);
    if (this.rejectedRetreatCoverIds.size > 8) {
      const oldest = this.rejectedRetreatCoverIds.values().next().value;
      if (oldest) this.rejectedRetreatCoverIds.delete(oldest);
    }
  }

  private isAllowedLoot(loot: GroundLootState): boolean {
    return !this.disableSnipers || (loot.itemId !== SNIPER_WEAPON_ITEM_ID && loot.itemId !== SNIPER_AMMO_ITEM_ID);
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

function rotateFlat(value: Vector3State, angle: number): Vector3State {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: value.x * cosine - value.z * sine,
    y: 0,
    z: value.x * sine + value.z * cosine,
  };
}

function horizontalDistance(a: Vector3State, b: Vector3State): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function spatialDistance(a: Vector3State, b: Vector3State): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function navigationSurfaceKey(point: Vector3State, layout: MapLayout): string {
  for (const building of layout.obstacles) {
    if (
      Math.abs(point.x - building.center.x) > building.width / 2 ||
      Math.abs(point.z - building.center.z) > building.depth / 2
    ) continue;
    for (let level = building.storyCount; level >= 1; level -= 1) {
      const supportY = building.baseY + level * building.storyHeight + BUILDING_ROOF_CAP_HEIGHT;
      if (point.y >= supportY + 0.15) return `${building.id}:${level}`;
    }
    return `${building.id}:0`;
  }
  return "ground";
}

function vectorDistance(a: Vector3State, b: Vector3State): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
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
