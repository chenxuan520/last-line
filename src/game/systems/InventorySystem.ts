import { ITEMS, type ItemConfig } from "../../config/items";
import type { ActorCommand } from "../commands/ActorCommand";
import {
  type ActorState,
  type EntityId,
  type GameEvent,
  type GroundLootState,
  type MatchState,
  type WeaponSlot,
  type WeaponState,
} from "../state/types";

const INTERACTION_DISTANCE_SQUARED = 3 * 3;
const TIMER_EPSILON_SECONDS = 1e-9;

export class InventorySystem {
  private readonly droppedDeadActors = new WeakSet<ActorState>();
  private nextLootId = 1;

  public update(state: MatchState, deltaSeconds: number, events: GameEvent[]): void {
    for (const actor of Object.values(state.actors)) {
      const usingItem = actor.inventory.usingItem;
      if (!actor.alive || !usingItem) {
        continue;
      }

      usingItem.remainingSeconds = Math.max(0, usingItem.remainingSeconds - Math.max(0, deltaSeconds));
      if (usingItem.remainingSeconds > TIMER_EPSILON_SECONDS) {
        continue;
      }

      const item = ITEMS[usingItem.itemId];
      actor.inventory.usingItem = null;
      if (!item || item.kind !== "medical" || item.healAmount === undefined || !this.removeOne(actor, item.id)) {
        continue;
      }

      actor.health = Math.min(actor.maxHealth, actor.health + item.healAmount);
      events.push({ type: "healing-completed", actorId: actor.id, itemId: item.id });
    }
  }

  public processCommand(
    state: MatchState,
    actorId: EntityId,
    command: ActorCommand,
    events: GameEvent[],
  ): void {
    const actor = state.actors[actorId];
    if (!actor?.alive || actor.deployment !== "grounded") {
      return;
    }

    const interruptsHealing = command.fire || command.move.x !== 0 || command.move.y !== 0 || command.move.z !== 0;
    if (actor.inventory.usingItem && interruptsHealing) {
      actor.inventory.usingItem = null;
      events.push({ type: "healing-interrupted", actorId });
    }

    if (command.switchWeapon !== null) {
      this.switchWeapon(actor, command.switchWeapon, events);
    }
    const droppedLootId = command.dropItem !== null
      ? this.dropItem(state, actor, command.dropItem, events)
      : null;
    if (command.interact) {
      this.pickNearestLoot(state, actor, events, droppedLootId);
    }
    if (command.useItem !== null && !interruptsHealing) {
      this.startHealing(actor, command.useItem, events);
    }
  }

  public dropDeadInventories(state: MatchState, events: GameEvent[]): void {
    for (const actor of Object.values(state.actors)) {
      if (actor.alive || this.droppedDeadActors.has(actor)) {
        continue;
      }
      this.droppedDeadActors.add(actor);
      actor.inventory.usingItem = null;

      for (let slot = 0; slot < actor.inventory.weaponSlots.length; slot += 1) {
        const weapon = actor.inventory.weaponSlots[slot];
        if (!weapon) {
          continue;
        }
        const itemId = this.getWeaponItemId(weapon.weaponId);
        if (itemId) {
          this.createGroundLoot(state, actor, itemId, 1, events, weapon);
        }
        actor.inventory.weaponSlots[slot] = null;
      }

      for (const stack of actor.inventory.backpack) {
        if (stack.quantity > 0) {
          this.createGroundLoot(state, actor, stack.itemId, stack.quantity, events);
        }
      }
      actor.inventory.backpack = [];

      if (actor.inventory.armorLevel > 0) {
        this.createGroundLoot(state, actor, `armor.${actor.inventory.armorLevel}`, 1, events);
        actor.inventory.armorLevel = 0;
        actor.armor = 0;
        actor.maxArmor = 0;
      }
      if (actor.inventory.helmetLevel > 0) {
        this.createGroundLoot(state, actor, `helmet.${actor.inventory.helmetLevel}`, 1, events);
        actor.inventory.helmetLevel = 0;
      }
    }
  }

