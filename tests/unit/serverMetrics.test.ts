import { describe, expect, it } from "vitest";
import {
  RoomMetricCollector,
  safeEmitServerMetric,
  type ServerMetricRecord,
  type ServerMetricSink,
} from "../../src/server/ServerMetrics";

describe("ServerMetrics", () => {
  it("aggregates a fixed 60 second room window and resets after flushing", () => {
    let now = 1_000;
    const records: ServerMetricRecord[] = [];
    const collector = new RoomMetricCollector({ emit: (record) => { records.push(record); } }, () => now);

    collector.observeTickDelay(2);
    collector.observeTickDelay(5);
    collector.observeWebSocketBufferedBytes(12);
    collector.observeWebSocketBufferedBytes(undefined);
    collector.observeCheckpointDuration(8);
    now += 59_999;
    expect(collector.flushDue()).toBe(false);
    expect(records).toEqual([]);

    now += 1;
    expect(collector.flushDue()).toBe(true);
    expect(records).toEqual([
      { type: "server_metric", schemaVersion: 1, metric: "tick_delay_ms", count: 2, sum: 7, max: 5 },
      {
        type: "server_metric",
        schemaVersion: 1,
        metric: "websocket_buffered_bytes",
        count: 1,
        sum: 12,
        max: 12,
        unavailableCount: 1,
      },
      { type: "server_metric", schemaVersion: 1, metric: "checkpoint_duration_ms", count: 1, sum: 8, max: 8 },
    ]);

    records.length = 0;
    collector.observeTickDelay(3);
    collector.flush();
    collector.flush();
    expect(records).toEqual([
      { type: "server_metric", schemaVersion: 1, metric: "tick_delay_ms", count: 1, sum: 3, max: 3 },
    ]);
  });

  it("reports unsupported buffering as unavailable rather than a zero sample", () => {
    const records: ServerMetricRecord[] = [];
    const collector = new RoomMetricCollector({ emit: (record) => { records.push(record); } }, () => 0);

    collector.observeWebSocketBufferedBytes(undefined);
    collector.flush();

    expect(records).toEqual([{
      type: "server_metric",
      schemaVersion: 1,
      metric: "websocket_buffered_bytes",
      count: 0,
      sum: 0,
      max: 0,
      unavailableCount: 1,
    }]);
  });

  it("contains synchronous and asynchronous sink failures", async () => {
    const throwingSink: ServerMetricSink = { emit: () => { throw new Error("sink failed"); } };
    const rejectingSink: ServerMetricSink = { emit: () => Promise.reject(new Error("sink rejected")) };
    const record = { type: "server_metric", schemaVersion: 1, metric: "active_rooms", value: 1 } as const;

    expect(() => safeEmitServerMetric(throwingSink, record)).not.toThrow();
    expect(() => safeEmitServerMetric(rejectingSink, record)).not.toThrow();
    await Promise.resolve();
  });
});
