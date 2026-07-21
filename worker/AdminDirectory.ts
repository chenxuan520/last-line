import {
  DurableService,
  type PlatformDurableObjectState,
  type PlatformSqlCursor,
  type PlatformSqlValue,
} from "../src/server/platform/DurableService";
import type { WorkerEnv } from "./env";

interface AdminRow extends Record<string, PlatformSqlValue> {
  id: string;
  username: string;
  username_key: string;
  password_hash: string;
  password_salt: string;
  password_revision: number;
  created_at: number;
  updated_at: number;
}

interface AdminSessionRow extends Record<string, PlatformSqlValue> {
  id: string;
  admin_id: string;
  token_hash: string;
  expires_at: number;
  created_at: number;
}

interface TurnstileResult {
  success?: boolean;
  hostname?: string;
  action?: string;
}

const PASSWORD_ITERATIONS = 100_000;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_HASH_BYTES = 32;
const MIN_PASSWORD_CHARACTERS = 6;
const MAX_PASSWORD_CHARACTERS = 128;
const MAX_PASSWORD_BYTES = 512;
const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1_000;
const ADMIN_COOKIE = "__Host-lastline_admin";
const MAX_REQUEST_BYTES = 8_192;
const textEncoder = new TextEncoder();
const DUMMY_SALT = new Uint8Array(PASSWORD_SALT_BYTES);
const DUMMY_HASH = new Uint8Array(PASSWORD_HASH_BYTES);