  private pickNearestLoot(
    state: MatchState,
    actor: ActorState,
    events: GameEvent[],
    ignoredLootId: EntityId | null = null,
  ): void {
    let nearest: GroundLootState | null = null;
    let nearestDistanceSquared = Number.POSITIVE_INFINITY;
    for (const loot of Object.values(state.groundLoot)) {
      if (!loot.available || loot.quantity <= 0 || loot.id === ignoredLootId) {
        continue;
      }
      const distanceSquared =
        (loot.position.x - actor.position.x) ** 2 +
        (loot.position.y - actor.position.y) ** 2 +
        (loot.position.z - actor.position.z) ** 2;
      if (
        distanceSquared > INTERACTION_DISTANCE_SQUARED ||
        distanceSquared > nearestDistanceSquared ||
        (distanceSquared === nearestDistanceSquared && nearest && loot.id >= nearest.id)
      ) {
        continue;
      }
      nearest = loot;
      nearestDistanceSquared = distanceSquared;
    }

    if (!nearest) {
      return;
    }
    const item = ITEMS[nearest.itemId];
    if (!item) {
      return;
    }

    const pickedQuantity = this.pickLoot(state, actor, item, nearest, events);
    if (pickedQuantity <= 0) {
      return;
    }
    nearest.quantity -= pickedQuantity;
    if (nearest.quantity === 0) {
      nearest.available = false;
    }
    events.push({
      type: "item-picked",
      actorId: actor.id,
      lootId: nearest.id,
      itemId: nearest.itemId,
      quantity: pickedQuantity,
    });
  }

  private pickLoot(
    state: MatchState,
    actor: ActorState,
    item: ItemConfig,
    loot: GroundLootState,
    events: GameEvent[],
  ): number {
    if (item.kind === "weapon") {
      return this.pickWeapon(state, actor, item, loot, events);
    }
    if (item.kind === "armor") {
      return this.pickArmor(state, actor, item, events);
    }
    if (item.kind === "helmet") {
      return this.pickHelmet(state, actor, item, events);
    }
    return this.addToBackpack(actor, item, loot.quantity);
  }

  private pickWeapon(
    state: MatchState,
    actor: ActorState,
    item: ItemConfig,
    loot: GroundLootState,
    events: GameEvent[],
  ): number {
    const pickedWeapon = loot.weapon;
    if (!item.weaponId || pickedWeapon?.weaponId !== item.weaponId) {
      return 0;
    }
    const inventory = actor.inventory;
    const emptySlot: WeaponSlot | null = inventory.weaponSlots[0] === null ? 0 : inventory.weaponSlots[1] === null ? 1 : null;
    const targetSlot = emptySlot ?? inventory.activeWeaponSlot;
    const replacedWeapon = inventory.weaponSlots[targetSlot];
    const replacedItemId = replacedWeapon ? this.getWeaponItemId(replacedWeapon.weaponId) : null;
    if (replacedWeapon && !replacedItemId) {
      return 0;
    }

    inventory.weaponSlots[targetSlot] = pickedWeapon;
    delete loot.weapon;
    if (replacedWeapon && replacedItemId) {
      this.createGroundLoot(state, actor, replacedItemId, 1, events, replacedWeapon);
    }
    return 1;
  }

  private pickArmor(state: MatchState, actor: ActorState, item: ItemConfig, events: GameEvent[]): number {
    const level = item.level;
    if (!level || level <= actor.inventory.armorLevel) {
      return 0;
    }
    const replacedLevel = actor.inventory.armorLevel;
    actor.inventory.armorLevel = level;
    actor.maxArmor = level * 50;
    actor.armor = actor.maxArmor;
    if (replacedLevel > 0) {
      this.createGroundLoot(state, actor, `armor.${replacedLevel}`, 1, events);
    }
    return 1;
  }

  private pickHelmet(state: MatchState, actor: ActorState, item: ItemConfig, events: GameEvent[]): number {
    const level = item.level;
    if (!level || level <= actor.inventory.helmetLevel) {
      return 0;
    }
    const replacedLevel = actor.inventory.helmetLevel;
    actor.inventory.helmetLevel = level;
    if (replacedLevel > 0) {
      this.createGroundLoot(state, actor, `helmet.${replacedLevel}`, 1, events);
    }
    return 1;
  }

  private addToBackpack(actor: ActorState, item: ItemConfig, quantity: number): number {
    let remaining = quantity;
    for (const stack of actor.inventory.backpack) {
      if (stack.itemId !== item.id || stack.quantity >= item.maxStack) {
        continue;
      }
      const added = Math.min(item.maxStack - stack.quantity, remaining);
      stack.quantity += added;
      remaining -= added;
      if (remaining === 0) {
        break;
      }
    }

    while (remaining > 0 && actor.inventory.backpack.length < actor.inventory.maxBackpackStacks) {
      const added = Math.min(item.maxStack, remaining);
      actor.inventory.backpack.push({ itemId: item.id, quantity: added });
      remaining -= added;
    }
    return quantity - remaining;
  }

  private switchWeapon(actor: ActorState, slot: WeaponSlot, events: GameEvent[]): void {
    if (slot === actor.inventory.activeWeaponSlot || !actor.inventory.weaponSlots[slot]) {
      return;
    }
    actor.inventory.activeWeaponSlot = slot;
    events.push({ type: "weapon-switched", actorId: actor.id, slot });
  }

