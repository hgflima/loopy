/**
 * Scheduler types — pure data structures for the task DAG (AD-6).
 *
 * `TaskGraph` represents the dependency graph extracted from the backlog.
 * `SchedulerTaskStatus` tracks the lifecycle of each task within a run.
 * Both are read-only, deterministic, and I/O-free.
 */

/** Lifecycle status of a task within the scheduler. */
export type SchedulerTaskStatus =
  | "blocked"
  | "ready"
  | "running"
  | "done"
  | "escalated"
  | "paused"
  | "skipped";

/** The dependency graph of tasks extracted from the backlog. */
export interface TaskGraph {
  /** Task ids in backlog order. */
  readonly nodes: readonly string[];
  /** Dependency edges: `[dep, dependente]` — "dependente depends on dep". */
  readonly edges: readonly (readonly [string, string])[];
}
