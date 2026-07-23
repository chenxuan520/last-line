import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EntityId } from "../../src/game/state/types";
import { MatchRuntime } from "../../src/server/MatchRuntime";
import type { ServerMetricRecord, ServerMetricSink } from "../../src/server/ServerMetrics";
import type { PlatformSocket } from "../../src/server/platform/DurableService";
import { createStandaloneEnvironment, type StandaloneEnvironment } from "../../standalone/StandaloneEnvironment";
import worker from "../../worker/index";

describe("standalone server metrics", () => {
  const directories: string[] = [];
  const environments: StandaloneEnvironment[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.allSettled(environments.splice(0).map((environment) => environment.close()));
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
  });

  it("emits the absolute active room gauge only on changes and after rehydration", async () => {
    const fixture = await createEnvironmentFixture();
    const firstRecords: ServerMetricRecord[] = [];
    const first = await openEnvironment(fixture.databasePath, collectInto(firstRecords));
    const guest = await createGuest(first, "Gauge Host");
    await createPrivateRoom(first, guest);
    await createGuest(first, "Gauge Observer");

    expect(activeRoomValues(firstRecords)).toEqual([0, 1]);
    await first.close();
    environments.splice(environments.indexOf(first), 1);

    const secondRecords: ServerMetricRecord[] = [];
    const second = await openEnvironment(fixture.databasePath, collectInto(secondRecords));
    await worker.fetch(new Request("https://test/v1/rooms"), second.env);
    expect(activeRoomValues(secondRecords)).toEqual([1]);
  });

  it("records a fake standalone socket's buffered bytes", async () => {
    const fixture = await createEnvironmentFixture();
    const records: ServerMetricRecord[] = [];
    const environment = await openEnvironment(fixture.databasePath, collectInto(records));
    const guest = await createGuest(environment, "Buffered Host");
    const admission = await createPrivateRoom(environment, guest);
    const socket = new FakePlatformSocket(321);
    const url = admissionUrl(admission);
    const preflight = await environment.rooms.run(admission.roomId, (room) => room.preflightWebSocket(url));
    await environment.rooms.run(
      admission.roomId,
      (room) => room.acceptPlatformWebSocket(socket, preflight),
    );
    await environment.rooms.run(admission.roomId, (room) => room.prepareForShutdown());

    expect(records).toContainEqual({
      type: "server_metric",
      schemaVersion: 1,
      metric: "websocket_buffered_bytes",
      count: 2,
      sum: 642,
      max: 321,
      unavailableCount: 0,
    });
  });

  it("waits for checkpoint persistence before recording its duration", async () => {
    let now = 100;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const fixture = await createEnvironmentFixture();
    const records: ServerMetricRecord[] = [];
    const environment = await openEnvironment(fixture.databasePath, collectInto(records));
    const guest = await createGuest(environment, "Checkpoint Host");
    const admission = await createPrivateRoom(environment, guest);
    const room = await environment.rooms.getService(admission.roomId);
    const state = await environment.rooms.getState(admission.roomId);
    const writeStarted = deferred<void>();
    const releaseWrite = deferred<void>();
    const put = state.storage.put.bind(state.storage);
    state.storage.put = async <Value>(key: string, value: Value): Promise<void> => {
      if (key === "checkpoint-v1") {
        writeStarted.resolve(undefined);
        await releaseWrite.promise;
      }
      await put(key, value);
    };
    const runtime = new MatchRuntime({
      humanActorIds: ["human-1" as EntityId],
      seed: 1,
      startWithBandage: true,
      disableAiSnipers: true,
    });
    const checkpointRoom = room as unknown as {
      captureCheckpoint(runtime: MatchRuntime): unknown;
      persistCheckpoint(pending: unknown): Promise<void>;
    };

    const pendingCheckpoint = checkpointRoom.captureCheckpoint(runtime);
    const persistence = checkpointRoom.persistCheckpoint(pendingCheckpoint);
    await writeStarted.promise;
    now = 145;
    expect(records.some((record) => record.metric === "checkpoint_duration_ms")).toBe(false);
    releaseWrite.resolve(undefined);
    await persistence;
    await room.prepareForShutdown();

    expect(records).toContainEqual({
      type: "server_metric",
      schemaVersion: 1,
      metric: "checkpoint_duration_ms",
      count: 1,
      sum: 45,
      max: 45,
    });
  });

  it("keeps room operations authoritative when an injected sink throws", async () => {
    const fixture = await createEnvironmentFixture();
    const environment = await openEnvironment(fixture.databasePath, {
      emit: () => { throw new Error("metrics unavailable"); },
    });
    const guest = await createGuest(environment, "Sink Failure Host");
    const admission = await createPrivateRoom(environment, guest);
    const socket = new FakePlatformSocket(0);
    const preflight = await environment.rooms.run(
      admission.roomId,
      (room) => room.preflightWebSocket(admissionUrl(admission)),
    );

    await expect(environment.rooms.run(
      admission.roomId,
      (room) => room.acceptPlatformWebSocket(socket, preflight),
    )).resolves.toBeUndefined();
    await expect(environment.rooms.run(
      admission.roomId,
      (room) => room.prepareForShutdown(),
    )).resolves.toBeUndefined();
    expect(socket.messages).toHaveLength(2);
  });

  async function createEnvironmentFixture(): Promise<{ databasePath: string }> {
    const directory = await mkdtemp(resolve(tmpdir(), "last-line-metrics-"));
    directories.push(directory);
    return { databasePath: resolve(directory, "metrics.sqlite") };
  }

  async function openEnvironment(databasePath: string, metricSink: ServerMetricSink): Promise<StandaloneEnvironment> {
    const environment = await createStandaloneEnvironment({ databasePath, metricSink });
    environments.push(environment);
    return environment;
  }
});