export class AdminDirectory extends DurableService<WorkerEnv> {
  public constructor(ctx: PlatformDurableObjectState, env: WorkerEnv) {
    super(ctx, env);
    const sql = this.ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS administrators (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      username_key TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_revision INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS administrator_sessions (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`);
    sql.exec("CREATE INDEX IF NOT EXISTS administrator_sessions_admin ON administrator_sessions(admin_id)");
    sql.exec(`CREATE TABLE IF NOT EXISTS administrator_limits (
      key TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL,
      window_started_at INTEGER NOT NULL,
      blocked_until INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS administrator_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS administrator_reset_uses (
      token_hash TEXT PRIMARY KEY,
      used_at INTEGER NOT NULL
    )`);
  }

  public async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const now = Date.now();
    this.cleanup(now);
    try {
      if (request.method === "GET" && url.pathname === "/internal/auth-policy") {
        return this.adminCapabilityAllowed(request)
          ? json({ registrationLoginRequired: this.registrationLoginRequired() })
          : json({ error: "forbidden" }, 403);
      }
      if (request.method === "GET" && url.pathname === "/v1/admin/status") return await this.status(request, now);
      if (request.method === "POST" && url.pathname === "/v1/admin/bootstrap") {
        return await this.bootstrap(request, now);
      }
      if (request.method === "POST" && url.pathname === "/v1/admin/reset") {
        return await this.resetPassword(request, now);
      }
      if (request.method === "POST" && url.pathname === "/v1/admin/login") return await this.login(request, now);
      if (request.method === "POST" && url.pathname === "/v1/admin/logout") return await this.logout(request);

      const authenticated = await this.authenticate(request, now);
      if (!authenticated) return json({ error: "unauthorized" }, 401);
      if (request.method !== "GET" && !sameOrigin(request)) return json({ error: "forbidden" }, 403);
      if (request.method === "GET" && url.pathname === "/v1/admin/me") {
        return json({ administrator: publicAdmin(authenticated.admin) });
      }
      if (request.method === "POST" && url.pathname === "/v1/admin/password") {
        return await this.changePassword(request, authenticated, now);
      }
      if (request.method === "GET" && url.pathname === "/v1/admin/settings") {
        return json({ registrationLoginRequired: this.registrationLoginRequired() });
      }
      if (request.method === "POST" && url.pathname === "/v1/admin/settings/auth") {
        return await this.setRegistrationLoginRequired(request, now);
      }
      if (request.method === "GET" && url.pathname === "/v1/admin/accounts") {
        return this.forwardAccounts(url);
      }
      const accountAction = /^\/v1\/admin\/accounts\/(account-[a-f0-9-]+)\/(disable|enable|revoke)$/.exec(url.pathname);
      if (request.method === "POST" && accountAction?.[1] && accountAction[2]) {
        return this.forwardAccountAction(accountAction[1], accountAction[2]);
      }
      if (request.method === "GET" && url.pathname === "/v1/admin/rooms") return this.forwardRooms();
      const roomClose = /^\/v1\/admin\/rooms\/(room-[a-f0-9-]+)\/close$/.exec(url.pathname);
      if (request.method === "POST" && roomClose?.[1]) return this.closeRoom(roomClose[1]);
      return json({ error: "not-found" }, 404);
    } catch (error) {
      console.error("AdminDirectory request failed", error instanceof Error ? error.stack ?? error.message : String(error));
      return json({ error: "admin-service-error" }, 500);
    }
  }

  private async status(request: Request, now: number): Promise<Response> {
    const turnstile = this.turnstileConfiguration();
    if (turnstile === "invalid") return json({ error: "turnstile-misconfigured" }, 503);
    const authenticated = await this.authenticate(request, now);
    return json({
      needsBootstrap: this.administratorCount() === 0,
      bootstrapConfigured: Boolean(this.env.ADMIN_BOOTSTRAP_TOKEN),
      resetConfigured: Boolean(this.env.ADMIN_RESET_TOKEN),
      administrator: authenticated ? publicAdmin(authenticated.admin) : null,
      turnstile: turnstile
        ? { enabled: true, siteKey: turnstile.siteKey }
        : { enabled: false, siteKey: null },
    });
  }

  private async bootstrap(request: Request, now: number): Promise<Response> {
    if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
    if (!await this.allowRequest(request, "bootstrap", 10, 60 * 60 * 1_000, now)) {
      return json({ error: "rate-limited" }, 429);
    }
    if (this.administratorCount() !== 0) return json({ error: "bootstrap-complete" }, 409);
    const body = await readJsonObject(request);
    const username = parseUsername(body?.username);
    const password = parsePassword(body?.password);
    const bootstrapToken = typeof body?.bootstrapToken === "string" ? body.bootstrapToken : "";
    const expectedToken = this.env.ADMIN_BOOTSTRAP_TOKEN ?? "";
    if (!username || !password || !expectedToken || !await secureTextEqual(bootstrapToken, expectedToken)) {
      return json({ error: "invalid-bootstrap" }, 401);
    }
    if (!await this.verifyTurnstile(request, body?.turnstileToken, "admin_bootstrap")) {
      return json({ error: "turnstile-failed" }, 403);
    }

    const administratorId = `admin-${crypto.randomUUID()}`;
    const passwordRecord = await createPasswordRecord(password);
    const session = await createAdminSession(now);
    const created = this.ctx.storage.transactionSync(() => {
      if (this.administratorCount() !== 0) return false;
      this.ctx.storage.sql.exec(
        `INSERT INTO administrators (
          id, username, username_key, password_hash, password_salt,
          password_revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        administratorId,
        username.value,
        username.key,
        passwordRecord.hash,
        passwordRecord.salt,
        now,
        now,
      );
      this.insertSession(administratorId, session.hash, session.expiresAt, now);
      return true;
    });
    if (!created) return json({ error: "bootstrap-complete" }, 409);
    return sessionResponse(
      { id: administratorId, username: username.value, createdAt: now },
      session.token,
      session.expiresAt,
      201,
    );
  }

  private async login(request: Request, now: number): Promise<Response> {
    if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
    if (!await this.allowRequest(request, "login", 20, 10 * 60 * 1_000, now)) {
      return json({ error: "rate-limited" }, 429);
    }
    const body = await readJsonObject(request);
    const username = parseUsername(body?.username);
    const password = parsePassword(body?.password);
    if (!username || !password) return json({ error: "invalid-credentials" }, 401);
    if (!await this.allowIdentifier(`login:${username.key}`, 20, 10 * 60 * 1_000, now)) {
      return json({ error: "rate-limited" }, 429);
    }
    if (!await this.verifyTurnstile(request, body?.turnstileToken, "admin_login")) {
      return json({ error: "turnstile-failed" }, 403);
    }

    const administrator = this.getAdministratorByUsername(username.key);
    const valid = administrator
      ? await verifyPassword(password, administrator.password_salt, administrator.password_hash)
      : await verifyDummyPassword(password);
    if (!administrator || !valid) return json({ error: "invalid-credentials" }, 401);
    const session = await createAdminSession(now);
    const inserted = this.ctx.storage.transactionSync(() => {
      const current = this.getAdministratorById(administrator.id);
      if (
        !current
        || current.password_revision !== administrator.password_revision
        || current.password_hash !== administrator.password_hash
      ) return false;
      this.insertSession(administrator.id, session.hash, session.expiresAt, now);
      return true;
    });
    if (!inserted) return json({ error: "invalid-credentials" }, 401);
    return sessionResponse(
      { id: administrator.id, username: username.value, createdAt: administrator.created_at },
      session.token,
      session.expiresAt,
    );
  }

  private async resetPassword(request: Request, now: number): Promise<Response> {
    if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
    if (!await this.allowRequest(request, "reset", 10, 60 * 60 * 1_000, now)) {
      return json({ error: "rate-limited" }, 429);
    }
    if (this.administratorCount() !== 1) return json({ error: "reset-unavailable" }, 409);
    const body = await readJsonObject(request);
    const username = parseUsername(body?.username);
    const newPassword = parsePassword(body?.newPassword);
    const resetToken = typeof body?.resetToken === "string" ? body.resetToken : "";
    const expectedToken = this.env.ADMIN_RESET_TOKEN ?? "";
    if (!username || !newPassword || !expectedToken || !await secureTextEqual(resetToken, expectedToken)) {
      return json({ error: "invalid-reset" }, 401);
    }
    const resetHash = await hashText(resetToken);
    if (first(this.ctx.storage.sql.exec<Record<string, PlatformSqlValue>>(
      "SELECT token_hash FROM administrator_reset_uses WHERE token_hash = ?",
      resetHash,
    ))) return json({ error: "invalid-reset" }, 401);
    if (!await this.verifyTurnstile(request, body?.turnstileToken, "admin_reset")) {
      return json({ error: "turnstile-failed" }, 403);
    }
    const administrator = this.onlyAdministrator();
    if (!administrator) return json({ error: "reset-unavailable" }, 409);
    const [record, session] = await Promise.all([createPasswordRecord(newPassword), createAdminSession(now)]);
    const changed = this.ctx.storage.transactionSync(() => {
      const current = this.getAdministratorById(administrator.id);
      if (
        !current
        || this.administratorCount() !== 1
        || current.password_revision !== administrator.password_revision
        || current.password_hash !== administrator.password_hash
      ) return false;
      if (first(this.ctx.storage.sql.exec<Record<string, PlatformSqlValue>>(
        "SELECT token_hash FROM administrator_reset_uses WHERE token_hash = ?",
        resetHash,
      ))) return false;
      this.ctx.storage.sql.exec(
        "INSERT INTO administrator_reset_uses (token_hash, used_at) VALUES (?, ?)",
        resetHash,
        now,
      );
      this.ctx.storage.sql.exec(
        `UPDATE administrators SET username = ?, username_key = ?, password_hash = ?, password_salt = ?,
          password_revision = password_revision + 1, updated_at = ? WHERE id = ?`,
        username.value,
        username.key,
        record.hash,
        record.salt,
        now,
        current.id,
      );
      this.ctx.storage.sql.exec("DELETE FROM administrator_sessions WHERE admin_id = ?", current.id);
      this.insertSession(current.id, session.hash, session.expiresAt, now);
      return true;
    });
    if (!changed) return json({ error: "stale-session" }, 409);
    return sessionResponse(
      { id: administrator.id, username: username.value, createdAt: administrator.created_at },
      session.token,
      session.expiresAt,
    );
  }

  private async logout(request: Request): Promise<Response> {
    if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
    const token = readCookie(request, ADMIN_COOKIE);
    if (token) {
      const hash = await hashText(token);
      this.ctx.storage.sql.exec("DELETE FROM administrator_sessions WHERE token_hash = ?", hash);
    }
    return new Response(null, {
      status: 204,
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": clearAdminCookie(),
      },
    });
  }

