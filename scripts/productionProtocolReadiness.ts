import { MULTIPLAYER_PROTOCOL_HEADER } from "../src/network/protocol";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;

export interface ProductionProtocolReadinessOptions {
  readonly apiUrl: URL;
  readonly expectedProtocolVersion: number;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly sleep?: (delayMs: number) => Promise<void>;
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
}

export async function waitForProductionProtocol(
  options: ProductionProtocolReadinessOptions,
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const startedAt = now();
  let lastObservedProtocol: number | null = null;

  while (true) {
    const elapsedBeforeRequestMs = now() - startedAt;
    if (elapsedBeforeRequestMs >= timeoutMs) {
      throw propagationTimeout(lastObservedProtocol, options.expectedProtocolVersion, timeoutMs);
    }
    let response: Response;
    try {
      response = await fetchImpl(new URL("/health", options.apiUrl), {
        headers: { "Cache-Control": "no-cache" },
        signal: AbortSignal.timeout(Math.min(15_000, timeoutMs - elapsedBeforeRequestMs)),
      });
    } catch {
      await waitForNextAttempt(startedAt, now, sleep, pollIntervalMs, timeoutMs, lastObservedProtocol,
        options.expectedProtocolVersion);
      continue;
    }
    if (!response.ok) {
      if (!isTransientGatewayStatus(response.status)) {
        throw new Error(`Production health returned ${response.status}`);
      }
      await waitForNextAttempt(startedAt, now, sleep, pollIntervalMs, timeoutMs, lastObservedProtocol,
        options.expectedProtocolVersion);
      continue;
    }

    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new Error("Production returned an invalid health response");
    }
    if (!isHealthyService(value)) throw new Error("Production returned an invalid health response");

    const protocolHeader = response.headers.get(MULTIPLAYER_PROTOCOL_HEADER);
    if (protocolHeader !== null) {
      if (!/^[1-9]\d*$/.test(protocolHeader)) {
        throw new Error(`Production returned an invalid protocol header (${protocolHeader})`);
      }
      const observedProtocol = Number(protocolHeader);
      if (!Number.isSafeInteger(observedProtocol)) {
        throw new Error(`Production returned an invalid protocol header (${protocolHeader})`);
      }
      if (observedProtocol === options.expectedProtocolVersion) return;
      if (observedProtocol > options.expectedProtocolVersion) {
        throw new Error(
          `Production protocol ${observedProtocol} is newer than client protocol ${options.expectedProtocolVersion}`,
        );
      }
      lastObservedProtocol = observedProtocol;
    }

    await waitForNextAttempt(startedAt, now, sleep, pollIntervalMs, timeoutMs, lastObservedProtocol,
      options.expectedProtocolVersion);
  }
}

async function waitForNextAttempt(
  startedAt: number,
  now: () => number,
  sleep: (delayMs: number) => Promise<void>,
  pollIntervalMs: number,
  timeoutMs: number,
  observedProtocol: number | null,
  expectedProtocol: number,
): Promise<void> {
  const elapsedMs = now() - startedAt;
  if (elapsedMs >= timeoutMs) {
    throw propagationTimeout(observedProtocol, expectedProtocol, timeoutMs);
  }
  await sleep(Math.min(pollIntervalMs, timeoutMs - elapsedMs));
}

function isTransientGatewayStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function propagationTimeout(
  observedProtocol: number | null,
  expectedProtocol: number,
  timeoutMs: number,
): Error {
  const observed = observedProtocol === null ? "an artifact without a protocol marker" : observedProtocol;
  return new Error(
    `Production protocol remained at ${observed}; expected ${expectedProtocol} after ${timeoutMs}ms`,
  );
}

function isHealthyService(value: unknown): boolean {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "ok" in value &&
    value.ok === true &&
    "service" in value &&
    value.service === "lastlinep2p";
}
