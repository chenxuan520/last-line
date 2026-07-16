import type { GameEvent, MatchState } from "../state/types";

export interface GameMode {
  start(state: MatchState, events: GameEvent[]): void;
  update(state: MatchState, deltaSeconds: number, events: GameEvent[]): void;
}
