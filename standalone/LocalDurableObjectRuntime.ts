import { DatabaseSync } from "node:sqlite";
import type { ServerMetricSink } from "../src/server/ServerMetrics";
import type {
  PlatformDurableObjectNamespace,
  PlatformDurableObjectState,
  PlatformDurableObjectStub,
  PlatformObjectStorage,
  PlatformSocket,
  PlatformSqlCursor,
  PlatformSqlStorage,
  PlatformSqlValue,
} from "../src/server/platform/DurableService";

interface DurableServiceInstance {
  fetch(request: Request): Promise<Response>;
  alarm?(): Promise<void>;
}

type DurableServiceConstructor<Service extends DurableServiceInstance, Environment> = new (
  state: PlatformDurableObjectState,
  environment: Environment,
) => Service;

interface LocalObjectRecord<Service extends DurableServiceInstance> {
  readonly service: Service;
  readonly state: LocalDurableObjectState;
  operationTail: Promise<void>;
}

interface AlarmRow {
  namespace: string;
  object_name: string;
  scheduled_at: number;
  generation: number;
}

interface LocalNamespaceOptions {
  serializeOperations?: boolean;
  evictWhenDormant?: boolean;
}

export class LocalDurableObjectRuntime {
  private readonly database: DatabaseSync;
  private readonly namespaces = new Map<string, LocalDurableObjectNamespace<DurableServiceInstance, unknown>>();
  private readonly alarmTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingTasks = new Set<Promise<unknown>>();
  private transactionDepth = 0;
  private closed = false;

