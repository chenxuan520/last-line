import { BATTLE_ROYALE_CONFIG } from "../config/battleRoyale";
import { ITEMS } from "../config/items";
import { WEAPONS } from "../config/weapons";
import { createMapLayout, type MapLayout } from "../config/map";
import { DEFAULT_MAP_ID, normalizeMapId, type MapId } from "../config/maps";
import { FRAG_GRENADE_CONFIG } from "../config/throwables";
import { BotController } from "../controllers/BotController";
import { createIdleCommand, type ActorCommand } from "../game/commands/ActorCommand";
import { GameSimulation } from "../game/GameSimulation";
import { BattleRoyaleMode, createBattleRoyaleStateForHumans } from "../game/modes/BattleRoyaleMode";
import { SIMULATION_STEP_SECONDS, SIMULATION_TICK_RATE } from "../game/simulationTiming";
import type {
  ActiveGrenadeState,
  ActorState,
  EntityId,
  GameEvent,
  GroundLootState,
  MatchState,
} from "../game/state/types";
import { SimulationCombatWorld } from "../game/systems/SimulationCombatWorld";
import type { MatchFrame, MultiplayerEvent, SequencedGameEvent } from "../network/protocol";
import { CommandInbox } from "./CommandInbox";
import { LagCompensatedCombatWorld } from "./LagCompensatedCombatWorld";

const BOT_COHORTS = 3;
const TAKEOVER_TICKS = SIMULATION_TICK_RATE * 5;
const ACTOR_REPLICATION_RANGE = 400;
const LOOT_REPLICATION_RANGE = 60;
const AIRBORNE_LOOT_REPLICATION_RANGE = ACTOR_REPLICATION_RANGE;
export const MATCH_CHECKPOINT_VERSION = 7;
const MINIMUM_CLOSED_SAFE_ZONE_SECONDS = BATTLE_ROYALE_CONFIG.safeZoneStages.reduce(
  (total, stage) => total + stage.waitSeconds + stage.shrinkSeconds / 2,
  0,
);
const MINIMUM_CLOSED_SAFE_ZONE_TICKS = Math.ceil(
  MINIMUM_CLOSED_SAFE_ZONE_SECONDS * SIMULATION_TICK_RATE,
);

export interface MatchRuntimeOptions {
  humanActorIds: readonly EntityId[];
  seed: number;
  mapId?: MapId;
  startWithBandage: boolean;
  disableAiSnipers: boolean;
  state?: MatchState;
  tick?: number;
  snapshotSequence?: number;
  eventSequence?: number;
}

export interface MatchCheckpoint {
  version: number;
  state: MatchState;
  tick: number;
  snapshotSequence: number;
  eventSequence: number;
}

export class MatchRuntime {
  public readonly state: MatchState;
  private readonly simulation: GameSimulation;
  private readonly world: LagCompensatedCombatWorld;
  private readonly layout: MapLayout;
  private readonly bots = new Map<EntityId, BotController>();
  private readonly botContinuousCommands = new Map<EntityId, ActorCommand>();
  private readonly takeoverBots = new Map<EntityId, BotController>();
  private readonly disconnectedAtTick = new Map<EntityId, number>();
  private readonly inbox = new CommandInbox();
  private readonly pendingEvents: SequencedGameEvent[] = [];
  private readonly dirtyLootIds = new Set<EntityId>();
  private tickValue: number;
  private snapshotSequenceValue: number;
  private eventSequenceValue: number;

