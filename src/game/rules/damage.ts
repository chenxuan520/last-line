import type { ActorState } from "../state/types";

export interface ProtectedDamage {
  armorDamage: number;
  healthDamage: number;
}

export function calculateProtectedDamage(
  actor: Pick<ActorState, "armor" | "inventory">,
  rawDamage: number,
): ProtectedDamage {
  const helmetReduction = actor.inventory.helmetLevel === 2
    ? 0.2
    : actor.inventory.helmetLevel === 1
      ? 0.1
      : 0;
  const reducedDamage = rawDamage * (1 - helmetReduction);
  const armorRate = actor.inventory.armorLevel === 2 ? 0.55 : 0.45;
  const armorDamage = Math.min(actor.armor, reducedDamage * armorRate);
  return {
    armorDamage,
    healthDamage: reducedDamage - armorDamage,
  };
}
