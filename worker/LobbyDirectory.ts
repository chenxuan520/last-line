import {
  MAX_HUMAN_PLAYERS,
  type GuestSession,
  type PublicRoomSummary,
  type RoomVisibility,
} from "../src/network/protocol";
import {
  consoleServerMetricSink,
  safeEmitServerMetric,
  type ServerMetricSink,
} from "../src/server/ServerMetrics";
import { DurableService, type PlatformDurableObjectState } from "../src/server/platform/DurableService";
import type { WorkerEnv } from "./env";
import type {
  GuestRecord,
  RoomInitialization,
  RoomMutationResult,
  RoomOptions,
} from "./shared";

interface LobbyData {
  guests: Record<string, GuestRecord>;
  rooms: Record<string, PublicRoomSummary>;
}

const STORAGE_KEY = "lobby-data-v1";
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const GUEST_TTL_MS = 24 * 60 * 60 * 1_000;
const ROOM_TTL_MS = 60 * 60 * 1_000;
const MAX_GUEST_RECORDS = 5_000;
const MAX_ROOM_RECORDS = 1_000;

export class LobbyDirectory extends DurableService<WorkerEnv> {
  private data: LobbyData = { guests: {}, rooms: {} };
  private readonly rateLimits = new Map<string, { startedAt: number; count: number }>();
  private readonly metricSink: ServerMetricSink;
  private lastActiveRoomCount: number | null = null;

  public constructor(ctx: PlatformDurableObjectState, env: WorkerEnv) {
    super(ctx, env);
    this.metricSink = ctx.metricSink ?? consoleServerMetricSink;
    this.ctx.blockConcurrencyWhile(async () => {
      this.data = await this.ctx.storage.get<LobbyData>(STORAGE_KEY) ?? this.data;
      if (this.removeExpiredRecords()) await this.persist();
      else this.emitActiveRoomCount();
    });
  }

