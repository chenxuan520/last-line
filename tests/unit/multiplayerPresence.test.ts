import { describe, expect, it } from "vitest";
import { resolveHumanConnectionNotice } from "../../src/network/MultiplayerPresence";

describe("multiplayer presence notices", () => {
  const labels = { "human-1": "Alpha", "human-2": "Bravo" };

  it("uses display names for remote disconnect and reconnect notices", () => {
    expect(resolveHumanConnectionNotice(
      { type: "human-connection", actorId: "human-2", status: "disconnected" },
      "human-1",
      labels,
    )).toBe("Bravo 已断开连接");
    expect(resolveHumanConnectionNotice(
      { type: "human-connection", actorId: "human-2", status: "reconnected" },
      "human-1",
      labels,
    )).toBe("Bravo 已重新连接");
  });

  it("suppresses local and unknown actor notices without leaking raw ids", () => {
    expect(resolveHumanConnectionNotice(
      { type: "human-connection", actorId: "human-1", status: "disconnected" },
      "human-1",
      labels,
    )).toBeNull();
    expect(resolveHumanConnectionNotice(
      { type: "human-connection", actorId: "human-secret", status: "disconnected" },
      "human-1",
      labels,
    )).toBeNull();
  });
});
