import { describe, expect, it, vi } from "vitest";
import {
  multiplayerAdmissionRequestsPointerLock,
  privateLobbyReleasesPointerLock,
  releasePointerLockSafely,
  requestDesktopPointerLockSafely,
  requestPointerLockSafely,
} from "../../src/controllers/pointerLock";

describe("GameApp actions", () => {
  it("continues when pointer lock is unavailable or throws synchronously", () => {
    expect(() => requestPointerLockSafely({})).not.toThrow();
    expect(() => requestPointerLockSafely({
      requestPointerLock: () => {
        throw new Error("unsupported");
      },
    })).not.toThrow();
  });

  it("accepts legacy void returns and contains asynchronous rejection", () => {
    const legacyRequest = vi.fn();
    const containRejection = vi.fn();
    requestPointerLockSafely({ requestPointerLock: legacyRequest });
    requestPointerLockSafely({
      requestPointerLock: () => ({ catch: containRejection }),
    });

    expect(legacyRequest).toHaveBeenCalledOnce();
    expect(containRejection).toHaveBeenCalledOnce();
  });

  it("requests desktop pointer lock only when the target is not already locked", () => {
    const requestPointerLock = vi.fn();
    const target = { requestPointerLock };

    requestDesktopPointerLockSafely(target, false, null);
    requestDesktopPointerLockSafely(target, false, target);
    requestDesktopPointerLockSafely(target, true, null);

    expect(requestPointerLock).toHaveBeenCalledOnce();
  });

  it("contains desktop pointer lock failures without blocking multiplayer startup", () => {
    expect(() => requestDesktopPointerLockSafely({
      requestPointerLock: () => {
        throw new Error("blocked");
      },
    }, false, null)).not.toThrow();
    expect(() => requestDesktopPointerLockSafely({}, false, null)).not.toThrow();
  });

  it("releases only the active target and contains legacy failures", () => {
    const target = {};
    const exitPointerLock = vi.fn();

    releasePointerLockSafely({ pointerLockElement: null, exitPointerLock }, target);
    releasePointerLockSafely({ pointerLockElement: target, exitPointerLock }, target);
    expect(exitPointerLock).toHaveBeenCalledOnce();
    expect(() => releasePointerLockSafely({
      pointerLockElement: target,
      exitPointerLock: () => {
        throw new Error("stale");
      },
    }, target)).not.toThrow();
  });

  it("prelocks multiplayer admission only when the room can auto-start", () => {
    expect(multiplayerAdmissionRequestsPointerLock("quick")).toBe(true);
    expect(multiplayerAdmissionRequestsPointerLock("create-public")).toBe(true);
    expect(multiplayerAdmissionRequestsPointerLock("join")).toBe(true);
    expect(multiplayerAdmissionRequestsPointerLock("create-private")).toBe(false);
  });

  it("releases a private guest lock until the guest explicitly readies", () => {
    expect(privateLobbyReleasesPointerLock("private", false, false)).toBe(true);
    expect(privateLobbyReleasesPointerLock("private", false, true)).toBe(false);
    expect(privateLobbyReleasesPointerLock("private", true, true)).toBe(false);
    expect(privateLobbyReleasesPointerLock("public", false, false)).toBe(false);
  });
});