  private async authenticate(
    request: Request,
    now: number,
  ): Promise<{ admin: AdminRow; session: AdminSessionRow } | null> {
    const token = readCookie(request, ADMIN_COOKIE);
    if (!token) return null;
    const hash = await hashText(token);
    const session = first(this.ctx.storage.sql.exec<AdminSessionRow>(
      "SELECT * FROM administrator_sessions WHERE token_hash = ? AND expires_at > ?",
      hash,
      now,
    ));
    if (!session) return null;
    const admin = this.getAdministratorById(session.admin_id);
    if (!admin) {
      this.ctx.storage.sql.exec("DELETE FROM administrator_sessions WHERE id = ?", session.id);
      return null;
    }
    return { admin, session };
  }

  private async changePassword(
    request: Request,
    authenticated: { admin: AdminRow; session: AdminSessionRow },
    now: number,
  ): Promise<Response> {
    if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
    const body = await readJsonObject(request);
    const currentPassword = parsePassword(body?.currentPassword);
    const newPassword = parsePassword(body?.newPassword);
    if (!currentPassword || !newPassword) return json({ error: "invalid-password" }, 400);
    if (currentPassword === newPassword) return json({ error: "password-unchanged" }, 400);
    if (!await verifyPassword(
      currentPassword,
      authenticated.admin.password_salt,
      authenticated.admin.password_hash,
    )) return json({ error: "invalid-current-password" }, 401);
    const [record, session] = await Promise.all([createPasswordRecord(newPassword), createAdminSession(now)]);
    const changed = this.ctx.storage.transactionSync(() => {
      const current = this.getAdministratorById(authenticated.admin.id);
      const currentSession = first(this.ctx.storage.sql.exec<AdminSessionRow>(
        "SELECT * FROM administrator_sessions WHERE id = ?",
        authenticated.session.id,
      ));
      if (
        !current
        || !currentSession
        || current.password_revision !== authenticated.admin.password_revision
        || current.password_hash !== authenticated.admin.password_hash
      ) return false;
      this.ctx.storage.sql.exec(
        `UPDATE administrators SET password_hash = ?, password_salt = ?,
          password_revision = password_revision + 1, updated_at = ? WHERE id = ?`,
        record.hash,
        record.salt,
        now,
        current.id,
      );
      this.ctx.storage.sql.exec("DELETE FROM administrator_sessions WHERE admin_id = ?", current.id);
      this.insertSession(current.id, session.hash, session.expiresAt, now);
      return true;
    });
    if (!changed) return json({ error: "stale-session" }, 409);
    return sessionResponse(publicAdmin(authenticated.admin), session.token, session.expiresAt);
  }

