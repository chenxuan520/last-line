interface PointerLockTarget {
  requestPointerLock?: () => void | { catch?: (onRejected: () => void) => unknown };
}

export function requestPointerLockSafely(target: PointerLockTarget): void {
  try {
    const request = target.requestPointerLock?.();
    if (request && typeof request.catch === "function") {
      void request.catch(() => {});
    }
  } catch {
    // Unsupported browsers continue with the in-game resume card fallback.
  }
}