  public async fetch(request: Request): Promise<Response> {
    if (this.removeExpiredRecords()) await this.persist();
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/internal/admin/rooms") {
      return this.adminCapabilityAllowed(request) ? this.listAdminRooms() : json({ error: "forbidden" }, 403);
    }
    const closeMatch = /^\/internal\/admin\/rooms\/(room-[a-f0-9-]+)\/close$/.exec(url.pathname);
    if (request.method === "POST" && closeMatch?.[1]) {
      return this.adminCapabilityAllowed(request)
        ? this.closeRoom(closeMatch[1])
        : json({ error: "forbidden" }, 403);
    }
    if (url.pathname.startsWith("/v1/") && !this.allowRequest(request)) {
      return json({ error: "rate-limited" }, 429);
    }
    if (request.method === "POST" && url.pathname === "/v1/guests") return this.createGuest(request);
    if (request.method === "GET" && url.pathname === "/v1/rooms") return this.listRooms();
    if (request.method === "POST" && url.pathname === "/v1/rooms") return this.createRoom(request);
    if (request.method === "POST" && url.pathname === "/v1/matchmaking/quick") return this.quickMatch(request);
    const joinMatch = /^\/v1\/rooms\/([A-Z0-9]+)\/join$/.exec(url.pathname);
    if (request.method === "POST" && joinMatch?.[1]) return this.joinRoom(joinMatch[1], request);
    const updateMatch = /^\/internal\/rooms\/(.+)$/.exec(url.pathname);
    if (request.method === "PUT" && updateMatch?.[1]) return this.updateRoom(decodeURIComponent(updateMatch[1]), request);
    return json({ error: "not-found" }, 404);
  }

  private async createGuest(request: Request): Promise<Response> {
    if (Object.keys(this.data.guests).length >= MAX_GUEST_RECORDS) return json({ error: "lobby-capacity" }, 503);
    const body = await readJson(request);
    const displayName = sanitizeDisplayName(body?.displayName);
    if (!displayName) return json({ error: "invalid-display-name" }, 400);
    const trustedAccount = this.adminCapabilityAllowed(request)
      && typeof body?.accountId === "string"
      && /^account-[a-f0-9-]+$/.test(body.accountId)
      && typeof body.accountSessionRevision === "number"
      && Number.isSafeInteger(body.accountSessionRevision)
      && body.accountSessionRevision >= 0;
    const playerId = `guest-${crypto.randomUUID()}`;
    const record: GuestRecord = {
      playerId,
      sessionToken: crypto.randomUUID(),
      displayName,
      accountId: trustedAccount ? body.accountId as string : null,
      accountSessionRevision: trustedAccount ? body.accountSessionRevision as number : null,
      createdAt: Date.now(),
    };
    this.data.guests[playerId] = record;
    await this.persist();
    const response: GuestSession = {
      playerId,
      sessionToken: record.sessionToken,
      displayName,
    };
    return json(response, 201);
  }

  private listRooms(): Response {
    const rooms = Object.values(this.data.rooms)
      .filter((room) => room.visibility === "public" && room.status === "waiting" && room.playerCount < room.capacity)
      .sort((left, right) => left.code.localeCompare(right.code));
    return json({ rooms });
  }

  private listAdminRooms(): Response {
    const rooms = Object.values(this.data.rooms)
      .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0) || left.roomId.localeCompare(right.roomId));
    return json({ rooms });
  }

  private async closeRoom(roomId: string): Promise<Response> {
    const summary = this.data.rooms[roomId];
    if (!summary) return json({ error: "room-not-found" }, 404);
    const response = await this.env.GAME_ROOMS.getByName(roomId).fetch(new Request(
      "https://room/internal/admin/close",
      { method: "POST", headers: this.adminCapabilityHeaders() },
    ));
    if (!response.ok && response.status !== 404 && response.status !== 410) return response;
    delete this.data.rooms[roomId];
    await this.persist();
    return json({ ok: true, roomId, previousStatus: summary.status });
  }

  private async createRoom(request: Request): Promise<Response> {
    if (Object.keys(this.data.rooms).length >= MAX_ROOM_RECORDS) return json({ error: "lobby-capacity" }, 503);
    const body = await readJson(request);
    const guest = await this.authenticate(body);
    if (!guest) return json({ error: "unauthorized" }, 401);
    const visibility = body?.visibility === "private" ? "private" : body?.visibility === "public" ? "public" : null;
    if (!visibility) return json({ error: "invalid-visibility" }, 400);
    const options = roomOptions(body);
    return this.createAndJoinRoom(guest, visibility, options);
  }

  private async quickMatch(request: Request): Promise<Response> {
    const body = await readJson(request);
    const guest = await this.authenticate(body);
    if (!guest) return json({ error: "unauthorized" }, 401);
    const available = Object.values(this.data.rooms)
      .filter((room) =>
        room.visibility === "public" && room.status === "waiting" && room.playerCount < MAX_HUMAN_PLAYERS
      )
      .sort((left, right) => right.playerCount - left.playerCount || left.code.localeCompare(right.code))[0];
    if (available) {
      const response = await this.joinExistingRoom(available.code, guest);
      if (response.status < 400) return response;
      delete this.data.rooms[available.roomId];
    }
    if (Object.keys(this.data.rooms).length >= MAX_ROOM_RECORDS) return json({ error: "lobby-capacity" }, 503);
    return this.createAndJoinRoom(guest, "public", roomOptions(body));
  }

  private async joinRoom(code: string, request: Request): Promise<Response> {
    const body = await readJson(request);
    const guest = await this.authenticate(body);
    if (!guest) return json({ error: "unauthorized" }, 401);
    return this.joinExistingRoom(code, guest);
  }

  private async joinExistingRoom(code: string, guest: GuestRecord): Promise<Response> {
    const summary = Object.values(this.data.rooms).find((room) => room.code === code);
    if (!summary) return json({ error: "room-not-found" }, 404);
    const stub = this.env.GAME_ROOMS.getByName(summary.roomId);
    const response = await stub.fetch(new Request("https://room/internal/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guest }),
    }));
    if (!response.ok) return response;
    const result = await response.json<RoomMutationResult>();
    this.data.rooms[summary.roomId] = result.summary;
    await this.persist();
    return json(result.admission, 200);
  }

  private async createAndJoinRoom(
    guest: GuestRecord,
    visibility: RoomVisibility,
    options: RoomOptions,
  ): Promise<Response> {
    const roomId = `room-${crypto.randomUUID()}`;
    const code = this.createRoomCode();
    const initialization: RoomInitialization = { roomId, code, visibility, host: guest, options };
    const stub = this.env.GAME_ROOMS.getByName(roomId);
    const response = await stub.fetch(new Request("https://room/internal/initialize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(initialization),
    }));
    if (!response.ok) return response;
    const result = await response.json<RoomMutationResult>();
    this.data.rooms[roomId] = result.summary;
    await this.persist();
    return json(result.admission, 201);
  }

  private async updateRoom(roomId: string, request: Request): Promise<Response> {
    const summary = await request.json<PublicRoomSummary>();
    if (summary.roomId !== roomId) return json({ error: "room-mismatch" }, 400);
    if (summary.status === "finished") delete this.data.rooms[roomId];
    else this.data.rooms[roomId] = summary;
    await this.persist();
    return json({ ok: true });
  }

  private async authenticate(body: Record<string, unknown> | null): Promise<GuestRecord | null> {
    const playerId = typeof body?.playerId === "string" ? body.playerId : "";
    const sessionToken = typeof body?.sessionToken === "string" ? body.sessionToken : "";
    const guest = this.data.guests[playerId];
    if (!guest || guest.sessionToken !== sessionToken) return null;
    if (!guest.accountId) return guest;
    const headers = this.adminCapabilityHeaders();
    const response = await this.env.ACCOUNTS.getByName("global").fetch(new Request(
      `https://accounts/internal/account-status/${encodeURIComponent(guest.accountId)}`,
      { headers },
    ));
    if (!response.ok) return null;
    const status = await response.json<{
      enabled?: unknown;
      sessionRevision?: unknown;
    }>();
    return status.enabled === true && status.sessionRevision === guest.accountSessionRevision ? guest : null;
  }

  private adminCapabilityAllowed(request: Request): boolean {
    const expected = this.env.INTERNAL_ADMIN_TOKEN;
    return Boolean(expected && request.headers.get("X-Admin-Capability") === expected);
  }

  private adminCapabilityHeaders(): Headers {
    const headers = new Headers();
    if (this.env.INTERNAL_ADMIN_TOKEN) headers.set("X-Admin-Capability", this.env.INTERNAL_ADMIN_TOKEN);
    return headers;
  }

  private createRoomCode(): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const bytes = crypto.getRandomValues(new Uint8Array(6));
      const code = [...bytes].map((value) => ROOM_CODE_ALPHABET[value % ROOM_CODE_ALPHABET.length]).join("");
      if (!Object.values(this.data.rooms).some((room) => room.code === code)) return code;
    }
    throw new Error("room code allocation failed");
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put(STORAGE_KEY, this.data);
    this.emitActiveRoomCount();
  }

  private emitActiveRoomCount(): void {
    const now = Date.now();
    const activeRoomCount = Object.values(this.data.rooms).filter((room) =>
      room.status !== "finished" && now - (room.updatedAt ?? 0) <= ROOM_TTL_MS
    ).length;
    if (activeRoomCount === this.lastActiveRoomCount) return;
    this.lastActiveRoomCount = activeRoomCount;
    safeEmitServerMetric(this.metricSink, {
      type: "server_metric",
      schemaVersion: 1,
      metric: "active_rooms",
      value: activeRoomCount,
    });
  }

  private removeExpiredRecords(): boolean {
    const now = Date.now();
    let changed = false;
    for (const [playerId, guest] of Object.entries(this.data.guests)) {
      if (now - guest.createdAt > GUEST_TTL_MS) {
        delete this.data.guests[playerId];
        changed = true;
      }
    }
    for (const [roomId, room] of Object.entries(this.data.rooms)) {
      if (room.status === "finished" || now - (room.updatedAt ?? 0) > ROOM_TTL_MS) {
        delete this.data.rooms[roomId];
        changed = true;
      }
    }
    return changed;
  }

  private allowRequest(request: Request): boolean {
    const now = Date.now();
    const key = request.headers.get("CF-Connecting-IP") ?? "local";
    const current = this.rateLimits.get(key);
    if (!current || now - current.startedAt >= 60_000) {
      this.rateLimits.set(key, { startedAt: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= 60;
  }
}

function roomOptions(body: Record<string, unknown> | null): RoomOptions {
  return {
    startWithBandage: body?.startWithBandage !== false,
    disableAiSnipers: body?.disableAiSnipers !== false,
  };
}

function sanitizeDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length >= 1 && normalized.length <= 20 ? normalized : null;
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}
