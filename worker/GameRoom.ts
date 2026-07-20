import { DurableObject } from "cloudflare:workers";
import type { EntityId } from "../src/game/state/types";
import {
  MAX_HUMAN_PLAYERS,
  MIN_HUMAN_PLAYERS,
  MULTIPLAYER_PROTOCOL_VERSION,
  parseClientMessage,
  type LobbyView,
  type PublicRoomSummary,
  type RoomAdmission,
  type RoomStatus,
  type RoomVisibility,
  type ServerMessage,
} from "../src/network/protocol";
import { MatchRuntime, type MatchCheckpoint } from "../src/server/MatchRuntime";
import type { WorkerEnv } from "./env";
import type {
  RoomInitialization,
  RoomJoinRequest,
  RoomMemberRecord,
  RoomMutationResult,
  RoomOptions,
} from "./shared";

interface PersistedRoom {
  roomId: string;
  code: string;
  visibility: RoomVisibility;
  status: RoomStatus;
  revision: number;
  countdownEndsAt: number | null;
  options: RoomOptions;
  seed: number;
  expiresAt: number;
  members: Record<string, RoomMemberRecord>;
  checkpoint: MatchCheckpoint | null;
}

interface SocketAttachment {
  playerId: string;
  connectionEpoch: number;
  usedAdmission: boolean;
}

const STORAGE_KEY = "room-v1";
const TICK_MS = 1_000 / 30;
const COUNTDOWN_MS = 3_000;
const WAITING_TTL_MS = 60 * 60 * 1_000;
const WATCHDOG_MS = 15_000;

export class GameRoom extends DurableObject<WorkerEnv> {
  private data: PersistedRoom | null = null;
  private runtime: MatchRuntime | null = null;
  private loopRunning = false;
  private nextTickAt = 0;
  private lastTickAt = 0;
  private readonly visibleLootByPlayer = new Map<string, Set<EntityId>>();
  private readonly messageRates = new Map<string, { startedAt: number; count: number }>();

