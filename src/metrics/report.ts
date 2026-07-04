/**
 * Pure Run report renderer (AD-6).
 *
 * Produces the text emitted to stderr at the end of every Run when `metrics`
 * is configured. Format (per spec):
 * - One block per Task, one line per Step (`id · type · Δt · usage`).
 * - Subtotal per Task (Σ Δt · tokens · cost).
 * - Total of the Run.
 * - "Change até agora" line (accumulated across all Runs).
 *
 * Cost is shown at Task/Run/Change level only (never per-Step — OQ2).
 * `usage` null → "n-a" (non-agent); `available:false` → "n/d".
 */

import type { ChangeMetrics, RunMetrics } from "../types.js";
import { summarizeChange, summarizeRun, summarizeTask } from "./folds.js";
import { formatCost, formatDuration, formatUsage } from "./format.js";

/**
 * Render the Run report as an array of lines (no trailing newlines).
 * The caller joins with `\n` and writes to stderr.
 */
export function renderRunReport(
  run: RunMetrics,
  change: ChangeMetrics,
): string[] {
  const lines: string[] = [];

  lines.push("── Run report ──");
  lines.push("");

  for (const [taskId, taskMetrics] of Object.entries(run.tasks)) {
    lines.push(`  ${taskId}:`);

    for (const [stepId, sm] of Object.entries(taskMetrics.steps)) {
      lines.push(`    ${stepId} · ${sm.type} · ${formatDuration(sm.durationMs)} · ${formatUsage(sm.usage)}`);
    }

    const ts = summarizeTask(taskMetrics);
    lines.push(`    Σ ${taskId} · ${formatDuration(ts.durationMs)} · ${formatUsage(ts.usage)} · custo: ${formatCost(ts.cost)}`);
    lines.push("");
  }

  const rs = summarizeRun(run);
  lines.push(
    `  Total Run · ${formatDuration(rs.durationMs)} · ${formatUsage(rs.usage)} · custo: ${formatCost(rs.cost)}`,
  );

  const cs = summarizeChange(change);
  lines.push(
    `  Change até agora: ${cs.runCount} Run(s) · ${cs.taskCount} Task(s) · ${formatUsage(cs.usage)} · ${formatDuration(cs.durationMs)} · custo: ${formatCost(cs.cost)}`,
  );

  lines.push("── fim ──");
  return lines;
}
