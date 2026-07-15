import { defineConfig, type Options } from "tsup";

const shared: Options = {
  format: ["esm"],
  target: "node20",
  platform: "node",
  minify: false,
  sourcemap: false,
  // esbuild cannot resolve Bun's built-in SQLite module; the telemetry adapter
  // only reaches it on the Bun sidecar (runtime-guarded), so keep it external.
  // The dead `import("node:sqlite")` branch is tolerated without tree-shaking.
  external: ["bun:sqlite"],
  // `schema.ts`'s Bun-only text-import
  // (`import("./schema.sql", { with: { type: "text" } })`) is dead code on Node
  // (it reads the copied `dist/schema.sql` via `readFileSync`), but esbuild
  // rejects the `type: "text"` attribute unless the specifier is left external.
  // tsup's `external` does not glob, so reach esbuild's native (globbing) one.
  esbuildOptions(options) {
    options.external = [...(options.external ?? []), "*.sql"];
  },
};

export default defineConfig([
  {
    ...shared,
    entry: ["src/index.ts"],
    banner: { js: "#!/usr/bin/env node" },
    clean: true,
    // The telemetry schema is the single source of the DDL, loaded at runtime
    // via `readFileSync(new URL("./schema.sql", import.meta.url))`. Once
    // `schema.ts` is inlined into `dist/index.js`, that URL resolves to
    // `dist/schema.sql`, so copy it next to the bundle. (The Bun sidecar embeds
    // it via a text-import instead — see `src/telemetry/schema.ts`.)
    onSuccess: "cp src/telemetry/schema.sql dist/schema.sql",
  },
  {
    ...shared,
    entry: {
      "tui/store": "src/tui/store.ts",
      "tui/view": "src/tui/view.ts",
      "tui/transport": "src/tui/transport.ts",
      "config": "src/config/index.ts",
      "backlog": "src/backlog/index.ts",
      "scheduler": "src/scheduler/index.ts",
    },
    dts: true,
    clean: false,
  },
]);
