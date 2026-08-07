import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DurableService,
  type PlatformDurableObjectState,
} from "../../src/server/platform/DurableService";
import { MATCH_CHECKPOINT_VERSION, MatchRuntime } from "../../src/server/MatchRuntime";
import { createStandaloneEnvironment } from "../../standalone/StandaloneEnvironment";
import { LocalDurableObjectRuntime } from "../../standalone/LocalDurableObjectRuntime";
import worker from "../../worker/index";

describe("LocalDurableObjectRuntime", () => {
  it("keeps an alarm durable until its handler completes", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "last-line-alarm-"));
    const databasePath = resolve(directory, "alarm.sqlite");
    const entered = deferred<void>();
    const release = deferred<void>();
    const runtime = new LocalDurableObjectRuntime(databasePath);
    const namespace = runtime.createNamespace("test", BlockingAlarmService, () => ({ entered, release }));
    try {
      const state = await namespace.getState("object");
      await state.storage.setAlarm(Date.now());
      await entered.promise;

      const observer = new DatabaseSync(databasePath, { readOnly: true });
      const duringHandler = observer.prepare(
        "SELECT COUNT(*) AS count FROM durable_object_alarms WHERE namespace = 'test' AND object_name = 'object'",
      ).get() as { count: number };
      observer.close();
      expect(duringHandler.count).toBe(1);

      release.resolve(undefined);
      await runtime.drainTasks();
      const afterHandler = new DatabaseSync(databasePath, { readOnly: true });
      const completed = afterHandler.prepare(
        "SELECT COUNT(*) AS count FROM durable_object_alarms WHERE namespace = 'test' AND object_name = 'object'",
      ).get() as { count: number };
      afterHandler.close();
      expect(completed.count).toBe(0);
    } finally {
      release.resolve(undefined);
      await runtime.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("does not let a completed alarm invocation delete its rescheduled generation", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "last-line-alarm-generation-"));
    const databasePath = resolve(directory, "alarm.sqlite");
    const entered = deferred<void>();
    const release = deferred<void>();
    const rescheduleAt = Date.now() + 60_000;
    const runtime = new LocalDurableObjectRuntime(databasePath);
    const namespace = runtime.createNamespace("test", BlockingAlarmService, () => ({
      entered,
      release,
      rescheduleAt,
    }));
    try {
      const state = await namespace.getState("object");
      await state.storage.setAlarm(Date.now());
      await entered.promise;
      const observer = new DatabaseSync(databasePath, { readOnly: true });
      const rescheduled = observer.prepare(
        "SELECT scheduled_at, generation FROM durable_object_alarms WHERE namespace = 'test' AND object_name = 'object'",
      ).get() as { scheduled_at: number; generation: number };
      observer.close();
      expect(rescheduled).toEqual({ scheduled_at: rescheduleAt, generation: 2 });

      release.resolve(undefined);
      await runtime.drainTasks();
      const afterHandler = new DatabaseSync(databasePath, { readOnly: true });
      const preserved = afterHandler.prepare(
        "SELECT scheduled_at, generation FROM durable_object_alarms WHERE namespace = 'test' AND object_name = 'object'",
      ).get() as { scheduled_at: number; generation: number };
      afterHandler.close();
      expect(preserved).toEqual({ scheduled_at: rescheduleAt, generation: 2 });
    } finally {
      release.resolve(undefined);
      await runtime.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("schedules the initial room alarm before committing room state", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "last-line-room-initialize-"));
    const environment = await createStandaloneEnvironment({
      databasePath: resolve(directory, "initialize.sqlite"),
    });
    try {
      const roomId = "room-00000000-0000-4000-8000-000000000001";
      const state = await environment.rooms.getState(roomId);
      const calls: string[] = [];
      const put = state.storage.put.bind(state.storage);
      const setAlarm = state.storage.setAlarm.bind(state.storage);
      state.storage.put = async <Value>(key: string, value: Value): Promise<void> => {
        calls.push(`put:${key}`);
        await put(key, value);
      };
      state.storage.setAlarm = async (scheduledTime: number): Promise<void> => {
        calls.push("alarm");
        await setAlarm(scheduledTime);
      };
      const response = await environment.env.GAME_ROOMS.getByName(roomId).fetch(new Request(
        "https://room/internal/initialize",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roomId,
            code: "ABC234",
            visibility: "private",
            host: {
              playerId: "guest-initialize",
              sessionToken: "session",
              displayName: "Initializer",
              accountId: null,
              accountSessionRevision: null,
              createdAt: Date.now(),
            },
            options: { startWithBandage: true, disableAiSnipers: true },
          }),
        },
      ));
      expect(response.status).toBe(201);
      expect(calls.slice(0, 2)).toEqual(["alarm", "put:room-v1"]);
    } finally {
      await environment.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("evicts closed GameRoom instances instead of retaining completed match state", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "last-line-room-eviction-"));
    const environment = await createStandaloneEnvironment({
      databasePath: resolve(directory, "rooms.sqlite"),
    });
    try {
      for (let index = 0; index < 20; index += 1) {
        const guestResponse = await worker.fetch(new Request("https://test/v1/guests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName: `Guest ${index}` }),
        }), environment.env);
        const guest = await guestResponse.json() as Record<string, unknown>;
        const roomResponse = await worker.fetch(new Request("https://test/v1/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...guest, visibility: "private" }),
        }), environment.env);
        const admission = await roomResponse.json() as { roomId: string };
        expect(environment.rooms.instantiatedCount()).toBe(1);
        const close = await environment.env.LOBBY.getByName("global").fetch(new Request(
          `https://lobby/internal/admin/rooms/${admission.roomId}/close`,
          {
            method: "POST",
            headers: { "X-Admin-Capability": environment.env.INTERNAL_ADMIN_TOKEN ?? "" },
          },
        ));
        expect(close.ok).toBe(true);
        await Promise.resolve();
        expect(environment.rooms.instantiatedCount()).toBe(0);
      }
    } finally {
      await environment.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("releases a GameRoom after its full MatchRuntime is closed", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "last-line-runtime-eviction-"));
    const environment = await createStandaloneEnvironment({
      databasePath: resolve(directory, "runtime.sqlite"),
    });
    try {
      const firstGuest = await createGuest(environment, "Runtime Alpha");
      const secondGuest = await createGuest(environment, "Runtime Bravo");
      const firstAdmission = await quickMatch(environment, firstGuest);
      const secondAdmission = await quickMatch(environment, secondGuest);
      const firstSocket = new FakePlatformSocket();
      const secondSocket = new FakePlatformSocket();
      await acceptAdmission(environment, firstAdmission, firstSocket);
      await acceptAdmission(environment, secondAdmission, secondSocket);
      const state = await environment.rooms.getState(firstAdmission.roomId);
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const room = await state.storage.get<{ status?: string }>("room-v1");
        if (room?.status === "running") break;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
      }
      expect(await state.storage.get<{ status?: string }>("room-v1"))
        .toMatchObject({ status: "running" });

      const close = await closeRoom(environment, firstAdmission.roomId);
      expect(close.ok).toBe(true);
      state.releaseWebSocket(firstSocket);
      state.releaseWebSocket(secondSocket);
      await environment.rooms.evictIfDormant(firstAdmission.roomId);
      expect(environment.rooms.instantiatedCount()).toBe(0);
    } finally {
      await environment.close();
      await rm(directory, { force: true, recursive: true });
    }
  }, 8_000);

  it("closes waiting-room sockets and evicts the room when its TTL expires", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "last-line-waiting-expiry-"));
    const environment = await createStandaloneEnvironment({
      databasePath: resolve(directory, "waiting.sqlite"),
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const guest = await createGuest(environment, "Waiting Owner");
      const admission = await quickMatch(environment, guest);
      const socket = new FakePlatformSocket();
      await acceptAdmission(environment, admission, socket);
      const state = await environment.rooms.getState(admission.roomId);
      vi.setSystemTime(Date.now() + 60 * 60 * 1_000 + 1);
      await environment.rooms.run(admission.roomId, (room) => room.alarm());
      expect(socket.closed).toBe(true);
      expect(await state.storage.get("room-v1")).toBeUndefined();
      state.releaseWebSocket(socket);
      await environment.rooms.evictIfDormant(admission.roomId);
      expect(environment.rooms.instantiatedCount()).toBe(0);
    } finally {
      vi.useRealTimers();
      await environment.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("deletes a running room restored from the previous authoritative-map checkpoint", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "last-line-checkpoint-version-"));
    const databasePath = resolve(directory, "rooms.sqlite");
    const roomId = "room-00000000-0000-4000-8000-000000000002";
    let environment = await createStandaloneEnvironment({ databasePath });
    try {
      const state = await environment.rooms.getState(roomId);
      const runtime = new MatchRuntime({
        humanActorIds: ["human-1", "human-2"],
        seed: 42,
        mapId: "mixed",
        startWithBandage: true,
        disableAiSnipers: true,
      });
      const legacyCheckpoint = {
        ...runtime.checkpoint(),
        version: MATCH_CHECKPOINT_VERSION - 1,
      };
      await state.storage.put("room-v1", {
        roomId,
        code: "OLD234",
        visibility: "private",
        status: "running",
        revision: 1,
        countdownEndsAt: null,
        options: { mapId: "mixed", startWithBandage: true, disableAiSnipers: true },
        seed: 42,
        expiresAt: Date.now() + 60_000,
        members: persistedMatchMembers(),
        checkpoint: legacyCheckpoint,
      });
      await state.storage.put("checkpoint-v1", legacyCheckpoint);
      await state.storage.setAlarm(Date.now() + 60_000);
      await environment.close();

      environment = await createStandaloneEnvironment({ databasePath });
      const restoredState = await environment.rooms.getState(roomId);
      expect(await restoredState.storage.get("room-v1")).toBeUndefined();
      expect(await restoredState.storage.get("checkpoint-v1")).toBeUndefined();
    } finally {
      await environment.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("deletes a running room restored from a version 5 checkpoint without state", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "last-line-checkpoint-missing-state-"));
    const databasePath = resolve(directory, "rooms.sqlite");
    const roomId = "room-00000000-0000-4000-8000-000000000004";
    let environment = await createStandaloneEnvironment({ databasePath });
    try {
      const state = await environment.rooms.getState(roomId);
      const runtime = new MatchRuntime({
        humanActorIds: ["human-1", "human-2"],
        seed: 44,
        mapId: "town",
        startWithBandage: true,
        disableAiSnipers: true,
      });
      const corruptedCheckpoint = {
        ...runtime.checkpoint(),
        version: MATCH_CHECKPOINT_VERSION - 1,
        state: undefined,
      };
      await state.storage.put("room-v1", {
        roomId,
        code: "OLD236",
        visibility: "private",
        status: "running",
        revision: 1,
        countdownEndsAt: null,
        options: { mapId: "town", startWithBandage: true, disableAiSnipers: true },
        seed: 44,
        expiresAt: Date.now() + 60_000,
        members: persistedMatchMembers(),
        checkpoint: corruptedCheckpoint,
      });
      await state.storage.put("checkpoint-v1", corruptedCheckpoint);
      await state.storage.setAlarm(Date.now() + 60_000);
      await environment.close();

      environment = await createStandaloneEnvironment({ databasePath });
      const restoredState = await environment.rooms.getState(roomId);
      expect(await restoredState.storage.get("room-v1")).toBeUndefined();
      expect(await restoredState.storage.get("checkpoint-v1")).toBeUndefined();
    } finally {
      await environment.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("deletes a running room restored from a truncated actor roster", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "last-line-checkpoint-truncated-roster-"));
    const databasePath = resolve(directory, "rooms.sqlite");
    const roomId = "room-00000000-0000-4000-8000-000000000005";
    let environment = await createStandaloneEnvironment({ databasePath });
    try {
      const state = await environment.rooms.getState(roomId);
      const runtime = new MatchRuntime({
        humanActorIds: ["human-1", "human-2"],
        seed: 45,
        mapId: "town",
        startWithBandage: true,
        disableAiSnipers: true,
      });
      const checkpoint = runtime.checkpoint();
      const corruptedCheckpoint = {
        ...checkpoint,
        state: {
          ...checkpoint.state,
          actors: Object.fromEntries(Object.entries(checkpoint.state.actors).slice(0, -1)),
        },
      };
      await state.storage.put("room-v1", {
        roomId,
        code: "OLD237",
        visibility: "private",
        status: "running",
        revision: 1,
        countdownEndsAt: null,
        options: { mapId: "town", startWithBandage: true, disableAiSnipers: true },
        seed: 45,
        expiresAt: Date.now() + 60_000,
        members: persistedMatchMembers(),
        checkpoint: corruptedCheckpoint,
      });
      await state.storage.put("checkpoint-v1", corruptedCheckpoint);
      await state.storage.setAlarm(Date.now() + 60_000);
      await environment.close();

      environment = await createStandaloneEnvironment({ databasePath });
      const restoredState = await environment.rooms.getState(roomId);
      expect(await restoredState.storage.get("room-v1")).toBeUndefined();
      expect(await restoredState.storage.get("checkpoint-v1")).toBeUndefined();
    } finally {
      await environment.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("deletes running rooms restored from malformed members containers", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "last-line-checkpoint-members-shape-"));
    const databasePath = resolve(directory, "rooms.sqlite");
    let environment = await createStandaloneEnvironment({ databasePath });
    try {
      const runtime = new MatchRuntime({
        humanActorIds: ["human-1", "human-2"],
        seed: 46,
        mapId: "town",
        startWithBandage: true,
        disableAiSnipers: true,
      });
      const checkpoint = runtime.checkpoint();
      const corruptMembers = [
        undefined,
        null,
        { ...persistedMatchMembers(), corrupt: null },
      ];
      for (const [index, members] of corruptMembers.entries()) {
        const roomId = `room-00000000-0000-4000-8000-00000000010${index}`;
        const state = await environment.rooms.getState(roomId);
        const room: Record<string, unknown> = {
          roomId,
          code: `BAD10${index}`,
          visibility: "private",
          status: "running",
          revision: 1,
          countdownEndsAt: null,
          options: { mapId: "town", startWithBandage: true, disableAiSnipers: true },
          seed: 46,
          expiresAt: Date.now() + 60_000,
          checkpoint,
        };
        if (members !== undefined) room.members = members;
        await state.storage.put("room-v1", room);
        await state.storage.put("checkpoint-v1", checkpoint);
        await state.storage.setAlarm(Date.now() + 60_000);
      }
      await environment.close();

      environment = await createStandaloneEnvironment({ databasePath });
      for (let index = 0; index < corruptMembers.length; index += 1) {
        const roomId = `room-00000000-0000-4000-8000-00000000010${index}`;
        const restoredState = await environment.rooms.getState(roomId);
        expect(await restoredState.storage.get("room-v1"), `${index}:room`).toBeUndefined();
        expect(await restoredState.storage.get("checkpoint-v1"), `${index}:checkpoint`).toBeUndefined();
      }
    } finally {
      await environment.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("keeps a version 5 town checkpoint recoverable across a SQLite restart", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "last-line-checkpoint-town-v5-"));
    const databasePath = resolve(directory, "rooms.sqlite");
    const roomId = "room-00000000-0000-4000-8000-000000000003";
    let environment = await createStandaloneEnvironment({ databasePath });
    try {
      const state = await environment.rooms.getState(roomId);
      const runtime = new MatchRuntime({
        humanActorIds: ["human-1", "human-2"],
        seed: 43,
        mapId: "town",
        startWithBandage: true,
        disableAiSnipers: true,
      });
      const legacyCheckpoint = {
        ...runtime.checkpoint(),
        version: MATCH_CHECKPOINT_VERSION - 1,
      };
      await state.storage.put("room-v1", {
        roomId,
        code: "OLD235",
        visibility: "private",
        status: "running",
        revision: 1,
        countdownEndsAt: null,
        options: { mapId: "town", startWithBandage: true, disableAiSnipers: true },
        seed: 43,
        expiresAt: Date.now() + 60_000,
        members: persistedMatchMembers(),
        checkpoint: legacyCheckpoint,
      });
      await state.storage.put("checkpoint-v1", legacyCheckpoint);
      await state.storage.setAlarm(Date.now() + 60_000);
      await environment.close();

      environment = await createStandaloneEnvironment({ databasePath });
      const restoredState = await environment.rooms.getState(roomId);
      expect(await restoredState.storage.get("room-v1")).toMatchObject({
        status: "running",
        options: { mapId: "town" },
        checkpoint: { version: MATCH_CHECKPOINT_VERSION - 1, state: { mapId: "town" } },
      });
      expect(await restoredState.storage.get("checkpoint-v1")).toMatchObject({
        version: MATCH_CHECKPOINT_VERSION - 1,
        state: { mapId: "town" },
      });
    } finally {
      await environment.close();
      await rm(directory, { force: true, recursive: true });
    }
  });
});

