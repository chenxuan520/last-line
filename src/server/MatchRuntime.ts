import { BATTLE_ROYALE_CONFIG } from "../config/battleRoyale";
import { WEAPONS } from "../config/weapons";
import { createMapLayout, type MapLayout } from "../config/map";
import { DEFAULT_MAP_ID, normalizeMapId, type MapId } from "../config/maps";
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
import {
  MAX_HUMAN_PLAYERS,
  MIN_HUMAN_PLAYERS,
  type MatchFrame,
  type MultiplayerEvent,
  type SequencedGameEvent,
} from "../network/protocol";
import { CommandInbox } from "./CommandInbox";
import { LagCompensatedCombatWorld } from "./LagCompensatedCombatWorld";

const BOT_COHORTS = 3;
const TAKEOVER_TICKS = SIMULATION_TICK_RATE * 5;
const ACTOR_REPLICATION_RANGE = 400;
const LOOT_REPLICATION_RANGE = 60;
const AIRBORNE_LOOT_REPLICATION_RANGE = ACTOR_REPLICATION_RANGE;
export const MATCH_CHECKPOINT_VERSION = 6;

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
  humanActorIds?: readonly EntityId[],
): checkpoint is MatchCheckpoint {
  if (
    !isRecord(checkpoint) ||
    checkpoint.version !== MATCH_CHECKPOINT_VERSION ||
    !isNonNegativeSafeInteger(checkpoint.tick) ||
    !isNonNegativeSafeInteger(checkpoint.snapshotSequence) ||
    !isNonNegativeSafeInteger(checkpoint.eventSequence) ||
    !isRecord(checkpoint.state) ||
    !isCompleteMatchState(checkpoint.state, humanActorIds)
  ) return false;
  return true;
}

function isCompleteMatchState(
  state: Record<string, unknown>,
  humanActorIds?: readonly EntityId[],
): boolean {
  if (
    !["flight", "combat", "finished"].includes(String(state.phase)) ||
    !isNonNegativeFiniteNumber(state.elapsedSeconds) ||
    (state.mapId !== "island" && state.mapId !== "town") ||
    !isUint32(state.mapSeed) ||
    !isRecord(state.actors) ||
    Object.keys(state.actors).length !== BATTLE_ROYALE_CONFIG.participantCount ||
    !isRecord(state.groundLoot) ||
    !isRecord(state.activeGrenades) ||
    !isPositiveSafeInteger(state.nextGrenadeSequence) ||
    !isSafeZoneState(state.safeZone) ||
    !isFlightState(state.flight) ||
    !isMatchResult(state.result) ||
    (state.phase === "finished") !== (state.result !== null)
  ) return false;

  const playerActorIds: EntityId[] = [];
  for (const [actorId, actor] of Object.entries(state.actors)) {
    if (!isActorState(actor, actorId)) return false;
    if (actor.kind === "player") playerActorIds.push(actorId);
  }
  if (humanActorIds !== undefined) {
    const uniqueHumanActorIds = new Set(humanActorIds);
    if (
      humanActorIds.length < MIN_HUMAN_PLAYERS ||
      humanActorIds.length > MAX_HUMAN_PLAYERS ||
      uniqueHumanActorIds.size !== humanActorIds.length ||
      playerActorIds.length !== humanActorIds.length ||
      playerActorIds.some((actorId) => !uniqueHumanActorIds.has(actorId))
    ) return false;
  }

  for (const [lootId, loot] of Object.entries(state.groundLoot)) {
    if (!isGroundLootState(loot, lootId)) return false;
  }

  let maximumGrenadeSequence = 0;
  for (const [grenadeId, value] of Object.entries(state.activeGrenades)) {
    const sequenceMatch = /^grenade-(\d+)$/.exec(grenadeId);
    const sequence = Number(sequenceMatch?.[1]);
    if (
      !isRecord(value) ||
      value.id !== grenadeId ||
      typeof value.ownerId !== "string" ||
      value.ownerId.length === 0 ||
      !(value.ownerId in state.actors) ||
      typeof value.aiControlled !== "boolean" ||
      !Number.isSafeInteger(sequence) ||
      sequence < 1 ||
      !isFiniteVector(value.position) ||
      !isFiniteVector(value.velocity) ||
      typeof value.fuseSeconds !== "number" ||
      !Number.isFinite(value.fuseSeconds) ||
      value.fuseSeconds <= 0
    ) return false;
    maximumGrenadeSequence = Math.max(maximumGrenadeSequence, sequence);
  }
  return (state.nextGrenadeSequence as number) > maximumGrenadeSequence;
}

function normalizeMatchState(state: MatchState): MatchState {
  state.mapId = normalizeMapId(state.mapId);
  return state;
}

