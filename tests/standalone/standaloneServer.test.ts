import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createConnection, createServer as createNetServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  MULTIPLAYER_PROTOCOL_VERSION,
  type RoomAdmission,
  type ServerMessage,
} from "../../src/network/protocol";
import type { ServerMetricRecord } from "../../src/server/ServerMetrics";
import { loadStandaloneConfig, type StandaloneServerConfig } from "../../standalone/config";
import {
  startStandaloneServer,
  type StandaloneServerHandle,
  type StandaloneServerHooks,
} from "../../standalone/StandaloneServer";

describe("standalone multiplayer server", () => {
  const servers: StandaloneServerHandle[] = [];
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.allSettled(servers.splice(0).map((server) => server.close()));
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
  });

  it("validates standalone mode and derives local paths", () => {
    expect(() => loadStandaloneConfig({ SERVER_MODE: "cloudflare" }, "/tmp/project"))
      .toThrow("SERVER_MODE must be 'standalone'");
    const config = loadStandaloneConfig({
      SERVER_MODE: "standalone",
      SERVER_PORT: "9123",
      SERVER_PUBLIC_ORIGIN: "https://game.example.test",
      SERVER_TRUST_PROXY: "true",
      SERVER_DATA_DIR: "persistent",
      ALLOWED_ORIGINS: "https://admin.example.test",
    }, "/tmp/project");
    expect(config).toMatchObject({
      port: 9123,
      publicOrigin: "https://game.example.test",
      trustProxy: true,
      dataDirectory: "/tmp/project/persistent",
    });
    expect(config.allowedOrigins.split(",")).toEqual([
      "https://game.example.test",
      "https://admin.example.test",
    ]);
  });

  it("serves the application and persists player and administrator sessions", async () => {
    const fixture = await createFixture();
    let server = await start(fixture.config);
    const root = await fetch(`${server.origin}/`);
    expect(root.status).toBe(200);
    expect(await root.text()).toContain("standalone fixture");
    await expect(fetch(`${server.origin}/health`).then((response) => response.json())).resolves.toEqual({
      ok: true,
      service: "lastlinep2p",
    });
    expect((await fetch(`${server.origin}/metrics`)).status).toBe(404);

    const administrator = await post(server.origin, "/v1/admin/bootstrap", {
      username: "operator",
      password: "strong-admin-password",
      bootstrapToken: "bootstrap-secret",
    }, { Origin: fixture.config.publicOrigin });
    expect(administrator.response.status).toBe(201);
    const administratorCookie = cookie(administrator.response);

    const registration = await post(server.origin, "/v1/auth/register", {
      username: "player_one",
      password: "strong-player-password",
      displayName: "Player One",
    }, { Origin: fixture.config.publicOrigin });
    expect(registration.response.status).toBe(201);
    const playerCookie = cookie(registration.response);

    await server.close();
    servers.splice(servers.indexOf(server), 1);
    server = await start(fixture.config);

    const status = await fetch(`${server.origin}/v1/admin/status`, {
      headers: { Cookie: administratorCookie },
    });
    expect(await status.json()).toMatchObject({ administrator: { username: "operator" } });
    const session = await post(server.origin, "/v1/auth/session", {}, {
      Cookie: playerCookie,
      Origin: fixture.config.publicOrigin,
    });
    expect(session.response.status).toBe(200);
    expect(session.value).toMatchObject({ user: { username: "player_one", displayName: "Player One" } });
  });

  it("observes the real Node WebSocket buffered amount", async () => {
    const fixture = await createFixture();
    const records: ServerMetricRecord[] = [];
    const server = await start(fixture.config, {
      metricSink: { emit: (record) => { records.push(record); } },
    });
    const guest = await createGuest(server.origin, "Buffered Socket");
    const admission = await createPrivateRoom(server.origin, guest);
    const connection = connect(server.origin, admission);
    await connection.waitFor("welcome");

    await server.close();
    servers.splice(servers.indexOf(server), 1);
    await connection.waitForClose();

    const buffered = records.find((record) => record.metric === "websocket_buffered_bytes");
    expect(buffered).toMatchObject({
      type: "server_metric",
      metric: "websocket_buffered_bytes",
      count: 2,
      unavailableCount: 0,
    });
  });

  it("rejects network-path request targets before administrator same-origin checks", async () => {
    const fixture = await createFixture();
    const server = await start(fixture.config);
    const administrator = await post(server.origin, "/v1/admin/bootstrap", {
      username: "operator",
      password: "strong-admin-password",
      bootstrapToken: "bootstrap-secret",
    }, { Origin: fixture.config.publicOrigin });
    const administratorCookie = cookie(administrator.response);
    const registration = await post(server.origin, "/v1/auth/register", {
      username: "csrf_target",
      password: "strong-player-password",
      displayName: "CSRF Target",
    }, { Origin: fixture.config.publicOrigin });
    const accountId = (registration.value as { user: { id: string } }).user.id;

    const attack = await fetch(
      `${server.origin}//evil.example/v1/admin/accounts/${accountId}/disable`,
      {
        method: "POST",
        headers: { Cookie: administratorCookie, Origin: "http://evil.example" },
      },
    );
    expect(attack.status).toBe(400);
    const login = await post(server.origin, "/v1/auth/login", {
      username: "csrf_target",
      password: "strong-player-password",
    }, { Origin: fixture.config.publicOrigin });
    expect(login.response.status).toBe(200);
  });

  it("runs a two-player match and restores it from the local checkpoint", async () => {
    const fixture = await createFixture();
    let server = await start(fixture.config);
    const firstGuest = await createGuest(server.origin, "Alpha");
    const secondGuest = await createGuest(server.origin, "Bravo");
    const firstAdmission = await createPrivateRoom(server.origin, firstGuest);
    const secondAdmission = await joinPrivateRoom(server.origin, firstAdmission.code, secondGuest);
    const first = connect(server.origin, firstAdmission);
    const second = connect(server.origin, secondAdmission);
    const firstWelcome = await first.waitFor("welcome");
    const secondWelcome = await second.waitFor("welcome");
    expect(firstWelcome).toMatchObject({
      protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
      roomId: firstAdmission.roomId,
      playerId: firstAdmission.playerId,
    });
    expect(secondWelcome).toMatchObject({
      protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
      roomId: secondAdmission.roomId,
      playerId: secondAdmission.playerId,
    });
    first.socket.send(JSON.stringify({ type: "connection.ack" }));
    second.socket.send(JSON.stringify({ type: "connection.ack" }));
    second.socket.send(JSON.stringify({ type: "lobby.ready", ready: true }));
    await first.waitForMatching(
      (message) => message.type === "lobby.state"
        && message.lobby.members.length === 2
        && message.lobby.members.every((member) => member.ready),
      "both players ready",
    );
    first.socket.send(JSON.stringify({ type: "lobby.start" }));
    const firstFull = await first.waitFor("match.full", 6_000);
    await second.waitFor("match.full", 6_000);
    expect(firstFull.type === "match.full" && firstFull.state.phase).toBe("flight");
    await delay(150);

    const roomId = firstAdmission.roomId;
    const firstPlayerId = firstAdmission.playerId;
    const reconnectToken = firstWelcome.type === "welcome" ? firstWelcome.reconnectToken : "";
    const previousTick = firstFull.type === "match.full" ? firstFull.tick : -1;
    await server.close();
    servers.splice(servers.indexOf(server), 1);
    await Promise.all([first.waitForClose(), second.waitForClose()]);

    server = await start(fixture.config);
    const reconnectAdmission: RoomAdmission = {
      ...firstAdmission,
      roomId,
      playerId: firstPlayerId,
      admissionToken: reconnectToken,
    };
    const reconnected = connect(server.origin, reconnectAdmission);
    const restoredWelcome = await reconnected.waitFor("welcome");
    const restored = await reconnected.waitFor("match.full");
    expect(restoredWelcome.type === "welcome" && restoredWelcome.roomId).toBe(roomId);
    expect(restored.type === "match.full" && restored.tick).toBeGreaterThanOrEqual(previousTick);
    reconnected.socket.close(1000, "done");
    await reconnected.waitForClose();
    expect(secondWelcome.type).toBe("welcome");
  }, 12_000);

  it("clears a member that closes while its WebSocket is being accepted", async () => {
    const fixture = await createFixture();
    const acceptStarted = deferred<void>();
    const releaseAccept = deferred<void>();
    const server = await start(fixture.config, {
      beforeWebSocketAccept: async () => {
        acceptStarted.resolve(undefined);
        await releaseAccept.promise;
      },
    });
    const firstGuest = await createGuest(server.origin, "Early Close");
    const firstAdmission = await quickMatch(server.origin, firstGuest);
    const earlySocket = socketForAdmission(server.origin, firstAdmission);
    const earlyOpen = new Promise<void>((resolveOpen) => earlySocket.once("open", () => resolveOpen()));
    const earlyClose = new Promise<void>((resolveClose) => earlySocket.once("close", () => resolveClose()));
    await Promise.all([earlyOpen, acceptStarted.promise]);
    earlySocket.close(1000, "immediate close");
    await earlyClose;
    releaseAccept.resolve(undefined);
    await delay(25);

    const secondGuest = await createGuest(server.origin, "Observer");
    const secondAdmission = await quickMatch(server.origin, secondGuest);
    const second = connect(server.origin, secondAdmission);
    const lobby = await second.waitFor("lobby.state");
    expect(lobby.type === "lobby.state" && lobby.lobby.members).toEqual(expect.arrayContaining([
      expect.objectContaining({ playerId: firstAdmission.playerId, connected: false }),
      expect.objectContaining({ playerId: secondAdmission.playerId, connected: true }),
    ]));
    second.socket.close(1000, "done");
    await second.waitForClose();
  });

  it("prevents two processes from opening the same data directory", async () => {
    const fixture = await createFixture();
    await start(fixture.config);
    await expect(startStandaloneServer(fixture.config)).rejects.toThrow("already used");
  });

  it("releases the data lock when the listen port is already occupied", async () => {
    const fixture = await createFixture();
    const port = await reservePort();
    const blocker = createNetServer();
    await new Promise<void>((resolveListen, rejectListen) => {
      blocker.once("error", rejectListen);
      blocker.listen(port, "127.0.0.1", resolveListen);
    });
    const config: StandaloneServerConfig = {
      ...fixture.config,
      port,
      publicOrigin: `http://127.0.0.1:${port}`,
      allowedOrigins: `http://127.0.0.1:${port}`,
    };
    await expect(startStandaloneServer(config)).rejects.toMatchObject({ code: "EADDRINUSE" });
    await new Promise<void>((resolveClose, rejectClose) => {
      blocker.close((error) => error ? rejectClose(error) : resolveClose());
    });

    const recovered = await start(config);
    await expect(fetch(`${recovered.origin}/health`).then((response) => response.json()))
      .resolves.toMatchObject({ ok: true });
  });

  it("reacquires the data lock after an independent server process is killed", async () => {
    const fixture = await createFixture();
    const port = await reservePort();
    const first = startChildServer(fixture.config, port);
    await waitForChildOutput(first, "standalone server listening");
    first.kill("SIGKILL");
    await waitForChildExit(first);

    const restarted = startChildServer(fixture.config, port);
    await waitForChildOutput(restarted, "standalone server listening");
    await expect(fetch(`http://127.0.0.1:${port}/health`).then((response) => response.json()))
      .resolves.toMatchObject({ ok: true });
    restarted.kill("SIGTERM");
    expect(await waitForChildExit(restarted)).toBe(0);
  }, 8_000);

  it("bounds shutdown when a raw WebSocket client ignores the close handshake", async () => {
    const fixture = await createFixture();
    const server = await start(fixture.config);
    const guest = await createGuest(server.origin, "Unresponsive Client");
    const admission = await createPrivateRoom(server.origin, guest);
    const rawSocket = await openRawWebSocket(server.origin, admission);
    const startedAt = performance.now();
    await server.close();
    servers.splice(servers.indexOf(server), 1);
    expect(performance.now() - startedAt).toBeLessThan(3_000);
    rawSocket.destroy();

    const restarted = await start(fixture.config);
    await expect(fetch(`${restarted.origin}/health`).then((response) => response.json()))
      .resolves.toMatchObject({ ok: true });
  }, 6_000);

  async function createFixture(): Promise<{ config: StandaloneServerConfig }> {
    const directory = await mkdtemp(resolve(tmpdir(), "last-line-standalone-"));
    directories.push(directory);
    const staticDirectory = resolve(directory, "dist");
    const dataDirectory = resolve(directory, "data");
    await mkdir(staticDirectory, { recursive: true });
    await writeFile(resolve(staticDirectory, "index.html"), "<!doctype html><title>standalone fixture</title>");
    return {
      config: {
        host: "127.0.0.1",
        port: 0,
        publicOrigin: "http://127.0.0.1:0",
        allowedOrigins: "http://127.0.0.1:0",
        trustProxy: false,
        dataDirectory,
        databasePath: resolve(dataDirectory, "last-line.sqlite"),
        staticDirectory,
        adminBootstrapToken: "bootstrap-secret",
      },
    };
  }

  async function start(
    config: StandaloneServerConfig,
    hooks?: StandaloneServerHooks,
  ): Promise<StandaloneServerHandle> {
    const server = await startStandaloneServer(config, hooks);
    servers.push(server);
    return server;
  }
});

