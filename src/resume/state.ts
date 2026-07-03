/**
 * Step-level resume state: fingerprint, pure transitions, and atomic I/O.
 *
 * Pure functions (`pipelineFingerprint`, `completedStepsFor`, `*In` transitions,
 * `emptyState`) carry all the logic; `loadState` / `saveState` add disk I/O —
 * mirroring the `parseConfig` / `loadConfig` split in `config/load.ts` and the
 * `parseBacklog` / `loadBacklog` split in `backlog/todo.ts`.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { RunState, StepConfig, TaskCheckpoint, TaskStatus } from "../types";

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

/**
 * Stable fingerprint of the pipeline: changes when ids, order, OR content of
 * any step change. Uses `sha256(JSON.stringify(pipeline))` via `node:crypto`.
 */
export function pipelineFingerprint(pipeline: readonly StepConfig[]): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(pipeline)).digest("hex")}`;
}

// ---------------------------------------------------------------------------
// Pure queries
// ---------------------------------------------------------------------------

/**
 * Steps already completed for a task — empty set when the checkpoint is absent,
 * the pipeline hash diverges, or `status: "aborted"` without `allowAborted`.
 */
export function completedStepsFor(
  state: RunState,
  taskId: string,
  currentHash: string,
  opts: { readonly allowAborted: boolean },
): ReadonlySet<string> {
  const cp = state.tasks[taskId];
  if (cp === undefined || cp.pipelineHash !== currentHash) return new Set();
  if (cp.status === "aborted" && !opts.allowAborted) return new Set();
  return new Set(cp.completedSteps);
}

// ---------------------------------------------------------------------------
// Pure transitions  (state, …) => RunState
// ---------------------------------------------------------------------------

/** Return `state` with `taskId` mapped to `cp`. */
function withTask(state: RunState, taskId: string, cp: TaskCheckpoint): RunState {
  return { ...state, tasks: { ...state.tasks, [taskId]: cp } };
}

/** Record a completed step for a task (appends to `completedSteps`). */
export function recordStepIn(
  state: RunState,
  taskId: string,
  stepId: string,
  pipelineHash: string,
): RunState {
  const prev = state.tasks[taskId];
  return withTask(state, taskId, {
    pipelineHash,
    completedSteps: prev ? [...prev.completedSteps, stepId] : [stepId],
    status: prev?.status ?? "running",
  });
}

/** Set the status of a task's checkpoint. */
export function setStatusIn(
  state: RunState,
  taskId: string,
  status: TaskStatus,
  pipelineHash: string,
): RunState {
  const prev = state.tasks[taskId];
  return withTask(state, taskId, {
    pipelineHash: prev?.pipelineHash ?? pipelineHash,
    completedSteps: prev?.completedSteps ?? [],
    status,
  });
}

/** Remove a task's checkpoint entirely. */
export function clearTaskIn(state: RunState, taskId: string): RunState {
  return {
    ...state,
    tasks: Object.fromEntries(
      Object.entries(state.tasks).filter(([id]) => id !== taskId),
    ),
  };
}

/** Remove checkpoints for tasks not in `knownTaskIds`. */
export function pruneOrphansIn(
  state: RunState,
  knownTaskIds: readonly string[],
): RunState {
  const known = new Set(knownTaskIds);
  return {
    ...state,
    tasks: Object.fromEntries(
      Object.entries(state.tasks).filter(([id]) => known.has(id)),
    ),
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** A fresh, empty run state. */
export function emptyState(): RunState {
  return { version: 1, tasks: {} };
}

// ---------------------------------------------------------------------------
// I/O wrappers
// ---------------------------------------------------------------------------

/**
 * Load state from disk. Tolerates absence (file not found) and corruption
 * (invalid JSON) — returns `emptyState()` in both cases, never throws.
 */
export function loadState(path: string): RunState {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    if (parsed.version === 1 && typeof parsed.tasks === "object" && parsed.tasks !== null) {
      return parsed as unknown as RunState;
    }
  } catch {
    // file not found, permission error, or invalid JSON — all yield empty
  }
  return emptyState();
}

/**
 * Atomic write: `mkdirSync` (recursive) + write to `.tmp` + `renameSync`.
 * Never leaves a partial/corrupted `state.json`.
 */
export function saveState(path: string, state: RunState): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmp, path);
}