  public constructor(private readonly options: MatchRuntimeOptions) {
    const random = seededRandom(options.seed);
    this.state = options.state
      ? normalizeMatchState(JSON.parse(JSON.stringify(options.state)) as MatchState)
      : createBattleRoyaleStateForHumans(
        options.humanActorIds,
        BATTLE_ROYALE_CONFIG,
        random,
        {
          startWithBandage: options.startWithBandage,
          mapId: options.mapId ?? DEFAULT_MAP_ID,
        },
      );
    this.layout = createMapLayout(this.state.mapId, this.state.mapSeed);
    this.simulation = new GameSimulation(this.state, new BattleRoyaleMode(BATTLE_ROYALE_CONFIG, random), WEAPONS, this.layout);
    this.tickValue = options.tick ?? 0;
    this.snapshotSequenceValue = options.snapshotSequence ?? 0;
    this.eventSequenceValue = options.eventSequence ?? 0;
    this.world = new LagCompensatedCombatWorld(
      this.state,
      new SimulationCombatWorld(this.state, true, this.layout),
    );
    Object.values(this.state.actors).filter((actor) => actor.kind === "bot").forEach((actor, index) => {
      this.bots.set(actor.id, new BotController(
        index + 1,
        seededRandom(options.seed + 1_000 + index),
        options.disableAiSnipers,
        this.layout,
      ));
      const idle = createIdleCommand();
      this.botContinuousCommands.set(actor.id, continuousCommand(idle));
    });
    if (!options.state) {
      this.simulation.start();
      this.recordEvents(this.simulation.drainEvents());
    }
    this.world.recordFrame(this.tickValue);
  }

  public get tick(): number {
    return this.tickValue;
  }

  public submitInput(
    actorId: EntityId,
    sequence: number,
    command: ActorCommand,
    renderTick?: number,
    shotSequence?: number,
    shotWeaponId?: string,
  ): boolean {
    return this.options.humanActorIds.includes(actorId)
      && this.inbox.accept(
        actorId,
        sequence,
        command,
        this.tickValue,
        renderTick,
        shotSequence,
        shotWeaponId,
      );
  }

  public acknowledge(actorId: EntityId): number {
    return this.inbox.acknowledge(actorId);
  }

  public setConnected(actorId: EntityId, connected: boolean, announce = true): void {
    if (!this.options.humanActorIds.includes(actorId)) return;
    const wasConnected = !this.disconnectedAtTick.has(actorId);
    if (wasConnected === connected) return;
    if (connected) {
      this.disconnectedAtTick.delete(actorId);
      this.takeoverBots.delete(actorId);
    } else {
      this.disconnectedAtTick.set(actorId, this.tickValue);
      this.inbox.reset(actorId);
    }
    if (announce) {
      this.recordEvent({
        type: "human-connection",
        actorId,
        status: connected ? "reconnected" : "disconnected",
      });
    }
  }

  public step(): void {
    if (this.state.phase === "finished") return;
    const commands = new Map<EntityId, ActorCommand>();
    const aiActorIds = new Set<EntityId>();
    const rewindTicks = new Map<EntityId, number>();
    let livingActorCount: number | undefined;
    const getLivingActorCount = (): number => {
      livingActorCount ??= Object.values(this.state.actors).filter((candidate) => candidate.alive).length;
      return livingActorCount;
    };
    for (const [index, actorId] of this.options.humanActorIds.entries()) {
      const actor = this.state.actors[actorId];
      if (!actor?.alive) continue;
      const disconnectedAt = this.disconnectedAtTick.get(actorId);
      if (disconnectedAt !== undefined && this.tickValue - disconnectedAt >= TAKEOVER_TICKS) {
        let controller = this.takeoverBots.get(actorId);
        if (!controller) {
          controller = new BotController(
            10_000 + index,
            seededRandom(this.options.seed + 20_000 + index),
            this.options.disableAiSnipers,
            this.layout,
          );
          this.takeoverBots.set(actorId, controller);
        }
        aiActorIds.add(actorId);
        commands.set(actorId, controller.update(
          actor,
          this.state,
          this.world,
          SIMULATION_STEP_SECONDS,
          actorId,
          actor.deployment === "grounded" ? getLivingActorCount() : undefined,
        ));
      } else {
        const input = this.inbox.consumeWithMetadata(actorId, this.tickValue);
        commands.set(actorId, input.command);
        if (input.command.fire && input.renderTick !== null) rewindTicks.set(actorId, input.renderTick);
      }
    }
    let botIndex = 0;
    for (const [actorId, controller] of this.bots) {
      const actor = this.state.actors[actorId];
      if (actor?.alive) {
        aiActorIds.add(actorId);
        if (botIndex % BOT_COHORTS === this.tickValue % BOT_COHORTS) {
          const command = controller.update(
            actor,
            this.state,
            this.world,
            BOT_COHORTS * SIMULATION_STEP_SECONDS,
            this.options.humanActorIds[0] ?? actorId,
            actor.deployment === "grounded" ? getLivingActorCount() : undefined,
          );
          this.botContinuousCommands.set(actorId, continuousCommand(command));
          commands.set(actorId, command);
        } else {
          commands.set(actorId, this.botContinuousCommands.get(actorId) ?? createIdleCommand());
        }
      }
      botIndex += 1;
    }
    this.world.beginStep(this.tickValue, rewindTicks);
    try {
      this.simulation.step(SIMULATION_STEP_SECONDS, commands, this.world, aiActorIds);
    } finally {
      this.world.endStep();
    }
    const events = this.simulation.drainEvents();
    const shotSequences = new Map<EntityId, number>();
    for (const event of events) {
      if (event.type !== "shot-fired") continue;
      const shotSequence = this.inbox.consumeShotSequence(event.actorId, this.tickValue, event.weaponId);
      if (shotSequence !== null) shotSequences.set(event.actorId, shotSequence);
    }
    this.tickValue += 1;
    this.world.recordFrame(this.tickValue);
    this.recordEvents(events, shotSequences);
  }

