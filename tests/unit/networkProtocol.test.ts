import { describe, expect, it } from "vitest";
import { createIdleCommand } from "../../src/game/commands/ActorCommand";
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
    expect(parseClientMessage({ type: "unknown" })).toBeNull();
  });
});
