import type { WorkerEnv } from "./env";
export { GameRoom } from "./GameRoom";
export { LobbyDirectory } from "./LobbyDirectory";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://chenxuan520.github.io",
  "https://last-line.pages.dev",
  "https://lastline.011203.xyz",
];

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    const contentLength = Number(request.headers.get("Content-Length") ?? 0);
    if (contentLength > 16_384) return cors(Response.json({ error: "request-too-large" }, { status: 413 }), request, env);
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }), request, env);
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
      const response = await env.LOBBY.getByName("global").fetch(request);
      return cors(response, request, env);
    }
    return cors(Response.json({ error: "not-found" }, { status: 404 }), request, env);
  },
} satisfies ExportedHandler<WorkerEnv>;

function cors(response: Response, request: Request, env: WorkerEnv): Response {
  const origin = request.headers.get("Origin");
  const headers = new Headers(response.headers);
  if (origin && originAllowed(origin, env)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function originAllowed(origin: string | null, env: WorkerEnv): boolean {
  if (!origin) return true;
  if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return true;
  const configured = env.ALLOWED_ORIGINS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  return [...DEFAULT_ALLOWED_ORIGINS, ...configured].includes(origin);
}