interface AlarmEnvironment {
  entered: Deferred<void>;
  release: Deferred<void>;
  rescheduleAt?: number;
}

class BlockingAlarmService extends DurableService<AlarmEnvironment> {
  public constructor(state: PlatformDurableObjectState, environment: AlarmEnvironment) {
    super(state, environment);
  }

  public async fetch(): Promise<Response> {
    return new Response(null, { status: 204 });
  }

  public async alarm(): Promise<void> {
    this.env.entered.resolve(undefined);
    if (this.env.rescheduleAt !== undefined) await this.ctx.storage.setAlarm(this.env.rescheduleAt);
    await this.env.release.promise;
  }
}

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolvePromise: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

type TestEnvironment = Awaited<ReturnType<typeof createStandaloneEnvironment>>;

function persistedMatchMembers(): Record<string, Record<string, unknown>> {
  return Object.fromEntries(["human-1", "human-2"].map((actorId, index) => {
    const playerId = `player-${index + 1}`;
    return [playerId, {
      playerId,
      displayName: `Player ${index + 1}`,
      accountId: null,
      accountSessionRevision: null,
      admissionToken: `admission-${index + 1}`,
      admissionExpiresAt: Date.now() + 60_000,
      admissionConsumed: true,
      reconnectToken: `reconnect-${index + 1}`,
      pendingReconnectToken: null,
      ready: true,
      connected: false,
      host: index === 0,
      joinedAt: Date.now() + index,
      connectionEpoch: 1,
      actorId,
    }];
  }));
}

