import { createReadStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, relative, resolve, sep } from "node:path";
import type { Duplex } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { PlatformSocket } from "../src/server/platform/DurableService";
import worker, { isOriginAllowed } from "../worker/index";
import { createStandaloneEnvironment, type StandaloneEnvironment } from "./StandaloneEnvironment";
import type { StandaloneServerConfig } from "./config";

const MAX_REQUEST_BYTES = 16_384;
const ROOM_SOCKET_PATH = /^\/v1\/rooms\/(room-[a-f0-9-]+)\/socket$/;
const NETWORK_SHUTDOWN_TIMEOUT_MS = 2_000;

export interface StandaloneServerHandle {
  readonly origin: string;
  readonly config: StandaloneServerConfig;
  close(): Promise<void>;
}

export interface StandaloneServerHooks {
  beforeWebSocketAccept?(): Promise<void>;
}

export async function startStandaloneServer(
  config: StandaloneServerConfig,
  hooks: StandaloneServerHooks = {},
): Promise<StandaloneServerHandle> {
  await mkdir(config.dataDirectory, { recursive: true });
  await assertStaticBuild(config.staticDirectory);
  const releaseLock = await acquireProcessLock(config.dataDirectory);
  let environment: StandaloneEnvironment | null = null;
  let server: Server | null = null;
  let webSocketServer: WebSocketServer | null = null;
  try {
    environment = await createStandaloneEnvironment({
      databasePath: config.databasePath,
      allowedOrigins: config.allowedOrigins,
      adminBootstrapToken: config.adminBootstrapToken,
      adminResetToken: config.adminResetToken,
      turnstileSiteKey: config.turnstileSiteKey,
      turnstileSecretKey: config.turnstileSecretKey,
    });
    const activeEnvironment = environment;
    webSocketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_REQUEST_BYTES, perMessageDeflate: false });
    const activeWebSocketServer = webSocketServer;
    server = createServer((request, response) => {
      void handleHttpRequest(request, response, config, activeEnvironment).catch((error: unknown) => {
        console.error("Standalone HTTP request failed", error);
        if (!response.headersSent) response.writeHead(500, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "server-error" }));
      });
    });
    server.on("upgrade", (request, socket, head) => {
      void handleWebSocketUpgrade(
        request,
        socket,
        head,
        config,
        activeEnvironment,
        activeWebSocketServer,
        hooks,
      ).catch((error: unknown) => {
        console.error("Standalone WebSocket upgrade failed", error);
        writeUpgradeError(socket, 500, "Internal Server Error");
      });
    });
    await listen(server, config.host, config.port);
    const activeServer = server;
    const address = activeServer.address() as AddressInfo;
    const origin = config.port === 0
      ? `${new URL(config.publicOrigin).protocol}//${config.host === "0.0.0.0" ? "127.0.0.1" : config.host}:${address.port}`
      : config.publicOrigin;
    let closing: Promise<void> | null = null;
    return {
      origin,
      config,
      close: () => {
        closing ??= closeServer(activeServer, activeWebSocketServer, activeEnvironment, releaseLock);
        return closing;
      },
    };
  } catch (error) {
    try {
      for (const socket of webSocketServer?.clients ?? []) socket.terminate();
      webSocketServer?.close();
      if (server?.listening) await closeHttpServer(server);
    } catch (cleanupError) {
      console.error("Standalone listener cleanup failed", cleanupError);
    }
    try {
      if (environment) await environment.close();
    } catch (cleanupError) {
      console.error("Standalone environment cleanup failed", cleanupError);
    }
    try {
      await releaseLock();
    } catch (cleanupError) {
      console.error("Standalone process lock cleanup failed", cleanupError);
    }
    throw error;
  }
}

async function handleHttpRequest(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  config: StandaloneServerConfig,
  environment: StandaloneEnvironment,
): Promise<void> {
  let request: Request;
  try {
    request = await webRequest(incoming, config);
  } catch (error) {
    if (error instanceof InvalidRequestTargetError) {
      outgoing.writeHead(400, { "Content-Type": "application/json" });
      outgoing.end(JSON.stringify({ error: "invalid-request-target" }));
      return;
    }
    if (error instanceof RequestTooLargeError) {
      outgoing.writeHead(413, { "Content-Type": "application/json" });
      outgoing.end(JSON.stringify({ error: "request-too-large" }));
      return;
    }
    throw error;
  }
  const pathname = new URL(request.url).pathname;
  if (pathname === "/health" || pathname === "/admin" || pathname === "/admin/" || pathname.startsWith("/v1/")) {
    await writeWebResponse(outgoing, await worker.fetch(request, environment.env), incoming.method === "HEAD");
    return;
  }
  await serveStaticFile(incoming, outgoing, pathname, config.staticDirectory);
}

