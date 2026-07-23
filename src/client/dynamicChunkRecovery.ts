const RELOAD_COUNT_KEY = "last-line.dynamic-chunk-reloads.v1";
const MAX_RELOADS = 2;

interface DynamicChunkRecoveryHost {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  getSessionStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  reload(): void;
}

export function installDynamicChunkRecovery(host: DynamicChunkRecoveryHost): () => void {
  const handlePreloadError: EventListener = (event) => {
    const storage = getStorage(host.getSessionStorage);
    if (!storage) return;
    const reloadCount = Number(readItem(storage, RELOAD_COUNT_KEY) ?? "0");
    if (!Number.isFinite(reloadCount) || reloadCount >= MAX_RELOADS) return;
    if (!writeItem(storage, RELOAD_COUNT_KEY, String(reloadCount + 1))) return;
    event.preventDefault();
    try {
      host.reload();
    } catch {
      // Recovery must never prevent the existing model fallback.
    }
  };
  host.addEventListener("vite:preloadError", handlePreloadError);
  return () => host.removeEventListener("vite:preloadError", handlePreloadError);
}

export function clearDynamicChunkRecoveryAttempts(
  getSessionStorage: () => Pick<Storage, "removeItem"> | null,
): void {
  const storage = getStorage(getSessionStorage);
  if (!storage) return;
  try {
    storage.removeItem(RELOAD_COUNT_KEY);
  } catch {
    // Storage access is optional and must not turn a successful model load into fallback.
  }
}

function getStorage<T>(getSessionStorage: () => T | null): T | null {
  try {
    return getSessionStorage();
  } catch {
    return null;
  }
}

function readItem(storage: Pick<Storage, "getItem">, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(storage: Pick<Storage, "setItem">, key: string, value: string): boolean {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
