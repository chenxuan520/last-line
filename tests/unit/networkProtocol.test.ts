import { describe, expect, it } from "vitest";
import {
  createBackpackStackDropRequest,
  createIdleCommand,
} from "../../src/game/commands/ActorCommand";
import { parseClientMessage, sanitizeActorCommand } from "../../src/network/protocol";

describe("multiplayer protocol", () => {
  it("normalizes movement and aim vectors", () => {
    const command = sanitizeActorCommand({
      ...createIdleCommand(),
      move: { x: 2, y: 9, z: 0 },
      aimDirection: { x: 0, y: 0, z: 4 },
    });
    expect(command?.move).toEqual({ x: 1, y: 0, z: 0 });
    expect(command?.aimDirection).toEqual({ x: 0, y: 0, z: 1 });
  });

  it("rejects non-finite and malformed commands", () => {
    expect(sanitizeActorCommand({ ...createIdleCommand(), move: { x: Number.NaN, y: 0, z: 0 } })).toBeNull();
    expect(parseClientMessage({ type: "match.input", sequence: -1, command: createIdleCommand() })).toBeNull();
    expect(parseClientMessage({
      type: "match.input",
      sequence: 1,
      renderTick: -1,
      command: createIdleCommand(),
    })).toBeNull();
    expect(parseClientMessage({
      type: "match.input",
      sequence: 1,
      shotSequence: 1,
      command: createIdleCommand(),
    })).toBeNull();
    expect(parseClientMessage({ type: "unknown" })).toBeNull();
  });

  it("preserves an indexed backpack drop request through multiplayer sanitization", () => {
    const dropItem = createBackpackStackDropRequest(5, "ammo.rifle", [
      { itemId: "ammo.shell", quantity: 1 },
      { itemId: "bandage", quantity: 1 },
      { itemId: "medkit", quantity: 1 },
      { itemId: "ammo.light", quantity: 1 },
      { itemId: "ammo.sniper", quantity: 1 },
      { itemId: "ammo.rifle", quantity: 1 },
    ]);
    expect(dropItem).not.toBeNull();

    expect(sanitizeActorCommand({
      ...createIdleCommand(),
      dropItem,
    })?.dropItem).toBe(dropItem);
  });

  it("accepts a bounded server render tick while remaining compatible with older input", () => {
    expect(parseClientMessage({
      type: "match.input",
      sequence: 7,
      renderTick: 42,
      shotSequence: 7,
      shotWeaponId: "rifle",
      command: createIdleCommand(),
    })).toMatchObject({
      type: "match.input",
      sequence: 7,
      renderTick: 42,
      shotSequence: 7,
      shotWeaponId: "rifle",
    });
    expect(parseClientMessage({
      type: "match.input",
      sequence: 8,
      command: createIdleCommand(),
    })).toMatchObject({ type: "match.input", sequence: 8 });
  });
});
