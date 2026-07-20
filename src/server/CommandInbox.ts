import { createIdleCommand, type ActorCommand } from "../game/commands/ActorCommand";
import type { EntityId } from "../game/state/types";

interface InputState {
  lastReceivedSequence: number;
  lastAppliedSequence: number;
  lastReceivedTick: number;
  continuous: ActorCommand;
  pendingOneShot: PendingOneShot | null;
}

type PendingOneShot = Pick<
  ActorCommand,
  | "reload"
  | "jump"
  | "interact"
  | "interactLootId"
  | "interactLootGeneration"
  | "switchWeapon"
  | "useItem"
  | "dropItem"
>;

const INPUT_TIMEOUT_TICKS = 6;

export class CommandInbox {
  private readonly inputs = new Map<EntityId, InputState>();

  public accept(actorId: EntityId, sequence: number, command: ActorCommand, tick: number): boolean {
    const current = this.inputs.get(actorId);
    if (current && sequence <= current.lastReceivedSequence) return false;
    this.inputs.set(actorId, {
      lastReceivedSequence: sequence,
      lastAppliedSequence: current?.lastAppliedSequence ?? -1,
      lastReceivedTick: tick,
      continuous: continuousCommand(command),
      pendingOneShot: mergeOneShot(current?.pendingOneShot ?? null, oneShotCommand(command)),
    });
    return true;
  }

  public consume(actorId: EntityId, tick: number): ActorCommand {
    const input = this.inputs.get(actorId);
    if (!input) return createIdleCommand();
    const command = tick - input.lastReceivedTick <= INPUT_TIMEOUT_TICKS
      ? { ...input.continuous, ...(input.pendingOneShot ?? {}) }
      : { ...createIdleCommand(), aimDirection: { ...input.continuous.aimDirection } };
    input.pendingOneShot = null;
    input.lastAppliedSequence = input.lastReceivedSequence;
    return command;
  }

  public acknowledge(actorId: EntityId): number {
    return this.inputs.get(actorId)?.lastAppliedSequence ?? -1;
  }

  public reset(actorId: EntityId): void {
    this.inputs.delete(actorId);
  }
}

function continuousCommand(command: ActorCommand): ActorCommand {
  return {
    ...createIdleCommand(),
    move: { ...command.move },
    aimDirection: { ...command.aimDirection },
    fire: command.fire,
    sprint: command.sprint,
  };
}

function oneShotCommand(command: ActorCommand): PendingOneShot | null {
  if (
    !command.reload &&
    !command.jump &&
    !command.interact &&
    command.switchWeapon === null &&
    command.useItem === null &&
    command.dropItem === null
  ) return null;
  return {
    reload: command.reload,
    jump: command.jump,
    interact: command.interact,
    interactLootId: command.interactLootId,
    interactLootGeneration: command.interactLootGeneration,
    switchWeapon: command.switchWeapon,
    useItem: command.useItem,
    dropItem: command.dropItem,
  };
}

function mergeOneShot(current: PendingOneShot | null, next: PendingOneShot | null): PendingOneShot | null {
  if (!current) return next;
  if (!next) return current;
  return {
    reload: current.reload || next.reload,
    jump: current.jump || next.jump,
    interact: current.interact || next.interact,
    interactLootId: next.interact ? next.interactLootId : current.interactLootId,
    interactLootGeneration: next.interact ? next.interactLootGeneration : current.interactLootGeneration,
    switchWeapon: next.switchWeapon ?? current.switchWeapon,
    useItem: next.useItem ?? current.useItem,
    dropItem: next.dropItem ?? current.dropItem,
  };
}
