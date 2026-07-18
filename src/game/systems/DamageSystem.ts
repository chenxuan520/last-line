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
    weaponId: string | null = null,
  ): number {
    const target = state.actors[targetId];
    if (!target?.alive || target.deployment === "aircraft" || amount <= 0) {
      return 0;
    }

    const healthBefore = target.health;
    const source = sourceId ? state.actors[sourceId] : undefined;
    if (source && source.id !== target.id) {
      const x = source.position.x - target.position.x;
      const y = source.position.y - target.position.y;
      const z = source.position.z - target.position.z;
      const length = Math.hypot(x, y, z);
      if (length > 0) {
        target.lastDamageDirection = { x: x / length, y: y / length, z: z / length };
        target.lastDamageElapsedSeconds = state.elapsedSeconds;
      }
    }
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
      if (source && source.id !== target.id) {
        source.kills += 1;
      }
      events.push({ type: "actor-died", actorId: target.id, sourceId, weaponId });
    }
    return healthDamage;
  }
}
