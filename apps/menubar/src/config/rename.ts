/**
 * Rename cascade helpers (T-013, SC11).
 *
 * Pure functions that rename a step id, agent name, or checks-list name
 * throughout the entire config, rewriting all referrers.
 *
 * Collision guard: renaming to a name that already exists is rejected.
 *
 * Note (R6): the `run` field of a `checks` step is NOT validated as a ref by
 * the motor's zod schema — the cascade covers the rename, but an orphan
 * checks-list name does not produce a motor error.
 */

import type { LoopyConfigParsed } from "loopy/config";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type PipelineStep = LoopyConfigParsed["pipeline"][number];

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Rename a key in a record, preserving insertion order. */
function renameKey<V>(record: Record<string, V>, oldKey: string, newKey: string): Record<string, V> {
  const out: Record<string, V> = {};
  for (const [k, v] of Object.entries(record)) {
    out[k === oldKey ? newKey : k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type RenameResult =
  | { ok: true; config: LoopyConfigParsed }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// renameStepId
// ---------------------------------------------------------------------------

/**
 * Rename a step id and cascade to all `on_success.goto` / `on_fail.goto`
 * references across the pipeline.
 */
export function renameStepId(
  config: LoopyConfigParsed,
  oldId: string,
  newId: string,
): RenameResult {
  if (oldId === newId) return { ok: true, config };

  // Collision guard
  if (config.pipeline.some((s) => s.id === newId)) {
    return { ok: false, error: `Step id "${newId}" already exists` };
  }

  const pipeline: PipelineStep[] = config.pipeline.map((step) => {
    let s: PipelineStep = step;

    // Rename the step itself
    if (s.id === oldId) {
      s = { ...s, id: newId };
    }

    // Rewrite on_success.goto
    if (s.on_success && s.on_success.goto === oldId) {
      s = { ...s, on_success: { goto: newId } };
    }

    // Rewrite on_fail.goto
    if (s.on_fail && typeof s.on_fail === "object" && s.on_fail.goto === oldId) {
      s = { ...s, on_fail: { goto: newId } };
    }

    return s;
  });

  return { ok: true, config: { ...config, pipeline } };
}

// ---------------------------------------------------------------------------
// renameAgent
// ---------------------------------------------------------------------------

/**
 * Rename an agent in the registry and cascade to `acp.default_agent` and
 * every `step.agent` field in the pipeline.
 */
export function renameAgent(
  config: LoopyConfigParsed,
  oldName: string,
  newName: string,
): RenameResult {
  if (oldName === newName) return { ok: true, config };

  const agents = config.agents ?? {};

  // Collision guard
  if (newName in agents) {
    return { ok: false, error: `Agent "${newName}" already exists` };
  }

  const newAgents = renameKey(agents, oldName, newName);

  // Cascade acp.default_agent
  const acp =
    config.acp.default_agent === oldName
      ? { ...config.acp, default_agent: newName }
      : config.acp;

  // Cascade step.agent in pipeline
  const pipeline = config.pipeline.map((step) => {
    if (step.type === "agent" && step.agent === oldName) {
      return { ...step, agent: newName };
    }
    return step;
  });

  return { ok: true, config: { ...config, agents: newAgents, acp, pipeline } };
}

// ---------------------------------------------------------------------------
// renameChecksList
// ---------------------------------------------------------------------------

/**
 * Rename a checks-list key and cascade to `verify.run` in agent steps and
 * `run` in checks-type steps.
 */
export function renameChecksList(
  config: LoopyConfigParsed,
  oldName: string,
  newName: string,
): RenameResult {
  if (oldName === newName) return { ok: true, config };

  const checks = config.checks;

  // Collision guard
  if (newName in checks) {
    return { ok: false, error: `Checks list "${newName}" already exists` };
  }

  const newChecks = renameKey(checks, oldName, newName);

  // Cascade in pipeline: verify.run (agent steps) and run (checks steps)
  const pipeline = config.pipeline.map((step) => {
    if (step.type === "agent" && step.verify?.run === oldName) {
      return { ...step, verify: { ...step.verify, run: newName } };
    }
    if (step.type === "checks" && step.run === oldName) {
      return { ...step, run: newName };
    }
    return step;
  });

  return { ok: true, config: { ...config, checks: newChecks, pipeline } };
}