async function handleWebSocketUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  config: StandaloneServerConfig,
  environment: StandaloneEnvironment,
  webSocketServer: WebSocketServer,
  hooks: StandaloneServerHooks,
): Promise<void> {
  let url: URL;
  try {
    url = publicRequestUrl(request.url, config.publicOrigin);
  } catch (error) {
    if (error instanceof InvalidRequestTargetError) {
      writeUpgradeError(socket, 400, "Bad Request");
      return;
    }
    throw error;
  }
  const match = ROOM_SOCKET_PATH.exec(url.pathname);
  if (!match?.[1] || request.headers.upgrade?.toLowerCase() !== "websocket") {
    writeUpgradeError(socket, 404, "Not Found");
    return;
  }
  const origin = singleHeader(request.headers.origin);
  if (!isOriginAllowed(origin, environment.env)) {
    writeUpgradeError(socket, 403, "Forbidden");
    return;
  }
  const roomId = match[1];
  const preflight = await environment.rooms.run(roomId, (room) => room.preflightWebSocket(url));
  if (preflight.kind === "http-error") {
    writeUpgradeError(socket, preflight.response.status, await preflight.response.text());
    return;
  }
  const state = await environment.rooms.getState(roomId);
  webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
    const platformSocket = new NodeRoomSocket(webSocket);
    let acceptanceComplete = false;
    let closed = false;
    let closeQueued = false;
    const pendingMessages: string[] = [];
    let messageQueue = Promise.resolve();
    const dispatch = (message: string): void => {
      messageQueue = messageQueue
        .then(() => environment.rooms.run(
          roomId,
          (room) => room.webSocketMessage(platformSocket, message),
        ))
        .catch((error: unknown) => console.error("Standalone WebSocket message failed", error));
    };
    webSocket.on("message", (data, binary) => {
      if (binary || closed) return;
      const message = rawDataText(data);
      if (acceptanceComplete) dispatch(message);
      else pendingMessages.push(message);
    });
    const queueClose = (): void => {
      if (closeQueued) return;
      closeQueued = true;
      state.releaseWebSocket(platformSocket);
      messageQueue = messageQueue
        .then(() => environment.rooms.run(roomId, (room) => room.webSocketClose(platformSocket)))
        .catch((error: unknown) => console.error("Standalone WebSocket close failed", error));
      environment.runtime.trackTask(messageQueue);
    };
    webSocket.on("close", () => {
      closed = true;
      pendingMessages.length = 0;
      state.releaseWebSocket(platformSocket);
      if (acceptanceComplete) queueClose();
    });
    webSocket.on("error", () => {
      void environment.rooms.run(roomId, async (room) => room.webSocketError(platformSocket));
    });
    const acceptance = (async () => {
      await hooks.beforeWebSocketAccept?.();
      await environment.rooms.run(
        roomId,
        (room) => room.acceptPlatformWebSocket(platformSocket, preflight),
      );
    })().then(() => {
      acceptanceComplete = true;
      if (closed) {
        state.releaseWebSocket(platformSocket);
        queueClose();
        return;
      }
      for (const message of pendingMessages) dispatch(message);
      pendingMessages.length = 0;
    })
      .catch((error: unknown) => {
        acceptanceComplete = true;
        console.error("Standalone WebSocket acceptance failed", error);
        queueClose();
        platformSocket.close(1011, "accept failed");
      });
    environment.runtime.trackTask(acceptance);
  });
}

class NodeRoomSocket implements PlatformSocket {
  private attachment: unknown = null;

  public constructor(private readonly socket: WebSocket) {}

  public send(message: string): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(message);
  }

  public close(code?: number, reason?: string): void {
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close(code, reason);
    }
  }

  public serializeAttachment(attachment: unknown): void {
    this.attachment = structuredClone(attachment);
  }

  public deserializeAttachment(): unknown {
    return structuredClone(this.attachment);
  }
}

async function webRequest(incoming: IncomingMessage, config: StandaloneServerConfig): Promise<Request> {
  const headers = new Headers();
  for (const [name, rawValue] of Object.entries(incoming.headers)) {
    if (rawValue === undefined) continue;
    if (Array.isArray(rawValue)) {
      for (const value of rawValue) headers.append(name, value);
    } else {
      headers.set(name, rawValue);
    }
  }
  headers.set("CF-Connecting-IP", clientAddress(incoming, config.trustProxy));
  const method = incoming.method ?? "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : await readRequestBody(incoming);
  let url: URL;
  try {
    url = publicRequestUrl(incoming.url, config.publicOrigin);
  } catch (error) {
    if (error instanceof InvalidRequestTargetError) throw error;
    throw new InvalidRequestTargetError();
  }
  return new Request(url, {
    method,
    headers,
    body,
  });
}

async function readRequestBody(request: IncomingMessage): Promise<ArrayBuffer | undefined> {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    request.resume();
    throw new RequestTooLargeError();
  }
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    length += buffer.byteLength;
    if (length > MAX_REQUEST_BYTES) {
      request.resume();
      throw new RequestTooLargeError();
    }
    chunks.push(buffer);
  }
  if (length === 0) return undefined;
  const body = Buffer.concat(chunks, length);
  return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
}

