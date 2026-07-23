import {
  env,
  evictDurableObject,
  reset,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import worker from "../../worker/index";

describe("multiplayer worker", () => {
  afterEach(async () => {
    await reset();
  });

  it("reports a healthy realtime service", async () => {
    const response = await worker.fetch(new Request("https://test/health"), env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, service: "lastlinep2p" });
    expect((await worker.fetch(new Request("https://test/metrics"), env)).status).toBe(404);
  });

  it("keeps private rooms out of the public lobby", async () => {
    const guest = await createGuest("Private Host");
    const admission = await post("/v1/rooms", { ...guest, visibility: "private" });
    const rooms = await getRooms();

    expect(admission.code).toHaveLength(6);
    expect(rooms).toHaveLength(0);
  });

  it("quick-matches two guests into the same public room", async () => {
    const first = await createGuest("Alpha");
    const second = await createGuest("Bravo");
    const firstAdmission = await post("/v1/matchmaking/quick", first);
    const secondAdmission = await post("/v1/matchmaking/quick", second);
    const rooms = await getRooms();

    expect(secondAdmission.roomId).toBe(firstAdmission.roomId);
    expect(rooms).toHaveLength(1);
    expect(rooms[0]).toMatchObject({
      roomId: firstAdmission.roomId,
      visibility: "public",
      playerCount: 2,
      capacity: 10,
    });
  });

  it("consumes an admission token after its first WebSocket upgrade", async () => {
    const guest = await createGuest("Token Owner");
    const admission = await post("/v1/rooms", { ...guest, visibility: "private" });
    const socketUrl = new URL(String(admission.socketPath), "https://test");
    socketUrl.searchParams.set("playerId", String(admission.playerId));
    socketUrl.searchParams.set("token", String(admission.admissionToken));
    const request = (): Request => new Request(socketUrl, {
      headers: { Upgrade: "websocket", Origin: "http://localhost" },
    });

    const first = await worker.fetch(request(), env);
    expect(first.status).toBe(101);
    const socket = first.webSocket;
    if (!socket) throw new Error("WebSocket missing");
    const welcome = new Promise<void>((resolve) => {
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data)) as { type?: string };
        if (message.type === "welcome") resolve();
      });
    });
    socket.accept();
    await welcome;
    socket.send(JSON.stringify({ type: "connection.ack" }));
    await waitForAdmissionConsumption(String(admission.roomId), String(admission.playerId));
    const replay = await worker.fetch(request(), env);
    expect(replay.status).toBe(401);
    socket.close(1000, "done");
  });

  it("keeps the previous reconnect token valid until the replacement welcome is acknowledged", async () => {
    const guest = await createGuest("Reconnect Owner");
    const admission = await post("/v1/rooms", { ...guest, visibility: "private" });
    const first = await connectWithToken(admission, String(admission.admissionToken));
    first.socket.send(JSON.stringify({ type: "connection.ack" }));
    await waitForAdmissionConsumption(String(admission.roomId), String(admission.playerId));

    const second = await connectWithToken(admission, first.reconnectToken);
    second.socket.close(1000, "welcome not acknowledged");
    const recoveredOld = await connectWithToken(admission, first.reconnectToken);
    recoveredOld.socket.close(1000, "replacement welcome not acknowledged");
    const recoveredPending = await connectWithToken(admission, recoveredOld.reconnectToken);
    recoveredPending.socket.close(1000, "pending token presented but next welcome lost");
    const recoveredAgain = await connectWithToken(admission, recoveredOld.reconnectToken);
    expect(recoveredAgain.reconnectToken).not.toBe(recoveredOld.reconnectToken);

    first.socket.close(1000, "done");
    recoveredAgain.socket.close(1000, "done");
  });

  it("recovers a public countdown through a Durable Object eviction and alarm", async () => {
    const firstGuest = await createGuest("Alarm Alpha");
    const secondGuest = await createGuest("Alarm Bravo");
    const firstAdmission = await post("/v1/matchmaking/quick", firstGuest);
    const secondAdmission = await post("/v1/matchmaking/quick", secondGuest);
    const firstSocket = await connectAdmission(firstAdmission);
    const secondSocket = await connectAdmission(secondAdmission);
    const roomId = String(firstAdmission.roomId);
    const stub = env.GAME_ROOMS.getByName(roomId);

    await runInDurableObject(stub, async (_instance, state) => {
      const room = await state.storage.get<Record<string, unknown>>("room-v1");
      if (!room) throw new Error("room state missing");
      room.countdownEndsAt = Date.now() - 1;
      await state.storage.put("room-v1", room);
      await state.storage.setAlarm(Date.now() - 1);
    });
    await evictDurableObject(stub);
    await runDurableObjectAlarm(stub);
    const status = await runInDurableObject(stub, async (_instance, state) => {
      const room = await state.storage.get<{ status?: string }>("room-v1");
      return room?.status;
    });

    expect(status).toBe("running");
    firstSocket.close(1000, "done");
    secondSocket.close(1000, "done");
  });
});

async function createGuest(displayName: string): Promise<Record<string, unknown>> {
  return post("/v1/guests", { displayName });
}

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await worker.fetch(new Request(`https://test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), env);
  expect(response.status).toBeLessThan(400);
  return response.json() as Promise<Record<string, unknown>>;
}

async function getRooms(): Promise<Array<Record<string, unknown>>> {
  const response = await worker.fetch(new Request("https://test/v1/rooms"), env);
  const value = await response.json() as { rooms: Array<Record<string, unknown>> };
  return value.rooms;
}

async function connectAdmission(admission: Record<string, unknown>): Promise<WebSocket> {
  const socketUrl = new URL(String(admission.socketPath), "https://test");
  socketUrl.searchParams.set("playerId", String(admission.playerId));
  socketUrl.searchParams.set("token", String(admission.admissionToken));
  const response = await worker.fetch(new Request(socketUrl, {
    headers: { Upgrade: "websocket", Origin: "http://localhost" },
  }), env);
  if (!response.webSocket) throw new Error(`WebSocket upgrade failed: ${response.status}`);
  response.webSocket.accept();
  return response.webSocket;
}

async function connectWithToken(
  admission: Record<string, unknown>,
  token: string,
): Promise<{ socket: WebSocket; reconnectToken: string }> {
  const socketUrl = new URL(String(admission.socketPath), "https://test");
  socketUrl.searchParams.set("playerId", String(admission.playerId));
  socketUrl.searchParams.set("token", token);
  const response = await worker.fetch(new Request(socketUrl, {
    headers: { Upgrade: "websocket", Origin: "http://localhost" },
  }), env);
  if (!response.webSocket) throw new Error(`WebSocket upgrade failed: ${response.status}`);
  const socket = response.webSocket;
  const welcome = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("welcome timed out")), 1_000);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as { type?: string; reconnectToken?: string };
      if (message.type !== "welcome" || !message.reconnectToken) return;
      clearTimeout(timer);
      resolve(message.reconnectToken);
    });
  });
  socket.accept();
  return { socket, reconnectToken: await welcome };
}

async function waitForAdmissionConsumption(roomId: string, playerId: string): Promise<void> {
  const stub = env.GAME_ROOMS.getByName(roomId);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const consumed = await runInDurableObject(stub, async (_instance, state) => {
      const room = await state.storage.get<{
        members?: Record<string, { admissionConsumed?: boolean }>;
      }>("room-v1");
      return room?.members?.[playerId]?.admissionConsumed === true;
    });
    if (consumed) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Admission acknowledgement was not persisted");
}
