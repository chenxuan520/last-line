import { env, evictDurableObject, reset, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import worker from "../../worker/index";

const ADMIN_PASSWORD = "Correct admin battery staple 1";
const PLAYER_PASSWORD = "Correct player battery staple 1";

describe("admin control plane", () => {
  afterEach(async () => {
    await reset();
  });

  it("serves a hardened same-origin admin page without exposing secrets", async () => {
    const response = await worker.fetch(new Request("https://test/admin"), env);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(html).toContain("管理终端");
    expect(html).not.toContain("test-bootstrap-token");
    expect(html).not.toContain("challenges.cloudflare.com/turnstile/v0/api.js");
  });

  it("bootstraps one administrator and authenticates with a secure cookie", async () => {
    const initialStatus = await get("/v1/admin/status");
    await expect(initialStatus.json()).resolves.toMatchObject({
      needsBootstrap: true,
      bootstrapConfigured: true,
      resetConfigured: true,
      turnstile: { enabled: false },
    });

    const rejected = await post("/v1/admin/bootstrap", {
      username: "operator",
      password: ADMIN_PASSWORD,
      bootstrapToken: "wrong-token",
    });
    expect(rejected.status).toBe(401);

    const bootstrap = await post("/v1/admin/bootstrap", {
      username: "operator",
      password: ADMIN_PASSWORD,
      bootstrapToken: "test-bootstrap-token",
    });
    expect(bootstrap.status).toBe(201);
    const cookie = adminCookie(bootstrap);
    expect(bootstrap.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(bootstrap.headers.get("Set-Cookie")).toContain("Secure");
    expect(bootstrap.headers.get("Set-Cookie")).toContain("SameSite=Strict");

    const me = await get("/v1/admin/me", cookie);
    expect(me.status).toBe(200);
    await expect(me.json()).resolves.toMatchObject({ administrator: { username: "operator" } });

    const replayBootstrap = await post("/v1/admin/bootstrap", {
      username: "other",
      password: ADMIN_PASSWORD,
      bootstrapToken: "test-bootstrap-token",
    });
    expect(replayBootstrap.status).toBe(409);
  }, 60_000);

  it("enforces a single administrator and same-origin password mutations", async () => {
    const cookie = await bootstrapAdministrator();
    const crossOrigin = await post("/v1/admin/password", {
      currentPassword: ADMIN_PASSWORD,
      newPassword: "Replacement admin battery staple 2",
    }, cookie, "https://evil.example");
    expect(crossOrigin.status).toBe(403);
    expect((await get("/v1/admin/administrators", cookie)).status).toBe(404);
    expect((await post("/v1/admin/administrators", { username: "second", password: ADMIN_PASSWORD }, cookie)).status).toBe(404);
  }, 60_000);

  it("resets the sole administrator password with a temporary recovery secret", async () => {
    const oldCookie = await bootstrapAdministrator();
    const rejected = await post("/v1/admin/reset", {
      username: "recovered_operator",
      resetToken: "wrong-reset-token",
      newPassword: "Recovered admin battery staple 3",
    });
    expect(rejected.status).toBe(401);
    const resetResponse = await post("/v1/admin/reset", {
      username: "recovered_operator",
      resetToken: "test-reset-token",
      newPassword: "Recovered admin battery staple 3",
    });
    expect(resetResponse.status).toBe(200);
    expect((await get("/v1/admin/me", oldCookie)).status).toBe(401);
    const resetCookie = adminCookie(resetResponse);
    expect((await get("/v1/admin/me", resetCookie)).status).toBe(200);
    expect((await post("/v1/admin/login", { username: "operator", password: ADMIN_PASSWORD })).status).toBe(401);
    expect((await post("/v1/admin/login", {
      username: "recovered_operator",
      password: "Recovered admin battery staple 3",
    })).status).toBe(200);
    const reused = await post("/v1/admin/reset", {
      username: "another_operator",
      resetToken: "test-reset-token",
      newPassword: "Another recovered admin password 4",
    });
    expect(reused.status).toBe(401);
  }, 60_000);

  it("logs in, logs out, and rotates credentials after a password change", async () => {
    const bootstrapCookie = await bootstrapAdministrator();
    const logout = await post("/v1/admin/logout", {}, bootstrapCookie);
    expect(logout.status).toBe(204);
    expect((await get("/v1/admin/me", bootstrapCookie)).status).toBe(401);

    const rejected = await post("/v1/admin/login", {
      username: "operator",
      password: "Wrong administrator password 1",
    });
    expect(rejected.status).toBe(401);
    const login = await post("/v1/admin/login", { username: "OPERATOR", password: ADMIN_PASSWORD });
    expect(login.status).toBe(200);
    const loginCookie = adminCookie(login);

    const changed = await post("/v1/admin/password", {
      currentPassword: ADMIN_PASSWORD,
      newPassword: "Replacement admin battery staple 2",
    }, loginCookie);
    expect(changed.status).toBe(200);
    expect((await get("/v1/admin/me", loginCookie)).status).toBe(401);
    const changedCookie = adminCookie(changed);
    expect((await get("/v1/admin/me", changedCookie)).status).toBe(200);

    const oldLogin = await post("/v1/admin/login", { username: "operator", password: ADMIN_PASSWORD });
    const newLogin = await post("/v1/admin/login", {
      username: "operator",
      password: "Replacement admin battery staple 2",
    });
    expect(oldLogin.status).toBe(401);
    expect(newLogin.status).toBe(200);
  }, 60_000);

  it("toggles account-required multiplayer while preserving existing guests", async () => {
    const cookie = await bootstrapAdministrator();
    const oldGuest = await publicPost("/v1/guests", { displayName: "Existing Guest" });
    const initialConfig = await request(
      "/v1/auth/config",
      "GET",
      undefined,
      undefined,
      "https://lastline.011203.xyz",
    ).then((response) => response.json() as Promise<{
      registrationLoginRequired: boolean;
    }>);
    expect(initialConfig.registrationLoginRequired).toBe(false);

    const enabled = await post("/v1/admin/settings/auth", { required: true }, cookie);
    expect(enabled.status).toBe(200);
    const requiredConfig = await request(
      "/v1/auth/config",
      "GET",
      undefined,
      undefined,
      "https://lastline.011203.xyz",
    ).then((response) => response.json() as Promise<{
      registrationLoginRequired: boolean;
    }>);
    expect(requiredConfig.registrationLoginRequired).toBe(true);

    const anonymousGuest = await worker.fetch(new Request("https://test/v1/guests", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://lastline.011203.xyz" },
      body: JSON.stringify({ displayName: "Anonymous" }),
    }), env);
    expect(anonymousGuest.status).toBe(401);
    await expect(anonymousGuest.json()).resolves.toEqual({ error: "account-required" });

    const registration = await worker.fetch(new Request("https://test/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://lastline.011203.xyz" },
      body: JSON.stringify({ username: "AccountUser", password: PLAYER_PASSWORD, displayName: "账号玩家" }),
    }), env);
    expect(registration.status).toBe(201);
    expect(registration.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(registration.headers.get("Set-Cookie")).toContain("Path=/;");
    expect(registration.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    const registered = await registration.json() as {
      user: { id: string; displayName: string };
      session: { accessToken: string; refreshToken?: string };
    };
    expect(registered.user.displayName).toBe("账号玩家");
    expect(registered.session.refreshToken).toBeUndefined();
    const playerCookie = registration.headers.get("Set-Cookie")?.split(";", 1)[0] ?? "";
    const restoredSession = await worker.fetch(new Request("https://test/v1/auth/session", {
      method: "POST",
      headers: { Origin: "https://lastline.011203.xyz", Cookie: playerCookie },
    }), env);
    expect(restoredSession.status).toBe(200);
    const restored = await restoredSession.json() as {
      user: { username: string };
      session: { accessToken: string };
    };
    expect(restored.user.username).toBe("AccountUser");

    const authenticatedGuest = await worker.fetch(new Request("https://test/v1/guests", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://lastline.011203.xyz",
        Authorization: `Bearer ${restored.session.accessToken}`,
      },
      body: JSON.stringify({ displayName: "伪造昵称" }),
    }), env);
    expect(authenticatedGuest.status).toBe(201);
    const accountGuest = await authenticatedGuest.json() as {
      playerId: string;
      sessionToken: string;
      displayName: string;
    };
    expect(accountGuest.displayName).toBe("账号玩家");
    const accountAdmission = await publicPost("/v1/matchmaking/quick", accountGuest);

    const revokedAccount = await post(`/v1/admin/accounts/${registered.user.id}/revoke`, {}, cookie);
    expect(revokedAccount.status).toBe(200);
    const revokedGuest = await worker.fetch(new Request("https://test/v1/matchmaking/quick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(accountGuest),
    }), env);
    expect(revokedGuest.status).toBe(401);
    const revokedSocketUrl = new URL(String(accountAdmission.socketPath), "https://test");
    revokedSocketUrl.searchParams.set("playerId", String(accountAdmission.playerId));
    revokedSocketUrl.searchParams.set("token", String(accountAdmission.admissionToken));
    const revokedUpgrade = await worker.fetch(new Request(revokedSocketUrl, {
      headers: { Upgrade: "websocket", Origin: "http://localhost" },
    }), env);
    expect(revokedUpgrade.status).toBe(101);
    if (!revokedUpgrade.webSocket) throw new Error("Revoked terminal WebSocket missing");
    const revokedSocket = revokedUpgrade.webSocket;
    const revokedClose = new Promise<number>((resolve) => {
      revokedSocket.addEventListener("close", (event) => resolve(event.code), { once: true });
    });
    revokedSocket.accept();
    await expect(revokedClose).resolves.toBe(4011);

    const existingGuestMatch = await publicPost("/v1/matchmaking/quick", oldGuest);
    expect(existingGuestMatch.roomId).toBe(accountAdmission.roomId);
    const replacementHost = await runInDurableObject(
      env.GAME_ROOMS.getByName(String(accountAdmission.roomId)),
      async (_instance, state) => {
        const room = await state.storage.get<{
          members?: Record<string, { host?: boolean; accountId?: string | null }>;
        }>("room-v1");
        return Object.values(room?.members ?? {})[0];
      },
    );
    expect(replacementHost).toMatchObject({ host: true, accountId: null });

    const disabled = await post("/v1/admin/settings/auth", { required: false }, cookie);
    expect(disabled.status).toBe(200);
    const restoredGuest = await publicPost("/v1/guests", { displayName: "Guest Again" });
    expect(restoredGuest.displayName).toBe("Guest Again");
  }, 60_000);

  it("lists, disables, enables, and revokes player accounts", async () => {
    const cookie = await bootstrapAdministrator();
    const registration = await accountPost("/internal/auth/register", {
      username: "PlayerOne",
      password: PLAYER_PASSWORD,
      displayName: "玩家一号",
    });
    expect(registration.status).toBe(201);
    const player = await registration.json() as {
      user: { id: string };
      session: { accessToken: string };
    };

    const accounts = await get("/v1/admin/accounts?q=player", cookie);
    const accountList = await accounts.json() as {
      total: number;
      accounts: Array<{ id: string; activeSessions: number; disabledAt: number | null }>;
    };
    expect(accountList.total).toBe(1);
    expect(accountList.accounts[0]).toMatchObject({ id: player.user.id, activeSessions: 1, disabledAt: null });

    const disabled = await post(`/v1/admin/accounts/${player.user.id}/disable`, {}, cookie);
    expect(disabled.status).toBe(200);
    const disabledLogin = await accountPost("/internal/auth/login", {
      username: "PlayerOne",
      password: PLAYER_PASSWORD,
    }, "198.51.100.55");
    expect(disabledLogin.status).toBe(401);

    const enabled = await post(`/v1/admin/accounts/${player.user.id}/enable`, {}, cookie);
    expect(enabled.status).toBe(200);
    const login = await accountPost("/internal/auth/login", {
      username: "PlayerOne",
      password: PLAYER_PASSWORD,
    }, "198.51.100.56");
    expect(login.status).toBe(200);

    const revoked = await post(`/v1/admin/accounts/${player.user.id}/revoke`, {}, cookie);
    expect(revoked.status).toBe(200);
    const afterRevoke = await get("/v1/admin/accounts?q=player", cookie).then((response) => response.json() as Promise<{
      accounts: Array<{ activeSessions: number }>;
    }>);
    expect(afterRevoke.accounts[0]?.activeSessions).toBe(0);
  }, 60_000);

  it("lists and force-closes an online room", async () => {
    const cookie = await bootstrapAdministrator();
    const guest = await publicPost("/v1/guests", { displayName: "Room Host" });
    const admission = await publicPost("/v1/rooms", { ...guest, visibility: "private" });

    const rooms = await get("/v1/admin/rooms", cookie).then((response) => response.json() as Promise<{
      rooms: Array<{ roomId: string; visibility: string }>;
    }>);
    expect(rooms.rooms).toEqual([
      expect.objectContaining({ roomId: admission.roomId, visibility: "private" }),
    ]);

    const socketUrl = new URL(String(admission.socketPath), "https://test");
    socketUrl.searchParams.set("playerId", String(admission.playerId));
    socketUrl.searchParams.set("token", String(admission.admissionToken));
    const upgrade = await worker.fetch(new Request(socketUrl, {
      headers: { Upgrade: "websocket", Origin: "http://localhost" },
    }), env);
    if (!upgrade.webSocket) throw new Error("WebSocket missing");
    const socket = upgrade.webSocket;
    socket.accept();
    const closed = new Promise<number>((resolve) => socket.addEventListener("close", (event) => resolve(event.code), { once: true }));

    const close = await post(`/v1/admin/rooms/${admission.roomId}/close`, {}, cookie);
    expect(close.status).toBe(200);
    await expect(closed).resolves.toBe(4010);
    const remaining = await get("/v1/admin/rooms", cookie).then((response) => response.json() as Promise<{
      rooms: unknown[];
    }>);
    expect(remaining.rooms).toHaveLength(0);

    const reconnect = await worker.fetch(new Request(socketUrl, {
      headers: { Upgrade: "websocket", Origin: "http://localhost" },
    }), env);
    expect(reconnect.status).toBe(101);
    if (!reconnect.webSocket) throw new Error("Terminal WebSocket missing");
    const terminalSocket = reconnect.webSocket;
    const terminalClose = new Promise<number>((resolve) => {
      terminalSocket.addEventListener("close", (event) => resolve(event.code), { once: true });
    });
    terminalSocket.accept();
    await expect(terminalClose).resolves.toBe(4010);
  }, 60_000);

  it("stops and deletes a running room", async () => {
    const cookie = await bootstrapAdministrator();
    const firstGuest = await publicPost("/v1/guests", { displayName: "Runner One" });
    const secondGuest = await publicPost("/v1/guests", { displayName: "Runner Two" });
    const firstAdmission = await publicPost("/v1/matchmaking/quick", firstGuest);
    const secondAdmission = await publicPost("/v1/matchmaking/quick", secondGuest);
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
    const running = await runInDurableObject(stub, async (_instance, state) => {
      return (await state.storage.get<{ status?: string }>("room-v1"))?.status;
    });
    expect(running).toBe("running");

    const latestCheckpointTick = await runInDurableObject(stub, async (instance, state) => {
      const room = await state.storage.get<{
        checkpoint?: { tick: number; state: { elapsedSeconds: number } };
      }>("room-v1");
      if (!room?.checkpoint) throw new Error("running checkpoint missing");
      const latest = structuredClone(room.checkpoint);
      latest.tick += 30;
      latest.state.elapsedSeconds += 1;
      await state.storage.put("checkpoint-v1", latest);
      (instance as unknown as { loopRunning: boolean }).loopRunning = false;
      return latest.tick;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await evictDurableObject(stub);
    const recoveredTick = await runInDurableObject(stub, async (instance) => {
      return (instance as unknown as {
        data?: { checkpoint?: { tick: number } };
      }).data?.checkpoint?.tick;
    });
    expect(recoveredTick).toBeGreaterThanOrEqual(latestCheckpointTick);

    const close = await post(`/v1/admin/rooms/${roomId}/close`, {}, cookie);
    expect(close.status).toBe(200);
    const removed = await runInDurableObject(stub, async (_instance, state) => {
      return await state.storage.get("room-v1");
    });
    expect(removed).toBeUndefined();
    firstSocket.close(1000, "done");
    secondSocket.close(1000, "done");
  }, 60_000);
});

