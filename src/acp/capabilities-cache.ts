/**
 * Persistent cache for probed agent capabilities (D30/D32).
 *
 * Keyed by the **serialized `command` argv** (not the agent name from the yml),
 * because the argv is what actually identifies the adapter+version — the same
 * agent name can point to different commands across configs.
 *
 * File: `.loopy/capabilities.json` in the workspace root (`.loopy/` is already
 * an Artefact directory, gitignored).
 *
 * This is the **only** file in the capabilities feature that touches `node:fs` —
 * `capabilities.ts` stays pure (browser-safe invariant).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AgentCapabilities } from "./capabilities";

/** Shape of a single cache entry keyed by serialized argv. */
export interface CacheEntry {
  readonly probedAt: string;
  readonly capabilities: AgentCapabilities;
}

/** The full cache file shape: `{ "<argv joined>": CacheEntry }`. */
export type CapabilitiesCache = Record<string, CacheEntry>;

/** Canonical path for the cache file relative to the workspace root. */
const CACHE_REL = ".loopy/capabilities.json";

/**
 * Serialize a probe into the cache key: the argv, plus the model it was probed
 * **with** when one was applied.
 *
 * The model belongs in the key because capabilities are not always static:
 * OpenCode derives `thought_level` from the current model's variants, so
 * `opencode acp` probed bare and probed with `zai-coding-plan/glm-5.2` are two
 * different answers. Adapters that announce effort statically (Claude, Codex)
 * simply produce the same capabilities under both keys.
 *
 * A probe with no model keeps the legacy bare-argv key, so old cache files and
 * agents with no `model` in the registry keep hitting.
 */
export function cacheKey(command: readonly string[], model?: string): string {
  const argv = command.join(" ");
  return model ? `${argv}::${model}` : argv;
}

/**
 * Read the capabilities cache from `<root>/.loopy/capabilities.json`.
 * Returns an empty object when the file is missing, unreadable, or corrupt
 * (never throws).
 */
export function readCache(root: string): CapabilitiesCache {
  const path = resolve(root, CACHE_REL);
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as CapabilitiesCache;
  } catch {
    return {};
  }
}

/**
 * Write (upsert) a capabilities entry into the cache, preserving other entries.
 * Creates the `.loopy/` directory if it does not exist.
 *
 * @param model The model applied before reading the capabilities, if any — part
 *   of the key (see {@link cacheKey}).
 */
export function writeCache(
  root: string,
  command: readonly string[],
  caps: AgentCapabilities,
  model?: string,
): void {
  const path = resolve(root, CACHE_REL);
  const existing = readCache(root);
  const key = cacheKey(command, model);
  const entry: CacheEntry = {
    probedAt: new Date().toISOString(),
    capabilities: caps,
  };
  const merged: CapabilitiesCache = { ...existing, [key]: entry };

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(merged, null, 2) + "\n", "utf8");
}
