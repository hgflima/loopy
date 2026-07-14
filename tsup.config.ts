import { defineConfig, type Options } from "tsup";

const shared: Options = {
  format: ["esm"],
  target: "node20",
  platform: "node",
  minify: false,
  sourcemap: false,
};

export default defineConfig([
  {
    ...shared,
    entry: ["src/index.ts"],
    banner: { js: "#!/usr/bin/env node" },
    clean: true,
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
