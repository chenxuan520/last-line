import {
  BATTLE_ROYALE_CONFIG,
  type BattleRoyaleConfig,
  type SafeZoneStageConfig,
} from "../../config/battleRoyale";
import { ITEMS } from "../../config/items";
import { createMapLayout, MAP_HALF_SIZE } from "../../config/map";
import type { GameMode } from "./GameMode";
import { selectSimultaneousSurvivor } from "../rules/resolveSimultaneous";
import {
  createActorState,
  createWeaponState,
  type ActorState,
  type EntityId,
  type FlightState,
  type GameEvent,
  type GroundLootState,
  type MatchResult,
  type MatchState,
  type SafeZoneState,
  type Vector3State,
} from "../state/types";
import { DamageSystem } from "../systems/DamageSystem";

const FLIGHT_ALTITUDE = 180;
const FLIGHT_HALF_LENGTH = MAP_HALF_SIZE * 1.3;
const MAX_FLIGHT_OFFSET = MAP_HALF_SIZE * 0.55;
const AUTO_EJECT_PROGRESS = 0.92;
const FLIGHT_ACTOR_RADIUS = 0.42;
const INDOOR_LOOT_POINTS_PER_ZONE = 1;

type LootCategory = "weapon" | "ammo" | "medical" | "equipment";

const LOOT_CATEGORIES: readonly LootCategory[] = ["weapon", "ammo", "medical", "equipment"];

const LOOT_TABLE: readonly { category: LootCategory; itemId: string; quantity: number }[] = [
  { category: "weapon", itemId: "weapon.rifle", quantity: 1 },
  { category: "weapon", itemId: "weapon.smg", quantity: 1 },
  { category: "weapon", itemId: "weapon.shotgun", quantity: 1 },
  { category: "weapon", itemId: "weapon.sniper", quantity: 1 },
  { category: "ammo", itemId: "ammo.rifle", quantity: 60 },
  { category: "ammo", itemId: "ammo.light", quantity: 80 },
  { category: "ammo", itemId: "ammo.shell", quantity: 12 },
  { category: "ammo", itemId: "ammo.sniper", quantity: 10 },
  { category: "equipment", itemId: "armor.1", quantity: 1 },
  { category: "equipment", itemId: "armor.2", quantity: 1 },
  { category: "equipment", itemId: "helmet.1", quantity: 1 },
  { category: "equipment", itemId: "helmet.2", quantity: 1 },
  { category: "medical", itemId: "bandage", quantity: 2 },
  { category: "medical", itemId: "medkit", quantity: 1 },
];

export class BattleRoyaleMode implements GameMode {
  private readonly damage = new DamageSystem();

  public constructor(
    private readonly config: BattleRoyaleConfig = BATTLE_ROYALE_CONFIG,
    private readonly random: () => number = Math.random,
  ) {
    getFirstStage(config);
  }

  public start(state: MatchState, events: GameEvent[]): void {
    state.phase = "flight";
    state.result = null;
    state.flight = createFlight(this.config.flightSeconds, this.random);
    state.safeZone = createInitialSafeZone(this.config, this.random);
    const flightYaw = Math.atan2(
      state.flight.end.x - state.flight.start.x,
      state.flight.end.z - state.flight.start.z,
    );

    for (const actor of Object.values(state.actors)) {
      actor.deployment = "aircraft";
      actor.position = { ...state.flight.start };
      actor.velocity = { x: 0, y: 0, z: 0 };
      actor.yaw = flightYaw;
      actor.pitch = 0.28;
    }

    events.push({ type: "match-started" });
    events.push({ type: "phase-changed", phase: "flight" });
  }

  public update(state: MatchState, deltaSeconds: number, events: GameEvent[]): void {
    if (state.phase === "ready" || state.phase === "finished") {
      return;
    }

    const delta = Math.max(0, deltaSeconds);
    if (state.phase === "flight") {
      this.updateFlight(state, delta, events);
      return;
    }

    if (this.finishIfOnlyOneRemains(state, events)) {
      return;
    }

    this.updateSafeZone(state, delta, events);
    this.applySafeZoneDamage(state, delta, events);
    this.finishIfOnlyOneRemains(state, events);
  }

