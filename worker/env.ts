export interface WorkerEnv {
  LOBBY: DurableObjectNamespace;
  GAME_ROOMS: DurableObjectNamespace;
  ALLOWED_ORIGINS?: string;
}