interface GuestCredentials {
  playerId: string;
  sessionToken: string;
  displayName: string;
}

async function createGuest(origin: string, displayName: string): Promise<GuestCredentials> {
  const result = await post(origin, "/v1/guests", { displayName });
  expect(result.response.status).toBe(201);
  return result.value as GuestCredentials;
}

async function createPrivateRoom(origin: string, guest: GuestCredentials): Promise<RoomAdmission> {
  const result = await post(origin, "/v1/rooms", { ...guest, visibility: "private" });
  expect(result.response.status).toBe(201);
  return result.value as RoomAdmission;
}

async function quickMatch(origin: string, guest: GuestCredentials): Promise<RoomAdmission> {
  const result = await post(origin, "/v1/matchmaking/quick", guest);
  expect(result.response.status).toBeLessThan(400);
  return result.value as RoomAdmission;
}

async function joinPrivateRoom(
  origin: string,
  code: string,
  guest: GuestCredentials,
): Promise<RoomAdmission> {
  const result = await post(origin, `/v1/rooms/${code}/join`, guest);
  expect(result.response.status).toBe(200);
  return result.value as RoomAdmission;
}

async function post(
  origin: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ response: Response; value: unknown }> {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const value = response.status === 204 ? null : await response.json();
  return { response, value };
}