interface TestAdmission {
  roomId: string;
  playerId: string;
  admissionToken: string;
  socketPath: string;
}

async function createGuest(
  environment: StandaloneEnvironment,
  displayName: string,
): Promise<Record<string, unknown>> {
  const response = await worker.fetch(new Request("https://test/v1/guests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName }),
  }), environment.env);
  expect(response.status).toBe(201);
  return response.json() as Promise<Record<string, unknown>>;
}

async function createPrivateRoom(
  environment: StandaloneEnvironment,
  guest: Record<string, unknown>,
): Promise<TestAdmission> {
  const response = await worker.fetch(new Request("https://test/v1/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...guest, visibility: "private" }),
  }), environment.env);
  expect(response.status).toBe(201);
  return response.json() as Promise<TestAdmission>;
}

function admissionUrl(admission: TestAdmission): URL {
  const url = new URL(admission.socketPath, "https://test");
  url.searchParams.set("playerId", admission.playerId);
  url.searchParams.set("token", admission.admissionToken);
  return url;
}

function activeRoomValues(records: readonly ServerMetricRecord[]): number[] {
  return records.flatMap((record) => record.metric === "active_rooms" ? [record.value] : []);
}

function collectInto(records: ServerMetricRecord[]): ServerMetricSink {
  return { emit: (record) => { records.push(record); } };
}

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolvePromise: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((resolvePromiseValue) => { resolvePromise = resolvePromiseValue; });
  return { promise, resolve: resolvePromise };
}

class FakePlatformSocket implements PlatformSocket {
  private attachment: unknown = null;
  public readonly messages: string[] = [];

  public constructor(public readonly bufferedAmount: number) {}

  public send(message: string): void {
    this.messages.push(message);
  }

  public close(): void {}

  public serializeAttachment(attachment: unknown): void {
    this.attachment = structuredClone(attachment);
  }

  public deserializeAttachment(): unknown {
    return structuredClone(this.attachment);
  }
}