  public takeFrame(serverTimeMs: number): MatchFrame {
    this.snapshotSequenceValue += 1;
    const frame: MatchFrame = {
      snapshotSequence: this.snapshotSequenceValue,
      tick: this.tickValue,
      serverTimeMs,
      phase: this.state.phase,
      elapsedSeconds: this.state.elapsedSeconds,
      flight: this.state.flight,
      safeZone: this.state.safeZone,
      result: this.state.result,
      actors: this.state.actors,
      visibleActorIds: Object.keys(this.state.actors),
      activeGrenades: this.state.activeGrenades,
      lootChanges: [...this.dirtyLootIds].flatMap((id) => {
        const loot = this.state.groundLoot[id];
        return loot ? [loot] : [];
      }),
      events: [...this.pendingEvents],
    };
    this.pendingEvents.length = 0;
    this.dirtyLootIds.clear();
    return frame;
  }

  public checkpoint(): MatchCheckpoint {
    return {
      version: MATCH_CHECKPOINT_VERSION,
      state: JSON.parse(JSON.stringify(this.state)) as MatchState,
      tick: this.tickValue,
      snapshotSequence: this.snapshotSequenceValue,
      eventSequence: this.eventSequenceValue,
    };
  }

  public projectState(viewerId: EntityId): MatchState {
    const viewer = this.state.actors[viewerId];
    if (!viewer) return this.state;
    const visibleActorIds = this.visibleActorIds(viewer);
    return {
      ...this.state,
      actors: Object.fromEntries(Object.values(this.state.actors).map((actor) => [
        actor.id,
        visibleActorIds.has(actor.id) ? actor : redactActor(actor),
      ])),
      groundLoot: Object.fromEntries(this.visibleLoot(viewer).map((loot) => [loot.id, loot])),
      activeGrenades: Object.fromEntries(
        this.visibleGrenades(viewer).map((grenade) => [grenade.id, grenade]),
      ),
    };
  }

