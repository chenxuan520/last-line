import type { GameMode } from "./GameMode";
import type { EntityId, GameEvent, MatchResult, MatchState } from "../state/types";

export class TrainingMode implements GameMode {
  public constructor(private readonly playerId: EntityId) {}

  public start(state: MatchState, events: GameEvent[]): void {
    state.phase = "combat";
    state.result = null;
    events.push({ type: "match-started" });
  }

  public update(state: MatchState, _deltaSeconds: number, events: GameEvent[]): void {
    if (state.phase !== "combat") {
      return;
    }

    const player = state.actors[this.playerId];
    if (!player?.alive) {
      this.finish(state, { winnerId: this.findLivingBot(state), reason: "player-eliminated" }, events);
      return;
    }

    const livingBots = Object.values(state.actors).filter((actor) => actor.kind === "bot" && actor.alive);
    if (livingBots.length === 0) {
      this.finish(state, { winnerId: player.id, reason: "last-alive" }, events);
    }
  }

  private findLivingBot(state: MatchState): EntityId | null {
    return Object.values(state.actors).find((actor) => actor.kind === "bot" && actor.alive)?.id ?? null;
  }

  private finish(state: MatchState, result: MatchResult, events: GameEvent[]): void {
    state.phase = "finished";
    state.result = result;
    events.push({ type: "match-finished", result });
  }
}