  public constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.data = await this.ctx.storage.get<PersistedRoom>(STORAGE_KEY) ?? null;
      if (this.data) {
        const connectedPlayerIds = new Set(this.ctx.getWebSockets().flatMap((socket) => {
          const attachment = socket.deserializeAttachment() as SocketAttachment | null;
          return attachment ? [attachment.playerId] : [];
        }));
        for (const member of Object.values(this.data.members)) member.connected = connectedPlayerIds.has(member.playerId);
        if (this.data.status === "running") this.startLoop();
      }
    });
  }

  public async alarm(): Promise<void> {
    const data = this.data;
    if (!data) return;
    if (data.status === "finished") {
      await this.ctx.storage.deleteAll();
      this.data = null;
      return;
    }
    if (data.status === "running") {
      this.startLoop(true);
      await this.ctx.storage.setAlarm(Date.now() + WATCHDOG_MS);
      return;
    }
    if (data.status === "waiting") {
      if (data.expiresAt <= Date.now()) {
        data.status = "finished";
        await this.updateDirectory();
        await this.ctx.storage.deleteAll();
        this.data = null;
      } else {
        await this.ctx.storage.setAlarm(data.expiresAt);
      }
      return;
    }
    if (data.status !== "countdown") return;
    if (!data.countdownEndsAt || data.countdownEndsAt > Date.now()) {
      if (data.countdownEndsAt) await this.ctx.storage.setAlarm(data.countdownEndsAt);
      return;
    }
    if (!this.canStart()) {
      await this.cancelCountdown();
      await this.persistAndBroadcastLobby();
      return;
    }
    await this.startMatch();
  }

  public async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/internal/initialize") return this.initialize(request);
    if (request.method === "POST" && url.pathname === "/internal/join") return this.join(request);
    if (request.headers.get("Upgrade") === "websocket") return this.connectWebSocket(url);
    return Response.json({ error: "not-found" }, { status: 404 });
  }

  public async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string" || message.length > 16_384) return;
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    const data = this.data;
    const member = attachment ? data?.members[attachment.playerId] : null;
    if (!attachment || !data || !member || attachment.connectionEpoch !== member.connectionEpoch) return;
    if (!this.allowMessage(member.playerId)) {
      this.send(socket, { type: "error", code: "rate-limited", message: "消息发送过于频繁" });
      socket.close(4008, "rate limited");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      this.send(socket, { type: "error", code: "invalid-json", message: "消息格式无效" });
      return;
    }
    const command = parseClientMessage(parsed);
    if (!command) {
      this.send(socket, { type: "error", code: "invalid-message", message: "消息内容无效" });
      return;
    }
    if (command.type === "ping") {
      this.send(socket, { type: "pong", clientTimeMs: command.clientTimeMs, serverTimeMs: Date.now() });
      return;
    }
    if (command.type === "connection.ack") {
      if (attachment.usedAdmission && !member.admissionConsumed) {
        member.admissionConsumed = true;
        this.ctx.waitUntil(this.persist());
      }
      return;
    }
    if (command.type === "match.resync") {
      this.sendFull(socket, member);
      return;
    }
    if (command.type === "match.input") {
      if (data.status === "running" && member.actorId) {
        this.ensureRuntime()?.submitInput(member.actorId, command.sequence, command.command);
      }
      return;
    }
    if (data.status !== "waiting" && data.status !== "countdown") return;
    if (command.type === "lobby.ready") {
      member.ready = member.host || command.ready;
      data.revision += 1;
      if (!this.canStart()) await this.cancelCountdown();
      await this.persistAndBroadcastLobby();
      if (data.visibility === "public" && this.canStart()) await this.startCountdown();
      return;
    }
    if (command.type === "lobby.start") {
      if (!member.host || !this.canStart()) {
        this.send(socket, { type: "error", code: "cannot-start", message: "至少需要 2 名已准备玩家" });
        return;
      }
      await this.startCountdown();
      return;
    }
    if (command.type === "lobby.leave") {
      socket.close(1000, "left lobby");
      await this.removeWaitingMember(member.playerId);
    }
  }

  public async webSocketClose(socket: WebSocket): Promise<void> {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    const member = attachment ? this.data?.members[attachment.playerId] : null;
    if (!attachment || !member || attachment.connectionEpoch !== member.connectionEpoch) return;
    member.connected = false;
    if (member.actorId) this.runtime?.setConnected(member.actorId, false);
    if (this.data?.status === "countdown" && !this.canStart()) await this.cancelCountdown();
    await this.persistAndBroadcastLobby();
  }

  public webSocketError(socket: WebSocket): void {
    socket.close(1011, "socket error");
  }

  private async initialize(request: Request): Promise<Response> {
    if (this.data) return Response.json({ error: "already-initialized" }, { status: 409 });
    const input = await request.json<RoomInitialization>();
    const member = createMember(input.host.playerId, input.host.displayName, true, input.visibility === "public");
    this.data = {
      roomId: input.roomId,
      code: input.code,
      visibility: input.visibility,
      status: "waiting",
      revision: 1,
      countdownEndsAt: null,
      options: input.options,
      seed: randomUint32(),
      expiresAt: Date.now() + WAITING_TTL_MS,
      members: { [member.playerId]: member },
      checkpoint: null,
    };
    await this.persist();
    await this.ctx.storage.setAlarm(this.data.expiresAt);
    return Response.json(this.mutationResult(member), { status: 201 });
  }

  private async join(request: Request): Promise<Response> {
    const data = this.requireData();
    if (data.status !== "waiting" && data.status !== "countdown") {
      return Response.json({ error: "room-started" }, { status: 409 });
    }
    const input = await request.json<RoomJoinRequest>();
    let member = data.members[input.guest.playerId];
    if (!member && Object.keys(data.members).length >= MAX_HUMAN_PLAYERS) {
      return Response.json({ error: "room-full" }, { status: 409 });
    }
    member ??= createMember(input.guest.playerId, input.guest.displayName, false, data.visibility === "public");
    member.displayName = input.guest.displayName;
    member.admissionToken = crypto.randomUUID();
    member.admissionExpiresAt = Date.now() + 60_000;
    member.admissionConsumed = false;
    data.expiresAt = Date.now() + WAITING_TTL_MS;
    data.members[member.playerId] = member;
    data.revision += 1;
    await this.persist();
    if (data.status === "waiting") await this.ctx.storage.setAlarm(data.expiresAt);
    await this.updateDirectory();
    return Response.json(this.mutationResult(member));
  }

  private async connectWebSocket(url: URL): Promise<Response> {
    const data = this.requireData();
    const playerId = url.searchParams.get("playerId") ?? "";
    const token = url.searchParams.get("token") ?? "";
    const member = data.members[playerId];
    const admissionValid = Boolean(
      member && token === member.admissionToken && !member.admissionConsumed && member.admissionExpiresAt >= Date.now()
    );
    if (!member || (!admissionValid && token !== member.reconnectToken)) {
      return new Response("unauthorized", { status: 401 });
    }
    for (const socket of this.ctx.getWebSockets()) {
      const existing = socket.deserializeAttachment() as SocketAttachment | null;
      if (existing?.playerId === playerId) socket.close(4001, "reconnected");
    }
    member.connected = true;
    member.connectionEpoch += 1;
    member.reconnectToken = crypto.randomUUID();
    if (member.actorId) this.ensureRuntime()?.setConnected(member.actorId, true);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const attachment: SocketAttachment = {
      playerId,
      connectionEpoch: member.connectionEpoch,
      usedAdmission: admissionValid,
    };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server);
    this.send(server, {
      type: "welcome",
      protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
      roomId: data.roomId,
      playerId,
      actorId: member.actorId,
      reconnectToken: member.reconnectToken,
      serverTimeMs: Date.now(),
    });
    if (data.status === "running" || data.status === "finished") this.sendFull(server, member);
    else this.send(server, { type: "lobby.state", lobby: this.lobbyView() });
    this.ctx.waitUntil(this.persist());
    this.ctx.waitUntil(this.updateDirectory());
    if (data.visibility === "public" && this.canStart()) await this.startCountdown();
    if (data.status === "running") this.startLoop();
    return new Response(null, { status: 101, webSocket: client });
  }

  private canStart(): boolean {
    const members = Object.values(this.data?.members ?? {}).filter((member) => member.connected);
    return members.length >= MIN_HUMAN_PLAYERS && members.length <= MAX_HUMAN_PLAYERS && members.every((member) => member.ready);
  }

  private async startCountdown(): Promise<void> {
    const data = this.requireData();
    if (data.status === "countdown") return;
    data.status = "countdown";
    data.countdownEndsAt = Date.now() + COUNTDOWN_MS;
    data.revision += 1;
    await this.ctx.storage.setAlarm(data.countdownEndsAt);
    await this.persistAndBroadcastLobby();
  }

  private async cancelCountdown(): Promise<void> {
    const data = this.data;
    if (!data || data.status !== "countdown") return;
    data.status = "waiting";
    data.countdownEndsAt = null;
    data.revision += 1;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.setAlarm(data.expiresAt);
  }

  private async startMatch(): Promise<void> {
    const data = this.requireData();
    const members = Object.values(data.members)
      .filter((member) => member.connected)
      .sort((left, right) => left.joinedAt - right.joinedAt || left.playerId.localeCompare(right.playerId));
    if (members.length < MIN_HUMAN_PLAYERS || members.length > MAX_HUMAN_PLAYERS) {
      await this.cancelCountdown();
      await this.persistAndBroadcastLobby();
      return;
    }
    members.forEach((member, index) => {
      member.actorId = `human-${index + 1}`;
    });
    for (const member of Object.values(data.members)) {
      if (!member.connected) delete data.members[member.playerId];
    }
    data.status = "running";
    data.countdownEndsAt = null;
    data.revision += 1;
    await this.ctx.storage.deleteAlarm();
    this.runtime = new MatchRuntime({
      humanActorIds: members.map((member) => member.actorId as EntityId),
      seed: data.seed,
      startWithBandage: data.options.startWithBandage,
      disableAiSnipers: data.options.disableAiSnipers,
    });
    data.checkpoint = this.runtime.checkpoint();
    await this.persist();
    await this.ctx.storage.setAlarm(Date.now() + WATCHDOG_MS);
    await this.updateDirectory();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      const member = attachment ? data.members[attachment.playerId] : null;
      if (member) this.sendFull(socket, member);
    }
    this.startLoop();
  }

  private startLoop(force = false): void {
    if (this.data?.status !== "running") return;
    if (this.loopRunning) {
      if (!force || Date.now() - this.lastTickAt < 1_000) return;
      this.loopRunning = false;
      this.runtime = null;
    }
    const restored = this.runtime === null && this.data.checkpoint !== null;
    this.ensureRuntime();
    if (restored) {
      this.visibleLootByPlayer.clear();
      for (const socket of this.ctx.getWebSockets()) {
        const attachment = socket.deserializeAttachment() as SocketAttachment | null;
        const member = attachment ? this.data.members[attachment.playerId] : null;
        if (member) this.sendFull(socket, member);
      }
    }
    this.loopRunning = true;
    this.lastTickAt = Date.now();
    this.nextTickAt = performance.now();
    this.scheduleTick();
  }

  private scheduleTick(): void {
    if (!this.loopRunning) return;
    setTimeout(() => this.tick(), Math.max(0, this.nextTickAt - performance.now()));
  }

  private tick(): void {
    const data = this.data;
    const runtime = this.runtime;
    if (!this.loopRunning || !data || data.status !== "running" || !runtime) return;
    try {
      runtime.step();
      this.lastTickAt = Date.now();
    } catch {
      this.loopRunning = false;
      this.runtime = null;
      this.ctx.waitUntil(this.ctx.storage.setAlarm(Date.now() + 1_000));
      return;
    }
    if (runtime.tick % 3 === 0) this.broadcastFrame();
    if (runtime.tick % 30 === 0) {
      data.checkpoint = runtime.checkpoint();
      this.ctx.waitUntil(this.persist());
      this.ctx.waitUntil(this.ctx.storage.setAlarm(Date.now() + WATCHDOG_MS));
    }
    if (runtime.state.phase === "finished") {
      if (runtime.tick % 3 !== 0) this.broadcastFrame();
      data.status = "finished";
      data.checkpoint = runtime.checkpoint();
      this.loopRunning = false;
      this.ctx.waitUntil(this.persist());
      this.ctx.waitUntil(this.updateDirectory());
      this.ctx.waitUntil(this.ctx.storage.setAlarm(Date.now() + 60 * 60 * 1_000));
      return;
    }
    this.nextTickAt += TICK_MS;
    if (performance.now() - this.nextTickAt > 5_000) this.nextTickAt = performance.now();
    this.scheduleTick();
  }

  private broadcastFrame(): void {
    const runtime = this.runtime;
    if (!runtime) return;
    const commonFrame = runtime.takeFrame(Date.now());
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      const member = attachment ? this.data?.members[attachment.playerId] : null;
      if (!member?.actorId) continue;
      const projection = runtime.projectFrame(
        commonFrame,
        member.actorId,
        this.visibleLootByPlayer.get(member.playerId) ?? new Set(),
      );
      this.visibleLootByPlayer.set(member.playerId, projection.visibleLootIds);
      this.send(socket, {
        type: "match.snapshot",
        ackSequence: runtime.acknowledge(member.actorId),
        frame: projection.frame,
      });
    }
  }

  private ensureRuntime(): MatchRuntime | null {
    const data = this.data;
    if (this.runtime || !data?.checkpoint) return this.runtime;
    const humanActorIds = Object.values(data.members).flatMap((member) => member.actorId ? [member.actorId] : []);
    this.runtime = new MatchRuntime({
      humanActorIds,
      seed: data.seed,
      startWithBandage: data.options.startWithBandage,
      disableAiSnipers: data.options.disableAiSnipers,
      state: data.checkpoint.state,
      tick: data.checkpoint.tick,
      snapshotSequence: data.checkpoint.snapshotSequence,
      eventSequence: data.checkpoint.eventSequence,
    });
    for (const member of Object.values(data.members)) {
      if (member.actorId && !member.connected) this.runtime.setConnected(member.actorId, false);
    }
    return this.runtime;
  }

  private sendFull(socket: WebSocket, member: RoomMemberRecord): void {
    const runtime = this.ensureRuntime();
    if (!runtime || !member.actorId) return;
    this.send(socket, {
      type: "match.full",
      snapshotSequence: this.data?.checkpoint?.snapshotSequence ?? 0,
      tick: runtime.tick,
      localActorId: member.actorId,
      state: runtime.projectState(member.actorId),
      displayNames: Object.fromEntries(Object.values(this.data?.members ?? {}).flatMap((entry) =>
        entry.actorId ? [[entry.actorId, entry.displayName]] : []
      )),
      events: [],
    });
  }

  private async removeWaitingMember(playerId: string): Promise<void> {
    const data = this.data;
    if (!data || (data.status !== "waiting" && data.status !== "countdown")) return;
    const wasHost = data.members[playerId]?.host;
    delete data.members[playerId];
    if (wasHost) {
      const nextHost = Object.values(data.members).sort((left, right) => left.joinedAt - right.joinedAt)[0];
      if (nextHost) {
        nextHost.host = true;
        nextHost.ready = true;
      }
    }
    data.revision += 1;
    await this.persistAndBroadcastLobby();
    await this.updateDirectory();
  }

  private async persistAndBroadcastLobby(): Promise<void> {
    await this.persist();
    const message: ServerMessage = { type: "lobby.state", lobby: this.lobbyView() };
    for (const socket of this.ctx.getWebSockets()) this.send(socket, message);
  }

  private lobbyView(): LobbyView {
    const data = this.requireData();
    return {
      roomId: data.roomId,
      code: data.code,
      visibility: data.visibility,
      status: data.status,
      revision: data.revision,
      countdownEndsAt: data.countdownEndsAt,
      members: Object.values(data.members)
        .sort((left, right) => left.joinedAt - right.joinedAt)
        .map((member) => ({
          playerId: member.playerId,
          displayName: member.displayName,
          ready: member.ready,
          connected: member.connected,
          host: member.host,
        })),
      minimumPlayers: MIN_HUMAN_PLAYERS,
      maximumPlayers: MAX_HUMAN_PLAYERS,
    };
  }

  private mutationResult(member: RoomMemberRecord): RoomMutationResult {
    const data = this.requireData();
    const admission: RoomAdmission = {
      roomId: data.roomId,
      code: data.code,
      playerId: member.playerId,
      admissionToken: member.admissionToken,
      socketPath: `/v1/rooms/${encodeURIComponent(data.roomId)}/socket`,
    };
    return { admission, summary: this.summary() };
  }

  private summary(): PublicRoomSummary {
    const data = this.requireData();
    const host = Object.values(data.members).find((member) => member.host);
    return {
      roomId: data.roomId,
      code: data.code,
      visibility: data.visibility,
      hostName: host?.displayName ?? "无人房间",
      playerCount: Object.keys(data.members).length,
      capacity: MAX_HUMAN_PLAYERS,
      status: data.status,
      updatedAt: Date.now(),
    };
  }

  private async updateDirectory(): Promise<void> {
    const data = this.data;
    if (!data) return;
    const stub = this.env.LOBBY.getByName("global");
    await stub.fetch(new Request(`https://lobby/internal/rooms/${encodeURIComponent(data.roomId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.summary()),
    }));
  }

  private persist(): Promise<void> {
    return this.ctx.storage.put(STORAGE_KEY, this.requireData());
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      socket.close(1011, "send failed");
    }
  }

  private requireData(): PersistedRoom {
    if (!this.data) throw new Error("room is not initialized");
    return this.data;
  }

  private allowMessage(playerId: string): boolean {
    const now = Date.now();
    const current = this.messageRates.get(playerId);
    if (!current || now - current.startedAt >= 1_000) {
      this.messageRates.set(playerId, { startedAt: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= 120;
  }
}

function createMember(playerId: string, displayName: string, host: boolean, ready: boolean): RoomMemberRecord {
  return {
    playerId,
    displayName,
    admissionToken: crypto.randomUUID(),
    admissionExpiresAt: Date.now() + 60_000,
    admissionConsumed: false,
    reconnectToken: crypto.randomUUID(),
    ready: host || ready,
    connected: false,
    host,
    joinedAt: Date.now(),
    connectionEpoch: 0,
    actorId: null,
  };
}

function randomUint32(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
}