  public constructor(
    databasePath: string,
    public readonly metricSink?: ServerMetricSink,
  ) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA synchronous = NORMAL");
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec(`CREATE TABLE IF NOT EXISTS durable_object_values (
      namespace TEXT NOT NULL,
      object_name TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (namespace, object_name, key)
    )`);
    this.database.exec(`CREATE TABLE IF NOT EXISTS durable_object_alarms (
      namespace TEXT NOT NULL,
      object_name TEXT NOT NULL,
      scheduled_at INTEGER NOT NULL,
      generation INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (namespace, object_name)
    )`);
    const alarmColumns = this.database.prepare("PRAGMA table_info(durable_object_alarms)").all() as Array<{
      name?: string;
    }>;
    if (!alarmColumns.some((column) => column.name === "generation")) {
      this.database.exec("ALTER TABLE durable_object_alarms ADD COLUMN generation INTEGER NOT NULL DEFAULT 1");
    }
  }

  public createNamespace<Service extends DurableServiceInstance, Environment>(
    name: string,
    constructor: DurableServiceConstructor<Service, Environment>,
    environment: () => Environment,
    options: LocalNamespaceOptions = {},
  ): LocalDurableObjectNamespace<Service, Environment> {
    if (this.namespaces.has(name)) throw new Error(`duplicate durable namespace: ${name}`);
    const namespace = new LocalDurableObjectNamespace(
      this,
      name,
      constructor,
      environment,
      options,
    );
    this.namespaces.set(
      name,
      namespace as unknown as LocalDurableObjectNamespace<DurableServiceInstance, unknown>,
    );
    return namespace;
  }

  public async restoreAlarms(): Promise<void> {
    const alarms = this.database.prepare(
      "SELECT namespace, object_name, scheduled_at, generation FROM durable_object_alarms",
    ).all() as unknown as AlarmRow[];
    for (const alarm of alarms) {
      const durableNamespace = this.namespaces.get(alarm.namespace);
      if (!durableNamespace) {
        console.error(`Cannot restore alarm for unknown namespace ${alarm.namespace}`);
        continue;
      }
      await durableNamespace.getService(alarm.object_name);
      this.scheduleAlarm(alarm.namespace, alarm.object_name, alarm.scheduled_at, alarm.generation);
    }
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const timer of this.alarmTimers.values()) clearTimeout(timer);
    this.alarmTimers.clear();
    await Promise.allSettled([...this.pendingTasks]);
    this.database.close();
  }

  public async drainTasks(): Promise<void> {
    while (this.pendingTasks.size > 0) await Promise.allSettled([...this.pendingTasks]);
  }

  public runTransaction<Result>(callback: () => Result): Result {
    if (this.transactionDepth > 0) return callback();
    this.database.exec("BEGIN IMMEDIATE");
    this.transactionDepth += 1;
    try {
      const result = callback();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  public trackTask(task: Promise<unknown>): void {
    this.pendingTasks.add(task);
    void task.finally(() => this.pendingTasks.delete(task)).catch((error: unknown) => {
      console.error("Standalone background task failed", error);
    });
  }

  public sqlStorage(): PlatformSqlStorage {
    return new LocalSqlStorage(this.database);
  }

  public getValue<Value>(namespace: string, objectName: string, key: string): Value | undefined {
    const row = this.database.prepare(
      `SELECT value FROM durable_object_values
      WHERE namespace = ? AND object_name = ? AND key = ?`,
    ).get(namespace, objectName, key) as { value?: string } | undefined;
    return row?.value === undefined ? undefined : JSON.parse(row.value) as Value;
  }

  public putValue<Value>(namespace: string, objectName: string, key: string, value: Value): void {
    this.database.prepare(
      `INSERT INTO durable_object_values (namespace, object_name, key, value)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(namespace, object_name, key) DO UPDATE SET value = excluded.value`,
    ).run(namespace, objectName, key, JSON.stringify(value));
  }

  public deleteAllValues(namespace: string, objectName: string): void {
    this.runTransaction(() => {
      this.database.prepare(
        "DELETE FROM durable_object_values WHERE namespace = ? AND object_name = ?",
      ).run(namespace, objectName);
      this.database.prepare(
        "DELETE FROM durable_object_alarms WHERE namespace = ? AND object_name = ?",
      ).run(namespace, objectName);
    });
    this.cancelAlarm(namespace, objectName);
  }

  public setAlarm(namespace: string, objectName: string, scheduledAt: number): void {
    this.database.prepare(
      `INSERT INTO durable_object_alarms (namespace, object_name, scheduled_at, generation)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(namespace, object_name) DO UPDATE SET
        scheduled_at = excluded.scheduled_at,
        generation = durable_object_alarms.generation + 1`,
    ).run(namespace, objectName, Math.floor(scheduledAt));
    const row = this.database.prepare(
      "SELECT generation FROM durable_object_alarms WHERE namespace = ? AND object_name = ?",
    ).get(namespace, objectName) as { generation: number };
    this.scheduleAlarm(namespace, objectName, scheduledAt, row.generation);
  }

  public deleteAlarm(namespace: string, objectName: string): void {
    this.database.prepare(
      "DELETE FROM durable_object_alarms WHERE namespace = ? AND object_name = ?",
    ).run(namespace, objectName);
    this.cancelAlarm(namespace, objectName);
  }

  public objectHasState(namespace: string, objectName: string): boolean {
    const row = this.database.prepare(
      `SELECT EXISTS(
        SELECT 1 FROM durable_object_values WHERE namespace = ? AND object_name = ?
        UNION ALL
        SELECT 1 FROM durable_object_alarms WHERE namespace = ? AND object_name = ?
      ) AS present`,
    ).get(namespace, objectName, namespace, objectName) as { present: number };
    return row.present === 1;
  }

  private scheduleAlarm(
    namespace: string,
    objectName: string,
    scheduledAt: number,
    generation: number,
  ): void {
    if (this.closed) return;
    this.cancelAlarm(namespace, objectName);
    const key = objectKey(namespace, objectName);
    const delay = Math.max(0, Math.min(2_147_483_647, scheduledAt - Date.now()));
    const timer = setTimeout(() => {
      this.alarmTimers.delete(key);
      const task = this.invokeAlarm(namespace, objectName, generation);
      this.trackTask(task);
    }, delay);
    timer.unref();
    this.alarmTimers.set(key, timer);
  }

  private cancelAlarm(namespace: string, objectName: string): void {
    const key = objectKey(namespace, objectName);
    const timer = this.alarmTimers.get(key);
    if (timer) clearTimeout(timer);
    this.alarmTimers.delete(key);
  }

  private async invokeAlarm(namespace: string, objectName: string, generation: number): Promise<void> {
    const durableNamespace = this.namespaces.get(namespace);
    if (!durableNamespace) {
      console.error(`Cannot restore alarm for unknown namespace ${namespace}`);
      return;
    }
    try {
      await durableNamespace.invokeAlarm(objectName);
      this.database.prepare(
        `DELETE FROM durable_object_alarms
        WHERE namespace = ? AND object_name = ? AND generation = ?`,
      ).run(namespace, objectName, generation);
      await durableNamespace.evictIfDormant(objectName);
    } catch (error) {
      console.error(`Standalone alarm failed for ${namespace}/${objectName}`, error);
      this.setAlarm(namespace, objectName, Date.now() + 1_000);
    }
  }
}

export class LocalDurableObjectNamespace<
  Service extends DurableServiceInstance,
  Environment,
> implements PlatformDurableObjectNamespace {
  private readonly records = new Map<string, Promise<LocalObjectRecord<Service>>>();

  public constructor(
    private readonly runtime: LocalDurableObjectRuntime,
    private readonly name: string,
    private readonly serviceConstructor: DurableServiceConstructor<Service, Environment>,
    private readonly environment: () => Environment,
    private readonly options: LocalNamespaceOptions,
  ) {}

  public getByName(name: string): PlatformDurableObjectStub {
    return {
      fetch: (request) => this.run(name, (service) => service.fetch(request)),
    };
  }

  public async run<Result>(name: string, operation: (service: Service) => Promise<Result>): Promise<Result> {
    const record = await this.getRecord(name);
    const execute = async (): Promise<Result> => {
      try {
        return await operation(record.service);
      } finally {
        this.maybeEvict(name, record);
      }
    };
    if (!this.options.serializeOperations) return execute();
    const result = record.operationTail.then(execute);
    record.operationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  public async invokeAlarm(name: string): Promise<void> {
    await this.run(name, async (service) => {
      if (service.alarm) await service.alarm();
    });
  }

  public async getService(name: string): Promise<Service> {
    return (await this.getRecord(name)).service;
  }

  public async getState(name: string): Promise<LocalDurableObjectState> {
    return (await this.getRecord(name)).state;
  }

  public async getInstantiatedServices(): Promise<Service[]> {
    const records = await Promise.all(this.records.values());
    return records.map((record) => record.service);
  }

  public async runOnInstantiated(operation: (service: Service) => Promise<void>): Promise<void> {
    for (const name of [...this.records.keys()]) await this.run(name, operation);
  }

  public async evictIfDormant(name: string): Promise<void> {
    const pending = this.records.get(name);
    if (!pending) return;
    this.maybeEvict(name, await pending);
  }

  public instantiatedCount(): number {
    return this.records.size;
  }

  private getRecord(name: string): Promise<LocalObjectRecord<Service>> {
    let record = this.records.get(name);
    if (!record) {
      record = this.createRecord(name);
      this.records.set(name, record);
    }
    return record;
  }

  private async createRecord(name: string): Promise<LocalObjectRecord<Service>> {
    const state = new LocalDurableObjectState(this.runtime, this.name, name);
    const service = new this.serviceConstructor(state, this.environment());
    await state.ready();
    return { service, state, operationTail: Promise.resolve() };
  }

  private maybeEvict(name: string, record: LocalObjectRecord<Service>): void {
    if (!this.options.evictWhenDormant || !record.state.isDormant()) return;
    const current = this.records.get(name);
    if (current) void current.then((value) => {
      if (this.records.get(name) === current && value === record && record.state.isDormant()) {
        this.records.delete(name);
      }
    });
  }
}

export class LocalDurableObjectState implements PlatformDurableObjectState {
  public readonly storage: PlatformObjectStorage;
  public readonly metricSink: ServerMetricSink | undefined;
  private readonly sockets = new Set<PlatformSocket>();
  private readonly initializationTasks: Promise<unknown>[] = [];

  public constructor(
    private readonly runtime: LocalDurableObjectRuntime,
    private readonly namespace: string,
    private readonly objectName: string,
  ) {
    this.storage = new LocalObjectStorage(runtime, namespace, objectName);
    this.metricSink = runtime.metricSink;
  }

  public blockConcurrencyWhile(callback: () => Promise<unknown>): void {
    this.initializationTasks.push(callback());
  }

  public waitUntil(promise: Promise<unknown>): void {
    this.runtime.trackTask(promise);
  }

  public getWebSockets(): PlatformSocket[] {
    return [...this.sockets];
  }

  public acceptWebSocket(socket: PlatformSocket): void {
    this.sockets.add(socket);
  }

  public releaseWebSocket(socket: PlatformSocket): void {
    this.sockets.delete(socket);
  }

  public async ready(): Promise<void> {
    await Promise.all(this.initializationTasks);
  }

  public isDormant(): boolean {
    return this.sockets.size === 0 && !this.runtime.objectHasState(this.namespace, this.objectName);
  }
}

class LocalObjectStorage implements PlatformObjectStorage {
  public readonly sql: PlatformSqlStorage;

  public constructor(
    private readonly runtime: LocalDurableObjectRuntime,
    private readonly namespace: string,
    private readonly objectName: string,
  ) {
    this.sql = runtime.sqlStorage();
  }

  public async get<Value>(key: string): Promise<Value | undefined> {
    return this.runtime.getValue<Value>(this.namespace, this.objectName, key);
  }

  public async put<Value>(key: string, value: Value): Promise<void> {
    this.runtime.putValue(this.namespace, this.objectName, key, value);
  }

  public async deleteAll(): Promise<void> {
    this.runtime.deleteAllValues(this.namespace, this.objectName);
  }

  public async setAlarm(scheduledTime: number): Promise<void> {
    this.runtime.setAlarm(this.namespace, this.objectName, scheduledTime);
  }

  public async deleteAlarm(): Promise<void> {
    this.runtime.deleteAlarm(this.namespace, this.objectName);
  }

  public transactionSync<Result>(callback: () => Result): Result {
    return this.runtime.runTransaction(callback);
  }
}

class LocalSqlStorage implements PlatformSqlStorage {
  public constructor(private readonly database: DatabaseSync) {}

  public exec<Row extends Record<string, PlatformSqlValue>>(
    query: string,
    ...bindings: PlatformSqlValue[]
  ): PlatformSqlCursor<Row> {
    const statement = this.database.prepare(query);
    const values = bindings.map(sqlBinding);
    const rows = /^\s*(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(query)
      ? statement.all(...values) as unknown as Row[]
      : (statement.run(...values), []);
    return new LocalSqlCursor(rows);
  }
}

class LocalSqlCursor<Row extends Record<string, PlatformSqlValue>> implements PlatformSqlCursor<Row> {
  public constructor(private readonly rows: Row[]) {}

  public one(): Row {
    if (this.rows.length !== 1 || !this.rows[0]) {
      throw new Error(`Expected exactly one SQL row, received ${this.rows.length}`);
    }
    return this.rows[0];
  }

  public toArray(): Row[] {
    return this.rows;
  }
}

function sqlBinding(value: PlatformSqlValue): string | number | null | Uint8Array {
  return value instanceof ArrayBuffer ? new Uint8Array(value) : value;
}

function objectKey(namespace: string, objectName: string): string {
  return `${namespace}\u0000${objectName}`;
}
