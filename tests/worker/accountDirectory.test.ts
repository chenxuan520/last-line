import { env, reset, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import worker from "../../worker/index";

interface AuthSession {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
}

interface AuthPayload {
  user: {
    id: string;
    username: string;
    displayName: string;
    createdAt: number;
  };
  session: AuthSession;
}

const PASSWORD = "Correct horse battery staple 1";
const NEW_PASSWORD = "A different battery staple 2";
const accountEnv = env as typeof env & { ACCOUNTS: DurableObjectNamespace };

describe("unwired account directory", () => {
  afterEach(async () => {
    await reset();
  });

  it("is not reachable through the public Worker", async () => {
    const response = await worker.fetch(new Request("https://test/internal/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Alice", password: PASSWORD }),
    }), env);

    expect(response.status).toBe(404);
  });

  it("registers, authenticates, and stores only password and token digests", async () => {
    const registration = await register("Alice", PASSWORD, "幸存者 Alice");
    expect(registration.response.status).toBe(201);
    expect(registration.payload.user).toMatchObject({
      username: "Alice",
      displayName: "幸存者 Alice",
    });
    expect(registration.payload.session.accessToken).toMatch(/^lla_[A-Za-z0-9_-]{43}$/);
    expect(registration.payload.session.refreshToken).toMatch(/^llr_[A-Za-z0-9_-]{43}$/);

    const me = await accountRequest("/internal/auth/me", undefined, registration.payload.session.accessToken);
    expect(me.status).toBe(200);
    await expect(me.json()).resolves.toMatchObject({ user: { username: "Alice" } });

    const duplicate = await register("aLiCe", PASSWORD, "Duplicate", "198.51.100.2");
    expect(duplicate.response.status).toBe(409);
    await expect(duplicate.response.json()).resolves.toEqual({ error: "registration-unavailable" });

    const login = await post("/internal/auth/login", {
      username: "ALICE",
      password: PASSWORD,
    });
    expect(login.response.status).toBe(200);
    expect(login.payload.user.username).toBe("Alice");

    const wrongPassword = await rawPost("/internal/auth/login", {
      username: "Alice",
      password: "Wrong password value 123",
    }, "198.51.100.3");
    const unknownAccount = await rawPost("/internal/auth/login", {
      username: "Nobody",
      password: "Wrong password value 123",
    }, "198.51.100.4");
    expect(wrongPassword.status).toBe(401);
    expect(unknownAccount.status).toBe(401);
    await expect(wrongPassword.json()).resolves.toEqual({ error: "invalid-credentials" });
    await expect(unknownAccount.json()).resolves.toEqual({ error: "invalid-credentials" });

    const stored = await runInDurableObject(accountEnv.ACCOUNTS.getByName("global"), async (_instance, state) => {
      const account = state.storage.sql.exec<Record<string, SqlStorageValue>>(
        "SELECT password_hash, password_salt FROM accounts WHERE username_key = 'alice'",
      ).one();
      const sessions = state.storage.sql.exec<Record<string, SqlStorageValue>>(
        "SELECT access_hash, refresh_hash FROM sessions",
      ).toArray();
      return { account, sessions };
    });
    const serialized = JSON.stringify(stored);
    expect(stored.account.password_hash).not.toBe(PASSWORD);
    expect(stored.account.password_salt).not.toBe("");
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain(registration.payload.session.accessToken);
    expect(serialized).not.toContain(registration.payload.session.refreshToken);
  }, 60_000);

  it("atomically rejects a concurrent case-insensitive duplicate registration", async () => {
    const [first, second] = await Promise.all([
      rawPost("/internal/auth/register", { username: "RaceUser", password: PASSWORD }, "198.51.100.10"),
      rawPost("/internal/auth/register", { username: "raceuser", password: PASSWORD }, "198.51.100.11"),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const count = await runInDurableObject(accountEnv.ACCOUNTS.getByName("global"), async (_instance, state) => {
      return state.storage.sql.exec<{ count: number } & Record<string, SqlStorageValue>>(
        "SELECT COUNT(*) AS count FROM accounts",
      ).one().count;
    });
    expect(count).toBe(1);
  }, 60_000);

  it("tolerates an immediate refresh race and revokes a later replay", async () => {
    const registration = await register("RefreshUser", PASSWORD);
    const original = registration.payload.session;
    const rotated = await post("/internal/auth/refresh", { refreshToken: original.refreshToken });
    expect(rotated.response.status).toBe(200);
    expect(rotated.payload.session.accessToken).not.toBe(original.accessToken);
    expect(rotated.payload.session.refreshToken).not.toBe(original.refreshToken);

    const oldAccess = await accountRequest("/internal/auth/me", undefined, original.accessToken);
    const newAccess = await accountRequest("/internal/auth/me", undefined, rotated.payload.session.accessToken);
    expect(oldAccess.status).toBe(401);
    expect(newAccess.status).toBe(200);

    const replayed = await rawPost("/internal/auth/refresh", { refreshToken: original.refreshToken });
    expect(replayed.status).toBe(409);
    const stillValid = await accountRequest("/internal/auth/me", undefined, rotated.payload.session.accessToken);
    expect(stillValid.status).toBe(200);
    await runInDurableObject(accountEnv.ACCOUNTS.getByName("global"), async (_instance, state) => {
      state.storage.sql.exec("UPDATE used_refresh_tokens SET used_at = ?", Date.now() - 6_000);
    });
    const delayedReplay = await rawPost("/internal/auth/refresh", { refreshToken: original.refreshToken });
    expect(delayedReplay.status).toBe(401);
    const revokedAccess = await accountRequest("/internal/auth/me", undefined, rotated.payload.session.accessToken);
    expect(revokedAccess.status).toBe(401);
  }, 60_000);

  it("keeps one valid result when two rotations race", async () => {
    const registration = await register("RefreshRace", PASSWORD);
    const refreshToken = registration.payload.session.refreshToken;
    const [first, second] = await Promise.all([
      rawPost("/internal/auth/refresh", { refreshToken }, "198.51.100.50"),
      rawPost("/internal/auth/refresh", { refreshToken }, "198.51.100.51"),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const successful = first.status === 200 ? first : second;
    const payload = await successful.json() as AuthPayload;
    const access = await accountRequest("/internal/auth/me", undefined, payload.session.accessToken);
    expect(access.status).toBe(200);
  }, 60_000);

  it("lets an access-only logout revoke a concurrently rotating family", async () => {
    const registration = await register("LogoutRace", PASSWORD);
    const original = registration.payload.session;
    const [refresh, logout] = await Promise.all([
      rawPost("/internal/auth/refresh", { refreshToken: original.refreshToken }, "198.51.100.52"),
      accountRequest("/internal/auth/logout", undefined, original.accessToken, "198.51.100.53"),
    ]);
    expect(logout.status).toBe(204);
    expect([200, 401, 409]).toContain(refresh.status);
    if (refresh.status === 200) {
      const payload = await refresh.json() as AuthPayload;
      const access = await accountRequest("/internal/auth/me", undefined, payload.session.accessToken);
      expect(access.status).toBe(401);
    }
    const sessionCount = await runInDurableObject(
      accountEnv.ACCOUNTS.getByName("global"),
      async (_instance, state) => state.storage.sql.exec<{
        count: number;
      } & Record<string, SqlStorageValue>>("SELECT COUNT(*) AS count FROM sessions").one().count,
    );
    expect(sessionCount).toBe(0);
  }, 60_000);

  it("retains replay evidence and revokes sessions at the rotation cap", async () => {
    const registration = await register("HistoryUser", PASSWORD);
    const oldestRefreshToken = registration.payload.session.refreshToken;
    let refreshToken = registration.payload.session.refreshToken;
    let accessToken = registration.payload.session.accessToken;
    for (let index = 0; index < 70; index += 1) {
      const rotated = await post(
        "/internal/auth/refresh",
        { refreshToken },
        `198.51.101.${index + 1}`,
      );
      refreshToken = rotated.payload.session.refreshToken;
      accessToken = rotated.payload.session.accessToken;
    }
    const counts = await runInDurableObject(
      accountEnv.ACCOUNTS.getByName("global"),
      async (_instance, state) => ({
        access: state.storage.sql.exec<{ count: number } & Record<string, SqlStorageValue>>(
          "SELECT COUNT(*) AS count FROM used_access_tokens",
        ).one().count,
        refresh: state.storage.sql.exec<{ count: number } & Record<string, SqlStorageValue>>(
          "SELECT COUNT(*) AS count FROM used_refresh_tokens",
        ).one().count,
      }),
    );
    expect(counts).toEqual({ access: 70, refresh: 70 });
    await runInDurableObject(accountEnv.ACCOUNTS.getByName("global"), async (_instance, state) => {
      state.storage.sql.exec("UPDATE used_refresh_tokens SET used_at = ?", Date.now() - 6_000);
    });
    const replayed = await rawPost("/internal/auth/refresh", {
      refreshToken: oldestRefreshToken,
    }, "198.51.101.100");
    expect(replayed.status).toBe(401);
    const revoked = await accountRequest("/internal/auth/me", undefined, accessToken);
    expect(revoked.status).toBe(401);

    const capped = await register("CappedUser", PASSWORD, "CappedUser", "198.51.101.101");
    await runInDurableObject(accountEnv.ACCOUNTS.getByName("global"), async (_instance, state) => {
      state.storage.sql.exec("UPDATE sessions SET rotation_count = 4096 WHERE account_id = ?", capped.payload.user.id);
    });
    const overCap = await rawPost("/internal/auth/refresh", {
      refreshToken: capped.payload.session.refreshToken,
    }, "198.51.101.102");
    expect(overCap.status).toBe(401);
  }, 60_000);

  it("logs out idempotently and invalidates both session tokens", async () => {
    const registration = await register("LogoutUser", PASSWORD);
    const session = registration.payload.session;
    const first = await accountRequest(
      "/internal/auth/logout",
      { refreshToken: session.refreshToken },
      session.accessToken,
    );
    const second = await accountRequest(
      "/internal/auth/logout",
      { refreshToken: session.refreshToken },
      session.accessToken,
    );
    expect(first.status).toBe(204);
    expect(second.status).toBe(204);

    const me = await accountRequest("/internal/auth/me", undefined, session.accessToken);
    const refresh = await rawPost("/internal/auth/refresh", { refreshToken: session.refreshToken });
    expect(me.status).toBe(401);
    expect(refresh.status).toBe(401);
  }, 60_000);

  it("expires access independently and enforces the refresh-session lifetime", async () => {
    const registration = await register("ExpiryUser", PASSWORD);
    const original = registration.payload.session;
    await runInDurableObject(accountEnv.ACCOUNTS.getByName("global"), async (_instance, state) => {
      state.storage.sql.exec("UPDATE sessions SET access_expires_at = ?", Date.now() - 1);
    });

    const expiredAccess = await accountRequest("/internal/auth/me", undefined, original.accessToken);
    expect(expiredAccess.status).toBe(401);
    const refreshed = await post("/internal/auth/refresh", { refreshToken: original.refreshToken });
    expect(refreshed.response.status).toBe(200);

    await runInDurableObject(accountEnv.ACCOUNTS.getByName("global"), async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE sessions SET refresh_expires_at = ?, absolute_expires_at = ?",
        Date.now() - 1,
        Date.now() - 1,
      );
    });
    const expiredRefresh = await rawPost("/internal/auth/refresh", {
      refreshToken: refreshed.payload.session.refreshToken,
    });
    expect(expiredRefresh.status).toBe(401);
  }, 60_000);

  it("changes a password and revokes every older session", async () => {
    const registration = await register("PasswordUser", PASSWORD);
    const secondLogin = await post("/internal/auth/login", {
      username: "PasswordUser",
      password: PASSWORD,
    }, "198.51.100.20");
    const changed = await post("/internal/auth/password", {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    }, "198.51.100.21", registration.payload.session.accessToken);
    expect(changed.response.status).toBe(200);

    const firstOldAccess = await accountRequest(
      "/internal/auth/me",
      undefined,
      registration.payload.session.accessToken,
    );
    const secondOldAccess = await accountRequest(
      "/internal/auth/me",
      undefined,
      secondLogin.payload.session.accessToken,
    );
    expect(firstOldAccess.status).toBe(401);
    expect(secondOldAccess.status).toBe(401);

    const oldLogin = await rawPost("/internal/auth/login", {
      username: "PasswordUser",
      password: PASSWORD,
    }, "198.51.100.22");
    const newLogin = await post("/internal/auth/login", {
      username: "PasswordUser",
      password: NEW_PASSWORD,
    }, "198.51.100.23");
    expect(oldLogin.status).toBe(401);
    expect(newLogin.response.status).toBe(200);
    const freshAccess = await accountRequest(
      "/internal/auth/me",
      undefined,
      changed.payload.session.accessToken,
    );
    expect(freshAccess.status).toBe(200);
  }, 60_000);

  it("enforces username, display-name, password, and request constraints", async () => {
    const invalidUsername = await rawPost("/internal/auth/register", {
      username: "用戶名",
      password: PASSWORD,
    }, "198.51.100.30");
    const shortPassword = await rawPost("/internal/auth/register", {
      username: "ValidUser",
      password: "too short",
    }, "198.51.100.31");
    const longDisplayName = await rawPost("/internal/auth/register", {
      username: "ValidUser",
      password: PASSWORD,
      displayName: "x".repeat(21),
    }, "198.51.100.32");
    const wrongContentType = await accountEnv.ACCOUNTS.getByName("global").fetch(new Request(
      "https://accounts/internal/auth/register",
      { method: "POST", body: JSON.stringify({ username: "ValidUser", password: PASSWORD }) },
    ));

    expect(invalidUsername.status).toBe(400);
    expect(shortPassword.status).toBe(400);
    expect(longDisplayName.status).toBe(400);
    expect(wrongContentType.status).toBe(400);
    expect(invalidUsername.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rate-limits abusive clients and rejects oversized streamed bodies", async () => {
    const address = "198.51.100.40";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await rawPost("/internal/auth/login", {
        username: "x",
        password: PASSWORD,
      }, address);
      expect(response.status).toBe(401);
    }
    const limited = await rawPost("/internal/auth/login", {
      username: "x",
      password: PASSWORD,
    }, address);
    expect(limited.status).toBe(429);

    const oversizedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`{"username":"ValidUser","password":"${"x".repeat(4_100)}`));
        controller.enqueue(new TextEncoder().encode('"}'));
        controller.close();
      },
    });
    const oversized = await accountEnv.ACCOUNTS.getByName("global").fetch(new Request(
      "https://accounts/internal/auth/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.41" },
        body: oversizedBody,
      },
    ));
    expect(oversized.status).toBe(400);
  });
});

async function register(
  username: string,
  password: string,
  displayName = username,
  address = "198.51.100.1",
): Promise<{ response: Response; payload: AuthPayload }> {
  return post("/internal/auth/register", { username, password, displayName }, address);
}

async function post(
  path: string,
  body: Record<string, unknown>,
  address = "198.51.100.1",
  accessToken?: string,
): Promise<{ response: Response; payload: AuthPayload }> {
  const response = await accountRequest(path, body, accessToken, address);
  const payload = await response.clone().json() as AuthPayload;
  return { response, payload };
}

async function rawPost(
  path: string,
  body: Record<string, unknown>,
  address = "198.51.100.1",
): Promise<Response> {
  return accountRequest(path, body, undefined, address);
}

async function accountRequest(
  path: string,
  body?: Record<string, unknown>,
  accessToken?: string,
  address = "198.51.100.1",
): Promise<Response> {
  const headers = new Headers({ "CF-Connecting-IP": address });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  return accountEnv.ACCOUNTS.getByName("global").fetch(new Request(`https://accounts${path}`, {
    method: body === undefined && path.endsWith("/me") ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}
