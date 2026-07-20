import { describe, expect, it } from "vitest";
import { createIdleCommand } from "../../src/game/commands/ActorCommand";
import { CommandInbox } from "../../src/server/CommandInbox";

describe("CommandInbox", () => {
  it("applies one-shot input once while retaining continuous movement", () => {
    const inbox = new CommandInbox();
    const command = {
      ...createIdleCommand(),
      move: { x: 1, y: 0, z: 0 },
      fire: true,
      jump: true,
      interact: true,
    };
    expect(inbox.accept("human-1", 4, command, 10)).toBe(true);
    expect(inbox.consume("human-1", 10)).toMatchObject({ move: command.move, fire: true, jump: true, interact: true });
    expect(inbox.consume("human-1", 11)).toMatchObject({ move: command.move, fire: true, jump: false, interact: false });
    expect(inbox.acknowledge("human-1")).toBe(4);
  });

  it("rejects stale sequences and expires continuous input", () => {
    const inbox = new CommandInbox();
    expect(inbox.accept("human-1", 3, { ...createIdleCommand(), fire: true }, 2)).toBe(true);
    expect(inbox.accept("human-1", 3, createIdleCommand(), 3)).toBe(false);
    expect(inbox.consume("human-1", 9).fire).toBe(false);
  });

  it("does not lose a pending one-shot when a newer continuous frame arrives first", () => {
    const inbox = new CommandInbox();
    inbox.accept("human-1", 1, { ...createIdleCommand(), jump: true }, 1);
    inbox.accept("human-1", 2, { ...createIdleCommand(), move: { x: 1, y: 0, z: 0 } }, 1);

    expect(inbox.consume("human-1", 1)).toMatchObject({ jump: true, move: { x: 1, y: 0, z: 0 } });
    expect(inbox.acknowledge("human-1")).toBe(2);
  });
});
