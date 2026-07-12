/**
 * Public barrel for `loopy/config` — browser-safe surface only.
 *
 * Re-exports the pure, I/O-free API: schema, parse, serialize, template,
 * and types. **Never** re-exports `loadConfig` (uses `node:fs`).
 */
export { loopyConfigSchema } from "./schema";
export type { LoopyConfigParsed } from "./schema";
export { parseConfig, ConfigError } from "./load";
export type { ParseConfigOptions } from "./load";
export {
  serializeConfig,
  parseConfigSource,
  initialConfigTemplate,
} from "./serialize";