  private startHealing(actor: ActorState, itemId: string, events: GameEvent[]): void {
    const item = ITEMS[itemId];
    if (
      actor.inventory.usingItem ||
      actor.health >= actor.maxHealth ||
      !item ||
      item.kind !== "medical" ||
      item.useSeconds === undefined ||
      this.getBackpackQuantity(actor, itemId) <= 0
    ) {
      return;
    }
    actor.inventory.usingItem = { itemId, remainingSeconds: item.useSeconds };
    events.push({ type: "healing-started", actorId: actor.id, itemId });
  }

  private dropItem(state: MatchState, actor: ActorState, itemId: string, events: GameEvent[]): EntityId | null {
    const item = ITEMS[itemId];
    if (!item) {
      return null;
    }

    if (item.kind === "weapon" && item.weaponId) {
      const activeSlot = actor.inventory.activeWeaponSlot;
      const activeWeapon = actor.inventory.weaponSlots[activeSlot];
      const slot = activeWeapon?.weaponId === item.weaponId
        ? activeSlot
        : actor.inventory.weaponSlots[0]?.weaponId === item.weaponId
          ? 0
          : actor.inventory.weaponSlots[1]?.weaponId === item.weaponId
            ? 1
            : null;
      if (slot === null) {
        return null;
      }
      const droppedWeapon = actor.inventory.weaponSlots[slot];
      if (!droppedWeapon) {
        return null;
      }
      actor.inventory.weaponSlots[slot] = null;
      const lootId = this.createGroundLoot(state, actor, itemId, 1, events, droppedWeapon);
      const otherSlot: WeaponSlot = slot === 0 ? 1 : 0;
      if (slot === activeSlot && actor.inventory.weaponSlots[otherSlot]) {
        actor.inventory.activeWeaponSlot = otherSlot;
        events.push({ type: "weapon-switched", actorId: actor.id, slot: otherSlot });
      }
      return lootId;
    }

    if (item.kind === "armor") {
      if (actor.inventory.armorLevel !== item.level) {
        return null;
      }
      actor.inventory.armorLevel = 0;
      actor.armor = 0;
      actor.maxArmor = 0;
      return this.createGroundLoot(state, actor, itemId, 1, events);
    }

    if (item.kind === "helmet") {
      if (actor.inventory.helmetLevel !== item.level) {
        return null;
      }
      actor.inventory.helmetLevel = 0;
      return this.createGroundLoot(state, actor, itemId, 1, events);
    }

    const stackIndex = actor.inventory.backpack.findIndex((stack) => stack.itemId === itemId);
    if (stackIndex < 0) {
      return null;
    }
    const [stack] = actor.inventory.backpack.splice(stackIndex, 1);
    if (!stack) {
      return null;
    }
    const lootId = this.createGroundLoot(state, actor, itemId, stack.quantity, events);
    if (actor.inventory.usingItem?.itemId === itemId && this.getBackpackQuantity(actor, itemId) === 0) {
      actor.inventory.usingItem = null;
      events.push({ type: "healing-interrupted", actorId: actor.id });
    }
    return lootId;
  }

  private createGroundLoot(
    state: MatchState,
    actor: ActorState,
    itemId: string,
    quantity: number,
    events: GameEvent[],
    weapon?: WeaponState,
  ): EntityId {
    const reusable = Object.values(state.groundLoot)
      .filter((loot) => !loot.available)
      .sort((left, right) => left.id.localeCompare(right.id))[0];
    let lootId = reusable?.id;
    if (!lootId) {
      do {
        lootId = `loot-${this.nextLootId}`;
        this.nextLootId += 1;
      } while (state.groundLoot[lootId]);
    }

    state.groundLoot[lootId] = {
      id: lootId,
      itemId,
      quantity,
      ...(weapon ? { weapon } : {}),
      position: { ...actor.position },
      available: true,
    };
    events.push({ type: "item-dropped", actorId: actor.id, lootId, itemId, quantity });
    return lootId;
  }

  private getWeaponItemId(weaponId: string): string | null {
    return Object.values(ITEMS).find((item) => item.kind === "weapon" && item.weaponId === weaponId)?.id ?? null;
  }

  private getBackpackQuantity(actor: ActorState, itemId: string): number {
    return actor.inventory.backpack.reduce(
      (quantity, stack) => quantity + (stack.itemId === itemId ? stack.quantity : 0),
      0,
    );
  }

  private removeOne(actor: ActorState, itemId: string): boolean {
    const stackIndex = actor.inventory.backpack.findIndex((stack) => stack.itemId === itemId && stack.quantity > 0);
    if (stackIndex < 0) {
      return false;
    }
    const stack = actor.inventory.backpack[stackIndex];
    if (!stack) {
      return false;
    }
    stack.quantity -= 1;
    if (stack.quantity === 0) {
      actor.inventory.backpack.splice(stackIndex, 1);
    }
    return true;
  }
}
