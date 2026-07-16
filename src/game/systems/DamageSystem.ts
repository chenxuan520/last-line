import type { EntityId, GameEvent, MatchState } from "../state/types";

export class DamageSystem {
  public applyDamage(
    state: MatchState,
    targetId: EntityId,
    amount: number,
    sourceId: EntityId | null,
    events: GameEvent[],
    bypassArmor = false,
    minimumHealth = 0,
  ): number {
    const target = state.actors[targetId];
    if (!target?.alive || amount <= 0) {
      return 0;
    }

    const healthBefore = target.health;
    if (!bypassArmor) {
      const helmetReduction = target.inventory.helmetLevel === 2 ? 0.2 : target.inventory.helmetLevel === 1 ? 0.1 : 0;
      amount *= 1 - helmetReduction;
      const armorRate = target.inventory.armorLevel === 2 ? 0.55 : 0.45;
      const armorAbsorption = Math.min(target.armor, amount * armorRate);
      target.armor -= armorAbsorption;
      amount -= armorAbsorption;
    }

    const healthFloor = Math.min(target.health, Math.max(0, minimumHealth));
    target.health = Math.max(healthFloor, target.health - amount);
    const healthDamage = healthBefore - target.health;
    events.push({ type: "actor-damaged", actorId: target.id, sourceId, damage: healthDamage });

    if (target.health === 0) {
      target.alive = false;
      target.inventory.usingItem = null;
      const source = sourceId ? state.actors[sourceId] : undefined;
      if (source && source.id !== target.id) {
        source.kills += 1;
      }
      events.push({ type: "actor-died", actorId: target.id, sourceId });
    }
    return healthDamage;
  }
}
