/**
 * Pure fold functions for metric rollups: Sample → Step → Task → Run → Change.
 *
 * All functions are pure (no I/O, no mutation). Invariants:
 * - `usage` is **summed** across turns/visits (per-turn — spike v0.26.0).
 * - `cost` is the **last non-null** cumulative Session snapshot per Task.
 * - `null` usage means "not applicable" (non-agent); `available:false` means
 *   "agent but ACP didn't report" → render "n/d".
 * - Empty inputs yield zero/null summaries (never throw).
 */

import type {
  ChangeMetrics,
  MetricsSummary,
  RunMetrics,
  Sample,
  StepCost,
  StepMetrics,
  StepType,
  TaskMetrics,
  TurnUsage,
} from "../types.js";

// ---------------------------------------------------------------------------
// TurnUsage arithmetic
// ---------------------------------------------------------------------------

/** Sum two TurnUsage values. `null` is the identity element. */
export function addUsage(
  a: TurnUsage | null,
  b: TurnUsage | null,
): TurnUsage | null {
  if (a === null) return b;
  if (b === null) return a;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedReadTokens: (a.cachedReadTokens ?? 0) + (b.cachedReadTokens ?? 0),
    cachedWriteTokens: (a.cachedWriteTokens ?? 0) + (b.cachedWriteTokens ?? 0),
    thoughtTokens: (a.thoughtTokens ?? 0) + (b.thoughtTokens ?? 0),
    totalTokens: a.totalTokens + b.totalTokens,
    available: a.available || b.available,
  };
}

// ---------------------------------------------------------------------------
// StepCost arithmetic
// ---------------------------------------------------------------------------

/** Sum two StepCost values. `null` is the identity element. */
export function addCost(
  a: StepCost | null,
  b: StepCost | null,
): StepCost | null {
  if (a === null) return b;
  if (b === null) return a;
  return {
    amount: a.amount + b.amount,
    currency: a.currency,
    available: a.available || b.available,
  };
}

// ---------------------------------------------------------------------------
// Sample → StepMetrics
// ---------------------------------------------------------------------------

/** Fold visit Samples into a single StepMetrics (sum durations + usage). */
export function foldSamples(
  type: StepType,
  samples: readonly Sample[],
): StepMetrics {
  let durationMs = 0;
  let usage: TurnUsage | null = null;

  for (const s of samples) {
    durationMs += s.durationMs;
    usage = addUsage(usage, s.usage);
  }

  return { type, visits: samples.length, durationMs, usage };
}

// ---------------------------------------------------------------------------
// Task summary
// ---------------------------------------------------------------------------

/** Summarize a TaskMetrics: sum of steps' duration/usage/visits. */
export function summarizeTask(tm: TaskMetrics): MetricsSummary {
  let durationMs = 0;
  let usage: TurnUsage | null = null;
  let visits = 0;

  for (const sm of Object.values(tm.steps)) {
    durationMs += sm.durationMs;
    usage = addUsage(usage, sm.usage);
    visits += sm.visits;
  }

  return { durationMs, usage, visits, cost: tm.cost, taskCount: 1, runCount: 0 };
}

// ---------------------------------------------------------------------------
// Run summary
// ---------------------------------------------------------------------------

/** Summarize a RunMetrics: sum of tasks. Cost = last non-null across tasks. */
export function summarizeRun(rm: RunMetrics): MetricsSummary {
  let durationMs = 0;
  let usage: TurnUsage | null = null;
  let visits = 0;
  let cost: StepCost | null = null;
  let taskCount = 0;

  for (const tm of Object.values(rm.tasks)) {
    const ts = summarizeTask(tm);
    durationMs += ts.durationMs;
    usage = addUsage(usage, ts.usage);
    visits += ts.visits;
    if (ts.cost !== null) cost = ts.cost;
    taskCount++;
  }

  return { durationMs, usage, visits, cost, taskCount, runCount: 1 };
}

// ---------------------------------------------------------------------------
// Change summary (fold over runs[])
// ---------------------------------------------------------------------------

/** Summarize a ChangeMetrics: sum of all runs. */
export function summarizeChange(cm: ChangeMetrics): MetricsSummary {
  let durationMs = 0;
  let usage: TurnUsage | null = null;
  let visits = 0;
  let cost: StepCost | null = null;
  let taskCount = 0;

  for (const rm of cm.runs) {
    const rs = summarizeRun(rm);
    durationMs += rs.durationMs;
    usage = addUsage(usage, rs.usage);
    visits += rs.visits;
    if (rs.cost !== null) cost = rs.cost;
    taskCount += rs.taskCount;
  }

  return {
    durationMs,
    usage,
    visits,
    cost,
    taskCount,
    runCount: cm.runs.length,
  };
}
