import type { GameSettings } from "../config/settings";
import {
  isServerMessage,
  MULTIPLAYER_PROTOCOL_VERSION,
  type ClientMessage,
  type GuestSession,
  type PublicRoomSummary,
  type RoomAdmission,
  type RoomVisibility,
  type ServerMessage,
} from "./protocol";

type MessageHandler = (message: ServerMessage) => void;
type StatusHandler = (status: "connecting" | "connected" | "reconnecting" | "closed") => void;

export interface MultiplayerAccount {
  id: string;
  username: string;
  displayName: string;
  createdAt: number;
}

interface AccountAuthResponse {
  user: MultiplayerAccount;
  session: {
    tokenType: "Bearer";
    accessToken: string;
    accessExpiresAt: number;
  };
}

export class MultiplayerClient {
  private guest: GuestSession | null = null;

  public constructor(
    private readonly apiUrl: string,
    private readonly displayName: string,
    private readonly settings: GameSettings,
    private readonly accessToken: string | null | (() => Promise<string | null>) = null,
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
    const headers = new Headers({ "Content-Type": "application/json" });
    const accessToken = typeof this.accessToken === "function" ? await this.accessToken() : this.accessToken;
    if (typeof this.accessToken === "function" && !accessToken) throw new Error("账号登录已失效");
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    const response = await fetch(new URL(path, this.apiUrl), {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify(body),
    });
    if (!response.ok) throw await responseError(response);
    return response.json() as Promise<T>;
  }
}

export class MultiplayerAuthClient {
  private account: MultiplayerAccount | null = null;
  private accessToken: string | null = null;
  private accessExpiresAt = 0;
  private restorePromise: Promise<MultiplayerAccount | null> | null = null;

  public constructor(private readonly apiUrl: string) {}

  public async getConfiguration(): Promise<{ registrationLoginRequired: boolean }> {
    return this.get("/v1/auth/config");
  }

  public async restore(): Promise<MultiplayerAccount | null> {
    if (this.restorePromise) return this.restorePromise;
    this.restorePromise = this.restoreWithLock().finally(() => {
      this.restorePromise = null;
    });
    return this.restorePromise;
  }

  public async register(username: string, password: string, displayName: string): Promise<MultiplayerAccount> {
    return this.authenticate("/v1/auth/register", { username, password, displayName });
  }

  public async login(username: string, password: string): Promise<MultiplayerAccount> {
    return this.authenticate("/v1/auth/login", { username, password });
  }

  public async logout(): Promise<void> {
    const response = await this.request("/v1/auth/logout", {});
    if (!response.ok) throw await responseError(response);
    this.account = null;
    this.accessToken = null;
    this.accessExpiresAt = 0;
  }

  public get currentAccount(): MultiplayerAccount | null {
    return this.account;
  }

  public get currentAccessToken(): string | null {
    return this.accessToken;
  }

  public async ensureAccessToken(): Promise<string | null> {
    if (this.accessToken && Date.now() + 30_000 < this.accessExpiresAt) return this.accessToken;
    return await this.restore() ? this.accessToken : null;
  }

  private async authenticate(path: string, body: unknown): Promise<MultiplayerAccount> {
    const response = await this.request(path, body);
    if (!response.ok) throw await responseError(response);
    return this.applyAuth(await response.json() as AccountAuthResponse);
  }

  private applyAuth(value: AccountAuthResponse): MultiplayerAccount {
    this.account = value.user;
    this.accessToken = value.session.accessToken;
    this.accessExpiresAt = value.session.accessExpiresAt;
    return value.user;
  }

  private restoreWithLock(): Promise<MultiplayerAccount | null> {
    if (typeof navigator !== "undefined" && navigator.locks) {
      return navigator.locks.request("last-line-player-session-refresh", () => this.restoreRequest());
    }
    return this.restoreRequest();
  }

