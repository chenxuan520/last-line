import type { WorkerEnv } from "./env";
import { adminPage } from "./adminPage";
export { AccountDirectory } from "./AccountDirectory";
export { AdminDirectory } from "./AdminDirectory";
export { GameRoom } from "./GameRoom";
export { LobbyDirectory } from "./LobbyDirectory";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://chenxuan520.github.io",
  "https://last-line.pages.dev",
  "https://lastline.011203.xyz",
];
const PLAYER_REFRESH_COOKIE = "__Host-lastline_player_refresh";

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    const contentLength = Number(request.headers.get("Content-Length") ?? 0);
    if (contentLength > 16_384) return cors(Response.json({ error: "request-too-large" }, { status: 413 }), request, env);
    if (request.method === "GET" && (url.pathname === "/admin" || url.pathname === "/admin/")) {
      const siteKey = env.TURNSTILE_SITE_KEY?.trim() ?? "";
      const secretKey = env.TURNSTILE_SECRET_KEY?.trim() ?? "";
      if (Boolean(siteKey) !== Boolean(secretKey)) {
        return adminHeaders(Response.json({ error: "turnstile-misconfigured" }, { status: 503 }));
      }
      return adminPage(siteKey || null);
    }
    if (url.pathname.startsWith("/v1/admin/")) {
      const response = await env.ADMIN.getByName("global").fetch(request);
      return adminHeaders(response);
    }
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }), request, env);
    if (url.pathname.startsWith("/v1/auth/")) {
      if (!originAllowed(request.headers.get("Origin"), env)) return new Response("forbidden", { status: 403 });
      if (request.method !== "GET" && !request.headers.get("Origin")) return new Response("forbidden", { status: 403 });
      return cors(await handlePlayerAuth(request, env), request, env);
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return cors(Response.json({ ok: true, service: "lastlinep2p" }), request, env);
    }
    const roomSocket = /^\/v1\/rooms\/(room-[a-f0-9-]+)\/socket$/.exec(url.pathname);
    if (roomSocket?.[1]) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return cors(Response.json({ error: "upgrade-required" }, { status: 426 }), request, env);
      }
      if (!originAllowed(request.headers.get("Origin"), env)) return new Response("forbidden", { status: 403 });
      return env.GAME_ROOMS.getByName(roomSocket[1]).fetch(request);
    }
    if (url.pathname.startsWith("/v1/")) {
      let lobbyRequest = request;
      if (request.method === "POST" && url.pathname === "/v1/guests") {
        const policy = await readRegistrationPolicy(env);
        if (policy === null) return cors(Response.json({ error: "auth-service-unavailable" }, { status: 503 }), request, env);
        if (policy) {
          const account = await authenticatedPlayer(request, env);
          if (!account) return cors(Response.json({ error: "account-required" }, { status: 401 }), request, env);
          lobbyRequest = new Request(request.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "CF-Connecting-IP": request.headers.get("CF-Connecting-IP") ?? "",
              "X-Admin-Capability": env.INTERNAL_ADMIN_TOKEN ?? "",
            },
            body: JSON.stringify({
              displayName: account.displayName,
              accountId: account.id,
              accountSessionRevision: account.sessionRevision,
            }),
          });
        }
      }
      const response = await env.LOBBY.getByName("global").fetch(lobbyRequest);
      return cors(response, request, env);
    }
    return cors(Response.json({ error: "not-found" }, { status: 404 }), request, env);
  },
} satisfies ExportedHandler<WorkerEnv>;

