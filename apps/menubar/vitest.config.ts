import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^loopy\/(.*)/,
        replacement: resolve(import.meta.dirname, "../../src/$1"),
      },
    ],
  },
});
