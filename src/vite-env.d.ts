declare const __APP_VERSION__: string;
declare const __SINGLE_PLAYER_DEBUG__: boolean;

interface ImportMetaEnv {
  readonly VITE_MULTIPLAYER_ENABLED?: "true" | "false";
  readonly VITE_MULTIPLAYER_URL?: string;
  readonly VITE_SINGLE_PLAYER_DEBUG?: "true" | "false";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