async function createGuest(
  environment: TestEnvironment,
  displayName: string,
): Promise<Record<string, unknown>> {
  const response = await worker.fetch(new Request("https://test/v1/guests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName }),
  }), environment.env);
  return response.json() as Promise<Record<string, unknown>>;
}

async function quickMatch(
  environment: TestEnvironment,
  guest: Record<string, unknown>,
): Promise<{ roomId: string; playerId: string; admissionToken: string; socketPath: string }> {
  const response = await worker.fetch(new Request("https://test/v1/matchmaking/quick", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(guest),
  }), environment.env);
  return response.json() as Promise<{
    roomId: string;
    playerId: string;
    admissionToken: string;
    socketPath: string;
  }>;
}

async function acceptAdmission(
  environment: TestEnvironment,
  admission: { roomId: string; playerId: string; admissionToken: string; socketPath: string },
  socket: FakePlatformSocket,
): Promise<void> {
  const url = new URL(admission.socketPath, "https://test");
  url.searchParams.set("playerId", admission.playerId);
  url.searchParams.set("token", admission.admissionToken);
  const preflight = await environment.rooms.run(
    admission.roomId,
    (room) => room.preflightWebSocket(url),
  );
  await environment.rooms.run(
    admission.roomId,
    (room) => room.acceptPlatformWebSocket(socket, preflight),
  );
}

async function closeRoom(environment: TestEnvironment, roomId: string): Promise<Response> {
  return environment.env.LOBBY.getByName("global").fetch(new Request(
    `https://lobby/internal/admin/rooms/${roomId}/close`,
    {
      method: "POST",
      headers: { "X-Admin-Capability": environment.env.INTERNAL_ADMIN_TOKEN ?? "" },
    },
  ));
}

class FakePlatformSocket {
  private attachment: unknown = null;
  public readonly messages: string[] = [];
  public closed = false;

  public send(message: string): void {
    this.messages.push(message);
  }

  public close(): void {
    this.closed = true;
  }

  public serializeAttachment(attachment: unknown): void {
    this.attachment = structuredClone(attachment);
  }

  public deserializeAttachment(): unknown {
    return structuredClone(this.attachment);
  }
}
