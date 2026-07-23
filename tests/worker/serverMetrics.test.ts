import { env, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerMetricRecord } from "../../src/server/ServerMetrics";
import worker from "../../worker/index";

describe("Cloudflare server metrics", () => {
  beforeEach(async () => {
    await reset();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await reset();
  });

  it("emits active room changes and marks server-side buffering unavailable", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const guest = await post("/v1/guests", { displayName: "Metrics Host" });
    const admission = await post("/v1/rooms", { ...guest, visibility: "private" });
    expect(metricRecords(log.mock.calls).flatMap((record) =>
      record.metric === "active_rooms" ? [record.value] : []
    )).toEqual([0, 1]);

    const socketUrl = new URL(String(admission.socketPath), "https://test");
    socketUrl.searchParams.set("playerId", String(admission.playerId));
    socketUrl.searchParams.set("token", String(admission.admissionToken));
    const response = await worker.fetch(new Request(socketUrl, {
      headers: { Upgrade: "websocket", Origin: "http://localhost" },
    }), env);
    expect(response.status).toBe(101);
    response.webSocket?.accept();
    const room = env.GAME_ROOMS.getByName(String(admission.roomId));
    await runInDurableObject(room, async (instance) => {
      await (instance as unknown as { prepareForShutdown(): Promise<void> }).prepareForShutdown();
    });

    const buffered = metricRecords(log.mock.calls).find((record) =>
      record.metric === "websocket_buffered_bytes"
    );
    expect(buffered).toMatchObject({
      type: "server_metric",
      schemaVersion: 1,
      metric: "websocket_buffered_bytes",
      count: 0,
      sum: 0,
      max: 0,
    });
    expect(buffered?.metric === "websocket_buffered_bytes" && buffered.unavailableCount).toBeGreaterThanOrEqual(2);
    response.webSocket?.close(1000, "done");
  });
});

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await worker.fetch(new Request(`https://test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), env);
  expect(response.status).toBeLessThan(400);
  return response.json() as Promise<Record<string, unknown>>;
}

function metricRecords(calls: readonly unknown[][]): ServerMetricRecord[] {
  return calls.flatMap((call) => {
    if (typeof call[0] !== "string") return [];
    try {
      const value = JSON.parse(call[0]) as Partial<ServerMetricRecord>;
      return value.type === "server_metric" ? [value as ServerMetricRecord] : [];
    } catch {
      return [];
    }
  });
}
