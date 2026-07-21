import type { WeaponConfig } from "../config/weapons";
import { createMapLayout, type MapLayout } from "../config/map";
import type { ActorCommand } from "./commands/ActorCommand";
import type { GameMode } from "./modes/GameMode";
import { compareActorTurns } from "./rules/resolveSimultaneous";
import type { CombatWorld } from "./systems/CombatSystem";
import { CombatSystem } from "./systems/CombatSystem";
import { InventorySystem } from "./systems/InventorySystem";
import { MovementSystem } from "./systems/MovementSystem";
import type { EntityId, GameEvent, MatchState } from "./state/types";

export class GameSimulation {
  private readonly combat: CombatSystem;
  private readonly inventory: InventorySystem;
  private readonly movement: MovementSystem;
  private events: GameEvent[] = [];

  public constructor(
    public readonly state: MatchState,
    private readonly mode: GameMode,
    weapons: Readonly<Record<string, WeaponConfig>>,
    layout: MapLayout = createMapLayout(state.mapSeed),
  ) {
    this.combat = new CombatSystem(weapons);
    this.inventory = new InventorySystem(layout);
    this.movement = new MovementSystem(layout);
  }

  public start(): void {
    this.mode.start(this.state, this.events);
  }

  public step(
    deltaSeconds: number,
    commands: ReadonlyMap<EntityId, ActorCommand>,
    world: CombatWorld,
  ): void {
    if (this.state.phase === "ready" || this.state.phase === "finished") {
      return;
    }

    this.state.elapsedSeconds += deltaSeconds;
    this.combat.update(this.state, deltaSeconds, this.events);
    this.inventory.update(this.state, deltaSeconds, this.events);
    const orderedCommands = [...commands].sort(([leftId], [rightId]) => compareIds(leftId, rightId));
    for (const [actorId, command] of orderedCommands) {
      this.movement.processCommand(this.state, actorId, command, deltaSeconds);
    }
    const inventoryCommands = [...commands].sort(([leftId], [rightId]) =>
      compareActorTurns(leftId, rightId, this.state.elapsedSeconds),
    );
    for (const [actorId, command] of inventoryCommands) {
      this.inventory.processCommand(this.state, actorId, command, this.events);
    }
    this.combat.processCommands(this.state, commands, world, this.events, orderedCommands);
    this.mode.update(this.state, deltaSeconds, this.events);
    this.inventory.dropDeadInventories(this.state, this.events);
  }

  public drainEvents(): GameEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }
}

function compareIds(left: EntityId, right: EntityId): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