  private updateFlight(state: MatchState, deltaSeconds: number, events: GameEvent[]): void {
    const progressDelta = state.flight.durationSeconds <= 0 ? 1 : deltaSeconds / state.flight.durationSeconds;
    state.flight.progress = Math.min(1, state.flight.progress + progressDelta);
    const aircraftPosition = interpolateVector(state.flight.start, state.flight.end, state.flight.progress);
    const autoEjectProgress = Math.min(AUTO_EJECT_PROGRESS, getLastIslandFlightProgress(state.flight));
    const autoEjectPosition = interpolateVector(state.flight.start, state.flight.end, autoEjectProgress);

    for (const actor of Object.values(state.actors)) {
      if (actor.deployment === "aircraft") {
        actor.position = state.flight.progress >= autoEjectProgress
          ? { ...autoEjectPosition }
          : { ...aircraftPosition };
      }
    }

    if (state.flight.progress >= autoEjectProgress) {
      for (const actor of Object.values(state.actors)) {
        if (actor.deployment === "aircraft") {
          actor.deployment = "parachuting";
          actor.velocity = { x: 0, y: -5, z: 0 };
        }
      }
    }

    if (Object.values(state.actors).every((actor) => !actor.alive || actor.deployment === "grounded")) {
      state.phase = "combat";
      events.push({ type: "phase-changed", phase: "combat" });
      events.push({ type: "safe-zone-changed", stageIndex: state.safeZone.stageIndex, status: "waiting" });
    }
  }

  private updateSafeZone(state: MatchState, deltaSeconds: number, events: GameEvent[]): void {
    let remaining = deltaSeconds;
    let transitions = 0;
    const transitionLimit = this.config.safeZoneStages.length * 2 + 1;

    while (state.safeZone.status !== "closed" && transitions < transitionLimit) {
      if (state.safeZone.status === "waiting") {
        const consumed = Math.min(remaining, state.safeZone.secondsRemaining);
        state.safeZone.secondsRemaining = Math.max(0, state.safeZone.secondsRemaining - consumed);
        remaining -= consumed;
        if (state.safeZone.secondsRemaining > 0) {
          return;
        }

        const stage = this.getStage(state.safeZone.stageIndex);
        state.safeZone.status = "shrinking";
        state.safeZone.secondsRemaining = stage.shrinkSeconds;
        state.safeZone.startCenter = { ...state.safeZone.center };
        state.safeZone.startRadius = state.safeZone.radius;
        events.push({
          type: "safe-zone-changed",
          stageIndex: state.safeZone.stageIndex,
          status: "shrinking",
        });
        transitions += 1;
        continue;
      }

      const stage = this.getStage(state.safeZone.stageIndex);
      if (stage.shrinkSeconds > 0 && remaining === 0) {
        return;
      }
      const consumed = Math.min(remaining, state.safeZone.secondsRemaining);
      state.safeZone.secondsRemaining = Math.max(0, state.safeZone.secondsRemaining - consumed);
      remaining -= consumed;
      const progress = stage.shrinkSeconds === 0 ? 1 : 1 - state.safeZone.secondsRemaining / stage.shrinkSeconds;
      state.safeZone.center = interpolateVector(state.safeZone.startCenter, state.safeZone.targetCenter, progress);
      state.safeZone.radius = interpolate(state.safeZone.startRadius, state.safeZone.targetRadius, progress);
      if (state.safeZone.secondsRemaining > 0) {
        return;
      }

      state.safeZone.center = { ...state.safeZone.targetCenter };
      state.safeZone.radius = state.safeZone.targetRadius;
      const nextStageIndex = state.safeZone.stageIndex + 1;
      if (nextStageIndex >= this.config.safeZoneStages.length) {
        state.safeZone.status = "closed";
        events.push({
          type: "safe-zone-changed",
          stageIndex: state.safeZone.stageIndex,
          status: "closed",
        });
        return;
      }

      const nextStage = this.getStage(nextStageIndex);
      state.safeZone.stageIndex = nextStageIndex;
      state.safeZone.status = "waiting";
      state.safeZone.secondsRemaining = nextStage.waitSeconds;
      state.safeZone.damagePerSecond = nextStage.damagePerSecond;
      state.safeZone.startCenter = { ...state.safeZone.center };
      state.safeZone.startRadius = state.safeZone.radius;
      state.safeZone.targetCenter = createTargetCenter(
        state.safeZone.center,
        state.safeZone.radius,
        nextStage.radius,
        this.random,
      );
      state.safeZone.targetRadius = nextStage.radius;
      events.push({ type: "safe-zone-changed", stageIndex: nextStageIndex, status: "waiting" });
      transitions += 1;
    }
  }

