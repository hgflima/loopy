/**
 * Disk I/O wrapper around the pure parser in `./parse`: read a `loopy.yml` from
 * the filesystem, then validate it with {@link parseConfig}. This is the **only**
 * config module that touches `node:fs`, so the browser-safe barrel
 * (`./index.ts`) re-exports the pure API from `./parse` and never from here.
 *
 * `loadConfig` is called **first** in `execute()`, before any effect, so an
 * invalid config aborts cleanly with a `ConfigError` (clear message, no stack).
 */
import { readFileSync } from "node:fs";
import type { LoopyConfig } from "../types";
import { parseConfig, ConfigError } from "./parse";

// Back-compat re-exports: Node-side consumers (and tests) historically import
// the pure parse API from `./load`. The browser barrel imports it from `./parse`
// instead — keeping `node:fs` out of the browser bundle.
export { parseConfig, ConfigError } from "./parse";
export type { ParseConfigOptions } from "./parse";

/**
 * Read a `loopy.yml` from disk and validate it. Throws {@link ConfigError} when
 * the file is missing/unreadable or the contents are invalid.
 */
export function loadConfig(path: string): LoopyConfig {
  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ConfigError(
      `Não foi possível ler o config "${path}": ${reason}`,
      {
        cause: err,
      },
    );
  }

  return parseConfig(source, { sourcePath: path });
}