  private async restoreRequest(): Promise<MultiplayerAccount | null> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await this.request("/v1/auth/session", {});
      if (response.status === 409) {
        await delay(attempt === 0 ? 150 : 5_000);
        continue;
      }
      if (!response.ok) throw await responseError(response);
      const value = await response.json() as AccountAuthResponse | { authenticated: false };
      if ("authenticated" in value) {
        this.account = null;
        this.accessToken = null;
        this.accessExpiresAt = 0;
        return null;
      }
      return this.applyAuth(value);
    }
    return null;
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(new URL(path, this.apiUrl), { credentials: "include" });
    if (!response.ok) throw await responseError(response);
    return response.json() as Promise<T>;
  }

  private request(path: string, body: unknown): Promise<Response> {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (this.accessToken) headers.set("Authorization", `Bearer ${this.accessToken}`);
    return fetch(new URL(path, this.apiUrl), {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify(body),
    });
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class MultiplayerConnection {
  private socket: WebSocket | null = null;
  private handler: MessageHandler | null = null;
  private statusHandler: StatusHandler | null = null;
  private readonly queuedMessages: ServerMessage[] = [];
  private reconnectToken: string | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private socketListeners: AbortController | null = null;
  private closed = false;
  private opened = false;

  public constructor(
    private readonly apiUrl: string,
    private readonly admission: RoomAdmission,
    private readonly socketFactory: (url: URL) => WebSocket = (url) => new WebSocket(url),
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
    if (this.closed) return;
    const socket = this.socket;
    this.finishClosed();
    socket?.close(1000, "client closed");
  }

  private openSocket(resolve?: () => void, reject?: (error: Error) => void): void {
    if (this.closed) return;
    this.statusHandler?.(this.opened ? "reconnecting" : "connecting");
    const url = new URL(this.admission.socketPath, this.apiUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("playerId", this.admission.playerId);
    url.searchParams.set("token", this.reconnectToken ?? this.admission.admissionToken);
    this.socketListeners?.abort();
    const listeners = new AbortController();
    this.socketListeners = listeners;
    const socket = this.socketFactory(url);
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (this.socket !== socket || this.closed) return;
      this.opened = true;
      this.reconnectAttempt = 0;
      this.statusHandler?.("connected");
      resolve?.();
    }, { once: true, signal: listeners.signal });
    socket.addEventListener("message", (event) => {
      if (this.socket === socket && !this.closed) this.receive(event);
    }, { signal: listeners.signal });
    socket.addEventListener("error", () => {
      if (this.socket !== socket || this.closed) return;
      if (!this.opened) reject?.(new Error("无法连接联机服务器"));
    }, { once: true, signal: listeners.signal });
    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) return;
      if (event.code === 4010 || event.code === 4011) {
        this.finishClosed();
        return;
      }
      if (this.closed) return;
      if (event.code === 1000) {
        this.finishClosed();
        return;
      }
      this.scheduleReconnect();
    }, { signal: listeners.signal });
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
      if (value.protocolVersion !== MULTIPLAYER_PROTOCOL_VERSION) {
        const error: ServerMessage = { type: "error", code: "protocol-mismatch", message: "联机协议版本不兼容，请刷新页面" };
        if (this.handler) this.handler(error);
        else this.queuedMessages.push(error);
        const socket = this.socket;
        this.finishClosed();
        socket?.close(4002, "protocol mismatch");
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
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.statusHandler?.("reconnecting");
    const delay = Math.min(5_000, 250 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private finishClosed(): void {
    if (this.closed) return;
    this.closed = true;
    this.statusHandler?.("closed");
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socketListeners?.abort();
    this.socketListeners = null;
    this.socket = null;
    this.handler = null;
    this.statusHandler = null;
    this.queuedMessages.length = 0;
    this.reconnectToken = null;
  }
}

export function getDefaultMultiplayerApiUrl(): string | null {
  return resolveMultiplayerApiUrl(
    import.meta.env.VITE_MULTIPLAYER_ENABLED,
    import.meta.env.VITE_MULTIPLAYER_URL,
    typeof location === "undefined" ? null : location,
  );
}

export function resolveMultiplayerApiUrl(
  enabled: string | undefined,
  configuredValue: string | undefined,
  currentLocation: Pick<Location, "origin" | "hostname"> | null,
): string | null {
  if (enabled === "false") return null;
  const configured = configuredValue?.trim();
  if (configured === "same-origin") return currentLocation ? normalizeApiUrl(currentLocation.origin) : null;
  if (configured) return normalizeApiUrl(configured);
  if (currentLocation && (currentLocation.hostname === "127.0.0.1" || currentLocation.hostname === "localhost")) {
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
  if (code === "account-required") return "请先注册或登录";
  if (code === "invalid-credentials") return "账号或密码错误";
  if (code === "invalid-registration") return "账号需为 3–20 位字母、数字或下划线，密码至少 12 位";
  if (code === "registration-unavailable") return "该账号已被使用";
  if (code === "invalid-session") return "账号登录已失效";
  if (code === "auth-service-unavailable") return "账号服务暂不可用";
  if (code === "rate-limited") return "请求过于频繁，请稍后再试";
  return code ? `联机服务错误: ${code}` : "联机请求失败";
}
