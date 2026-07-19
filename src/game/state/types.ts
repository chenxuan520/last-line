import { ITEMS } from "../../config/items";
import { WEAPONS } from "../../config/weapons";

export type EntityId = string;
export type WeaponSlot = 0 | 1;

export interface Vector3State {
  x: number;
  y: number;
  z: number;
}

export interface WeaponState {
  weaponId: string;
  ammoInMagazine: number;
  cooldownSeconds: number;
  reloadSeconds: number;
}

export interface ItemStackState {
  itemId: string;
  quantity: number;
}

export interface ItemUseState {
  itemId: string;
  remainingSeconds: number;
}

export interface InventoryState {
  weaponSlots: [WeaponState | null, WeaponState | null];
  activeWeaponSlot: WeaponSlot;
  backpack: ItemStackState[];
  maxBackpackStacks: number;
  armorLevel: 0 | 1 | 2;
  helmetLevel: 0 | 1 | 2;
  usingItem: ItemUseState | null;
}

export interface ActorState {
  id: EntityId;
  kind: "player" | "bot";
  position: Vector3State;
  velocity: Vector3State;
  yaw: number;
  pitch: number;
  health: number;
  maxHealth: number;
  armor: number;
  maxArmor: number;
  alive: boolean;
  deployment: "aircraft" | "parachuting" | "grounded";
  inventory: InventoryState;
  kills: number;
  lastDamageDirection: Vector3State | null;
  lastDamageElapsedSeconds: number;
}

export interface GroundLootState {
  id: EntityId;
  itemId: string;
  quantity: number;
  weapon?: WeaponState;
  position: Vector3State;
  available: boolean;
  source?: "spawn" | "drop" | "death";
}

export interface SafeZoneState {
  center: Vector3State;
  radius: number;
  startCenter: Vector3State;
  startRadius: number;
  targetCenter: Vector3State;
  targetRadius: number;
  stageIndex: number;
  status: "waiting" | "shrinking" | "closed";
  secondsRemaining: number;
  damagePerSecond: number;
}

export interface FlightState {
  start: Vector3State;
  end: Vector3State;
  durationSeconds: number;
  progress: number;
}

export interface MatchResult {
  winnerId: EntityId | null;
  reason: "last-alive" | "player-eliminated";
}

export interface MatchState {
  phase: "ready" | "flight" | "combat" | "finished";
  elapsedSeconds: number;
  mapSeed: number;
  actors: Record<EntityId, ActorState>;
  groundLoot: Record<EntityId, GroundLootState>;
  safeZone: SafeZoneState;
  flight: FlightState;
  result: MatchResult | null;
}

export type GameEvent =
  | { type: "match-started" }
  | { type: "phase-changed"; phase: MatchState["phase"] }
  | { type: "shot-fired"; actorId: EntityId; weaponId: string; origin: Vector3State }
  | {
      type: "shot-traced";
      actorId: EntityId;
      origin: Vector3State;
      end: Vector3State;
      normal: Vector3State;
      hitType: "actor" | "environment" | "miss";
      targetId: EntityId | null;
    }
  | { type: "actor-damaged"; actorId: EntityId; sourceId: EntityId | null; damage: number }
  | { type: "actor-died"; actorId: EntityId; sourceId: EntityId | null; weaponId: string | null }
  | { type: "reload-started"; actorId: EntityId }
  | { type: "reload-completed"; actorId: EntityId }
  | { type: "item-picked"; actorId: EntityId; lootId: EntityId; itemId: string; quantity: number }
  | { type: "item-dropped"; actorId: EntityId; lootId: EntityId; itemId: string; quantity: number }
  | { type: "weapon-switched"; actorId: EntityId; slot: WeaponSlot }
  | { type: "healing-started"; actorId: EntityId; itemId: string }
  | { type: "healing-completed"; actorId: EntityId; itemId: string }
  | { type: "healing-interrupted"; actorId: EntityId }
  | { type: "safe-zone-changed"; stageIndex: number; status: SafeZoneState["status"] }
  | { type: "match-finished"; result: MatchResult };

export function createWeaponState(weaponId: string, loaded = true): WeaponState {
  const config = WEAPONS[weaponId];
  if (!config) {
    throw new Error(`未知武器: ${weaponId}`);
  }
  return {
    weaponId,
    ammoInMagazine: loaded ? config.magazineSize : 0,
    cooldownSeconds: 0,
    reloadSeconds: 0,
  };
}

export function createActorState(
  id: EntityId,
  kind: ActorState["kind"],
  position: Vector3State,
  weaponId = "rifle",
): ActorState {
  const weapon = createWeaponState(weaponId);
  const ammoItemId = WEAPONS[weaponId]?.ammoItemId;
  return {
    id,
    kind,
    position: { ...position },
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    health: 100,
    maxHealth: 100,
    armor: 50,
    maxArmor: 50,
    alive: true,
    deployment: "grounded",
    inventory: {
      weaponSlots: [weapon, null],
      activeWeaponSlot: 0,
      backpack: ammoItemId ? [{ itemId: ammoItemId, quantity: 90 }] : [],
      maxBackpackStacks: 6,
      armorLevel: 1,
      helmetLevel: 0,
      usingItem: null,
    },
    kills: 0,
    lastDamageDirection: null,
    lastDamageElapsedSeconds: -1,
  };
}

export function getActiveWeapon(actor: ActorState): WeaponState | null {
  return actor.inventory.weaponSlots[actor.inventory.activeWeaponSlot];
}

export function getItemQuantity(actor: ActorState, itemId: string): number {
  return actor.inventory.backpack.find((stack) => stack.itemId === itemId)?.quantity ?? 0;
}

export function getReserveAmmo(actor: ActorState): number {
  const weapon = getActiveWeapon(actor);
  const ammoItemId = weapon ? WEAPONS[weapon.weaponId]?.ammoItemId : undefined;
  return ammoItemId ? getItemQuantity(actor, ammoItemId) : 0;
}

export function getItemLabel(itemId: string): string {
  return ITEMS[itemId]?.label ?? itemId;
}