  private applySafeZoneDamage(state: MatchState, deltaSeconds: number, events: GameEvent[]): void {
    const damage = state.safeZone.damagePerSecond * deltaSeconds;
    if (damage <= 0) {
      return;
    }

    const living = Object.values(state.actors)
      .filter((actor) => actor.alive && actor.deployment === "grounded")
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    const outside = living.filter((actor) =>
      state.safeZone.radius <= 0 ||
      horizontalDistance(actor.position, state.safeZone.center) > state.safeZone.radius
    );
    const allWouldDie =
      outside.length === living.length && outside.every((actor) => actor.health <= damage);
    const survivorId = allWouldDie
      ? selectSimultaneousSurvivor(living.map((actor) => actor.id), state.elapsedSeconds)
      : undefined;

    for (const actor of outside) {
      // A rotating deterministic tie-break leaves one actor at 1 HP instead of producing no winner.
      this.damage.applyDamage(state, actor.id, damage, null, events, true, actor.id === survivorId ? 1 : 0);
    }
  }

  private finishIfOnlyOneRemains(state: MatchState, events: GameEvent[]): boolean {
    const living = Object.values(state.actors).filter((actor) => actor.alive);
    if (living.length !== 1) {
      return false;
    }

    const result: MatchResult = { winnerId: living[0]?.id ?? null, reason: "last-alive" };
    state.phase = "finished";
    state.result = result;
    events.push({ type: "phase-changed", phase: "finished" });
    events.push({ type: "match-finished", result });
    return true;
  }

  private getStage(stageIndex: number): SafeZoneStageConfig {
    const stage = this.config.safeZoneStages[stageIndex];
    if (!stage) {
      throw new Error(`安全区阶段不存在: ${stageIndex}`);
    }
    return stage;
  }
}