function isFiniteVector(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.x === "number" && Number.isFinite(value.x) &&
    typeof value.y === "number" && Number.isFinite(value.y) &&
    typeof value.z === "number" && Number.isFinite(value.z);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isActorState(value: unknown, actorId: EntityId): value is ActorState {
  if (
    !isRecord(value) ||
    value.id !== actorId ||
    (value.kind !== "player" && value.kind !== "bot") ||
    !isFiniteVector(value.position) ||
    !isFiniteVector(value.velocity) ||
    !isFiniteNumber(value.yaw) ||
    !isFiniteNumber(value.pitch) ||
    !isNonNegativeFiniteNumber(value.health) ||
    !isPositiveFiniteNumber(value.maxHealth) ||
    value.health > value.maxHealth ||
    !isNonNegativeFiniteNumber(value.armor) ||
    !isNonNegativeFiniteNumber(value.maxArmor) ||
    value.armor > value.maxArmor ||
    typeof value.alive !== "boolean" ||
    !["aircraft", "parachuting", "grounded"].includes(String(value.deployment)) ||
    !isInventoryState(value.inventory) ||
    !isNonNegativeSafeInteger(value.kills) ||
    !(value.lastDamageDirection === null || isFiniteVector(value.lastDamageDirection)) ||
    !isFiniteNumber(value.lastDamageElapsedSeconds)
  ) return false;
  return true;
}

function isInventoryState(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !Array.isArray(value.weaponSlots) ||
    value.weaponSlots.length !== 2 ||
    (value.activeWeaponSlot !== 0 && value.activeWeaponSlot !== 1) ||
    !Array.isArray(value.backpack) ||
    !isNonNegativeSafeInteger(value.maxBackpackStacks) ||
    value.backpack.length > value.maxBackpackStacks ||
    ![0, 1, 2].includes(Number(value.armorLevel)) ||
    ![0, 1, 2].includes(Number(value.helmetLevel)) ||
    !(value.usingItem === null || isItemUseState(value.usingItem))
  ) return false;
  return value.weaponSlots.every((weapon) => weapon === null || isWeaponState(weapon)) &&
    value.backpack.every(isItemStackState);
}

function isWeaponState(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.weaponId === "string" &&
    WEAPONS[value.weaponId] !== undefined &&
    isNonNegativeSafeInteger(value.ammoInMagazine) &&
    isFiniteNumber(value.cooldownSeconds) &&
    isNonNegativeFiniteNumber(value.reloadSeconds);
}

function isItemStackState(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.itemId === "string" &&
    value.itemId.length > 0 &&
    isPositiveSafeInteger(value.quantity);
}

function isItemUseState(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.itemId === "string" &&
    value.itemId.length > 0 &&
    isNonNegativeFiniteNumber(value.remainingSeconds);
}

function isGroundLootState(value: unknown, lootId: EntityId): boolean {
  return isRecord(value) &&
    value.id === lootId &&
    (value.generation === undefined || isNonNegativeSafeInteger(value.generation)) &&
    typeof value.itemId === "string" &&
    value.itemId.length > 0 &&
    isNonNegativeSafeInteger(value.quantity) &&
    (value.weapon === undefined || isWeaponState(value.weapon)) &&
    isFiniteVector(value.position) &&
    typeof value.available === "boolean" &&
    (value.source === undefined || ["spawn", "drop", "death"].includes(String(value.source)));
}

function isSafeZoneState(value: unknown): boolean {
  return isRecord(value) &&
    isFiniteVector(value.center) &&
    isNonNegativeFiniteNumber(value.radius) &&
    isFiniteVector(value.startCenter) &&
    isNonNegativeFiniteNumber(value.startRadius) &&
    isFiniteVector(value.targetCenter) &&
    isNonNegativeFiniteNumber(value.targetRadius) &&
    isNonNegativeSafeInteger(value.stageIndex) &&
    value.stageIndex < BATTLE_ROYALE_CONFIG.safeZoneStages.length &&
    ["waiting", "shrinking", "closed"].includes(String(value.status)) &&
    isNonNegativeFiniteNumber(value.secondsRemaining) &&
    isNonNegativeFiniteNumber(value.damagePerSecond);
}

function isFlightState(value: unknown): boolean {
  return isRecord(value) &&
    isFiniteVector(value.start) &&
    isFiniteVector(value.end) &&
    isNonNegativeFiniteNumber(value.durationSeconds) &&
    isNonNegativeFiniteNumber(value.progress) &&
    value.progress <= 1;
}

function isMatchResult(value: unknown): boolean {
  return value === null || (
    isRecord(value) &&
    (value.winnerId === null || typeof value.winnerId === "string") &&
    (value.reason === "last-alive" || value.reason === "player-eliminated")
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isUint32(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 0xffff_ffff;
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
