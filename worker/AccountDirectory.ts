import { DurableObject } from "cloudflare:workers";
import type { WorkerEnv } from "./env";

interface AccountRow extends Record<string, SqlStorageValue> {
  id: string;
  username: string;
  username_key: string;
  display_name: string;
  password_algorithm: string;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  password_revision: number;
  session_revision: number;
  disabled_at: number | null;
  created_at: number;
  updated_at: number;
}

interface SessionRow extends Record<string, SqlStorageValue> {
  id: string;
  account_id: string;
  access_hash: string;
  refresh_hash: string;
  access_expires_at: number;
  refresh_expires_at: number;
  absolute_expires_at: number;
  rotation_count: number;
  created_at: number;
  updated_at: number;
}

interface UsedRefreshRow extends Record<string, SqlStorageValue> {
  session_id: string;
  used_at: number;
}

interface SessionMaterial {
  accessToken: string;
  refreshToken: string;
  accessHash: string;
  refreshHash: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
  absoluteExpiresAt: number;
}

const PASSWORD_ALGORITHM = "PBKDF2-SHA-256";
const PASSWORD_ITERATIONS = 100_000;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_HASH_BYTES = 32;
const MIN_PASSWORD_CHARACTERS = 12;
const MAX_PASSWORD_CHARACTERS = 128;
const MAX_PASSWORD_BYTES = 512;
const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1_000;
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const REFRESH_RACE_GRACE_MS = 5_000;
const MAX_ACTIVE_SESSIONS = 10;
const MAX_SESSION_ROTATIONS = 4_096;
const MAX_REQUEST_BYTES = 4_096;
const DUMMY_PASSWORD_SALT = new Uint8Array(PASSWORD_SALT_BYTES);
const DUMMY_PASSWORD_HASH = new Uint8Array(PASSWORD_HASH_BYTES);
const textEncoder = new TextEncoder();