function getLastIslandFlightProgress(flight: FlightState): number {
  const limit = MAP_HALF_SIZE - FLIGHT_ACTOR_RADIUS;
  let entry = 0;
  let exit = 1;
  for (const [start, end] of [
    [flight.start.x, flight.end.x],
    [flight.start.z, flight.end.z],
  ] as const) {
    const delta = end - start;
    if (Math.abs(delta) < 1e-9) {
      if (start < -limit || start > limit) return 0;
      continue;
    }
    const first = (-limit - start) / delta;
    const second = (limit - start) / delta;
    entry = Math.max(entry, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
  }
  return Math.max(entry, Math.min(1, exit));
}

export function createBattleRoyaleState(
  playerId: EntityId,
  config: BattleRoyaleConfig = BATTLE_ROYALE_CONFIG,
  random: () => number = Math.random,
): MatchState {
  if (config.participantCount < 1) {
    throw new Error("大逃杀至少需要一名参与者");
  }

  const mapSeed = Math.floor(random() * 4_294_967_296) >>> 0;
  const layout = createMapLayout(mapSeed);
  const flight = createFlight(config.flightSeconds, random);
  const actors: Record<EntityId, ActorState> = {};
  actors[playerId] = createBattleRoyaleActor(playerId, "player", flight.start);
  let botNumber = 1;
  while (Object.keys(actors).length < config.participantCount) {
    const botId = `bot-${botNumber}`;
    botNumber += 1;
    if (botId !== playerId) {
      actors[botId] = createBattleRoyaleActor(botId, "bot", flight.start);
    }
  }

  return {
    phase: "ready",
    elapsedSeconds: 0,
    mapSeed,
    actors,
    groundLoot: createGroundLoot(layout.lootSpawnPoints, layout.lootZoneCounts, createLootRandom(mapSeed)),
    safeZone: createInitialSafeZone(config, random),
    flight,
    result: null,
  };
}

function createBattleRoyaleActor(
  id: EntityId,
  kind: ActorState["kind"],
  position: Vector3State,
): ActorState {
  const actor = createActorState(id, kind, position);
  actor.armor = 0;
  actor.deployment = "aircraft";
  actor.inventory.weaponSlots = [null, null];
  actor.inventory.backpack = [];
  actor.inventory.armorLevel = 0;
  actor.inventory.helmetLevel = 0;
  return actor;
}

function createGroundLoot(
  lootSpawnPoints: readonly Vector3State[],
  lootZoneCounts: readonly number[],
  random: () => number,
): Record<EntityId, GroundLootState> {
  const groundLoot: Record<EntityId, GroundLootState> = {};
  let zoneStart = 0;
  for (const zoneCount of lootZoneCounts) {
    const weaponCount = Math.max(4, Math.round(zoneCount * 0.4));
    const ammoCount = Math.max(4, Math.round(zoneCount * 0.2));
    const medicalCount = Math.max(1, Math.floor(zoneCount * 0.15));
    const categoryCounts: Record<LootCategory, number> = {
      weapon: weaponCount,
      ammo: ammoCount,
      medical: medicalCount,
      equipment: zoneCount - weaponCount - ammoCount - medicalCount,
    };
    const entriesByCategory = Object.fromEntries(
      LOOT_CATEGORIES.map((category) => [
        category,
        createLootEntries(category, categoryCounts[category], random),
      ]),
    ) as Record<LootCategory, (typeof LOOT_TABLE)[number][]>;
    const categoryOrder = reserveIndoorLootForSupplies(createLootCategoryOrder(categoryCounts, random));

    for (let zoneOffset = 0; zoneOffset < zoneCount; zoneOffset += 1) {
      const index = zoneStart + zoneOffset;
      const position = lootSpawnPoints[index];
      const category = categoryOrder[zoneOffset];
      const entry = category ? entriesByCategory[category].pop() : undefined;
      if (!position || !entry) {
        continue;
      }
      const id = `loot-${index}`;
      const item = ITEMS[entry.itemId];
      const weapon = item?.kind === "weapon" && item.weaponId ? createWeaponState(item.weaponId) : undefined;
      groundLoot[id] = {
        id,
        itemId: entry.itemId,
        quantity: entry.quantity,
        ...(weapon ? { weapon } : {}),
        position: { ...position },
        available: true,
        source: "spawn",
      };
    }
    zoneStart += zoneCount;
  }
  return groundLoot;
}

function reserveIndoorLootForSupplies(categories: LootCategory[]): LootCategory[] {
  const result = [...categories];
  const indoorStart = Math.max(0, result.length - INDOOR_LOOT_POINTS_PER_ZONE);
  for (let index = indoorStart; index < result.length; index += 1) {
    if (result[index] !== "weapon") continue;
    const swapIndex = result.findIndex((category, candidateIndex) => candidateIndex < indoorStart && category !== "weapon");
    if (swapIndex !== -1) {
      [result[index], result[swapIndex]] = [result[swapIndex] as LootCategory, result[index] as LootCategory];
    }
  }
  return result;
}

function createLootRandom(seed: number): () => number {
  // Keep loot randomization from perturbing the shared stream used by later simulation systems.
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function createLootEntries(
  category: LootCategory,
  count: number,
  random: () => number,
): (typeof LOOT_TABLE)[number][] {
  const available = LOOT_TABLE.filter((entry) => entry.category === category);
  const entries = [...available];
  while (entries.length < count) {
    const entry = available[Math.floor(random() * available.length)];
    if (entry) {
      entries.push(entry);
    }
  }
  return shuffle(entries, random);
}

function createLootCategoryOrder(
  categoryCounts: Readonly<Record<LootCategory, number>>,
  random: () => number,
): LootCategory[] {
  const remaining = { ...categoryCounts };
  const order: LootCategory[] = [];
  const deadEnds = new Set<string>();

  const appendCategory = (previous?: LootCategory, first?: LootCategory): boolean => {
    const remainingCount = LOOT_CATEGORIES.reduce((total, category) => total + remaining[category], 0);
    if (remainingCount === 0) {
      return previous !== first;
    }

    const stateKey = `${LOOT_CATEGORIES.map((category) => remaining[category]).join(",")}:${previous ?? ""}:${first ?? ""}`;
    if (deadEnds.has(stateKey)) {
      return false;
    }

    const candidates = shuffle(
      LOOT_CATEGORIES.filter(
        (category) =>
          remaining[category] > 0 && category !== previous && (remainingCount > 1 || category !== first),
      ),
      random,
    ).sort((left, right) => remaining[right] - remaining[left]);

    for (const category of candidates) {
      remaining[category] -= 1;
      order.push(category);
      if (appendCategory(category, first ?? category)) {
        return true;
      }
      order.pop();
      remaining[category] += 1;
    }

    deadEnds.add(stateKey);
    return false;
  };

  if (!appendCategory()) {
    throw new Error("无法生成分散的物资类别序列");
  }
  return order;
}

function shuffle<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex] as T, result[index] as T];
  }
  return result;
}

