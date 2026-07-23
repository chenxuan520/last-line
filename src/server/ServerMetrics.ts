const ROOM_METRIC_WINDOW_MS = 60_000;

export interface ActiveRoomsMetricRecord {
  readonly type: "server_metric";
  readonly schemaVersion: 1;
  readonly metric: "active_rooms";
  readonly value: number;
}

export interface TickDelayMetricRecord {
  readonly type: "server_metric";
  readonly schemaVersion: 1;
  readonly metric: "tick_delay_ms";
  readonly count: number;
  readonly sum: number;
  readonly max: number;
}

export interface WebSocketBufferedBytesMetricRecord {
  readonly type: "server_metric";
  readonly schemaVersion: 1;
  readonly metric: "websocket_buffered_bytes";
  readonly count: number;
  readonly sum: number;
  readonly max: number;
  readonly unavailableCount: number;
}

export interface CheckpointDurationMetricRecord {
  readonly type: "server_metric";
  readonly schemaVersion: 1;
  readonly metric: "checkpoint_duration_ms";
  readonly count: number;
  readonly sum: number;
  readonly max: number;
}

export type ServerMetricRecord =
  | ActiveRoomsMetricRecord
  | TickDelayMetricRecord
  | WebSocketBufferedBytesMetricRecord
  | CheckpointDurationMetricRecord;

export interface ServerMetricSink {
  emit(record: ServerMetricRecord): void | Promise<void>;
}

export function safeEmitServerMetric(
  sink: ServerMetricSink | undefined,
  record: ServerMetricRecord,
): void {
  if (!sink) return;
  try {
    void Promise.resolve(sink.emit(record)).catch(() => undefined);
  } catch {
    // Metrics must never affect authoritative room behavior.
  }
}

export function createJsonLineServerMetricSink(writeLine: (line: string) => void): ServerMetricSink {
  return {
    emit(record): void {
      writeLine(JSON.stringify(record));
    },
  };
}

export const consoleServerMetricSink = createJsonLineServerMetricSink((line) => console.log(line));

interface Aggregate {
  count: number;
  sum: number;
  max: number;
}

export class RoomMetricCollector {
  private windowStartedAt: number;
  private tickDelay = emptyAggregate();
  private websocketBufferedBytes = emptyAggregate();
  private websocketBufferedBytesUnavailableCount = 0;
  private checkpointDuration = emptyAggregate();

  public constructor(
    private readonly sink: ServerMetricSink | undefined,
    private readonly now: () => number,
  ) {
    this.windowStartedAt = now();
  }

  public observeTickDelay(milliseconds: number): void {
    observe(this.tickDelay, milliseconds);
  }

  public observeWebSocketBufferedBytes(bytes: number | undefined): void {
    if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
      this.websocketBufferedBytesUnavailableCount += 1;
      return;
    }
    observe(this.websocketBufferedBytes, bytes);
  }

  public observeCheckpointDuration(milliseconds: number): void {
    observe(this.checkpointDuration, milliseconds);
  }

  public flushDue(): boolean {
    const now = this.now();
    if (now - this.windowStartedAt < ROOM_METRIC_WINDOW_MS) return false;
    this.flushAt(now);
    return true;
  }

  public flush(): void {
    this.flushAt(this.now());
  }

  private flushAt(now: number): void {
    if (this.tickDelay.count > 0) {
      safeEmitServerMetric(this.sink, {
        type: "server_metric",
        schemaVersion: 1,
        metric: "tick_delay_ms",
        ...this.tickDelay,
      });
    }
    if (this.websocketBufferedBytes.count > 0 || this.websocketBufferedBytesUnavailableCount > 0) {
      safeEmitServerMetric(this.sink, {
        type: "server_metric",
        schemaVersion: 1,
        metric: "websocket_buffered_bytes",
        ...this.websocketBufferedBytes,
        unavailableCount: this.websocketBufferedBytesUnavailableCount,
      });
    }
    if (this.checkpointDuration.count > 0) {
      safeEmitServerMetric(this.sink, {
        type: "server_metric",
        schemaVersion: 1,
        metric: "checkpoint_duration_ms",
        ...this.checkpointDuration,
      });
    }
    this.tickDelay = emptyAggregate();
    this.websocketBufferedBytes = emptyAggregate();
    this.websocketBufferedBytesUnavailableCount = 0;
    this.checkpointDuration = emptyAggregate();
    this.windowStartedAt = now;
  }
}

function emptyAggregate(): Aggregate {
  return { count: 0, sum: 0, max: 0 };
}

function observe(aggregate: Aggregate, value: number): void {
  if (!Number.isFinite(value) || value < 0) return;
  aggregate.count += 1;
  aggregate.sum += value;
  aggregate.max = Math.max(aggregate.max, value);
}