function cookie(response: Response): string {
  const value = response.headers.getSetCookie()[0]?.split(";", 1)[0];
  if (!value) throw new Error("response cookie missing");
  return value;
}

function connect(origin: string, admission: RoomAdmission): SocketProbe {
  return new SocketProbe(socketForAdmission(origin, admission));
}

function socketForAdmission(origin: string, admission: RoomAdmission): WebSocket {
  const url = new URL(admission.socketPath, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("playerId", admission.playerId);
  url.searchParams.set("token", admission.admissionToken);
  return new WebSocket(url);
}

class SocketProbe {
  public readonly messages: ServerMessage[] = [];
  private readonly waiters = new Set<() => void>();

  public constructor(public readonly socket: WebSocket) {
    socket.on("message", (raw) => {
      this.messages.push(JSON.parse(raw.toString()) as ServerMessage);
      for (const notify of this.waiters) notify();
    });
  }

  public async waitFor<Type extends ServerMessage["type"]>(
    type: Type,
    timeout = 3_000,
  ): Promise<Extract<ServerMessage, { type: Type }>> {
    const existing = this.messages.find((message) => message.type === type);
    if (existing) return existing as Extract<ServerMessage, { type: Type }>;
    return new Promise((resolveMessage, rejectMessage) => {
      const timer = setTimeout(() => {
        this.waiters.delete(check);
        rejectMessage(new Error(`Timed out waiting for ${type}`));
      }, timeout);
      const check = (): void => {
        const message = this.messages.find((candidate) => candidate.type === type);
        if (!message) return;
        clearTimeout(timer);
        this.waiters.delete(check);
        resolveMessage(message as Extract<ServerMessage, { type: Type }>);
      };
      this.waiters.add(check);
    });
  }

  public async waitForMatching(
    predicate: (message: ServerMessage) => boolean,
    description: string,
    timeout = 3_000,
  ): Promise<ServerMessage> {
    const existing = this.messages.find(predicate);
    if (existing) return existing;
    return new Promise((resolveMessage, rejectMessage) => {
      const timer = setTimeout(() => {
        this.waiters.delete(check);
        rejectMessage(new Error(`Timed out waiting for ${description}`));
      }, timeout);
      const check = (): void => {
        const message = this.messages.find(predicate);
        if (!message) return;
        clearTimeout(timer);
        this.waiters.delete(check);
        resolveMessage(message);
      };
      this.waiters.add(check);
    });
  }

  public waitForClose(timeout = 3_000): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolveClose, rejectClose) => {
      const timer = setTimeout(() => rejectClose(new Error("Timed out waiting for socket close")), timeout);
      this.socket.once("close", () => {
        clearTimeout(timer);
        resolveClose();
      });
    });
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
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