  public projectFrame(
    frame: MatchFrame,
    viewerId: EntityId,
    previouslyVisibleLootIds: ReadonlySet<EntityId>,
  ): { frame: MatchFrame; visibleLootIds: Set<EntityId> } {
    const viewer = this.state.actors[viewerId];
    if (!viewer) return { frame, visibleLootIds: new Set() };
    const visibleActorIds = this.visibleActorIds(viewer);
    const visibleLoot = this.visibleLoot(viewer);
    const visibleLootIds = new Set(visibleLoot.map((loot) => loot.id));
    const newlyVisibleLoot = visibleLoot.filter((loot) => !previouslyVisibleLootIds.has(loot.id));
    const dirtyVisibleLoot = frame.lootChanges.filter((loot) => visibleLootIds.has(loot.id));
    const hiddenLoot = [...previouslyVisibleLootIds]
      .filter((id) => !visibleLootIds.has(id))
      .flatMap((id) => {
        const loot = this.state.groundLoot[id];
        return loot ? [{ ...loot, available: false }] : [];
      });
    return {
      frame: {
        ...frame,
        actors: Object.fromEntries(Object.values(this.state.actors).map((actor) => [
          actor.id,
          visibleActorIds.has(actor.id) ? actor : redactActor(actor),
        ])),
        visibleActorIds: [...visibleActorIds],
        activeGrenades: Object.fromEntries(
          this.visibleGrenades(viewer).map((grenade) => [grenade.id, grenade]),
        ),
        lootChanges: [...new Map(
          [...newlyVisibleLoot, ...dirtyVisibleLoot, ...hiddenLoot].map((loot) => [loot.id, loot]),
        ).values()],
        events: frame.events.filter((entry) => eventVisibleTo(entry.event, viewer, this.state.actors)),
      },
      visibleLootIds,
    };
  }

  private recordEvents(
    events: readonly GameEvent[],
    shotSequences: ReadonlyMap<EntityId, number> = new Map(),
  ): void {
    for (const event of events) {
      const shotSequence = event.type === "shot-fired" || event.type === "shot-traced"
        ? shotSequences.get(event.actorId)
        : undefined;
      this.recordEvent(event, shotSequence);
      if (event.type === "item-picked" || event.type === "item-dropped") this.dirtyLootIds.add(event.lootId);
    }
  }

  private recordEvent(event: MultiplayerEvent, shotSequence?: number): void {
    this.eventSequenceValue += 1;
    this.pendingEvents.push({
      sequence: this.eventSequenceValue,
      ...(shotSequence === undefined ? {} : { shotSequence }),
      event,
    });
  }

  private visibleActorIds(viewer: ActorState): Set<EntityId> {
    if (!viewer.alive) return new Set(Object.values(this.state.actors).filter((actor) => actor.alive).map((actor) => actor.id));
    return new Set(Object.values(this.state.actors).filter((actor) =>
      actor.id === viewer.id ||
      actor.deployment === "aircraft" ||
      Math.hypot(actor.position.x - viewer.position.x, actor.position.z - viewer.position.z) <= ACTOR_REPLICATION_RANGE
    ).map((actor) => actor.id));
  }

  private visibleLoot(viewer: ActorState): GroundLootState[] {
    const replicationRange = viewer.deployment === "grounded"
      ? LOOT_REPLICATION_RANGE
      : AIRBORNE_LOOT_REPLICATION_RANGE;
    return Object.values(this.state.groundLoot).filter((loot) =>
      loot.available && Math.hypot(
        loot.position.x - viewer.position.x,
        loot.position.z - viewer.position.z,
      ) <= replicationRange
    );
  }

  private visibleGrenades(viewer: ActorState): ActiveGrenadeState[] {
    if (!viewer.alive) return Object.values(this.state.activeGrenades);
    return Object.values(this.state.activeGrenades).filter((grenade) =>
      Math.hypot(
        grenade.position.x - viewer.position.x,
        grenade.position.z - viewer.position.z,
      ) <= ACTOR_REPLICATION_RANGE
    );
  }
}

export function isMatchCheckpointCompatible(
  checkpoint: unknown,
  requiredActorIds?: readonly EntityId[],
): checkpoint is MatchCheckpoint {
  if (!isRecord(checkpoint)) return false;
  if (
    !isNonNegativeInteger(checkpoint.tick) ||
    !isNonNegativeInteger(checkpoint.snapshotSequence) ||
    !isNonNegativeInteger(checkpoint.eventSequence)
  ) return false;
  if (!isRecoverableMatchState(checkpoint.state, checkpoint.tick, requiredActorIds)) return false;
  const mapId: unknown = checkpoint.state.mapId;
  if (checkpoint.version === MATCH_CHECKPOINT_VERSION) {
    return mapId === "island" || mapId === "town" || mapId === "mixed";
  }
  return false;
}

