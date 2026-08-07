import { describe, expect, it, vi } from "vitest";
import {
  waitForProductionProtocol,
  type ProductionProtocolReadinessOptions,
} from "../../scripts/productionProtocolReadiness";
import {
  MULTIPLAYER_PROTOCOL_HEADER,
  MULTIPLAYER_PROTOCOL_VERSION,
} from "../../src/network/protocol";

const apiUrl = new URL("https://multiplayer.example.test");

describe("production protocol readiness", () => {
  it("waits for a stale deployment to report the expected protocol", async () => {
    const responses = [
      healthResponse(),
      healthResponse(String(MULTIPLAYER_PROTOCOL_VERSION - 1)),
      healthResponse(String(MULTIPLAYER_PROTOCOL_VERSION)),
    ];
    const fetchImpl = vi.fn(async () => responses.shift() ?? healthResponse());
    const clock = fakeClock();

    await waitForProductionProtocol(options(fetchImpl, clock));

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(clock.sleep).toHaveBeenCalledTimes(2);
  });

  it("fails after the bounded propagation window stays on an old protocol", async () => {
    const fetchImpl = vi.fn(async () => healthResponse(String(MULTIPLAYER_PROTOCOL_VERSION - 1)));
    const clock = fakeClock();

    await expect(waitForProductionProtocol(options(fetchImpl, clock, { timeoutMs: 20_000 })))
      .rejects.toThrow(`Production protocol remained at ${MULTIPLAYER_PROTOCOL_VERSION - 1}`);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(clock.sleep).toHaveBeenCalledTimes(2);
  });

  it("waits through transient transport and gateway failures without creating resources", async () => {
    const responses: Array<Response | Error> = [
      new Error("connection reset"),
      new Response("unavailable", { status: 503 }),
      healthResponse(String(MULTIPLAYER_PROTOCOL_VERSION)),
    ];
    const fetchImpl = vi.fn(async () => {
      const value = responses.shift() ?? healthResponse();
      if (value instanceof Error) throw value;
      return value;
    });
    const clock = fakeClock();

    await waitForProductionProtocol(options(fetchImpl, clock));

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(clock.sleep).toHaveBeenCalledTimes(2);
  });

  it("fails after the bounded window stays on a transient gateway error", async () => {
    const fetchImpl = vi.fn(async () => new Response("unavailable", { status: 503 }));
    const clock = fakeClock();

    await expect(waitForProductionProtocol(options(fetchImpl, clock, { timeoutMs: 20_000 })))
      .rejects.toThrow(`expected ${MULTIPLAYER_PROTOCOL_VERSION} after 20000ms`);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(clock.sleep).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["a non-transient response", new Response("forbidden", { status: 403 }), "health returned 403"],
    ["an invalid health body", new Response(JSON.stringify({ ok: false })), "invalid health response"],
    ["invalid health JSON", new Response("{"), "invalid health response"],
    ["an invalid protocol header", healthResponse("seven"), "invalid protocol header"],
    [
      "a newer protocol",
      healthResponse(String(MULTIPLAYER_PROTOCOL_VERSION + 1)),
      `newer than client protocol ${MULTIPLAYER_PROTOCOL_VERSION}`,
    ],
  ])("does not retry %s", async (_name, response, expectedMessage) => {
    const fetchImpl = vi.fn(async () => response);
    const clock = fakeClock();

    await expect(waitForProductionProtocol(options(fetchImpl, clock))).rejects.toThrow(expectedMessage);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(clock.sleep).not.toHaveBeenCalled();
  });
});

function options(
  fetchImpl: ProductionProtocolReadinessOptions["fetchImpl"],
  clock: ReturnType<typeof fakeClock>,
  overrides: Partial<ProductionProtocolReadinessOptions> = {},
): ProductionProtocolReadinessOptions {
  return {
    apiUrl,
    expectedProtocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
    fetchImpl,
    now: clock.now,
    sleep: clock.sleep,
    pollIntervalMs: 10_000,
    timeoutMs: 60_000,
    ...overrides,
  };
}

function fakeClock(): {
  now: () => number;
  sleep: ReturnType<typeof vi.fn<(delayMs: number) => Promise<void>>>;
} {
  let elapsed = 0;
  return {
    now: () => elapsed,
    sleep: vi.fn(async (delayMs: number) => {
      elapsed += delayMs;
    }),
  };
}

function healthResponse(protocolVersion?: string): Response {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (protocolVersion !== undefined) headers.set(MULTIPLAYER_PROTOCOL_HEADER, protocolVersion);
  return new Response(JSON.stringify({ ok: true, service: "lastlinep2p" }), { headers });
}
