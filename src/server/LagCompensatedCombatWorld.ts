import { SIMULATION_TICK_RATE } from "../game/simulationTiming";
import type { EntityId, MatchState } from "../game/state/types";
import type { CombatWorld, ShotResult, ShotTrace } from "../game/systems/CombatSystem";
import {
  SimulationCombatWorld,
  type ActorHitboxState,
} from "../game/systems/SimulationCombatWorld";

const MAX_LAG_COMPENSATION_SECONDS = 0.2;
export const MAX_LAG_COMPENSATION_TICKS = Math.round(
  MAX_LAG_COMPENSATION_SECONDS * SIMULATION_TICK_RATE,
);

export function boundClientRenderTick(
  requestedTick: number | undefined,
  lastSentTick: number | undefined,
  lastAcceptedTick: number | undefined,
): number | undefined {
  if (requestedTick === undefined || lastSentTick === undefined) return undefined;
  const monotonicFloor = Math.min(lastAcceptedTick ?? 0, lastSentTick);
  return Math.max(monotonicFloor, Math.min(requestedTick, lastSentTick));
}

interface ActorHistoryFrame {
  tick: number;
  actors: Readonly<Record<EntityId, ActorHitboxState>>;
}

export class LagCompensatedCombatWorld implements CombatWorld {
  private readonly history: ActorHistoryFrame[] = [];
  private rewindTicks: ReadonlyMap<EntityId, number> = new Map();
  private currentTick = 0;

  public constructor(
    private readonly state: MatchState,
    private readonly currentWorld: SimulationCombatWorld,
  ) {}

  public recordFrame(tick: number): void {
    const frame = {
      tick,
      actors: Object.fromEntries(Object.values(this.state.actors).map((actor) => [actor.id, {
        id: actor.id,
        position: { ...actor.position },
        alive: actor.alive,
        deployment: actor.deployment,
      }])),
    } satisfies ActorHistoryFrame;
    const existing = this.history.findIndex((candidate) => candidate.tick === tick);
    if (existing >= 0) this.history[existing] = frame;
    else this.history.push(frame);
    this.history.sort((left, right) => left.tick - right.tick);
    const oldestRetainedTick = tick - MAX_LAG_COMPENSATION_TICKS - 1;
    while (this.history[0] && this.history[0].tick < oldestRetainedTick) this.history.shift();
  }

  public beginStep(currentTick: number, rewindTicks: ReadonlyMap<EntityId, number>): void {
    this.currentTick = currentTick;
    this.rewindTicks = rewindTicks;
  }

  public endStep(): void {
    this.rewindTicks = new Map();
  }

  public traceShot(trace: ShotTrace): EntityId | null {
    return this.traceShotDetailed(trace).targetId;
  }

  public traceShotDetailed(trace: ShotTrace): ShotResult {
    const requestedTick = this.rewindTicks.get(trace.shooterId);
    if (requestedTick === undefined) return this.currentWorld.traceShotDetailed(trace);
    const rewindTick = Math.max(
      this.currentTick - MAX_LAG_COMPENSATION_TICKS,
      Math.min(this.currentTick, requestedTick),
    );
    const frame = findFrame(this.history, rewindTick);
    return frame
      ? this.currentWorld.traceShotDetailedAgainstActors(trace, frame.actors)
      : this.currentWorld.traceShotDetailed(trace);
  }

  public hasLineOfSight(observerId: EntityId, targetId: EntityId): boolean {
    return this.currentWorld.hasLineOfSight(observerId, targetId);
  }
}

function findFrame(history: readonly ActorHistoryFrame[], tick: number): ActorHistoryFrame | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const frame = history[index];
    if (frame && frame.tick <= tick) return frame;
  }
  return undefined;
}