export class AccountDirectory extends DurableObject<WorkerEnv> {
  public constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env);
    const sql = this.ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      username_key TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_algorithm TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_iterations INTEGER NOT NULL,
      password_revision INTEGER NOT NULL,
      session_revision INTEGER NOT NULL DEFAULT 0,
      disabled_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    const accountColumns = sql.exec<{
      name: string;
    } & Record<string, SqlStorageValue>>("PRAGMA table_info(accounts)").toArray();
    if (!accountColumns.some((column) => column.name === "session_revision")) {
      sql.exec("ALTER TABLE accounts ADD COLUMN session_revision INTEGER NOT NULL DEFAULT 0");
    }
    sql.exec(`CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      access_hash TEXT NOT NULL UNIQUE,
      refresh_hash TEXT NOT NULL UNIQUE,
      access_expires_at INTEGER NOT NULL,
      refresh_expires_at INTEGER NOT NULL,
      absolute_expires_at INTEGER NOT NULL,
      rotation_count INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    sql.exec("CREATE INDEX IF NOT EXISTS sessions_account_id ON sessions(account_id)");
    sql.exec(`CREATE TABLE IF NOT EXISTS used_refresh_tokens (
      token_hash TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      used_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`);
    sql.exec("CREATE INDEX IF NOT EXISTS used_refresh_session_id ON used_refresh_tokens(session_id)");
    sql.exec(`CREATE TABLE IF NOT EXISTS used_access_tokens (
      token_hash TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      used_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`);
    sql.exec("CREATE INDEX IF NOT EXISTS used_access_session_id ON used_access_tokens(session_id)");
    sql.exec(`CREATE TABLE IF NOT EXISTS auth_limits (
      key TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL,
      window_started_at INTEGER NOT NULL,
      blocked_until INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`);
  }

  public async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const now = Date.now();
    this.cleanup(now);

    try {
      if (request.method === "GET" && url.pathname === "/internal/admin/accounts") {
        if (!this.adminCapabilityAllowed(request)) return json({ error: "forbidden" }, 403);
        return this.listAccounts(url);
      }
      const accountAction = /^\/internal\/admin\/accounts\/(account-[a-f0-9-]+)\/(disable|enable|revoke)$/.exec(url.pathname);
      if (request.method === "POST" && accountAction?.[1] && accountAction[2]) {
        if (!this.adminCapabilityAllowed(request)) return json({ error: "forbidden" }, 403);
        if (accountAction[2] === "revoke") return this.revokeAccountSessions(accountAction[1]);
        return this.setAccountDisabled(accountAction[1], accountAction[2] === "disable");
      }
      const accountStatus = /^\/internal\/account-status\/(account-[a-f0-9-]+)$/.exec(url.pathname);
      if (request.method === "GET" && accountStatus?.[1]) {
        if (!this.adminCapabilityAllowed(request)) return json({ error: "forbidden" }, 403);
        const account = this.getAccountById(accountStatus[1]);
        return account
          ? json({ enabled: account.disabled_at === null, sessionRevision: account.session_revision })
          : json({ error: "account-not-found" }, 404);
      }
      if (request.method === "POST" && url.pathname === "/internal/auth/register") {
        return await this.register(request, now);
      }
      if (request.method === "POST" && url.pathname === "/internal/auth/login") {
        return await this.login(request, now);
      }
      if (request.method === "POST" && url.pathname === "/internal/auth/refresh") {
        return await this.refresh(request, now);
      }
      if (request.method === "POST" && url.pathname === "/internal/auth/logout") {
        return await this.logout(request);
      }
      if (request.method === "GET" && url.pathname === "/internal/auth/me") {
        return await this.me(request, now);
      }
      if (request.method === "POST" && url.pathname === "/internal/auth/password") {
        return await this.changePassword(request, now);
      }
      return json({ error: "not-found" }, 404);
    } catch {
      return json({ error: "account-service-error" }, 500);
    }
  }

  private async register(request: Request, now: number): Promise<Response> {
    if (!await this.allowRequest(request, "register", 5, 60 * 60 * 1_000, now)) {
      return json({ error: "rate-limited" }, 429);
    }
    const body = await readJsonObject(request);
    if (!body) return json({ error: "invalid-request" }, 400);
    const username = parseUsername(body.username);
    const password = parsePassword(body.password);
    const displayName = body.displayName === undefined
      ? username?.value ?? null
      : parseDisplayName(body.displayName);
    if (!username || !password || !displayName) return json({ error: "invalid-registration" }, 400);
    if (this.getAccountByUsername(username.key)) return json({ error: "registration-unavailable" }, 409);

    const accountId = `account-${crypto.randomUUID()}`;
    const passwordRecord = await createPasswordRecord(password);
    const material = await createSessionMaterial(now);
    const inserted = this.ctx.storage.transactionSync(() => {
      if (this.getAccountByUsername(username.key)) return false;
      this.ctx.storage.sql.exec(
        `INSERT INTO accounts (
          id, username, username_key, display_name, password_algorithm, password_hash,
          password_salt, password_iterations, password_revision, session_revision, disabled_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, NULL, ?, ?)`,
        accountId,
        username.value,
        username.key,
        displayName,
        PASSWORD_ALGORITHM,
        passwordRecord.hash,
        passwordRecord.salt,
        PASSWORD_ITERATIONS,
        now,
        now,
      );
      this.insertSession(accountId, material, now);
      return true;
    });
    if (!inserted) return json({ error: "registration-unavailable" }, 409);

    return json({
      user: { id: accountId, username: username.value, displayName, createdAt: now },
      session: publicSession(material),
    }, 201);
  }

  private async login(request: Request, now: number): Promise<Response> {
    if (!await this.allowRequest(request, "login", 20, 10 * 60 * 1_000, now)) {
      return json({ error: "rate-limited" }, 429);
    }
    const body = await readJsonObject(request);
    if (!body) return json({ error: "invalid-request" }, 400);
    const username = parseUsername(body.username);
    const password = parsePassword(body.password);
    if (!username || !password) return json({ error: "invalid-credentials" }, 401);
    if (!await this.allowIdentifier(`login:${username.key}`, 20, 10 * 60 * 1_000, now)) {
      return json({ error: "rate-limited" }, 429);
    }

    const account = this.getAccountByUsername(username.key);
    const valid = account
      ? await verifyPassword(password, account)
      : await verifyDummyPassword(password);
    if (!account || !valid || account.disabled_at !== null) return json({ error: "invalid-credentials" }, 401);

    const material = await createSessionMaterial(now);
    const inserted = this.ctx.storage.transactionSync(() => {
      const current = this.getAccountById(account.id);
      if (
        !current
        || current.disabled_at !== null
        || current.password_revision !== account.password_revision
        || current.password_hash !== account.password_hash
      ) {
        return false;
      }
      this.insertSession(account.id, material, now);
      return true;
    });
    if (!inserted) return json({ error: "invalid-credentials" }, 401);
    return json({ user: publicAccount(account), session: publicSession(material) });
  }

  private async refresh(request: Request, now: number): Promise<Response> {
    if (!await this.allowRequest(request, "refresh", 60, 60 * 1_000, now)) {
      return json({ error: "rate-limited" }, 429);
    }
    const body = await readJsonObject(request);
    const refreshToken = parseToken(body?.refreshToken, "llr_");
    if (!refreshToken) return json({ error: "invalid-session" }, 401);
    const refreshHash = await hashToken(refreshToken);
    const session = this.getSessionByRefreshHash(refreshHash);
    if (!session) return this.handleUsedRefresh(refreshHash, now);
    if (session.refresh_expires_at <= now || session.absolute_expires_at <= now) {
      this.deleteSession(session.id);
      return json({ error: "invalid-session" }, 401);
    }
    if (session.rotation_count >= MAX_SESSION_ROTATIONS) {
      this.deleteSession(session.id);
      return json({ error: "invalid-session" }, 401);
    }

    const material = await createSessionMaterial(now, session.absolute_expires_at);
    const rotated = this.ctx.storage.transactionSync(() => {
      const current = this.getSessionById(session.id);
      if (
        !current
        || current.refresh_hash !== refreshHash
        || current.rotation_count >= MAX_SESSION_ROTATIONS
      ) return false;
      this.ctx.storage.sql.exec(
        "INSERT INTO used_refresh_tokens (token_hash, session_id, used_at, expires_at) VALUES (?, ?, ?, ?)",
        refreshHash,
        session.id,
        now,
        session.absolute_expires_at,
      );
      this.ctx.storage.sql.exec(
        "INSERT INTO used_access_tokens (token_hash, session_id, used_at, expires_at) VALUES (?, ?, ?, ?)",
        current.access_hash,
        session.id,
        now,
        session.absolute_expires_at,
      );
      this.ctx.storage.sql.exec(
        `UPDATE sessions SET access_hash = ?, refresh_hash = ?, access_expires_at = ?,
          refresh_expires_at = ?, rotation_count = rotation_count + 1, updated_at = ? WHERE id = ?`,
        material.accessHash,
        material.refreshHash,
        material.accessExpiresAt,
        material.refreshExpiresAt,
        now,
        session.id,
      );
      return true;
    });
    if (!rotated) return this.handleUsedRefresh(refreshHash, now);

    const account = this.getAccountById(session.account_id);
    if (!account || account.disabled_at !== null) {
      this.deleteSession(session.id);
      return json({ error: "invalid-session" }, 401);
    }
    return json({ user: publicAccount(account), session: publicSession(material) });
  }

  private async logout(request: Request): Promise<Response> {
    const accessToken = parseBearerToken(request.headers.get("Authorization"));
    const body = request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")
      ? await readJsonObject(request)
      : null;
    const refreshToken = parseToken(body?.refreshToken, "llr_");
    const [accessHash, refreshHash] = await Promise.all([
      accessToken ? hashToken(accessToken) : null,
      refreshToken ? hashToken(refreshToken) : null,
    ]);
    this.ctx.storage.transactionSync(() => {
      const sessionIds = new Set<string>();
      if (accessHash) {
        const session = this.getSessionByAccessHash(accessHash);
        if (session) sessionIds.add(session.id);
        const used = this.getUsedAccessSessionId(accessHash);
        if (used) sessionIds.add(used);
      }
      if (refreshHash) {
        const session = this.getSessionByRefreshHash(refreshHash);
        if (session) sessionIds.add(session.id);
        const used = this.getUsedRefresh(refreshHash);
        if (used) sessionIds.add(used.session_id);
      }
      for (const sessionId of sessionIds) this.deleteSession(sessionId);
    });
    return noContent();
  }

  private async me(request: Request, now: number): Promise<Response> {
    const token = parseBearerToken(request.headers.get("Authorization"));
    if (!token) return json({ error: "invalid-session" }, 401);
    const accessHash = await hashToken(token);
    const session = this.getSessionByAccessHash(accessHash);
    if (!session || session.access_expires_at <= now) return json({ error: "invalid-session" }, 401);
    const account = this.getAccountById(session.account_id);
    if (!account || account.disabled_at !== null) {
      this.deleteSession(session.id);
      return json({ error: "invalid-session" }, 401);
    }
    return json({ user: publicAccount(account) });
  }

  private async changePassword(request: Request, now: number): Promise<Response> {
    if (!await this.allowRequest(request, "password", 5, 60 * 60 * 1_000, now)) {
      return json({ error: "rate-limited" }, 429);
    }
    const token = parseBearerToken(request.headers.get("Authorization"));
    const body = await readJsonObject(request);
    const currentPassword = parsePassword(body?.currentPassword);
    const newPassword = parsePassword(body?.newPassword);
    if (!token) return json({ error: "invalid-session" }, 401);
    if (!currentPassword || !newPassword) return json({ error: "invalid-password" }, 400);
    if (currentPassword === newPassword) return json({ error: "password-unchanged" }, 400);

    const accessHash = await hashToken(token);
    const session = this.getSessionByAccessHash(accessHash);
    if (!session || session.access_expires_at <= now) return json({ error: "invalid-session" }, 401);
    const account = this.getAccountById(session.account_id);
    if (!account || account.disabled_at !== null || !await verifyPassword(currentPassword, account)) {
      return json({ error: "invalid-current-password" }, 401);
    }

    const [passwordRecord, material] = await Promise.all([
      createPasswordRecord(newPassword),
      createSessionMaterial(now),
    ]);
    const changed = this.ctx.storage.transactionSync(() => {
      const currentSession = this.getSessionById(session.id);
      const currentAccount = this.getAccountById(account.id);
      if (
        !currentSession
        || currentSession.access_hash !== accessHash
        || currentSession.access_expires_at <= now
        || !currentAccount
        || currentAccount.disabled_at !== null
        || currentAccount.password_revision !== account.password_revision
        || currentAccount.password_hash !== account.password_hash
      ) {
        return false;
      }
      this.ctx.storage.sql.exec(
        `UPDATE accounts SET password_algorithm = ?, password_hash = ?, password_salt = ?,
          password_iterations = ?, password_revision = password_revision + 1,
          session_revision = session_revision + 1, updated_at = ? WHERE id = ?`,
        PASSWORD_ALGORITHM,
        passwordRecord.hash,
        passwordRecord.salt,
        PASSWORD_ITERATIONS,
        now,
        account.id,
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM used_refresh_tokens WHERE session_id IN (SELECT id FROM sessions WHERE account_id = ?)",
        account.id,
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM used_access_tokens WHERE session_id IN (SELECT id FROM sessions WHERE account_id = ?)",
        account.id,
      );
      this.ctx.storage.sql.exec("DELETE FROM sessions WHERE account_id = ?", account.id);
      this.insertSession(account.id, material, now);
      return true;
    });
    if (!changed) return json({ error: "stale-session" }, 409);

    return json({ user: publicAccount(account), session: publicSession(material) });
  }

  private handleUsedRefresh(refreshHash: string, now: number): Response {
    const used = this.getUsedRefresh(refreshHash);
    if (!used) return json({ error: "invalid-session" }, 401);
    if (now - used.used_at <= REFRESH_RACE_GRACE_MS) return json({ error: "refresh-raced" }, 409);
    this.deleteSession(used.session_id);
    return json({ error: "invalid-session" }, 401);
  }

  private listAccounts(url: URL): Response {
    const query = (url.searchParams.get("q") ?? "").trim();
    if (query.length > 64) return json({ error: "invalid-query" }, 400);
    const limit = clampInteger(url.searchParams.get("limit"), 50, 1, 100);
    const offset = clampInteger(url.searchParams.get("offset"), 0, 0, 100_000);
    const search = `%${escapeLike(query.toLowerCase())}%`;
    const where = query ? "WHERE a.username_key LIKE ? ESCAPE '\\' OR lower(a.display_name) LIKE ? ESCAPE '\\'" : "";
    const bindings = query ? [search, search] : [];
    const rows = this.ctx.storage.sql.exec<{
      id: string;
      username: string;
      display_name: string;
      created_at: number;
      updated_at: number;
      disabled_at: number | null;
      active_sessions: number;
    } & Record<string, SqlStorageValue>>(
      `SELECT a.id, a.username, a.display_name, a.created_at, a.updated_at, a.disabled_at,
        COUNT(s.id) AS active_sessions
      FROM accounts a LEFT JOIN sessions s ON s.account_id = a.id
      ${where}
      GROUP BY a.id
      ORDER BY a.created_at DESC, a.id
      LIMIT ? OFFSET ?`,
      ...bindings,
      limit,
      offset,
    ).toArray();
    const total = this.ctx.storage.sql.exec<{
      total: number;
    } & Record<string, SqlStorageValue>>(
      `SELECT COUNT(*) AS total FROM accounts a ${where}`,
      ...bindings,
    ).one().total;
    return json({
      accounts: rows.map((row) => ({
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        disabledAt: row.disabled_at,
        activeSessions: row.active_sessions,
      })),
      total,
      limit,
      offset,
    });
  }

  private adminCapabilityAllowed(request: Request): boolean {
    const expected = this.env.INTERNAL_ADMIN_TOKEN;
    return Boolean(expected && request.headers.get("X-Admin-Capability") === expected);
  }

  private setAccountDisabled(accountId: string, disabled: boolean): Response {
    return this.ctx.storage.transactionSync(() => {
      const account = this.getAccountById(accountId);
      if (!account) return json({ error: "account-not-found" }, 404);
      const now = Date.now();
      this.ctx.storage.sql.exec(
        `UPDATE accounts SET disabled_at = ?,
          session_revision = session_revision + CASE WHEN ? THEN 1 ELSE 0 END,
          updated_at = ? WHERE id = ?`,
        disabled ? now : null,
        disabled ? 1 : 0,
        now,
        accountId,
      );
      if (disabled) this.deleteAccountSessions(accountId);
      return json({ ok: true, disabledAt: disabled ? now : null });
    });
  }

  private revokeAccountSessions(accountId: string): Response {
    return this.ctx.storage.transactionSync(() => {
      if (!this.getAccountById(accountId)) return json({ error: "account-not-found" }, 404);
      this.ctx.storage.sql.exec(
        "UPDATE accounts SET session_revision = session_revision + 1, updated_at = ? WHERE id = ?",
        Date.now(),
        accountId,
      );
      this.deleteAccountSessions(accountId);
      return json({ ok: true });
    });
  }

  private deleteAccountSessions(accountId: string): void {
    const sessions = this.ctx.storage.sql.exec<{
      id: string;
    } & Record<string, SqlStorageValue>>("SELECT id FROM sessions WHERE account_id = ?", accountId).toArray();
    for (const session of sessions) this.deleteSession(session.id);
  }

  private getAccountByUsername(usernameKey: string): AccountRow | null {
    return first(this.ctx.storage.sql.exec<AccountRow>(
      `SELECT id, username, username_key, display_name, password_algorithm, password_hash, password_salt,
        password_iterations, password_revision, session_revision, disabled_at, created_at, updated_at
      FROM accounts WHERE username_key = ?`,
      usernameKey,
    ));
  }

  private getAccountById(accountId: string): AccountRow | null {
    return first(this.ctx.storage.sql.exec<AccountRow>(
      `SELECT id, username, username_key, display_name, password_algorithm, password_hash, password_salt,
        password_iterations, password_revision, session_revision, disabled_at, created_at, updated_at
      FROM accounts WHERE id = ?`,
      accountId,
    ));
  }

  private getSessionById(sessionId: string): SessionRow | null {
    return first(this.ctx.storage.sql.exec<SessionRow>("SELECT * FROM sessions WHERE id = ?", sessionId));
  }

  private getSessionByAccessHash(accessHash: string): SessionRow | null {
    return first(this.ctx.storage.sql.exec<SessionRow>("SELECT * FROM sessions WHERE access_hash = ?", accessHash));
  }

  private getSessionByRefreshHash(refreshHash: string): SessionRow | null {
    return first(this.ctx.storage.sql.exec<SessionRow>("SELECT * FROM sessions WHERE refresh_hash = ?", refreshHash));
  }

  private getUsedRefresh(refreshHash: string): UsedRefreshRow | null {
    return first(this.ctx.storage.sql.exec<UsedRefreshRow>(
      "SELECT session_id, used_at FROM used_refresh_tokens WHERE token_hash = ?",
      refreshHash,
    ));
  }

  private getUsedAccessSessionId(accessHash: string): string | null {
    const row = first(this.ctx.storage.sql.exec<{
      session_id: string;
    } & Record<string, SqlStorageValue>>(
      "SELECT session_id FROM used_access_tokens WHERE token_hash = ?",
      accessHash,
    ));
    return row?.session_id ?? null;
  }

  private insertSession(accountId: string, material: SessionMaterial, now: number): void {
    const sessions = this.ctx.storage.sql.exec<{ id: string } & Record<string, SqlStorageValue>>(
      "SELECT id FROM sessions WHERE account_id = ? ORDER BY created_at ASC",
      accountId,
    ).toArray();
    const removeCount = Math.max(0, sessions.length - MAX_ACTIVE_SESSIONS + 1);
    for (const row of sessions.slice(0, removeCount)) this.deleteSession(row.id);
    this.ctx.storage.sql.exec(
      `INSERT INTO sessions (
        id, account_id, access_hash, refresh_hash, access_expires_at,
        refresh_expires_at, absolute_expires_at, rotation_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      `session-${crypto.randomUUID()}`,
      accountId,
      material.accessHash,
      material.refreshHash,
      material.accessExpiresAt,
      material.refreshExpiresAt,
      material.absoluteExpiresAt,
      now,
      now,
    );
  }

  private deleteSession(sessionId: string): void {
    this.ctx.storage.sql.exec("DELETE FROM used_refresh_tokens WHERE session_id = ?", sessionId);
    this.ctx.storage.sql.exec("DELETE FROM used_access_tokens WHERE session_id = ?", sessionId);
    this.ctx.storage.sql.exec("DELETE FROM sessions WHERE id = ?", sessionId);
  }

  private cleanup(now: number): void {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "DELETE FROM used_refresh_tokens WHERE expires_at <= ? OR session_id NOT IN (SELECT id FROM sessions)",
        now,
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM used_access_tokens WHERE expires_at <= ? OR session_id NOT IN (SELECT id FROM sessions)",
        now,
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM sessions WHERE refresh_expires_at <= ? OR absolute_expires_at <= ?",
        now,
        now,
      );
      this.ctx.storage.sql.exec("DELETE FROM auth_limits WHERE expires_at <= ?", now);
    });
  }

  private async allowRequest(
    request: Request,
    scope: string,
    limit: number,
    windowMs: number,
    now: number,
  ): Promise<boolean> {
    const address = request.headers.get("CF-Connecting-IP") ?? "unidentified";
    return this.allowIdentifier(`${scope}:${address}`, limit, windowMs, now);
  }

  private async allowIdentifier(
    identifier: string,
    limit: number,
    windowMs: number,
    now: number,
  ): Promise<boolean> {
    const key = await hashToken(identifier);
    return this.ctx.storage.transactionSync(() => {
      const row = first(this.ctx.storage.sql.exec<{
        attempts: number;
        window_started_at: number;
        blocked_until: number;
      } & Record<string, SqlStorageValue>>(
        "SELECT attempts, window_started_at, blocked_until FROM auth_limits WHERE key = ?",
        key,
      ));
      if (row?.blocked_until && row.blocked_until > now) return false;
      if (!row || now - row.window_started_at >= windowMs) {
        this.ctx.storage.sql.exec(
          `INSERT INTO auth_limits (key, attempts, window_started_at, blocked_until, expires_at)
            VALUES (?, 1, ?, 0, ?) ON CONFLICT(key) DO UPDATE SET
            attempts = 1, window_started_at = excluded.window_started_at,
            blocked_until = 0, expires_at = excluded.expires_at`,
          key,
          now,
          now + windowMs * 2,
        );
        return true;
      }
      if (row.attempts >= limit) {
        this.ctx.storage.sql.exec(
          "UPDATE auth_limits SET blocked_until = ?, expires_at = ? WHERE key = ?",
          now + windowMs,
          now + windowMs * 2,
          key,
        );
        return false;
      }
      this.ctx.storage.sql.exec(
        "UPDATE auth_limits SET attempts = attempts + 1, expires_at = ? WHERE key = ?",
        now + windowMs * 2,
        key,
      );
      return true;
    });
  }
}

