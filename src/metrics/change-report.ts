/**
 * Change report — Markdown renderer + byte-preserving index.md rewrite (T-006).
 *
 * Pure functions:
 * - {@link renderChangeSection}: Render a Change report section (Markdown).
 * - {@link upsertChangeSection}: Replace or append a section, byte-preserving.
 *
 * I/O:
 * - {@link persistChangeReport}: Write the Change report to the index file.
 *
 * The section boundary is: from `## <changeId>` to the next `## ` (h2) or EOF.
 * This mirrors the byte-preserving pattern of `markDone` in `src/backlog/todo.ts`.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ChangeMetrics, MetricsSummary, TurnUsage } from "../types.js";
import { addUsage, summarizeChange, summarizeTask } from "./folds.js";
import { formatCost, formatDuration, formatTokens } from "./format.js";

// ---------------------------------------------------------------------------
// Per-task aggregation across runs
// ---------------------------------------------------------------------------

/**
 * Aggregate each task's metrics across all runs in the Change.
 * Returns entries in first-seen order (chronological).
 */
function aggregateTasks(
  metrics: ChangeMetrics,
): Array<[string, MetricsSummary]> {
  const byTask = new Map<string, MetricsSummary>();

  for (const run of metrics.runs) {
    for (const [id, tm] of Object.entries(run.tasks)) {
      const ts = summarizeTask(tm);
      const prev = byTask.get(id);
      if (!prev) {
        byTask.set(id, ts);
      } else {
        byTask.set(id, {
          durationMs: prev.durationMs + ts.durationMs,
          usage: addUsage(prev.usage, ts.usage),
          visits: prev.visits + ts.visits,
          cost: ts.cost ?? prev.cost,
          taskCount: 1,
          runCount: 0,
        });
      }
    }
  }

  return [...byTask.entries()];
}

// ---------------------------------------------------------------------------
// Token column formatting
// ---------------------------------------------------------------------------

function tokenCols(usage: TurnUsage | null): [string, string, string, string] {
  if (usage === null) return ["n-a", "n-a", "n-a", "n-a"];
  if (!usage.available) return ["n/d", "n/d", "n/d", "n/d"];
  const cached = (usage.cachedReadTokens ?? 0) + (usage.cachedWriteTokens ?? 0);
  return [
    formatTokens(usage.inputTokens),
    formatTokens(usage.outputTokens),
    formatTokens(cached),
    formatTokens(usage.totalTokens),
  ];
}

// ---------------------------------------------------------------------------
// Renderer (pure — AD-6)
// ---------------------------------------------------------------------------

/**
 * Render a Change report section as Markdown.
 *
 * Format: `## <changeId>` + totals paragraph + rich table per Task.
 * Ends with `\n\n` for clean insertion/appending.
 */
export function renderChangeSection(
  changeId: string,
  metrics: ChangeMetrics,
): string {
  const cs = summarizeChange(metrics);
  const lastRun = metrics.runs[metrics.runs.length - 1];
  const stoppedBy = lastRun?.stoppedBy ?? "n/d";

  const lines: string[] = [];

  lines.push(`## ${changeId}`);
  lines.push("");

  // Totals paragraph
  const parts = [
    `${cs.runCount} Run(s)`,
    `${cs.taskCount} Task(s)`,
  ];
  if (cs.usage && cs.usage.available) {
    parts.push(
      `in:${formatTokens(cs.usage.inputTokens)} out:${formatTokens(cs.usage.outputTokens)}`,
    );
  }
  parts.push(formatDuration(cs.durationMs));
  parts.push(`custo: ${formatCost(cs.cost)}`);
  parts.push(`parada: ${stoppedBy}`);
  lines.push(parts.join(" · "));
  lines.push("");

  // Task table
  const tasks = aggregateTasks(metrics);
  if (tasks.length > 0) {
    lines.push("| Task | Δt | in | out | cached | tokens | visits | custo |");
    lines.push("|------|-----|-----|------|--------|--------|--------|-------|");

    for (const [taskId, ts] of tasks) {
      const [inCol, outCol, cachedCol, tokensCol] = tokenCols(ts.usage);
      lines.push(
        `| ${taskId} | ${formatDuration(ts.durationMs)} | ${inCol} | ${outCol} | ${cachedCol} | ${tokensCol} | ${ts.visits} | ${formatCost(ts.cost)} |`,
      );
    }
  }

  // Trailing blank line for clean separation from the next section
  lines.push("");
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Byte-preserving section upsert (pure)
// ---------------------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace or append a section in `content`, preserving all other content
 * byte-for-byte. Section boundaries: from `## <changeId>` (inclusive) to the
 * next `## ` (h2, exclusive) or EOF.
 */
export function upsertChangeSection(
  content: string,
  changeId: string,
  section: string,
): string {
  const pattern = new RegExp(`^## ${escapeRegex(changeId)}\\s*$`, "m");
  const match = pattern.exec(content);

  if (!match) {
    // Not found — append at end
    const sep = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
    return content + sep + section;
  }

  const startOffset = match.index;

  // Find end of section: next `## ` at start of a line, or EOF
  const afterHeadingNewline = content.indexOf("\n", startOffset);
  const searchFrom =
    afterHeadingNewline === -1 ? content.length : afterHeadingNewline + 1;

  const rest = content.slice(searchFrom);
  const nextH2 = /^## /m.exec(rest);
  const endOffset = nextH2 ? searchFrom + nextH2.index : content.length;

  return content.slice(0, startOffset) + section + content.slice(endOffset);
}

// ---------------------------------------------------------------------------
// I/O: persist to index file
// ---------------------------------------------------------------------------

const INDEX_TITLE = "# Changes\n\n";

/**
 * Persist the Change report to the index file. Creates the file (with a `#`
 * heading) if it doesn't exist; upserts the section for `changeId` otherwise.
 * Atomic write (write to .tmp, rename).
 */
export function persistChangeReport(
  path: string,
  changeId: string,
  metrics: ChangeMetrics,
): void {
  const section = renderChangeSection(changeId, metrics);

  let existing: string;
  try {
    existing = readFileSync(path, "utf8");
  } catch {
    existing = INDEX_TITLE;
  }

  const updated = upsertChangeSection(existing, changeId, section);

  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, updated, "utf8");
  renameSync(tmp, path);
}
