const RELOAD_COUNT_KEY = "last-line.dynamic-chunk-reloads.v1";
const MAX_RELOADS = 2;

interface DynamicChunkRecoveryHost {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  readonly sessionStorage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  reload(): void;
}

export function installDynamicChunkRecovery(host: DynamicChunkRecoveryHost): () => void {
  const handlePreloadError: EventListener = () => {
    const reloadCount = Number(host.sessionStorage.getItem(RELOAD_COUNT_KEY) ?? "0");
    if (!Number.isFinite(reloadCount) || reloadCount >= MAX_RELOADS) return;
    host.sessionStorage.setItem(RELOAD_COUNT_KEY, String(reloadCount + 1));
    host.reload();
  };
  host.addEventListener("vite:preloadError", handlePreloadError);
  return () => host.removeEventListener("vite:preloadError", handlePreloadError);
}

export function clearDynamicChunkRecoveryAttempts(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(RELOAD_COUNT_KEY);
}
