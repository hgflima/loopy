/**
 * Public barrel for `loopy/config` — browser-safe surface only.
 *
 * Re-exports the pure, I/O-free API: schema, parse, serialize, template,
 * and types. Parsing comes from `./parse` (never `./load`, which imports
 * `node:fs` for `loadConfig`) so this barrel stays free of Node built-ins and
 * the Vite/Rollup browser build never trips on an externalized `node:fs`.
 */
export { loopyConfigSchema } from "./schema";
export type { LoopyConfigParsed } from "./schema";
export { parseConfig, ConfigError } from "./parse";
export type { ParseConfigOptions } from "./parse";
export {
  serializeConfig,
  parseConfigSource,
  initialConfigTemplate,
} from "./serialize";

/**
 * Catálogo de Agentes — reexportado aqui (e não num subpath próprio) porque é
 * exatamente o público deste barrel: quem edita `agents:` precisa do argv, e o
 * módulo é puro. A GUI monta o select de `preset` a partir daqui.
 */
export { AGENT_CATALOG, AGENT_PRESET_IDS, findAgentPreset } from "../acp/catalog.js";
export type { AgentPreset } from "../acp/catalog.js";
