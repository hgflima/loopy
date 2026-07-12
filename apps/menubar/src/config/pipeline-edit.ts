import type { StepConfig, StepType } from "loopy/types";

// ── Helpers ────────────────────────────────────────────────────────────

/** Generate a unique step id that doesn't collide with existing pipeline ids. */
function generateStepId(pipeline: readonly StepConfig[]): string {
  const ids = new Set(pipeline.map((s) => s.id));
  let n = pipeline.length + 1;
  while (ids.has(`step-${n}`)) n++;
  return `step-${n}`;
}

/** Default type-specific fields for a freshly created step. */
function defaultsForType(type: StepType) {
  switch (type) {
    case "agent":
      return { prompt: "" } as const;
    case "shell":
      return { run: [] as string[] } as const;
    case "checks":
      return { run: "" } as const;
    case "approval":
      return { prompt: "" } as const;
  }
}

// Base keys preserved across type migration (id + StepBase optional fields + on_fail).
const BASE_KEYS = [
  "id",
  "always",
  "on_success",
  "parallel_safe",
  "on_fail",
] as const;

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Insert a new step of the given type into the pipeline.
 * Generates a unique id and applies type-appropriate defaults.
 */
export function addStep(
  pipeline: readonly StepConfig[],
  type: StepType,
  atIndex?: number,
): StepConfig[] {
  const id = generateStepId(pipeline);
  const step = { id, type, ...defaultsForType(type) } as StepConfig;
  const result = [...pipeline];
  result.splice(atIndex ?? result.length, 0, step);
  return result;
}

/** Remove a step by id. Returns a new array without the step. */
export function removeStep(
  pipeline: readonly StepConfig[],
  id: string,
): StepConfig[] {
  return pipeline.filter((s) => s.id !== id);
}

/** Move a step from one index to another. Returns a new array. */
export function reorderStep(
  pipeline: readonly StepConfig[],
  from: number,
  to: number,
): StepConfig[] {
  const result = [...pipeline];
  const [step] = result.splice(from, 1);
  result.splice(to, 0, step);
  return result;
}

/**
 * Change a step's type, preserving base fields (id, always, on_success,
 * parallel_safe, on_fail) and discarding type-specific fields (R4).
 * Same-type migration is a no-op.
 */
export function migrateStepType(
  step: StepConfig,
  newType: StepType,
): StepConfig {
  if (step.type === newType) return step;

  const raw = step as unknown as Record<string, unknown>;
  const base: Record<string, unknown> = {};
  for (const key of BASE_KEYS) {
    if (key in raw && raw[key] !== undefined) {
      base[key] = raw[key];
    }
  }

  return { type: newType, ...base, ...defaultsForType(newType) } as StepConfig;
}

// ── Orphan ref detection ───────────────────────────────────────────────

export interface OrphanRef {
  /** The step that contains the dangling reference. */
  stepId: string;
  /** Which field holds the dangling goto. */
  field: "on_fail" | "on_success";
  /** The target id that doesn't exist in the pipeline. */
  target: string;
}

/** Extract the goto target from an on_fail/on_success action, if any. */
function gotoTarget(
  action: StepConfig["on_fail"] | StepConfig["on_success"],
): string | undefined {
  return typeof action === "object" && action !== null
    ? action.goto
    : undefined;
}

/**
 * Scan the pipeline for goto/on_success.goto references that point to
 * step ids not present in the pipeline. Mirrors the superRefine in the
 * schema without reimplementing rules — just collects refs for the UI.
 */
export function orphanRefs(pipeline: readonly StepConfig[]): OrphanRef[] {
  const ids = new Set(pipeline.map((s) => s.id));
  const orphans: OrphanRef[] = [];

  for (const step of pipeline) {
    for (const field of ["on_success", "on_fail"] as const) {
      const target = gotoTarget(step[field]);
      if (target && !ids.has(target)) {
        orphans.push({ stepId: step.id, field, target });
      }
    }
  }

  return orphans;
}
