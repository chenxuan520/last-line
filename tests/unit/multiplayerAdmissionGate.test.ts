import { describe, expect, it } from "vitest";
import {
  admissionAttemptOwnsSideEffects,
  MultiplayerAdmissionGate,
  ownsMultiplayerConnection,
} from "../../src/app/MultiplayerAdmissionGate";

describe("MultiplayerAdmissionGate", () => {
  it("allows only one admission until the active attempt finishes", () => {
    const gate = new MultiplayerAdmissionGate();

    expect(gate.begin()).toBe(true);
    expect(gate.pending).toBe(true);
    expect(gate.begin()).toBe(false);

    gate.end();
    expect(gate.pending).toBe(false);
    expect(gate.begin()).toBe(true);
  });

  it("ignores stale completion tokens from an earlier attempt", () => {
    const gate = new MultiplayerAdmissionGate();
    const first = gate.beginAttempt();
    if (first === null) throw new Error("first admission token missing");
    expect(gate.isActive(first)).toBe(true);
    gate.end(first);
    const second = gate.beginAttempt();
    if (second === null) throw new Error("second admission token missing");

    expect(gate.isActive(first)).toBe(false);
    expect(gate.isActive(second)).toBe(true);
    gate.end(first);

    expect(gate.pending).toBe(true);
    gate.end(second);
    expect(gate.pending).toBe(false);
  });

  it("invalidates an in-flight attempt when the menu resets", () => {
    const gate = new MultiplayerAdmissionGate();
    const first = gate.beginAttempt();
    if (first === null) throw new Error("admission token missing");

    gate.reset();
    const second = gate.beginAttempt();
    if (second === null) throw new Error("replacement admission token missing");

    expect(admissionAttemptOwnsSideEffects(gate, first, true)).toBe(false);
    expect(admissionAttemptOwnsSideEffects(gate, second, true)).toBe(true);
    expect(admissionAttemptOwnsSideEffects(gate, second, false)).toBe(false);
  });

  it("distinguishes a stale closed connection from the active replacement", () => {
    const first = {};
    const second = {};

    expect(ownsMultiplayerConnection(first, first)).toBe(true);
    expect(ownsMultiplayerConnection(second, first)).toBe(false);
    expect(ownsMultiplayerConnection(null, first)).toBe(false);
  });

  it("grants connection failure cleanup only to the active connection", () => {
    const stale = {};
    const active = {};

    expect(ownsMultiplayerConnection(active, stale)).toBe(false);
    expect(ownsMultiplayerConnection(active, active)).toBe(true);
  });
});
