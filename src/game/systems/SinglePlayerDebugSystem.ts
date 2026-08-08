import { ITEMS } from "../../config/items";
import type { MapLayout } from "../../config/map";
import { WEAPONS } from "../../config/weapons";
import { ACTOR_EYE_HEIGHT } from "../rules/actorGeometry";
import {
  createWeaponState,
  type ActorState,
  type EntityId,
  type MatchState,
} from "../state/types";
import { DamageSystem } from "./DamageSystem";
import { getSupportHeight } from "./MovementSystem";

export type SinglePlayerDebugAction =
  | { type: "land-now" }
  | { type: "set-health"; value: number }
  | { type: "set-armor"; value: number }
  | { type: "set-kills"; value: number }
  | { type: "grant-item"; itemId: string; quantity: number }
  | { type: "grant-loadout" }
  | { type: "clear-inventory" };

const TEST_LOADOUT_ITEMS = [
  ["ammo.rifle", 120],
  ["ammo.sniper", 40],
  ["bandage", 5],
  ["medkit", 2],
  ["grenade.frag", 6],
] as const;
const MAX_DEBUG_ITEM_STACKS = 20;

export function createSinglePlayerDebugDamageSystem(playerId: EntityId): DamageSystem {
  return new DamageSystem((targetId) => targetId === playerId);
}

export class SinglePlayerDebugSystem {
  public constructor(
    private readonly playerId: EntityId,
    private readonly layout: MapLayout,
  ) {}

  public apply(state: MatchState, action: SinglePlayerDebugAction): void {
    const player = state.actors[this.playerId];
    if (!player || !player.alive) return;
    switch (action.type) {
      case "land-now":
        this.landNow(player);
        return;
      case "set-health":
        player.health = clamp(action.value, 1, player.maxHealth);
        return;
      case "set-armor":
        this.setArmor(player, action.value);
        return;
      case "set-kills":
        player.kills = clampInteger(action.value, 0, Number.MAX_SAFE_INTEGER);
        return;
      case "grant-item":
        this.grantItem(player, action.itemId, action.quantity);
        return;
      case "grant-loadout":
        this.grantLoadout(player);
        return;
      case "clear-inventory":
        this.clearInventory(player);
    }
  }

  private landNow(player: ActorState): void {
    player.position.y = getSupportHeight(
      player.position.x,
      player.position.z,
      Number.POSITIVE_INFINITY,
      this.layout,
    ) + ACTOR_EYE_HEIGHT;
    player.velocity = { x: 0, y: 0, z: 0 };
    player.deployment = "grounded";
  }

  private setArmor(player: ActorState, value: number): void {
    const armor = clamp(value, 0, 100);
    player.inventory.armorLevel = armor > 50 ? 2 : armor > 0 ? 1 : 0;
    player.maxArmor = player.inventory.armorLevel * 50;
    player.armor = Math.min(armor, player.maxArmor);
  }

  private grantItem(player: ActorState, itemId: string, quantity: number): void {
    const item = ITEMS[itemId];
    if (!item) return;
    const amount = clampInteger(quantity, 1, item.maxStack * MAX_DEBUG_ITEM_STACKS);
    if (item.kind === "weapon" && item.weaponId) {
      this.equipWeapon(player, item.weaponId);
      return;
    }
    if (item.kind === "armor") {
      this.setArmor(player, (item.level ?? 0) * 50);
      return;
    }
    if (item.kind === "helmet") {
      player.inventory.helmetLevel = item.level ?? 0;
      return;
    }
    let remaining = amount;
    while (remaining > 0) {
      const stack = player.inventory.backpack.find(
        (candidate) => candidate.itemId === item.id && candidate.quantity < item.maxStack,
      );
      const added = Math.min(item.maxStack - (stack?.quantity ?? 0), remaining);
      if (stack) stack.quantity += added;
      else player.inventory.backpack.push({ itemId: item.id, quantity: added });
      remaining -= added;
    }
    player.inventory.maxBackpackStacks = Math.max(
      player.inventory.maxBackpackStacks,
      player.inventory.backpack.length,
    );
  }

  private equipWeapon(player: ActorState, weaponId: string): void {
    if (!WEAPONS[weaponId]) return;
    const existingSlot = player.inventory.weaponSlots.findIndex((weapon) => weapon?.weaponId === weaponId);
    if (existingSlot >= 0) {
      player.inventory.weaponSlots[existingSlot as 0 | 1] = createWeaponState(weaponId);
      player.inventory.activeWeaponSlot = existingSlot as 0 | 1;
      return;
    }
    const emptySlot = player.inventory.weaponSlots.findIndex((weapon) => weapon === null);
    const slot = (emptySlot >= 0 ? emptySlot : player.inventory.activeWeaponSlot) as 0 | 1;
    player.inventory.weaponSlots[slot] = createWeaponState(weaponId);
    player.inventory.activeWeaponSlot = slot;
  }

  private grantLoadout(player: ActorState): void {
    this.clearInventory(player);
    player.inventory.weaponSlots = [createWeaponState("rifle"), createWeaponState("sniper")];
    player.inventory.activeWeaponSlot = 0;
    for (const [itemId, quantity] of TEST_LOADOUT_ITEMS) {
      this.grantItem(player, itemId, quantity);
    }
    this.setArmor(player, 100);
    player.inventory.helmetLevel = 2;
    player.health = player.maxHealth;
  }

  private clearInventory(player: ActorState): void {
    player.inventory.weaponSlots = [null, null];
    player.inventory.activeWeaponSlot = 0;
    player.inventory.backpack = [];
    player.inventory.maxBackpackStacks = 6;
    player.inventory.armorLevel = 0;
    player.inventory.helmetLevel = 0;
    player.inventory.usingItem = null;
    player.armor = 0;
    player.maxArmor = 0;
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.trunc(clamp(value, minimum, maximum));
}