  private forwardAccounts(url: URL): Promise<Response> {
    const internal = new URL("https://accounts/internal/admin/accounts");
    internal.search = url.search;
    return this.env.ACCOUNTS.getByName("global").fetch(new Request(internal, {
      headers: this.adminCapabilityHeaders(),
    }));
  }

  private async setRegistrationLoginRequired(request: Request, now: number): Promise<Response> {
    const body = await readJsonObject(request);
    if (typeof body?.required !== "boolean") return json({ error: "invalid-setting" }, 400);
    this.ctx.storage.sql.exec(
      `INSERT INTO administrator_settings (key, value, updated_at) VALUES ('registration-login-required', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      body.required ? "1" : "0",
      now,
    );
    return json({ registrationLoginRequired: body.required });
  }

  private registrationLoginRequired(): boolean {
    const row = first(this.ctx.storage.sql.exec<{
      value: string;
    } & Record<string, PlatformSqlValue>>(
      "SELECT value FROM administrator_settings WHERE key = 'registration-login-required'",
    ));
    return row?.value === "1";
  }

  private forwardAccountAction(accountId: string, action: string): Promise<Response> {
    return this.env.ACCOUNTS.getByName("global").fetch(new Request(
      `https://accounts/internal/admin/accounts/${encodeURIComponent(accountId)}/${action}`,
      { method: "POST", headers: this.adminCapabilityHeaders() },
    ));
  }

  private forwardRooms(): Promise<Response> {
    return this.env.LOBBY.getByName("global").fetch(new Request("https://lobby/internal/admin/rooms", {
      headers: this.adminCapabilityHeaders(),
    }));
  }

  private closeRoom(roomId: string): Promise<Response> {
    return this.env.LOBBY.getByName("global").fetch(new Request(
      `https://lobby/internal/admin/rooms/${encodeURIComponent(roomId)}/close`,
      { method: "POST", headers: this.adminCapabilityHeaders() },
    ));
  }

  private getAdministratorByUsername(usernameKey: string): AdminRow | null {
    return first(this.ctx.storage.sql.exec<AdminRow>(
      `SELECT id, username, username_key, password_hash, password_salt,
        password_revision, created_at, updated_at
      FROM administrators WHERE username_key = ?`,
      usernameKey,
    ));
  }

  private getAdministratorById(administratorId: string): AdminRow | null {
    return first(this.ctx.storage.sql.exec<AdminRow>(
      `SELECT id, username, username_key, password_hash, password_salt,
        password_revision, created_at, updated_at
      FROM administrators WHERE id = ?`,
      administratorId,
    ));
  }

  private administratorCount(): number {
    return this.ctx.storage.sql.exec<{
      count: number;
    } & Record<string, PlatformSqlValue>>("SELECT COUNT(*) AS count FROM administrators").one().count;
  }

  private onlyAdministrator(): AdminRow | null {
    const administrators = this.ctx.storage.sql.exec<AdminRow>(
      `SELECT id, username, username_key, password_hash, password_salt,
        password_revision, created_at, updated_at
      FROM administrators LIMIT 2`,
    ).toArray();
    return administrators.length === 1 ? administrators[0] ?? null : null;
  }

  private insertSession(adminId: string, tokenHash: string, expiresAt: number, now: number): void {
    const sessions = this.ctx.storage.sql.exec<{
      id: string;
    } & Record<string, PlatformSqlValue>>(
      "SELECT id FROM administrator_sessions WHERE admin_id = ? ORDER BY created_at",
      adminId,
    ).toArray();
    for (const session of sessions.slice(0, Math.max(0, sessions.length - 4))) {
      this.ctx.storage.sql.exec("DELETE FROM administrator_sessions WHERE id = ?", session.id);
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO administrator_sessions (id, admin_id, token_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)`,
      `admin-session-${crypto.randomUUID()}`,
      adminId,
      tokenHash,
      expiresAt,
      now,
    );
  }

  private cleanup(now: number): void {
    this.ctx.storage.sql.exec("DELETE FROM administrator_sessions WHERE expires_at <= ?", now);
    this.ctx.storage.sql.exec("DELETE FROM administrator_limits WHERE expires_at <= ?", now);
  }

  private adminCapabilityHeaders(): Headers {
    const headers = new Headers();
    if (this.env.INTERNAL_ADMIN_TOKEN) headers.set("X-Admin-Capability", this.env.INTERNAL_ADMIN_TOKEN);
    return headers;
  }

  private adminCapabilityAllowed(request: Request): boolean {
    const expected = this.env.INTERNAL_ADMIN_TOKEN;
    return Boolean(expected && request.headers.get("X-Admin-Capability") === expected);
  }

  private turnstileConfiguration(): { siteKey: string; secretKey: string } | null | "invalid" {
    const siteKey = this.env.TURNSTILE_SITE_KEY?.trim() ?? "";
    const secretKey = this.env.TURNSTILE_SECRET_KEY?.trim() ?? "";
    if (Boolean(siteKey) !== Boolean(secretKey)) return "invalid";
    return siteKey && secretKey ? { siteKey, secretKey } : null;
  }

  private async verifyTurnstile(request: Request, value: unknown, expectedAction: string): Promise<boolean> {
    const configuration = this.turnstileConfiguration();
    if (configuration === null) return true;
    if (configuration === "invalid" || typeof value !== "string" || value.length < 1 || value.length > 2_048) {
      return false;
    }
    const body = new URLSearchParams({
      secret: configuration.secretKey,
      response: value,
      idempotency_key: crypto.randomUUID(),
    });
    const remoteIp = request.headers.get("CF-Connecting-IP");
    if (remoteIp) body.set("remoteip", remoteIp);
    try {
      const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return false;
      const result = await response.json() as TurnstileResult;
      return result.success === true
        && result.action === expectedAction
        && result.hostname === new URL(request.url).hostname;
    } catch {
      return false;
    }
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

  private async allowIdentifier(identifier: string, limit: number, windowMs: number, now: number): Promise<boolean> {
    const key = await hashText(identifier);
    return this.ctx.storage.transactionSync(() => {
      const row = first(this.ctx.storage.sql.exec<{
        attempts: number;
        window_started_at: number;
        blocked_until: number;
      } & Record<string, PlatformSqlValue>>(
        "SELECT attempts, window_started_at, blocked_until FROM administrator_limits WHERE key = ?",
        key,
      ));
      if (row?.blocked_until && row.blocked_until > now) return false;
      if (!row || now - row.window_started_at >= windowMs) {
        this.ctx.storage.sql.exec(
          `INSERT INTO administrator_limits (key, attempts, window_started_at, blocked_until, expires_at)
          VALUES (?, 1, ?, 0, ?) ON CONFLICT(key) DO UPDATE SET attempts = 1,
          window_started_at = excluded.window_started_at, blocked_until = 0, expires_at = excluded.expires_at`,
          key,
          now,
          now + windowMs * 2,
        );
        return true;
      }
      if (row.attempts >= limit) {
        this.ctx.storage.sql.exec(
          "UPDATE administrator_limits SET blocked_until = ?, expires_at = ? WHERE key = ?",
          now + windowMs,
          now + windowMs * 2,
          key,
        );
        return false;
      }
      this.ctx.storage.sql.exec(
        "UPDATE administrator_limits SET attempts = attempts + 1, expires_at = ? WHERE key = ?",
        now + windowMs * 2,
        key,
      );
      return true;
    });
  }
}

function first<T extends Record<string, PlatformSqlValue>>(cursor: PlatformSqlCursor<T>): T | null {
  return cursor.toArray()[0] ?? null;
}

function parseUsername(value: unknown): { value: string; key: string } | null {
  if (typeof value !== "string") return null;
  const username = value.trim();
  return /^[A-Za-z0-9_]{3,20}$/.test(username)
    ? { value: username, key: username.toLowerCase() }
    : null;
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

async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) return null;
  const declaredLength = Number(request.headers.get("Content-Length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) return null;
  if (!request.body) return null;
  try {
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
  const hash = await derivePassword(password, salt);
  return { hash: encodeBase64Url(hash), salt: encodeBase64Url(salt) };
}

async function verifyPassword(password: string, saltValue: string, hashValue: string): Promise<boolean> {
  const actual = await derivePassword(password, decodeBase64Url(saltValue));
  const expected = decodeBase64Url(hashValue);
  return actual.byteLength === expected.byteLength && crypto.subtle.timingSafeEqual(actual, expected);
}

async function verifyDummyPassword(password: string): Promise<boolean> {
  return crypto.subtle.timingSafeEqual(await derivePassword(password, DUMMY_SALT), DUMMY_HASH);
}

async function derivePassword(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", textEncoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt as unknown as BufferSource,
      iterations: PASSWORD_ITERATIONS,
    },
    key,
    PASSWORD_HASH_BYTES * 8,
  ));
}

async function createAdminSession(now: number): Promise<{
  token: string;
  hash: string;
  expiresAt: number;
}> {
  const token = `ll_admin_${encodeBase64Url(randomBytes(32))}`;
  return { token, hash: await hashText(token), expiresAt: now + ADMIN_SESSION_TTL_MS };
}

async function secureTextEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", textEncoder.encode(left)),
    crypto.subtle.digest("SHA-256", textEncoder.encode(right)),
  ]);
  return crypto.subtle.timingSafeEqual(leftHash, rightHash);
}

async function hashText(value: string): Promise<string> {
  return encodeBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(value))));
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

function readCookie(request: Request, name: string): string | null {
  const cookies = request.headers.get("Cookie")?.split(";") ?? [];
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator < 0 || cookie.slice(0, separator).trim() !== name) continue;
    const value = cookie.slice(separator + 1).trim();
    return /^ll_admin_[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
  }
  return null;
}

function sameOrigin(request: Request): boolean {
  return request.headers.get("Origin") === new URL(request.url).origin;
}

function publicAdmin(admin: AdminRow): { id: string; username: string; createdAt: number } {
  return { id: admin.id, username: admin.username, createdAt: admin.created_at };
}

function sessionResponse(
  administrator: { id: string; username: string; createdAt: number },
  token: string,
  expiresAt: number,
  status = 200,
): Response {
  return json({ administrator, expiresAt }, status, { "Set-Cookie": adminCookie(token) });
}

function adminCookie(token: string): string {
  return `${ADMIN_COOKIE}=${token}; Path=/; Max-Age=${ADMIN_SESSION_TTL_MS / 1_000}; HttpOnly; Secure; SameSite=Strict`;
}

function clearAdminCookie(): string {
  return `${ADMIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

function json(value: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", ...Object.fromEntries(new Headers(extraHeaders)) },
  });
}