function isRecoverableMatchState(
  value: unknown,
  tick: number,
  requiredActorIds?: readonly EntityId[],
): value is MatchState {
  if (!isRecord(value)) return false;
  if (!["flight", "combat", "finished"].includes(String(value.phase))) return false;
  if (!isNonNegativeNumber(value.elapsedSeconds) || !isUint32(value.mapSeed)) return false;
  const actors = value.actors;
  if (!isRecord(actors)) return false;
  const actorEntries = Object.entries(actors);
  if (actorEntries.length !== BATTLE_ROYALE_CONFIG.participantCount) return false;
  if (!actorEntries.every(([actorId, actor]) =>
    isRecoverableActor(actor) && actorId === actor.id
  )) return false;
  if (requiredActorIds !== undefined) {
    const requiredActors = new Set(requiredActorIds);
    if (
      requiredActors.size !== requiredActorIds.length ||
      requiredActorIds.some((actorId) => (actors[actorId] as ActorState | undefined)?.kind !== "player") ||
      actorEntries.some(([actorId, actor]) =>
        requiredActors.has(actorId) !== ((actor as ActorState).kind === "player")
      )
    ) return false;
  }
  if (!isRecord(value.groundLoot) || !Object.entries(value.groundLoot).every(
    ([lootId, loot]) => isRecoverableLoot(lootId, loot),
  )) return false;
  if (!isRecoverableGrenades(value.activeGrenades, value.nextGrenadeSequence, actors)) return false;
  if (!isRecoverableSafeZone(value.safeZone, value.phase, value.elapsedSeconds, tick) ||
    !isRecoverableFlight(value.flight)) return false;
  const resultIsValid = value.result === null || (
    isRecord(value.result) &&
    (value.result.winnerId === null || typeof value.result.winnerId === "string") &&
    (value.result.reason === "last-alive" || value.result.reason === "player-eliminated")
  );
  return resultIsValid && (value.phase === "finished") === (value.result !== null);
}

function isRecoverableActor(value: unknown): value is ActorState {
  if (!isRecord(value) || !isNonEmptyString(value.id)) return false;
  if (value.kind !== "player" && value.kind !== "bot") return false;
  if (!isVector(value.position) || !isVector(value.velocity)) return false;
  if (!isFiniteNumber(value.yaw) || !isFiniteNumber(value.pitch)) return false;
  if (!isPositiveNumber(value.maxHealth) ||
    !isNonNegativeNumber(value.health) ||
    value.health > value.maxHealth ||
    !isNonNegativeNumber(value.maxArmor) ||
    !isNonNegativeNumber(value.armor) ||
    value.armor > value.maxArmor ||
    !isNonNegativeInteger(value.kills) ||
    !isFiniteNumber(value.lastDamageElapsedSeconds)
  ) return false;
  if (typeof value.alive !== "boolean") return false;
  if (!["aircraft", "parachuting", "grounded"].includes(String(value.deployment))) return false;
  if (value.lastDamageDirection !== null && !isVector(value.lastDamageDirection)) return false;
  return isRecoverableInventory(value.inventory);
}

function isRecoverableInventory(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.weaponSlots) || value.weaponSlots.length !== 2) return false;
  if (!value.weaponSlots.every((weapon) => weapon === null || isRecoverableWeapon(weapon))) return false;
  if (value.activeWeaponSlot !== 0 && value.activeWeaponSlot !== 1) return false;
  if (!Array.isArray(value.backpack) || !value.backpack.every(isRecoverableBackpackStack)) return false;
  if (!isNonNegativeInteger(value.maxBackpackStacks) ||
    value.backpack.length > value.maxBackpackStacks
  ) return false;
  if (!isEquipmentLevel(value.armorLevel) || !isEquipmentLevel(value.helmetLevel)) {
    return false;
  }
  return value.usingItem === null || (
    isRecord(value.usingItem) &&
    isNonEmptyString(value.usingItem.itemId) &&
    isNonNegativeNumber(value.usingItem.remainingSeconds)
  );
}

