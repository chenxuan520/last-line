import { describe, expect, it, vi } from "vitest";
import { requestPointerLockSafely } from "../../src/controllers/pointerLock";

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
});
