import { createIdleCommand, type ActorCommand } from "../game/commands/ActorCommand";
import type { EntityId } from "../game/state/types";

interface InputState {
  lastReceivedSequence: number;
  lastAppliedSequence: number;
  lastReceivedTick: number;
  renderTick: number | null;
  continuous: ActorCommand;
  pendingOneShot: PendingOneShot | null;
  pendingShots: PendingShot[];
}

interface PendingShot {
  sequence: number;
  weaponId: string;
  receivedTick: number;
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
  | "throwGrenade"
>;

const INPUT_TIMEOUT_TICKS = 6;
const MAX_PENDING_SHOTS = 32;

export interface ConsumedInput {
  command: ActorCommand;
  inputSequence: number | null;
  renderTick: number | null;
}

export class CommandInbox {
  private readonly inputs = new Map<EntityId, InputState>();

  public accept(
    actorId: EntityId,
    sequence: number,
    command: ActorCommand,
    tick: number,
    renderTick?: number,
    shotSequence?: number,
    shotWeaponId?: string,
  ): boolean {
    const current = this.inputs.get(actorId);
    if (current && sequence <= current.lastReceivedSequence) return false;
    this.inputs.set(actorId, {
      lastReceivedSequence: sequence,
      lastAppliedSequence: current?.lastAppliedSequence ?? -1,
      lastReceivedTick: tick,
      renderTick: renderTick ?? null,
      continuous: continuousCommand(command),
      pendingOneShot: mergeOneShot(current?.pendingOneShot ?? null, oneShotCommand(command)),
      pendingShots: appendPendingShot(current?.pendingShots ?? [], shotSequence, shotWeaponId, tick),
    });
    return true;
  }

  public consume(actorId: EntityId, tick: number): ActorCommand {
    return this.consumeWithMetadata(actorId, tick).command;
  }

  public consumeWithMetadata(actorId: EntityId, tick: number): ConsumedInput {
    const input = this.inputs.get(actorId);
    if (!input) return { command: createIdleCommand(), inputSequence: null, renderTick: null };
    const fresh = tick - input.lastReceivedTick <= INPUT_TIMEOUT_TICKS;
    const command = fresh
      ? { ...input.continuous, ...(input.pendingOneShot ?? {}) }
      : { ...createIdleCommand(), aimDirection: { ...input.continuous.aimDirection } };
    input.pendingOneShot = null;
    input.lastAppliedSequence = input.lastReceivedSequence;
    return {
      command,
      inputSequence: fresh ? input.lastReceivedSequence : null,
      renderTick: fresh ? input.renderTick : null,
    };
  }

  public acknowledge(actorId: EntityId): number {
    return this.inputs.get(actorId)?.lastAppliedSequence ?? -1;
  }

  public consumeShotSequence(actorId: EntityId, tick: number, weaponId: string): number | null {
    const pending = this.inputs.get(actorId)?.pendingShots;
    if (!pending) return null;
    while (pending[0] && tick - pending[0].receivedTick > INPUT_TIMEOUT_TICKS) pending.shift();
    const index = pending.findIndex((shot) => shot.weaponId === weaponId);
    if (index < 0) return null;
    return pending.splice(index, 1)[0]?.sequence ?? null;
  }

  public reset(actorId: EntityId): void {
    this.inputs.delete(actorId);
  }
}

function appendPendingShot(
  current: readonly PendingShot[],
  sequence: number | undefined,
  weaponId: string | undefined,
  tick: number,
): PendingShot[] {
  const pending = current.filter((shot) => tick - shot.receivedTick <= INPUT_TIMEOUT_TICKS);
  if (
    sequence !== undefined
    && weaponId !== undefined
    && !pending.some((shot) => shot.sequence === sequence)
  ) {
    pending.push({ sequence, weaponId, receivedTick: tick });
  }
  return pending.slice(-MAX_PENDING_SHOTS);
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
    command.dropItem === null &&
    command.throwGrenade === null
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
    throwGrenade: command.throwGrenade,
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
    throwGrenade: next.throwGrenade ?? current.throwGrenade,
  };
}