function isRecoverableBackpackStack(value: unknown): boolean {
  if (!isRecord(value) || !isNonEmptyString(value.itemId) || !isPositiveInteger(value.quantity)) {
    return false;
  }
  const item = ITEMS[value.itemId];
  return Boolean(item) && value.quantity <= (item?.maxStack ?? 0);
}

function isRecoverableWeapon(value: unknown): boolean {
  if (!isRecord(value) || !isNonEmptyString(value.weaponId)) return false;
  const config = WEAPONS[value.weaponId];
  return Boolean(config) &&
    isNonNegativeInteger(value.ammoInMagazine) &&
    Number(value.ammoInMagazine) <= (config?.magazineSize ?? -1) &&
    isFiniteNumber(value.cooldownSeconds) &&
    isNonNegativeNumber(value.reloadSeconds);
}

function isRecoverableLoot(lootId: string, value: unknown): boolean {
  return isRecord(value) &&
    value.id === lootId &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.itemId) &&
    (value.generation === undefined || isNonNegativeInteger(value.generation)) &&
    isNonNegativeInteger(value.quantity) &&
    isVector(value.position) &&
    typeof value.available === "boolean" &&
    (value.source === undefined || ["spawn", "drop", "death"].includes(String(value.source))) &&
    (value.weapon === undefined || isRecoverableWeapon(value.weapon));
}

function isRecoverableGrenades(
  activeGrenades: unknown,
  nextGrenadeSequence: unknown,
  actors: Record<string, unknown>,
): boolean {
  if (!isRecord(activeGrenades) ||
    !Number.isSafeInteger(nextGrenadeSequence) ||
    Number(nextGrenadeSequence) < 1
  ) return false;
  let maximumGrenadeSequence = 0;
  for (const [grenadeId, value] of Object.entries(activeGrenades)) {
    const sequence = Number(/^grenade-(\d+)$/.exec(grenadeId)?.[1]);
    if (
      !isRecord(value) ||
      value.id !== grenadeId ||
      typeof value.ownerId !== "string" ||
      !(value.ownerId in actors) ||
      typeof value.aiControlled !== "boolean" ||
      !Number.isSafeInteger(sequence) ||
      sequence < 1 ||
      !isVector(value.position) ||
      !isVector(value.velocity) ||
      !isPositiveNumber(value.fuseSeconds) ||
      value.fuseSeconds > FRAG_GRENADE_CONFIG.fuseSeconds
    ) return false;
    maximumGrenadeSequence = Math.max(maximumGrenadeSequence, sequence);
  }
  return Number(nextGrenadeSequence) > maximumGrenadeSequence;
}

function isRecoverableSafeZone(
  value: unknown,
  phase: unknown,
  elapsedSeconds: number,
  tick: number,
): boolean {
  if (!isRecord(value) ||
    !isVector(value.center) ||
    !isVector(value.startCenter) ||
    !isVector(value.targetCenter) ||
    ![value.radius, value.startRadius, value.targetRadius, value.secondsRemaining,
      value.damagePerSecond].every(isNonNegativeNumber) ||
    !isNonNegativeInteger(value.stageIndex) ||
    value.stageIndex >= BATTLE_ROYALE_CONFIG.safeZoneStages.length ||
    !["waiting", "shrinking", "closed"].includes(String(value.status))
  ) return false;
  if (value.status !== "closed") return true;
  const finalStageIndex = BATTLE_ROYALE_CONFIG.safeZoneStages.length - 1;
  const finalStage = BATTLE_ROYALE_CONFIG.safeZoneStages[finalStageIndex];
  return Boolean(
    finalStage &&
    (phase === "combat" || phase === "finished") &&
    elapsedSeconds >= MINIMUM_CLOSED_SAFE_ZONE_SECONDS &&
    tick >= MINIMUM_CLOSED_SAFE_ZONE_TICKS &&
    value.stageIndex === finalStageIndex &&
    value.secondsRemaining === 0 &&
    value.radius === finalStage.radius &&
    value.targetRadius === finalStage.radius &&
    value.damagePerSecond === finalStage.damagePerSecond &&
    equalVectors(value.center, value.targetCenter)
  );
}

