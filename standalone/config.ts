import { resolve } from "node:path";

export interface StandaloneServerConfig {
  readonly host: string;
  readonly port: number;
  readonly publicOrigin: string;
  readonly allowedOrigins: string;
  readonly trustProxy: boolean;
  readonly dataDirectory: string;
  readonly databasePath: string;
  readonly staticDirectory: string;
  readonly adminBootstrapToken?: string;
  readonly adminResetToken?: string;
  readonly turnstileSiteKey?: string;
  readonly turnstileSecretKey?: string;
}

export function loadStandaloneConfig(
  environment: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): StandaloneServerConfig {
  const mode = environment.SERVER_MODE?.trim() || "standalone";
  if (mode !== "standalone") {
    throw new Error("SERVER_MODE must be 'standalone' when starting the Node server");
  }
  const host = environment.SERVER_HOST?.trim() || "127.0.0.1";
  const port = parsePort(environment.SERVER_PORT);
  const publicOrigin = parseOrigin(
    environment.SERVER_PUBLIC_ORIGIN?.trim() || `http://127.0.0.1:${port}`,
  );
  const configuredOrigins = environment.ALLOWED_ORIGINS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean) ?? [];
  const allowedOrigins = [...new Set([publicOrigin, ...configuredOrigins])].join(",");
  const dataDirectory = resolve(cwd, environment.SERVER_DATA_DIR?.trim() || "data");
  return {
    host,
    port,
    publicOrigin,
    allowedOrigins,
    trustProxy: parseBoolean(environment.SERVER_TRUST_PROXY, false),
    dataDirectory,
    databasePath: resolve(dataDirectory, "last-line.sqlite"),
    staticDirectory: resolve(cwd, environment.SERVER_STATIC_DIR?.trim() || "dist"),
    adminBootstrapToken: optional(environment.ADMIN_BOOTSTRAP_TOKEN),
    adminResetToken: optional(environment.ADMIN_RESET_TOKEN),
    turnstileSiteKey: optional(environment.TURNSTILE_SITE_KEY),
    turnstileSecretKey: optional(environment.TURNSTILE_SECRET_KEY),
  };
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? 8787);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error("SERVER_PORT must be an integer between 0 and 65535");
  }
  return port;
}

function parseOrigin(value: string): string {
  const url = new URL(value);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("SERVER_PUBLIC_ORIGIN must be an HTTP(S) origin");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("SERVER_PUBLIC_ORIGIN must not include a path, query, or fragment");
  }
  return url.origin;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error("SERVER_TRUST_PROXY must be true/false or 1/0");
}

function optional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
