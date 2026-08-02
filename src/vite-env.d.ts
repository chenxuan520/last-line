declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_MULTIPLAYER_ENABLED?: "true" | "false";
  readonly VITE_MULTIPLAYER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