function first<T extends Record<string, SqlStorageValue>>(cursor: SqlStorageCursor<T>): T | null {
  return cursor.toArray()[0] ?? null;
}

function parseUsername(value: unknown): { value: string; key: string } | null {
  if (typeof value !== "string") return null;
  const username = value.trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return null;
  return { value: username, key: username.toLowerCase() };
}

function parseDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const displayName = value.trim().replace(/\s+/g, " ");
  return displayName.length >= 1 && displayName.length <= 20 ? displayName : null;
}

function parsePassword(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const password = value.normalize("NFC");
  const characters = Array.from(password).length;
  const bytes = textEncoder.encode(password).byteLength;
  return characters >= MIN_PASSWORD_CHARACTERS
    && characters <= MAX_PASSWORD_CHARACTERS
    && bytes <= MAX_PASSWORD_BYTES
    ? password
    : null;
}

function parseToken(value: unknown, prefix: "lla_" | "llr_"): string | null {
  return typeof value === "string" && new RegExp(`^${prefix}[A-Za-z0-9_-]{43}$`).test(value)
    ? value
    : null;
}

function parseBearerToken(value: string | null): string | null {
  if (!value?.startsWith("Bearer ")) return null;
  return parseToken(value.slice(7), "lla_");
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) return null;
  try {
    const declaredLength = Number(request.headers.get("Content-Length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) return null;
    if (!request.body) return null;
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function createPasswordRecord(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(PASSWORD_SALT_BYTES);
  const hash = await derivePassword(password, salt, PASSWORD_ITERATIONS);
  return { hash: encodeBase64Url(hash), salt: encodeBase64Url(salt) };
}

async function verifyPassword(password: string, account: AccountRow): Promise<boolean> {
  if (account.password_algorithm !== PASSWORD_ALGORITHM || account.password_iterations !== PASSWORD_ITERATIONS) {
    return false;
  }
  const actual = await derivePassword(password, decodeBase64Url(account.password_salt), account.password_iterations);
  const expected = decodeBase64Url(account.password_hash);
  return actual.byteLength === expected.byteLength && crypto.subtle.timingSafeEqual(actual, expected);
}

async function verifyDummyPassword(password: string): Promise<boolean> {
  const actual = await derivePassword(password, DUMMY_PASSWORD_SALT, PASSWORD_ITERATIONS);
  return crypto.subtle.timingSafeEqual(actual, DUMMY_PASSWORD_HASH);
}

async function derivePassword(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", textEncoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    PASSWORD_HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

async function createSessionMaterial(now: number, existingAbsoluteExpiry?: number): Promise<SessionMaterial> {
  const accessToken = `lla_${encodeBase64Url(randomBytes(32))}`;
  const refreshToken = `llr_${encodeBase64Url(randomBytes(32))}`;
  const absoluteExpiresAt = existingAbsoluteExpiry ?? now + SESSION_TTL_MS;
  const [accessHash, refreshHash] = await Promise.all([hashToken(accessToken), hashToken(refreshToken)]);
  return {
    accessToken,
    refreshToken,
    accessHash,
    refreshHash,
    accessExpiresAt: Math.min(now + ACCESS_TOKEN_TTL_MS, absoluteExpiresAt),
    refreshExpiresAt: Math.min(now + REFRESH_TOKEN_TTL_MS, absoluteExpiresAt),
    absoluteExpiresAt,
  };
}

async function hashToken(token: string): Promise<string> {
  return encodeBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(token))));
}

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function publicAccount(account: AccountRow): Record<string, unknown> {
  return {
    id: account.id,
    username: account.username,
    displayName: account.display_name,
    createdAt: account.created_at,
    sessionRevision: account.session_revision,
  };
}

function publicSession(material: SessionMaterial): Record<string, unknown> {
  return {
    tokenType: "Bearer",
    accessToken: material.accessToken,
    accessExpiresAt: material.accessExpiresAt,
    refreshToken: material.refreshToken,
    refreshExpiresAt: material.refreshExpiresAt,
  };
}

function clampInteger(value: string | null, fallback: number, minimum: number, maximum: number): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function noContent(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
