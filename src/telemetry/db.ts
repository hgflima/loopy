/**
 * The single runtime seam for the telemetry SQLite driver.
 *
 * `openDb` is the **only** place in the codebase that imports a SQLite engine:
 * `node:sqlite`'s `DatabaseSync` (Node ≥22.13, the npm CLI) or `bun:sqlite`'s
 * `Database` (the packaged sidecar built with `bun build --compile`), picked by
 * runtime via a dynamic `import(...)`. Both engines expose a synchronous,
 * near-identical surface, so {@link wrap} collapses them into one
 * {@link TelemetryDb} shape (`prepare`/`run`/`all`/`close`) that the rest of
 * `src/telemetry/` codes against without ever knowing which driver backs it.
 *
 * WAL is set **once at bootstrap** (D8): the mode is persistent in the SQLite
 * file header, and `busy_timeout` does **not** protect the `journal_mode=WAL`
 * pragma under concurrent creation — so a second connection must not depend on
 * re-running it. `busy_timeout` stays as a safety net for the concurrent Rust
 * reader (D9); `foreign_keys` is off by default in SQLite and must be enabled
 * per connection.
 */

/** A value SQLite can bind or return. */
export type SqlValue = string | number | bigint | boolean | null | Uint8Array;

/** Named bind parameters — bare names, e.g. `{ id: 1 }` for a `:id` placeholder. */
export type SqlParams = Record<string, SqlValue>;

/** One returned row (column name → value). */
export type SqlRow = Record<string, SqlValue>;

/** Outcome of a mutating statement (`INSERT`/`UPDATE`/`DELETE`). */
export interface RunResult {
  readonly changes: number | bigint;
  readonly lastInsertRowid: number | bigint;
}

/** A prepared statement, reusable across many parameter bindings. */
export interface TelemetryStatement {
  run(params?: SqlParams): RunResult;
  get<T = SqlRow>(params?: SqlParams): T | undefined;
  all<T = SqlRow>(params?: SqlParams): T[];
}

/** The driver-agnostic database handle the telemetry subsystem codes against. */
export interface TelemetryDb {
  prepare(sql: string): TelemetryStatement;
  /** Execute raw SQL (DDL / pragmas, multi-statement) with no bound parameters. */
  run(sql: string): void;
  /** One-shot query convenience: prepare, bind, and collect every row. */
  all<T = SqlRow>(sql: string, params?: SqlParams): T[];
  /** Close the handle. Idempotent — safe to call more than once. */
  close(): void;
}

// The structural subset of `DatabaseSync` / `bun:sqlite`'s `Database` that
// `wrap` relies on — the intersection where the two APIs already converge.
interface RawStatement {
  run(params?: SqlParams): RunResult;
  get(params?: SqlParams): unknown;
  all(params?: SqlParams): unknown[];
}
interface RawDb {
  exec(sql: string): void;
  prepare(sql: string): RawStatement;
  close(): void;
}

const BOOTSTRAP_PRAGMAS =
  "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;";

/**
 * Open (creating if absent) the telemetry database at `path` and return a
 * runtime-agnostic handle with WAL already established.
 */
export async function openDb(path: string): Promise<TelemetryDb> {
  const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
  const raw: RawDb = isBun
    ? (new (await import("bun:sqlite")).Database(path) as unknown as RawDb)
    : (new (await import("node:sqlite")).DatabaseSync(path) as unknown as RawDb);

  // WAL 1× at bootstrap (D8) — busy_timeout does NOT protect this pragma, and
  // the mode persists in the file header, so reopens need not re-run it.
  raw.exec(BOOTSTRAP_PRAGMAS);
  return wrap(raw);
}

// Bind params only when supplied: passing an explicit `undefined` would be seen
// by the driver as an anonymous parameter, so omit the argument entirely instead.
function wrapStatement(stmt: RawStatement): TelemetryStatement {
  return {
    run(params?: SqlParams): RunResult {
      return params === undefined ? stmt.run() : stmt.run(params);
    },
    get<T = SqlRow>(params?: SqlParams): T | undefined {
      return (params === undefined ? stmt.get() : stmt.get(params)) as
        | T
        | undefined;
    },
    all<T = SqlRow>(params?: SqlParams): T[] {
      return (params === undefined ? stmt.all() : stmt.all(params)) as T[];
    },
  };
}

/** Collapse a raw driver handle into the common {@link TelemetryDb} shape. */
function wrap(raw: RawDb): TelemetryDb {
  let closed = false;
  return {
    prepare(sql: string): TelemetryStatement {
      return wrapStatement(raw.prepare(sql));
    },
    run(sql: string): void {
      raw.exec(sql);
    },
    all<T = SqlRow>(sql: string, params?: SqlParams): T[] {
      return wrapStatement(raw.prepare(sql)).all<T>(params);
    },
    close(): void {
      // node:sqlite throws `ERR_INVALID_STATE` on a double close; guard so the
      // handle is safe to close from both a `finally` and an outer teardown.
      if (closed) return;
      closed = true;
      raw.close();
    },
  };
}
