import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const menubarModules = resolve(import.meta.dirname, "node_modules");

export default defineConfig({
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      {
        find: /^loopy\/(.*)/,
        replacement: resolve(import.meta.dirname, "../../src/$1"),
      },
      // Force every import of react / react-dom to the menubar's React 18
      // (root has React 19 for Ink — two copies break hooks).
      { find: /^react$/, replacement: resolve(menubarModules, "react") },
      {
        find: /^react\/(.+)/,
        replacement: resolve(menubarModules, "react/$1"),
      },
      {
        find: /^react-dom$/,
        replacement: resolve(menubarModules, "react-dom"),
      },
      {
        find: /^react-dom\/(.+)/,
        replacement: resolve(menubarModules, "react-dom/$1"),
      },
    ],
  },
  test: {
    environment: "jsdom",
    server: {
      deps: {
        // Inline deps so Vite's alias pipeline applies to their react imports.
        inline: [
          "@xyflow/react",
          "@xyflow/system",
          "zustand",
          "use-sync-external-store",
          "react-markdown",
        ],
      },
    },
  },
});
