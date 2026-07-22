import type { ActorCommand } from "../game/commands/ActorCommand";
import { createIdleCommand } from "../game/commands/ActorCommand";
import type {
  ActorState,
  EntityId,
  FlightState,
  GameEvent,
  GroundLootState,
  MatchResult,
  MatchState,
  SafeZoneState,
  Vector3State,
  WeaponSlot,
} from "../game/state/types";

export const MULTIPLAYER_PROTOCOL_VERSION = 2;
export const MIN_HUMAN_PLAYERS = 2;
export const MAX_HUMAN_PLAYERS = 10;

export type RoomVisibility = "public" | "private";
export type RoomStatus = "waiting" | "countdown" | "running" | "finished";

export interface GuestSession {
  playerId: string;
  sessionToken: string;
  displayName: string;
}

export interface LobbyMemberView {
  playerId: string;
  displayName: string;
  ready: boolean;
  connected: boolean;
  host: boolean;
}

export interface LobbyView {
  roomId: string;
  code: string;
  visibility: RoomVisibility;
  status: RoomStatus;
  revision: number;
  countdownEndsAt: number | null;
  members: LobbyMemberView[];
  minimumPlayers: number;
  maximumPlayers: number;
}

export interface PublicRoomSummary {
  roomId: string;
  code: string;
  visibility: RoomVisibility;
  hostName: string;
  playerCount: number;
  capacity: number;
  status: RoomStatus;
  updatedAt: number;
}

export interface RoomAdmission {
  roomId: string;
  code: string;
  playerId: string;
  admissionToken: string;
  socketPath: string;
}

export interface SequencedGameEvent {
  sequence: number;
  event: GameEvent;
}

export interface MatchFrame {
  snapshotSequence: number;
  tick: number;
  serverTimeMs: number;
  phase: MatchState["phase"];
  elapsedSeconds: number;
  flight: FlightState;
  safeZone: SafeZoneState;
  result: MatchResult | null;
  actors: Record<EntityId, ActorState>;
  visibleActorIds: EntityId[];
  lootChanges: GroundLootState[];
  events: SequencedGameEvent[];
}

export type ClientMessage =
  | { type: "connection.ack" }
  | { type: "lobby.ready"; ready: boolean }
  | { type: "lobby.start" }
  | { type: "lobby.leave" }
  | { type: "match.input"; sequence: number; command: ActorCommand }
  | { type: "match.resync" }
  | { type: "ping"; clientTimeMs: number };

export type ServerMessage =
  | {
      type: "welcome";
      protocolVersion: number;
      roomId: string;
      playerId: string;
      actorId: EntityId | null;
      reconnectToken: string;
      serverTimeMs: number;
    }
  | { type: "lobby.state"; lobby: LobbyView }
  | {
      type: "match.full";
      snapshotSequence: number;
      tick: number;
      localActorId: EntityId;
      state: MatchState;
      displayNames: Record<EntityId, string>;
      events: SequencedGameEvent[];
    }
  | { type: "match.snapshot"; ackSequence: number; frame: MatchFrame }
  | { type: "pong"; clientTimeMs: number; serverTimeMs: number }
  | { type: "error"; code: string; message: string };

export function parseClientMessage(value: unknown): ClientMessage | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (value.type === "lobby.ready" && typeof value.ready === "boolean") {
    return { type: "lobby.ready", ready: value.ready };
  }
  if (
    value.type === "connection.ack" ||
    value.type === "lobby.start" ||
    value.type === "lobby.leave" ||
    value.type === "match.resync"
  ) {
    return { type: value.type };
  }
  if (value.type === "ping" && isFiniteNumber(value.clientTimeMs)) {
    return { type: "ping", clientTimeMs: value.clientTimeMs };
  }
  const sequence = value.sequence;
  if (value.type === "match.input" && typeof sequence === "number" && Number.isSafeInteger(sequence) && sequence >= 0) {
    const command = sanitizeActorCommand(value.command);
    return command ? { type: "match.input", sequence, command } : null;
  }
  return null;
}

export function sanitizeActorCommand(value: unknown): ActorCommand | null {
  if (!isRecord(value)) return null;
  const move = finiteVector(value.move);
  const aimDirection = finiteVector(value.aimDirection);
  if (!move || !aimDirection) return null;
  const { fire, reload, sprint, jump, interact } = value;
  if (
    typeof fire !== "boolean" ||
    typeof reload !== "boolean" ||
    typeof sprint !== "boolean" ||
    typeof jump !== "boolean" ||
    typeof interact !== "boolean"
  ) return null;
  const interactLootId = nullableShortString(value.interactLootId);
  const generation = value.interactLootGeneration;
  const interactLootGeneration = generation === null
    ? null
    : typeof generation === "number" && Number.isSafeInteger(generation) && generation >= 0
      ? generation
      : undefined;
  const switchWeapon = value.switchWeapon === null || value.switchWeapon === 0 || value.switchWeapon === 1
    ? value.switchWeapon as WeaponSlot | null
    : undefined;
  const useItem = nullableShortString(value.useItem);
  const dropItem = nullableShortString(value.dropItem);
  if (
    interactLootId === undefined ||
    interactLootGeneration === undefined ||
    switchWeapon === undefined ||
    useItem === undefined ||
    dropItem === undefined
  ) return null;
  const moveLength = Math.hypot(move.x, move.z);
  const moveScale = moveLength > 1 ? 1 / moveLength : 1;
  const aimLength = Math.hypot(aimDirection.x, aimDirection.y, aimDirection.z);
  const normalizedAim = aimLength > 0.0001
    ? { x: aimDirection.x / aimLength, y: aimDirection.y / aimLength, z: aimDirection.z / aimLength }
    : createIdleCommand().aimDirection;
  return {
    move: { x: move.x * moveScale, y: 0, z: move.z * moveScale },
    aimDirection: normalizedAim,
    fire,
    reload,
    sprint,
    jump,
    interact,
    interactLootId,
    interactLootGeneration,
    switchWeapon,
    useItem,
    dropItem,
  };
}

export function isServerMessage(value: unknown): value is ServerMessage {
  return isRecord(value) && typeof value.type === "string" && [
    "welcome",
    "lobby.state",
    "match.full",
    "match.snapshot",
    "pong",
    "error",
  ].includes(value.type);
}

function finiteVector(value: unknown): Vector3State | null {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.z)
    ? { x: value.x, y: value.y, z: value.z }
    : null;
}

function nullableShortString(value: unknown): string | null | undefined {
  return value === null ? null : typeof value === "string" && value.length <= 128 ? value : undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
