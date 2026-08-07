import type { GrenadeThrowMode } from "../../config/throwables";
import type { EntityId, ItemStackState, Vector3State, WeaponSlot } from "../state/types";

export interface ActorCommand {
  move: Vector3State;
  aimDirection: Vector3State;
  fire: boolean;
  reload: boolean;
  sprint: boolean;
  jump: boolean;
  interact: boolean;
  interactLootId: EntityId | null;
  interactLootGeneration: number | null;
  switchWeapon: WeaponSlot | null;
  useItem: string | null;
  dropItem: string | null;
  throwGrenade: GrenadeThrowMode | null;
}

export function createIdleCommand(): ActorCommand {
  return {
    move: { x: 0, y: 0, z: 0 },
    aimDirection: { x: 0, y: 0, z: 1 },
    fire: false,
    reload: false,
    sprint: false,
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

const BACKPACK_DROP_PREFIX = "backpack:";

export function createBackpackStackDropRequest(
  index: number,
  itemId: string,
  backpack: readonly ItemStackState[],
  expectedSnapshot = backpackSnapshotSignature(backpack),
): string | null {
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index > 99 ||
    itemId.length === 0 ||
    !/^[0-9a-f]{16}$/.test(expectedSnapshot)
  ) return null;
  return `${BACKPACK_DROP_PREFIX}${index}:${expectedSnapshot}:${itemId}`;
}

export function parseBackpackStackDropRequest(
  request: string,
): { index: number; snapshot: string; itemId: string } | null {
  if (!request.startsWith(BACKPACK_DROP_PREFIX)) return null;
  const indexSeparator = request.indexOf(":", BACKPACK_DROP_PREFIX.length);
  const snapshotSeparator = request.indexOf(":", indexSeparator + 1);
  if (indexSeparator < 0 || snapshotSeparator < 0) return null;
  const index = Number(request.slice(BACKPACK_DROP_PREFIX.length, indexSeparator));
  const snapshot = request.slice(indexSeparator + 1, snapshotSeparator);
  const itemId = request.slice(snapshotSeparator + 1);
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index > 99 ||
    !/^[0-9a-f]{16}$/.test(snapshot) ||
    itemId.length === 0
  ) return null;
  return { index, snapshot, itemId };
}

export function backpackSnapshotSignature(backpack: readonly ItemStackState[]): string {
  let hash = 0xcbf29ce484222325n;
  for (const stack of backpack) {
    const value = `${stack.itemId}\0${stack.quantity}\0`;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= BigInt(value.charCodeAt(index));
      hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
  }
  return hash.toString(16).padStart(16, "0");
}