async function bootstrapAdministrator(): Promise<string> {
  const response = await post("/v1/admin/bootstrap", {
    username: "operator",
    password: ADMIN_PASSWORD,
    bootstrapToken: "test-bootstrap-token",
  });
  expect(response.status).toBe(201);
  return adminCookie(response);
}

function adminCookie(response: Response): string {
  const value = response.headers.get("Set-Cookie")?.split(";", 1)[0];
  if (!value) throw new Error("Admin cookie missing");
  return value;
}

function get(path: string, cookie?: string): Promise<Response> {
  return request(path, "GET", undefined, cookie);
}

function post(path: string, body: unknown, cookie?: string, origin = "https://test"): Promise<Response> {
  return request(path, "POST", body, cookie, origin);
}

function request(
  path: string,
  method: string,
  body?: unknown,
  cookie?: string,
  origin = "https://test",
): Promise<Response> {
  const headers = new Headers({ Origin: origin });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (cookie) headers.set("Cookie", cookie);
  return worker.fetch(new Request(`https://test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
}

function accountPost(path: string, body: unknown, address = "198.51.100.54"): Promise<Response> {
  return env.ACCOUNTS.getByName("global").fetch(new Request(`https://accounts${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": address },
    body: JSON.stringify(body),
  }));
}

async function publicPost(path: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await worker.fetch(new Request(`https://test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), env);
  expect(response.status).toBeLessThan(400);
  return response.json() as Promise<Record<string, unknown>>;
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
