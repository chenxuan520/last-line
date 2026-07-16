import type { EntityId } from "../state/types";

export function selectSimultaneousSurvivor(
  actorIds: readonly EntityId[],
  elapsedSeconds: number,
): EntityId | undefined {
  const sortedIds = [...actorIds].sort();
  if (sortedIds.length === 0) return undefined;
  return sortedIds[stableHash(`${tickKey(elapsedSeconds)}|${sortedIds.join("|")}`) % sortedIds.length];
}

export function compareActorTurns(left: EntityId, right: EntityId, elapsedSeconds: number): number {
  const tick = tickKey(elapsedSeconds);
  const leftRank = stableHash(`${tick}|${left}`);
  const rightRank = stableHash(`${tick}|${right}`);
  return leftRank - rightRank || left.localeCompare(right);
}

function tickKey(elapsedSeconds: number): number {
  return Math.round(elapsedSeconds * 1_000_000);
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
