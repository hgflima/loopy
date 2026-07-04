import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  banner: { js: "#!/usr/bin/env node" },
  clean: true,
  minify: false,
  sourcemap: false,
});