async function handlePlayerAuth(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/v1/auth/config") {
    const required = await readRegistrationPolicy(env);
    return required === null
      ? Response.json({ error: "auth-service-unavailable" }, { status: 503 })
      : Response.json({ registrationLoginRequired: required });
  }
  if (request.method === "POST" && url.pathname === "/v1/auth/session") {
    const refreshToken = readCookie(request, PLAYER_REFRESH_COOKIE);
    if (!refreshToken) return Response.json({ authenticated: false });
    const response = await env.ACCOUNTS.getByName("global").fetch(new Request(
      "https://accounts/internal/auth/refresh",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": request.headers.get("CF-Connecting-IP") ?? "" },
        body: JSON.stringify({ refreshToken }),
      },
    ));
    if (response.status === 409) return response;
    if (response.status === 401) {
      return Response.json(
        { authenticated: false },
        { headers: { "Set-Cookie": clearPlayerRefreshCookie(), "Cache-Control": "no-store" } },
      );
    }
    if (!response.ok) return response;
    return playerSessionResponse(response);
  }
  if (request.method === "POST" && (url.pathname === "/v1/auth/register" || url.pathname === "/v1/auth/login")) {
    const action = url.pathname.endsWith("register") ? "register" : "login";
    const response = await env.ACCOUNTS.getByName("global").fetch(new Request(
      `https://accounts/internal/auth/${action}`,
      request,
    ));
    return playerSessionResponse(response);
  }
  if (request.method === "POST" && url.pathname === "/v1/auth/refresh") {
    const refreshToken = readCookie(request, PLAYER_REFRESH_COOKIE);
    if (!refreshToken) return Response.json({ error: "invalid-session" }, { status: 401 });
    const response = await env.ACCOUNTS.getByName("global").fetch(new Request(
      "https://accounts/internal/auth/refresh",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": request.headers.get("CF-Connecting-IP") ?? "" },
        body: JSON.stringify({ refreshToken }),
      },
    ));
    return playerSessionResponse(response);
  }
  if (request.method === "POST" && url.pathname === "/v1/auth/logout") {
    const refreshToken = readCookie(request, PLAYER_REFRESH_COOKIE);
    const headers = new Headers({ "Content-Type": "application/json" });
    const authorization = request.headers.get("Authorization");
    if (authorization) headers.set("Authorization", authorization);
    const response = await env.ACCOUNTS.getByName("global").fetch(new Request("https://accounts/internal/auth/logout", {
      method: "POST",
      headers,
      body: JSON.stringify({ refreshToken }),
    }));
    if (!response.ok) return response;
    return new Response(null, { status: 204, headers: { "Set-Cookie": clearPlayerRefreshCookie() } });
  }
  if (request.method === "GET" && url.pathname === "/v1/auth/me") {
    const headers = new Headers();
    const authorization = request.headers.get("Authorization");
    if (authorization) headers.set("Authorization", authorization);
    return env.ACCOUNTS.getByName("global").fetch(new Request("https://accounts/internal/auth/me", { headers }));
  }
  return Response.json({ error: "not-found" }, { status: 404 });
}

async function playerSessionResponse(response: Response): Promise<Response> {
  if (!response.ok) return response;
  const value = await response.json() as {
    user: { id: string; username: string; displayName: string; createdAt: number };
    session: {
      tokenType: string;
      accessToken: string;
      accessExpiresAt: number;
      refreshToken: string;
      refreshExpiresAt: number;
    };
  };
  const maxAge = Math.max(0, Math.floor((value.session.refreshExpiresAt - Date.now()) / 1_000));
  return Response.json({
    user: value.user,
    session: {
      tokenType: value.session.tokenType,
      accessToken: value.session.accessToken,
      accessExpiresAt: value.session.accessExpiresAt,
    },
  }, {
    status: response.status,
    headers: { "Cache-Control": "no-store", "Set-Cookie": playerRefreshCookie(value.session.refreshToken, maxAge) },
  });
}

async function readRegistrationPolicy(env: WorkerEnv): Promise<boolean | null> {
  const headers = new Headers();
  if (env.INTERNAL_ADMIN_TOKEN) headers.set("X-Admin-Capability", env.INTERNAL_ADMIN_TOKEN);
  const response = await env.ADMIN.getByName("global").fetch(new Request("https://admin/internal/auth-policy", { headers }));
  if (!response.ok) return null;
  const value = await response.json() as { registrationLoginRequired?: unknown };
  return typeof value.registrationLoginRequired === "boolean" ? value.registrationLoginRequired : null;
}

async function authenticatedPlayer(
  request: Request,
  env: WorkerEnv,
): Promise<{ id: string; username: string; displayName: string; sessionRevision: number } | null> {
  const authorization = request.headers.get("Authorization");
  if (!authorization) return null;
  const response = await env.ACCOUNTS.getByName("global").fetch(new Request("https://accounts/internal/auth/me", {
    headers: { Authorization: authorization },
  }));
  if (!response.ok) return null;
  const value = await response.json() as {
    user?: { id?: unknown; username?: unknown; displayName?: unknown; sessionRevision?: unknown };
  };
  return typeof value.user?.id === "string"
    && typeof value.user.username === "string"
    && typeof value.user.displayName === "string"
    && typeof value.user.sessionRevision === "number"
    ? {
        id: value.user.id,
        username: value.user.username,
        displayName: value.user.displayName,
        sessionRevision: value.user.sessionRevision,
      }
    : null;
}

function readCookie(request: Request, name: string): string | null {
  for (const cookie of request.headers.get("Cookie")?.split(";") ?? []) {
    const separator = cookie.indexOf("=");
    if (separator >= 0 && cookie.slice(0, separator).trim() === name) return cookie.slice(separator + 1).trim();
  }
  return null;
}

function playerRefreshCookie(token: string, maxAge: number): string {
  return `${PLAYER_REFRESH_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

function clearPlayerRefreshCookie(): string {
  return `${PLAYER_REFRESH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

function adminHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function cors(response: Response, request: Request, env: WorkerEnv): Response {
  const origin = request.headers.get("Origin");
  const headers = new Headers(response.headers);
  if (origin && originAllowed(origin, env)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Vary", "Origin");
  }
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function originAllowed(origin: string | null, env: WorkerEnv): boolean {
  if (!origin) return true;
  if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return true;
  const configured = env.ALLOWED_ORIGINS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  return [...DEFAULT_ALLOWED_ORIGINS, ...configured].includes(origin);
}