function createFlight(durationSeconds: number, random: () => number): FlightState {
  const angle = random() * Math.PI * 2;
  const offset = (random() * 2 - 1) * MAX_FLIGHT_OFFSET;
  const directionX = Math.cos(angle);
  const directionZ = Math.sin(angle);
  const normalX = -directionZ;
  const normalZ = directionX;
  return {
    start: {
      x: normalX * offset - directionX * FLIGHT_HALF_LENGTH,
      y: FLIGHT_ALTITUDE,
      z: normalZ * offset - directionZ * FLIGHT_HALF_LENGTH,
    },
    end: {
      x: normalX * offset + directionX * FLIGHT_HALF_LENGTH,
      y: FLIGHT_ALTITUDE,
      z: normalZ * offset + directionZ * FLIGHT_HALF_LENGTH,
    },
    durationSeconds,
    progress: 0,
  };
}

function createInitialSafeZone(config: BattleRoyaleConfig, random: () => number): SafeZoneState {
  const firstStage = getFirstStage(config);
  const center = { x: 0, y: 0, z: 0 };
  return {
    center: { ...center },
    radius: MAP_HALF_SIZE,
    startCenter: { ...center },
    startRadius: MAP_HALF_SIZE,
    targetCenter: createTargetCenter(center, MAP_HALF_SIZE, firstStage.radius, random),
    targetRadius: firstStage.radius,
    stageIndex: 0,
    status: "waiting",
    secondsRemaining: firstStage.waitSeconds,
    damagePerSecond: firstStage.damagePerSecond,
  };
}

function createTargetCenter(
  center: Vector3State,
  currentRadius: number,
  targetRadius: number,
  random: () => number,
): Vector3State {
  const maxOffset = Math.max(0, currentRadius - targetRadius);
  const angle = random() * Math.PI * 2;
  const distance = Math.sqrt(random()) * maxOffset;
  return {
    x: center.x + Math.cos(angle) * distance,
    y: 0,
    z: center.z + Math.sin(angle) * distance,
  };
}

function getFirstStage(config: BattleRoyaleConfig): SafeZoneStageConfig {
  const stage = config.safeZoneStages[0];
  if (!stage) {
    throw new Error("大逃杀至少需要一个安全区阶段");
  }
  return stage;
}

function interpolate(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function interpolateVector(start: Vector3State, end: Vector3State, progress: number): Vector3State {
  return {
    x: interpolate(start.x, end.x, progress),
    y: interpolate(start.y, end.y, progress),
    z: interpolate(start.z, end.z, progress),
  };
}

function horizontalDistance(left: Vector3State, right: Vector3State): number {
  return Math.hypot(left.x - right.x, left.z - right.z);
}
