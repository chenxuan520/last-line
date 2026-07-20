import type { GameSettings } from "../config/settings";
import {
  isServerMessage,
  type ClientMessage,
  type GuestSession,
  type PublicRoomSummary,
  type RoomAdmission,
  type RoomVisibility,
  type ServerMessage,
} from "./protocol";

type MessageHandler = (message: ServerMessage) => void;
type StatusHandler = (status: "connecting" | "connected" | "reconnecting" | "closed") => void;

export class MultiplayerClient {
  private guest: GuestSession | null = null;

  public constructor(
    private readonly apiUrl: string,
    private readonly displayName: string,
    private readonly settings: GameSettings,
  ) {}

  public async createRoom(visibility: RoomVisibility): Promise<RoomAdmission> {
    const guest = await this.ensureGuest();
    return this.post<RoomAdmission>("/v1/rooms", {
      ...guest,
      visibility,
      startWithBandage: this.settings.startWithBandage,
      disableAiSnipers: this.settings.disableAiSnipers,
    });
  }

  public async quickMatch(): Promise<RoomAdmission> {
    const guest = await this.ensureGuest();
    return this.post<RoomAdmission>("/v1/matchmaking/quick", {
      ...guest,
      startWithBandage: this.settings.startWithBandage,
      disableAiSnipers: this.settings.disableAiSnipers,
    });
  }

  public async joinRoom(code: string): Promise<RoomAdmission> {
    const guest = await this.ensureGuest();
    return this.post<RoomAdmission>(`/v1/rooms/${encodeURIComponent(code.trim().toUpperCase())}/join`, guest);
  }

  public async listRooms(): Promise<PublicRoomSummary[]> {
    const response = await fetch(new URL("/v1/rooms", this.apiUrl));
    if (!response.ok) throw await responseError(response);
    const value = await response.json() as { rooms?: PublicRoomSummary[] };
    return Array.isArray(value.rooms) ? value.rooms : [];
  }

  public connect(admission: RoomAdmission): MultiplayerConnection {
    return new MultiplayerConnection(this.apiUrl, admission);
  }

  public get playerId(): string | null {
    return this.guest?.playerId ?? null;
  }

  private async ensureGuest(): Promise<GuestSession> {
    if (this.guest) return this.guest;
    this.guest = await this.post<GuestSession>("/v1/guests", { displayName: this.displayName });
    return this.guest;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(new URL(path, this.apiUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw await responseError(response);
    return response.json() as Promise<T>;
  }
}

export class MultiplayerConnection {
  private socket: WebSocket | null = null;
  private handler: MessageHandler | null = null;
  private statusHandler: StatusHandler | null = null;
  private readonly queuedMessages: ServerMessage[] = [];
  private reconnectToken: string | null = null;
  private reconnectAttempt = 0;
  private closed = false;
  private opened = false;

  public constructor(
    private readonly apiUrl: string,
    private readonly admission: RoomAdmission,
  ) {}

  public open(): Promise<void> {
    return new Promise((resolve, reject) => this.openSocket(resolve, reject));
  }

  public setMessageHandler(handler: MessageHandler | null): void {
    this.handler = handler;
    if (!handler) return;
    for (const message of this.queuedMessages.splice(0)) handler(message);
  }

  public setStatusHandler(handler: StatusHandler | null): void {
    this.statusHandler = handler;
  }

  public send(message: ClientMessage): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  public close(): void {
    this.closed = true;
    this.statusHandler?.("closed");
    this.socket?.close(1000, "client closed");
    this.socket = null;
  }

  private openSocket(resolve?: () => void, reject?: (error: Error) => void): void {
    if (this.closed) return;
    this.statusHandler?.(this.opened ? "reconnecting" : "connecting");
    const url = new URL(this.admission.socketPath, this.apiUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("playerId", this.admission.playerId);
    url.searchParams.set("token", this.reconnectToken ?? this.admission.admissionToken);
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.addEventListener("open", () => {
      this.opened = true;
      this.reconnectAttempt = 0;
      this.statusHandler?.("connected");
      resolve?.();
    }, { once: true });
    socket.addEventListener("message", (event) => this.receive(event));
    socket.addEventListener("error", () => {
      if (!this.opened) reject?.(new Error("无法连接联机服务器"));
    }, { once: true });
    socket.addEventListener("close", (event) => {
      if (this.closed || event.code === 1000) return;
      this.scheduleReconnect();
    });
  }

  private receive(event: MessageEvent): void {
    if (typeof event.data !== "string") return;
    let value: unknown;
    try {
      value = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!isServerMessage(value)) return;
    if (value.type === "welcome") {
      if (value.protocolVersion !== 1) {
        const error: ServerMessage = { type: "error", code: "protocol-mismatch", message: "联机协议版本不兼容，请刷新页面" };
        if (this.handler) this.handler(error);
        else this.queuedMessages.push(error);
        this.closed = true;
        this.socket?.close(4002, "protocol mismatch");
        return;
      }
      this.reconnectToken = value.reconnectToken;
      this.send({ type: "connection.ack" });
    }
    if (this.handler) this.handler(value);
    else {
      this.queuedMessages.push(value);
      if (this.queuedMessages.length > 200) this.queuedMessages.shift();
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    this.statusHandler?.("reconnecting");
    const delay = Math.min(5_000, 250 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    setTimeout(() => this.openSocket(), delay);
  }
}

export function getDefaultMultiplayerApiUrl(): string | null {
  const configured = import.meta.env.VITE_MULTIPLAYER_URL?.trim();
  if (configured) return normalizeApiUrl(configured);
  if (typeof location !== "undefined" && (location.hostname === "127.0.0.1" || location.hostname === "localhost")) {
    return "http://127.0.0.1:8787";
  }
  return null;
}

export function normalizeApiUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

async function responseError(response: Response): Promise<Error> {
  try {
    const value = await response.json() as { error?: string };
    return new Error(errorLabel(value.error));
  } catch {
    return new Error(`联机请求失败 (${response.status})`);
  }
}

function errorLabel(code: string | undefined): string {
  if (code === "room-not-found") return "房间不存在";
  if (code === "room-full") return "房间已满";
  if (code === "room-started") return "房间已经开局";
  if (code === "unauthorized") return "联机身份已失效";
  return code ? `联机服务错误: ${code}` : "联机请求失败";
}