async function reservePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("ephemeral port unavailable");
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
  return address.port;
}

function startChildServer(config: StandaloneServerConfig, port: number): ChildProcess {
  return spawn(process.execPath, ["--import", "tsx", "standalone/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SERVER_MODE: "standalone",
      SERVER_HOST: "127.0.0.1",
      SERVER_PORT: String(port),
      SERVER_PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
      SERVER_DATA_DIR: config.dataDirectory,
      SERVER_STATIC_DIR: config.staticDirectory,
      ADMIN_BOOTSTRAP_TOKEN: config.adminBootstrapToken ?? "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function waitForChildOutput(child: ChildProcess, expected: string, timeout = 3_000): Promise<void> {
  return new Promise((resolveOutput, rejectOutput) => {
    let output = "";
    const timer = setTimeout(() => rejectOutput(new Error(`child output timed out: ${output}`)), timeout);
    const read = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      if (!output.includes(expected)) return;
      clearTimeout(timer);
      cleanup();
      resolveOutput();
    };
    const exited = (code: number | null): void => {
      clearTimeout(timer);
      cleanup();
      rejectOutput(new Error(`child exited before ready (${code}): ${output}`));
    };
    const cleanup = (): void => {
      child.stdout?.off("data", read);
      child.stderr?.off("data", read);
      child.off("exit", exited);
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    child.once("exit", exited);
  });
}

function waitForChildExit(child: ChildProcess, timeout = 3_000): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => rejectExit(new Error("child exit timed out")), timeout);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolveExit(code);
    });
  });
}

async function openRawWebSocket(origin: string, admission: RoomAdmission): Promise<Socket> {
  const url = new URL(admission.socketPath, origin);
  url.searchParams.set("playerId", admission.playerId);
  url.searchParams.set("token", admission.admissionToken);
  const socket = createConnection({ host: url.hostname, port: Number(url.port) });
  await new Promise<void>((resolveConnect, rejectConnect) => {
    socket.once("connect", resolveConnect);
    socket.once("error", rejectConnect);
  });
  socket.write(
    `GET ${url.pathname}${url.search} HTTP/1.1\r\n`
    + `Host: ${url.host}\r\n`
    + "Connection: Upgrade\r\n"
    + "Upgrade: websocket\r\n"
    + "Sec-WebSocket-Version: 13\r\n"
    + "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
  );
  const response = await new Promise<string>((resolveResponse, rejectResponse) => {
    const timer = setTimeout(() => rejectResponse(new Error("raw WebSocket upgrade timed out")), 1_000);
    socket.once("data", (data) => {
      clearTimeout(timer);
      resolveResponse(data.toString("utf8"));
    });
  });
  expect(response).toContain("101 Switching Protocols");
  return socket;
}
