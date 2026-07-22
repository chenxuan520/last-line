import { describe, expect, it, vi } from "vitest";
import { clearDynamicChunkRecoveryAttempts, installDynamicChunkRecovery } from "../../src/client/dynamicChunkRecovery";

describe("dynamic chunk recovery", () => {
  it("reloads twice before allowing the model fallback", () => {
    const target = new EventTarget();
    const values = new Map<string, string>();
    const reload = vi.fn();
    const dispose = installDynamicChunkRecovery({
      addEventListener: (type, listener) => target.addEventListener(type, listener),
      removeEventListener: (type, listener) => target.removeEventListener(type, listener),
      sessionStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
      },
      reload,
    });

    const first = new Event("vite:preloadError", { cancelable: true });
    const second = new Event("vite:preloadError", { cancelable: true });
    const third = new Event("vite:preloadError", { cancelable: true });
    target.dispatchEvent(first);
    target.dispatchEvent(second);
    target.dispatchEvent(third);

    expect(first.defaultPrevented).toBe(false);
    expect(second.defaultPrevented).toBe(false);
    expect(third.defaultPrevented).toBe(false);
    expect(reload).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("clears the retry budget after the chunk loads", () => {
    const removeItem = vi.fn();
    clearDynamicChunkRecoveryAttempts({ removeItem });
    expect(removeItem).toHaveBeenCalledWith("last-line.dynamic-chunk-reloads.v1");
  });
});
