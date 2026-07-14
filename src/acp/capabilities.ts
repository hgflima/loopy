/**
 * Pure parse of the `configOptions` announced in ACP `session/new`.
 *
 * Discovers what an agent supports — modes, models, effort levels — from the
 * **same** `configOptions` array that {@link findConfigId} in `session.ts`
 * already reads for `model` and `thought_level`. This module generalises that
 * pattern to **all three categories** (`mode` / `model` / `thought_level`)
 * and exposes the discovered values, not just the `id`.
 *
 * Zero I/O, zero SDK calls — only SDK **types** are imported.
 *
 * @see D28 in the C-0016 spec: `configOptions` is the source of truth.
 */
import type {
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
} from "@agentclientprotocol/sdk";

/**
 * What an ACP agent announced it supports.
 *
 * Every field is derived from `configOptions` in `session/new`. An empty array
 * means the agent does not announce that category — this is real information
 * (e.g. OpenCode has no `thought_level`), **never** an error.
 */
export interface AgentCapabilities {
  readonly modes: readonly string[];
  readonly models: readonly string[];
  readonly efforts: readonly string[];
  /** `id` of the config option with `category: "mode"` (if present). */
  readonly modeConfigId?: string;
  /** `id` of the config option with `category: "model"` (if present). */
  readonly modelConfigId?: string;
  /** `id` of the config option with `category: "thought_level"` (if present). Differs by adapter: `effort` (Claude), `reasoning_effort` (Codex). */
  readonly effortConfigId?: string;
  /**
   * What the agent selects **on its own** when the yml says nothing —
   * the `currentValue` each select announces at `session/new`.
   *
   * An omitted `mode`/`model`/`effort` in a step is never "no value": the
   * agent still runs with *something*. These are that something, so the GUI can
   * name the inherited default instead of implying the field is empty.
   * `undefined` = the agent doesn't announce that category.
   */
  readonly defaultMode?: string;
  readonly defaultModel?: string;
  readonly defaultEffort?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers (pure)
// ---------------------------------------------------------------------------

/** True when a select option list uses the grouped variant. */
function isGrouped(
  options:
    | readonly SessionConfigSelectOption[]
    | readonly SessionConfigSelectGroup[],
): options is readonly SessionConfigSelectGroup[] {
  return options.length > 0 && "group" in options[0]!;
}

/** Flatten a select's option list (flat or grouped) into plain values. */
function extractValues(option: SessionConfigOption): readonly string[] {
  if (option.type !== "select") return [];
  const opts = option.options;
  if (isGrouped(opts)) {
    return opts.flatMap((g) => g.options.map((o) => o.value));
  }
  return (opts as readonly SessionConfigSelectOption[]).map((o) => o.value);
}

/** The value a select is already sitting on — the agent's own default. */
function currentValueOf(option: SessionConfigOption): string | undefined {
  return option.type === "select" ? option.currentValue : undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse the capabilities an agent announced in `session/new`.
 *
 * Finds config options by **category** (`mode` / `model` / `thought_level`) —
 * the same criterion as `findConfigId` (`session.ts:133`). Extracts the
 * selectable values and the `id` used for `set_config_option`.
 *
 * `category: "model_config"` (fast mode) is intentionally **ignored** (D35).
 *
 * @param configOptions The `configOptions` from `NewSessionResponse` (may be `undefined`).
 * @param fallbackModes Legacy `availableModes` — used **only** when `configOptions` has
 *   no `mode` category. `configOptions` takes precedence (D28).
 */
export function parseCapabilities(
  configOptions: readonly SessionConfigOption[] | undefined,
  fallbackModes?: readonly string[],
): AgentCapabilities {
  const fallback = fallbackModes ? [...fallbackModes] : [];

  if (!configOptions) {
    return { modes: fallback, models: [], efforts: [] };
  }

  const modeOption = configOptions.find((o) => o.category === "mode");
  const modelOption = configOptions.find((o) => o.category === "model");
  const effortOption = configOptions.find(
    (o) => o.category === "thought_level",
  );

  return {
    modes: modeOption ? extractValues(modeOption) : fallback,
    models: modelOption ? extractValues(modelOption) : [],
    efforts: effortOption ? extractValues(effortOption) : [],
    modeConfigId: modeOption?.id,
    modelConfigId: modelOption?.id,
    effortConfigId: effortOption?.id,
    defaultMode: modeOption ? currentValueOf(modeOption) : undefined,
    defaultModel: modelOption ? currentValueOf(modelOption) : undefined,
    defaultEffort: effortOption ? currentValueOf(effortOption) : undefined,
  };
}
