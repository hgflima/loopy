/**
 * Ambient stub for Bun's built-in SQLite driver.
 *
 * The engine only ever loads `bun:sqlite` inside the packaged sidecar
 * (`bun build --compile`); under Node — where `tsc` and `tsup` run — the module
 * does not exist. This minimal declaration keeps `openDb`'s runtime-guarded
 * `import("bun:sqlite")` type-checkable. esbuild externalizes the specifier
 * (tsup `external: ["bun:sqlite"]`), so the dead branch is never bundled for
 * Node. Only the surface `wrap` touches is declared.
 */
declare module "bun:sqlite" {
  export class Database {
    /**
     * `strict` must be passed as `true` by `openDb`: without it bun:sqlite
     * leaves bare-named params (`{ id: 1 }` for `:id`) unbound instead of
     * throwing, and every telemetry INSERT dies on NOT NULL in silence.
     */
    constructor(filename?: string, options?: { strict?: boolean });
    exec(sql: string): void;
    prepare(sql: string): {
      run(params?: unknown): {
        changes: number | bigint;
        lastInsertRowid: number | bigint;
      };
      get(params?: unknown): unknown;
      all(params?: unknown): unknown[];
    };
    close(): void;
  }
}