function isRecoverableFlight(value: unknown): boolean {
  return isRecord(value) &&
    isVector(value.start) &&
    isVector(value.end) &&
    isNonNegativeNumber(value.durationSeconds) &&
    isNonNegativeNumber(value.progress) &&
    value.progress <= 1;
}

function isVector(value: unknown): boolean {
  return isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.z);
}

function equalVectors(left: unknown, right: unknown): boolean {
  return isRecord(left) &&
    isRecord(right) &&
    left.x === right.x &&
    left.y === right.y &&
    left.z === right.z;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isUint32(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 0xffff_ffff;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isEquipmentLevel(value: unknown): value is 0 | 1 | 2 {
  return value === 0 || value === 1 || value === 2;
}

function normalizeMatchState(state: MatchState): MatchState {
  state.mapId = normalizeMapId(state.mapId);
  return state;
}

function redactActor(actor: ActorState): ActorState {
  return {
    ...actor,
    position: { x: 0, y: -10_000, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    health: actor.alive ? actor.maxHealth : 0,
    armor: 0,
    inventory: {
      weaponSlots: [null, null],
      activeWeaponSlot: 0,
      backpack: [],
      maxBackpackStacks: actor.inventory.maxBackpackStacks,
      armorLevel: 0,
      helmetLevel: 0,
      usingItem: null,
    },
    lastDamageDirection: null,
    lastDamageElapsedSeconds: -1,
  };
}

function eventVisibleTo(
  event: MultiplayerEvent,
  viewer: ActorState,
  actors: Readonly<Record<EntityId, ActorState>>,
): boolean {
  if (event.type === "human-connection") return true;
  if (event.type === "actor-died" || event.type === "match-finished" || event.type === "phase-changed" || event.type === "safe-zone-changed") {
    return true;
  }
  if (event.type === "match-started") return true;
  if ("actorId" in event && event.actorId === viewer.id) return true;
  if (event.type === "actor-damaged" && event.sourceId === viewer.id) return true;
  if (event.type === "shot-fired" || event.type === "shot-traced") {
    const originVisible = Math.hypot(
      event.origin.x - viewer.position.x,
      event.origin.y - viewer.position.y,
      event.origin.z - viewer.position.z,
    ) <= ACTOR_REPLICATION_RANGE;
    if (!originVisible || event.type === "shot-fired") return originVisible;
    return Math.hypot(
      event.end.x - viewer.position.x,
      event.end.y - viewer.position.y,
      event.end.z - viewer.position.z,
    ) <= ACTOR_REPLICATION_RANGE;
  }
  if (event.type === "grenade-thrown" || event.type === "grenade-exploded") {
    if (!viewer.alive) return true;
    return Math.hypot(
      event.position.x - viewer.position.x,
      event.position.y - viewer.position.y,
      event.position.z - viewer.position.z,
    ) <= ACTOR_REPLICATION_RANGE;
  }
  if ("actorId" in event) {
    const actor = actors[event.actorId];
    return Boolean(actor && Math.hypot(actor.position.x - viewer.position.x, actor.position.z - viewer.position.z) <= 60);
  }
  return false;
}

function continuousCommand(command: ActorCommand): ActorCommand {
  return {
    ...command,
    fire: false,
    reload: false,
    jump: false,
    interact: false,
    interactLootId: null,
    interactLootGeneration: null,
    switchWeapon: null,
    useItem: null,
    dropItem: null,
    throwGrenade: null,
  };
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}
