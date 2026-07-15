/**
 * Ambient stub for `*.sql` text-imports.
 *
 * `schema.ts` loads `schema.sql` via a Bun-embedded text-import
 * (`import("./schema.sql", { with: { type: "text" } })`) on the packaged
 * sidecar. Under Node — where `tsc`/`tsup`/vitest run — that branch is dead
 * (guarded by `typeof Bun`), but `tsc` still type-checks the specifier. Declare
 * the module so the import resolves to a string.
 */
declare module "*.sql" {
  const sql: string;
  export default sql;
}
