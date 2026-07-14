/**
 * PC-based resume state: fingerprint, pure transitions, and atomic I/O.
 *
 * Pure functions (`pipelineFingerprint`, `resumeStateFor`, `*In` transitions,
 * `emptyState`) carry all the logic; `loadState` / `saveState` add disk I/O —
 * mirroring the `parseConfig` / `loadConfig` split in `config/load.ts` and the
 * `parseBacklog` / `loadBacklog` split in `backlog/todo.ts`.
 *
 * C-0004 migration: `TaskCheckpoint` uses `pc` (step id) + `visits` (counters)
 * + `checksReport` (carry) instead of `completedSteps: string[]`.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CheckpointStatus, RunState, StepConfig, TaskCheckpoint } from "../types";

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

/** Resume point extracted from a checkpoint — PC position + visit counters + carry. */
export interface ResumePoint {
  readonly pc: string;
  readonly visits: Readonly<Record<string, number>>;
  readonly checksReport: string;
}

/**
 * Extract the resume point for a task — `undefined` when the checkpoint is
 * absent, the pipeline hash diverges, `status: "aborted"` without
 * `allowAborted`, or the PC is empty (fresh start).
 */
export function resumeStateFor(
  state: RunState,
  taskId: string,
  currentHash: string,
  opts: { readonly allowAborted: boolean },
): ResumePoint | undefined {
  const cp = state.tasks[taskId];
  if (cp === undefined || cp.pipelineHash !== currentHash) return undefined;
  if (cp.status === "aborted" && !opts.allowAborted) return undefined;
  if (cp.pc === "") return undefined;
  return { pc: cp.pc, visits: cp.visits, checksReport: cp.checksReport };
}

// ---------------------------------------------------------------------------
// Pure transitions  (state, …) => RunState
// ---------------------------------------------------------------------------

/** Return `state` with `taskId` mapped to `cp`. */
function withTask(state: RunState, taskId: string, cp: TaskCheckpoint): RunState {
  return { ...state, tasks: { ...state.tasks, [taskId]: cp } };
}

/** Save progress: update PC position, visit counters, and carry for a task. */
export function saveProgressIn(
  state: RunState,
  taskId: string,
  pc: string,
  visits: Readonly<Record<string, number>>,
  checksReport: string,
  pipelineHash: string,
): RunState {
  const prev = state.tasks[taskId];
  return withTask(state, taskId, {
    pipelineHash,
    pc,
    visits,
    checksReport,
    status: prev?.status ?? "running",
  });
}

/** Set the status of a task's checkpoint. */
export function setStatusIn(
  state: RunState,
  taskId: string,
  status: CheckpointStatus,
  pipelineHash: string,
): RunState {
  const prev = state.tasks[taskId];
  return withTask(state, taskId, {
    pipelineHash: prev?.pipelineHash ?? pipelineHash,
    pc: prev?.pc ?? "",
    visits: prev?.visits ?? {},
    checksReport: prev?.checksReport ?? "",
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
