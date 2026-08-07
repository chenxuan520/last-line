interface PointerLockTarget {
  requestPointerLock?: () => void | { catch?: (onRejected: () => void) => unknown };
}

interface PointerLockDocument {
  pointerLockElement?: unknown;
  exitPointerLock?: () => void | { catch?: (onRejected: () => void) => unknown };
}

export type MultiplayerAdmissionAction = "quick" | "create-public" | "create-private" | "join";

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

export function requestDesktopPointerLockSafely(
  target: PointerLockTarget,
  touchInput: boolean,
  pointerLockElement: unknown,
): void {
  if (touchInput || pointerLockElement === target) return;
  requestPointerLockSafely(target);
}

export function releasePointerLockSafely(
  documentTarget: PointerLockDocument,
  target: unknown,
): void {
  if (documentTarget.pointerLockElement !== target) return;
  try {
    const exit = documentTarget.exitPointerLock?.();
    if (exit && typeof exit.catch === "function") {
      void exit.catch(() => {});
    }
  } catch {
    // A rejected or stale lock must not block returning to a menu.
  }
}

export function multiplayerAdmissionRequestsPointerLock(
  action: MultiplayerAdmissionAction,
): boolean {
  return action !== "create-private";
}

export function privateLobbyReleasesPointerLock(
  visibility: "public" | "private",
  host: boolean,
  ready: boolean,
): boolean {
  return visibility === "private" && !host && !ready;
}
