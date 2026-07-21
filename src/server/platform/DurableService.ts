export type PlatformSqlValue = ArrayBuffer | string | number | null;

export interface PlatformSqlCursor<Row extends Record<string, PlatformSqlValue>> {
  one(): Row;
  toArray(): Row[];
}

export interface PlatformSqlStorage {
  exec<Row extends Record<string, PlatformSqlValue>>(
    query: string,
    ...bindings: PlatformSqlValue[]
  ): PlatformSqlCursor<Row>;
}

export interface PlatformObjectStorage {
  readonly sql: PlatformSqlStorage;
  get<Value>(key: string): Promise<Value | undefined>;
  put<Value>(key: string, value: Value): Promise<void>;
  deleteAll(): Promise<void>;
  setAlarm(scheduledTime: number): Promise<void>;
  deleteAlarm(): Promise<void>;
  transactionSync<Result>(callback: () => Result): Result;
}

export interface PlatformSocket {
  send(message: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(attachment: unknown): void;
  deserializeAttachment(): unknown;
}

export interface PlatformDurableObjectState {
  readonly storage: PlatformObjectStorage;
  blockConcurrencyWhile(callback: () => Promise<unknown>): void;
  waitUntil(promise: Promise<unknown>): void;
  getWebSockets(): PlatformSocket[];
  acceptWebSocket(socket: PlatformSocket): void;
}

export interface PlatformDurableObjectStub {
  fetch(request: Request): Promise<Response>;
}

export interface PlatformDurableObjectNamespace {
  getByName(name: string): PlatformDurableObjectStub;
}

export abstract class DurableService<Environment> {
  protected constructor(
    protected readonly ctx: PlatformDurableObjectState,
    protected readonly env: Environment,
  ) {}
}
