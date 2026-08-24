import type { EntityId, MatchState } from "./state/types";

export const DAMAGE_CAUSE_IDS = ["rifle", "smg", "shotgun", "sniper", "grenade.frag"] as const;
export const DAMAGE_TOTAL_SCALE = 10;
export const MAX_DAMAGE_TOTAL = 99_999;

export type DamageTotals = Record<EntityId, Record<EntityId, Record<string, number>>>;
export type PackedDamageTotals = Record<EntityId, Record<EntityId, number[]>>;

export interface DamageTotalChange {
  sourceId: EntityId;
  targetId: EntityId;
  causeId: string;
  total: number;
}

export interface RawDamageContribution {
  sourceId: EntityId;
  targetId: EntityId;
  causeId: string;
  amount: number;
  aiControlled: boolean;
}

export class DamageTotalsTracker {
  public readonly totals: DamageTotals;
  private changes: DamageTotals = {};

  public constructor(initial: DamageTotals = {}) {
    this.totals = cloneDamageTotals(initial);
  }

  public record(state: MatchState, contribution: RawDamageContribution): void {
    const source = state.actors[contribution.sourceId];
    const target = state.actors[contribution.targetId];
    if (
      contribution.aiControlled ||
      source?.kind !== "player" ||
      !target?.alive ||
      target.deployment === "aircraft" ||
      source.id === target.id ||
      !contribution.causeId ||
      !Number.isFinite(contribution.amount) ||
      contribution.amount <= 0
    ) return;

    const byTarget = this.totals[source.id] ??= {};
    const byCause = byTarget[target.id] ??= {};
    const total = Math.min(
      MAX_DAMAGE_TOTAL,
      Math.round(((byCause[contribution.causeId] ?? 0) + contribution.amount) * DAMAGE_TOTAL_SCALE) /
        DAMAGE_TOTAL_SCALE,
    );
    byCause[contribution.causeId] = total;

    const changedTargets = this.changes[source.id] ??= {};
    const changedCauses = changedTargets[target.id] ??= {};
    changedCauses[contribution.causeId] = total;
  }

  public drainChanges(): DamageTotalChange[] {
    const changes = Object.entries(this.changes).flatMap(([sourceId, targets]) =>
      Object.entries(targets).flatMap(([targetId, causes]) =>
        Object.entries(causes).map(([causeId, total]) => ({ sourceId, targetId, causeId, total })),
      ),
    ).sort((left, right) =>
      left.sourceId.localeCompare(right.sourceId) ||
      left.targetId.localeCompare(right.targetId) ||
      left.causeId.localeCompare(right.causeId)
    );
    this.changes = {};
    return changes;
  }
}

export function cloneDamageTotals(totals: DamageTotals): DamageTotals {
  return Object.fromEntries(Object.entries(totals).map(([sourceId, targets]) => [
    sourceId,
    Object.fromEntries(Object.entries(targets).map(([targetId, causes]) => [targetId, { ...causes }])),
  ]));
}

export function packDamageTotals(totals: DamageTotals): PackedDamageTotals {
  return Object.fromEntries(Object.entries(totals).flatMap(([sourceId, targets]) => {
    const packedTargets = Object.fromEntries(Object.entries(targets).flatMap(([targetId, causes]) => {
      const values = DAMAGE_CAUSE_IDS.map((causeId) =>
        Math.round((causes[causeId] ?? 0) * DAMAGE_TOTAL_SCALE)
      );
      return values.some((value) => value > 0) ? [[targetId, values]] : [];
    }));
    return Object.keys(packedTargets).length > 0 ? [[sourceId, packedTargets]] : [];
  }));
}

export function unpackDamageTotals(totals: PackedDamageTotals): DamageTotals {
  return Object.fromEntries(Object.entries(totals).map(([sourceId, targets]) => [
    sourceId,
    Object.fromEntries(Object.entries(targets).map(([targetId, values]) => [
      targetId,
      Object.fromEntries(DAMAGE_CAUSE_IDS.flatMap((causeId, index) => {
        const total = values[index] ?? 0;
        return total > 0 ? [[causeId, total / DAMAGE_TOTAL_SCALE]] : [];
      })),
    ])),
  ]));
}

export function projectDamageTotals(totals: DamageTotals, sourceId: EntityId): DamageTotals {
  const targets = totals[sourceId];
  return targets ? { [sourceId]: Object.fromEntries(
    Object.entries(targets).map(([targetId, causes]) => [targetId, { ...causes }]),
  ) } : {};
}

export function applyDamageTotalChanges(totals: DamageTotals, changes: readonly DamageTotalChange[]): void {
  for (const change of changes) {
    const targets = totals[change.sourceId] ??= {};
    const causes = targets[change.targetId] ??= {};
    causes[change.causeId] = change.total;
  }
}