async function writeWebResponse(response: ServerResponse, value: Response, headOnly = false): Promise<void> {
  response.statusCode = value.status;
  response.statusMessage = value.statusText;
  for (const [name, headerValue] of value.headers) {
    if (name.toLowerCase() !== "set-cookie") response.setHeader(name, headerValue);
  }
  const cookies = value.headers.getSetCookie();
  if (cookies.length > 0) response.setHeader("Set-Cookie", cookies);
  if (headOnly || !value.body) {
    response.end();
    return;
  }
  response.end(Buffer.from(await value.arrayBuffer()));
}

async function serveStaticFile(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  root: string,
): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }
  const relativePath = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const filePath = resolve(root, relativePath);
  const pathFromRoot = relative(root, filePath);
  if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`)) {
    response.writeHead(403).end();
    return;
  }
  let metadata;
  try {
    metadata = await stat(filePath);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not Found");
    return;
  }
  if (!metadata.isFile()) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    "Cache-Control": isHashedAsset(relativePath)
      ? "public, max-age=31536000, immutable"
      : "no-cache",
    "Content-Length": metadata.size,
    "Content-Type": contentType(filePath),
    "X-Content-Type-Options": "nosniff",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(filePath).pipe(response);
}

function isHashedAsset(relativePath: string): boolean {
  return relativePath.startsWith("assets/") && /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(relativePath);
}

function clientAddress(request: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = singleHeader(request.headers["x-forwarded-for"])?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  return request.socket.remoteAddress ?? "unidentified";
}

function singleHeader(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function rawDataText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data as ArrayBuffer).toString("utf8");
}

function writeUpgradeError(socket: Duplex, status: number, message: string): void {
  if (socket.destroyed) return;
  const reason = message || "Request rejected";
  const body = Buffer.from(reason);
  socket.end(
    `HTTP/1.1 ${status} ${httpStatusText(status)}\r\n`
    + "Connection: close\r\n"
    + "Content-Type: text/plain; charset=utf-8\r\n"
    + `Content-Length: ${body.byteLength}\r\n\r\n`
    + reason,
  );
}

function httpStatusText(status: number): string {
  if (status === 400) return "Bad Request";
  if (status === 401) return "Unauthorized";
  if (status === 403) return "Forbidden";
  if (status === 404) return "Not Found";
  if (status === 503) return "Service Unavailable";
  return "Error";
}

function publicRequestUrl(target: string | undefined, publicOrigin: string): URL {
  if (!target || !target.startsWith("/") || target.startsWith("//")) {
    throw new InvalidRequestTargetError();
  }
  const url = new URL(target, publicOrigin);
  if (url.origin !== new URL(publicOrigin).origin) throw new InvalidRequestTargetError();
  return url;
}

function contentType(filePath: string): string {
  return ({
    ".css": "text/css; charset=utf-8",
    ".glb": "model/gltf-binary",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
  } as Record<string, string>)[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

async function assertStaticBuild(directory: string): Promise<void> {
  const index = await stat(resolve(directory, "index.html")).catch(() => null);
  if (!index?.isFile()) throw new Error(`Static build not found at ${directory}; run npm run build first`);
}

async function acquireProcessLock(dataDirectory: string): Promise<() => Promise<void>> {
  const lockPath = resolve(dataDirectory, ".server-lock.sqlite");
  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(lockPath);
    database.exec("PRAGMA busy_timeout = 0");
    database.exec("PRAGMA journal_mode = DELETE");
    database.exec("CREATE TABLE IF NOT EXISTS process_lock (id INTEGER PRIMARY KEY CHECK (id = 1))");
    database.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    database?.close();
    if (String((error as Error).message).toLowerCase().includes("database is locked")) {
      throw new Error("Standalone data directory is already used by another process");
    }
    throw error;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try {
      database?.exec("ROLLBACK");
    } finally {
      database?.close();
      database = null;
    }
  };
}

async function closeServer(
  server: Server,
  webSocketServer: WebSocketServer,
  environment: StandaloneEnvironment,
  releaseLock: () => Promise<void>,
): Promise<void> {
  const httpClose = closeHttpServer(server);
  try {
    await environment.rooms.runOnInstantiated((room) => room.prepareForShutdown());
    const webSocketClose = closeWebSocketServer(webSocketServer);
    for (const socket of webSocketServer.clients) socket.close(1012, "server restarting");
    const gracefulNetworkClose = Promise.allSettled([httpClose, webSocketClose]);
    const timedOut = await waitForTimeout(gracefulNetworkClose, NETWORK_SHUTDOWN_TIMEOUT_MS);
    if (timedOut) {
      for (const socket of webSocketServer.clients) socket.terminate();
      server.closeAllConnections();
      await gracefulNetworkClose;
    }
    await environment.runtime.drainTasks();
    await environment.rooms.runOnInstantiated((room) => room.prepareForShutdown());
  } finally {
    for (const socket of webSocketServer.clients) socket.terminate();
    server.closeAllConnections();
    try {
      await environment.close();
    } finally {
      await releaseLock();
    }
  }
}

function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
    server.closeIdleConnections();
  });
}

function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error: Error): void => rejectListen(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolveListen();
    });
  });
}

async function waitForTimeout(task: Promise<unknown>, milliseconds: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      task.then(() => false),
      new Promise<true>((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout(true), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

class RequestTooLargeError extends Error {}
class InvalidRequestTargetError extends Error {}
