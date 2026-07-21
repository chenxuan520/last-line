import { BATTLE_ROYALE_CONFIG } from "../config/battleRoyale";
import { WEAPONS } from "../config/weapons";
import { createMapLayout, type MapLayout } from "../config/map";
import { BotController } from "../controllers/BotController";
import { createIdleCommand, type ActorCommand } from "../game/commands/ActorCommand";
import { GameSimulation } from "../game/GameSimulation";
import { BattleRoyaleMode, createBattleRoyaleStateForHumans } from "../game/modes/BattleRoyaleMode";
import type { ActorState, EntityId, GameEvent, GroundLootState, MatchState } from "../game/state/types";
import { SimulationCombatWorld } from "../game/systems/SimulationCombatWorld";
import type { MatchFrame, SequencedGameEvent } from "../network/protocol";
import { CommandInbox } from "./CommandInbox";

const TICK_RATE = 30;
const BOT_COHORTS = 3;
const TAKEOVER_TICKS = 150;
const ACTOR_REPLICATION_RANGE = 400;
const LOOT_REPLICATION_RANGE = 60;

export interface MatchRuntimeOptions {
  humanActorIds: readonly EntityId[];
  seed: number;
  startWithBandage: boolean;
  disableAiSnipers: boolean;
  state?: MatchState;
  tick?: number;
  snapshotSequence?: number;
  eventSequence?: number;
}

export interface MatchCheckpoint {
  state: MatchState;
  tick: number;
  snapshotSequence: number;
  eventSequence: number;
}

export class MatchRuntime {
  public readonly state: MatchState;
  private readonly simulation: GameSimulation;
  private readonly world: SimulationCombatWorld;
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
      ? JSON.parse(JSON.stringify(options.state)) as MatchState
      : createBattleRoyaleStateForHumans(
        options.humanActorIds,
        BATTLE_ROYALE_CONFIG,
        random,
        { startWithBandage: options.startWithBandage },
      );
    this.layout = createMapLayout(this.state.mapSeed);
    this.simulation = new GameSimulation(this.state, new BattleRoyaleMode(BATTLE_ROYALE_CONFIG, random), WEAPONS, this.layout);
    this.world = new SimulationCombatWorld(this.state, true, this.layout);
    this.tickValue = options.tick ?? 0;
    this.snapshotSequenceValue = options.snapshotSequence ?? 0;
    this.eventSequenceValue = options.eventSequence ?? 0;
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
  }

  public get tick(): number {
    return this.tickValue;
  }

  public submitInput(actorId: EntityId, sequence: number, command: ActorCommand): boolean {
    return this.options.humanActorIds.includes(actorId) && this.inbox.accept(actorId, sequence, command, this.tickValue);
  }

  public acknowledge(actorId: EntityId): number {
    return this.inbox.acknowledge(actorId);
  }

  public setConnected(actorId: EntityId, connected: boolean): void {
    if (!this.options.humanActorIds.includes(actorId)) return;
    if (connected) {
      this.disconnectedAtTick.delete(actorId);
      this.takeoverBots.delete(actorId);
      return;
    }
    this.disconnectedAtTick.set(actorId, this.tickValue);
    this.inbox.reset(actorId);
  }

  public step(): void {
    if (this.state.phase === "finished") return;
    const commands = new Map<EntityId, ActorCommand>();
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
        commands.set(actorId, controller.update(
          actor,
          this.state,
          this.world,
          1 / TICK_RATE,
          actorId,
          actor.deployment === "grounded" ? getLivingActorCount() : undefined,
        ));
      } else {
        commands.set(actorId, this.inbox.consume(actorId, this.tickValue));
      }
    }
    let botIndex = 0;
    for (const [actorId, controller] of this.bots) {
      const actor = this.state.actors[actorId];
      if (actor?.alive) {
        if (botIndex % BOT_COHORTS === this.tickValue % BOT_COHORTS) {
          const command = controller.update(
            actor,
            this.state,
            this.world,
            BOT_COHORTS / TICK_RATE,
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
    this.simulation.step(1 / TICK_RATE, commands, this.world);
    this.tickValue += 1;
    this.recordEvents(this.simulation.drainEvents());
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
        lootChanges: [...visibleLoot, ...hiddenLoot],
        events: frame.events.filter((entry) => eventVisibleTo(entry.event, viewer, this.state.actors)),
      },
      visibleLootIds,
    };
  }

  private recordEvents(events: readonly GameEvent[]): void {
    for (const event of events) {
      this.eventSequenceValue += 1;
      this.pendingEvents.push({ sequence: this.eventSequenceValue, event });
      if (event.type === "item-picked" || event.type === "item-dropped") this.dirtyLootIds.add(event.lootId);
    }
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
    return Object.values(this.state.groundLoot).filter((loot) =>
      loot.available && Math.hypot(
        loot.position.x - viewer.position.x,
        loot.position.y - viewer.position.y,
        loot.position.z - viewer.position.z,
      ) <= LOOT_REPLICATION_RANGE
    );
  }
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
  event: GameEvent,
  viewer: ActorState,
  actors: Readonly<Record<EntityId, ActorState>>,
): boolean {
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
