import { timingSafeEqual } from "node:crypto";
import { AccountDirectory } from "../worker/AccountDirectory";
import { AdminDirectory } from "../worker/AdminDirectory";
import type { WorkerEnv } from "../worker/env";
import { GameRoom } from "../worker/GameRoom";
import { LobbyDirectory } from "../worker/LobbyDirectory";
import {
  LocalDurableObjectNamespace,
  LocalDurableObjectRuntime,
} from "./LocalDurableObjectRuntime";

export interface StandaloneEnvironmentOptions {
  databasePath: string;
  allowedOrigins?: string;
  adminBootstrapToken?: string;
  adminResetToken?: string;
  turnstileSiteKey?: string;
  turnstileSecretKey?: string;
}

export interface StandaloneEnvironment {
  readonly env: WorkerEnv;
  readonly runtime: LocalDurableObjectRuntime;
  readonly rooms: LocalDurableObjectNamespace<GameRoom, WorkerEnv>;
  close(): Promise<void>;
}

export async function createStandaloneEnvironment(
  options: StandaloneEnvironmentOptions,
): Promise<StandaloneEnvironment> {
  installTimingSafeEqual();
  const runtime = new LocalDurableObjectRuntime(options.databasePath);
  const env = {} as WorkerEnv;
  const environment = (): WorkerEnv => env;
  const lobby = runtime.createNamespace("lobby", LobbyDirectory, environment);
  const rooms = runtime.createNamespace("game-rooms", GameRoom, environment, {
    serializeOperations: true,
    evictWhenDormant: true,
  });
  const accounts = runtime.createNamespace("accounts", AccountDirectory, environment);
  const admin = runtime.createNamespace("admin", AdminDirectory, environment);
  Object.assign(env, {
    SERVER_PLATFORM: "standalone",
    LOBBY: lobby,
    GAME_ROOMS: rooms,
    ACCOUNTS: accounts,
    ADMIN: admin,
    ALLOWED_ORIGINS: options.allowedOrigins,
    ADMIN_BOOTSTRAP_TOKEN: options.adminBootstrapToken,
    ADMIN_RESET_TOKEN: options.adminResetToken,
    INTERNAL_ADMIN_TOKEN: crypto.randomUUID(),
    TURNSTILE_SITE_KEY: options.turnstileSiteKey,
    TURNSTILE_SECRET_KEY: options.turnstileSecretKey,
  } satisfies WorkerEnv);
  await runtime.restoreAlarms();
  return {
    env,
    runtime,
    rooms,
    close: () => runtime.close(),
  };
}

function installTimingSafeEqual(): void {
  const subtle = crypto.subtle as unknown as {
    timingSafeEqual?: (
      left: ArrayBufferView | ArrayBuffer,
      right: ArrayBufferView | ArrayBuffer,
    ) => boolean;
  };
  if (subtle.timingSafeEqual) return;
  Object.defineProperty(subtle, "timingSafeEqual", {
    configurable: true,
    value: (left: ArrayBufferView | ArrayBuffer, right: ArrayBufferView | ArrayBuffer): boolean => {
      const leftBytes = nodeBuffer(left);
      const rightBytes = nodeBuffer(right);
      return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
    },
  });
}

function nodeBuffer(value: ArrayBufferView | ArrayBuffer): Buffer {
  return ArrayBuffer.isView(value)
    ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
    : Buffer.from(value);
}
