export interface WorkerEnv {
  LOBBY: DurableObjectNamespace;
  GAME_ROOMS: DurableObjectNamespace;
  ACCOUNTS: DurableObjectNamespace;
  ADMIN: DurableObjectNamespace;
  ALLOWED_ORIGINS?: string;
  ADMIN_BOOTSTRAP_TOKEN?: string;
  ADMIN_RESET_TOKEN?: string;
  INTERNAL_ADMIN_TOKEN?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}
