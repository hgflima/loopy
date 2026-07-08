import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Resolve `loopy/tui/*` to the engine's TypeScript source, mirroring
    // vitest.config.ts. The root package `@hgflima/loopy` is NOT an npm workspace
    // (workspaces are apps/* only), so `@hgflima/loopy` in node_modules is the stale
    // *published* build (exports:null, no dist/tui) — resolving to ../../src keeps
    // the app on local source and the subpaths honest. These modules are pure
    // (no React/Ink), so no second React copy leaks into the bundle.
    dedupe: ["react", "react-dom"],
    alias: [
      {
        find: /^loopy\/(.*)/,
        replacement: resolve(import.meta.dirname, "../../src/$1"),
      },
    ],
  },
  server: {
    strictPort: true,
    port: 5173,
  },
});
