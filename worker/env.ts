import type { PlatformDurableObjectNamespace } from "../src/server/platform/DurableService";

export interface WorkerEnv {
  SERVER_PLATFORM?: "cloudflare" | "standalone";
  LOBBY: PlatformDurableObjectNamespace;
  GAME_ROOMS: PlatformDurableObjectNamespace;
  ACCOUNTS: PlatformDurableObjectNamespace;
  ADMIN: PlatformDurableObjectNamespace;
  ALLOWED_ORIGINS?: string;
  ADMIN_BOOTSTRAP_TOKEN?: string;
  ADMIN_RESET_TOKEN?: string;
  INTERNAL_ADMIN_TOKEN?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}
