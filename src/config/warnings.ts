/**
 * Non-blocking pipeline warnings — pure functions, no I/O.
 *
 * `collectPipelineWarnings` inspects an already-validated pipeline and returns
 * human-readable warnings (pt-BR) for conditions that are valid but merit
 * attention:
 *   (a) Cycles in the flow graph created by goto edges.
 *   (b) `on_success`/`on_fail:{goto}` on `always` steps (ignored in teardown).
 *
 * Called after `parseConfig`; the CLI surfaces the lines on stderr (non-fatal,
 * mirrors `formatValidationError` without throwing). AD-6: pure & testable.
 */
import type { StepConfig } from "../types";

// ---------------------------------------------------------------------------
// (a) Cycle detection via DFS on the flow graph
// ---------------------------------------------------------------------------

/**
 * Build the flow graph from non-always steps. Edges:
 * - Success: `on_success.goto` if present, else the next non-always step.
 * - Failure: `on_fail.goto` if present (escalate = terminal, no edge).
 *
 * Always steps are excluded — teardown is always linear, gotos ignored.
 */
function buildFlowGraph(steps: readonly StepConfig[]): Map<string, string[]> {
  const main = steps.filter((s) => !s.always);
  const adj = new Map<string, string[]>();

  for (let i = 0; i < main.length; i++) {
    const step = main[i]!;
    const targets: string[] = [];

    // Success path
    if (step.on_success) {
      targets.push(step.on_success.goto);
    } else if (i + 1 < main.length) {
      targets.push(main[i + 1]!.id);
    }

    // Failure path — only goto creates a flow edge
    if (step.on_fail && typeof step.on_fail === "object") {
      targets.push(step.on_fail.goto);
    }

    if (targets.length > 0) adj.set(step.id, targets);
  }

  return adj;
}

/** Detect cycles in the flow graph using DFS. Returns one warning per cycle. */
function detectCycles(steps: readonly StepConfig[]): string[] {
  const adj = buildFlowGraph(steps);
  const allIds = steps.filter((s) => !s.always).map((s) => s.id);

  const visited = new Set<string>();
  const inStack = new Set<string>();
  const stack: string[] = [];
  const warnings: string[] = [];
  const reportedCycles = new Set<string>();

  function dfs(node: string): void {
    visited.add(node);
    inStack.add(node);
    stack.push(node);

    for (const target of adj.get(node) ?? []) {
      if (inStack.has(target)) {
        // Back edge — extract the cycle from the stack
        const cycleStart = stack.indexOf(target);
        const cycle = stack.slice(cycleStart);
        // Normalize: rotate to start from the lexicographically smallest id
        const minId = cycle.reduce((a, b) => (a < b ? a : b));
        const minIdx = cycle.indexOf(minId);
        const normalized = [
          ...cycle.slice(minIdx),
          ...cycle.slice(0, minIdx),
        ];
        const key = normalized.join(" \u2192 ");
        if (!reportedCycles.has(key)) {
          reportedCycles.add(key);
          warnings.push(
            `ciclo no grafo de goto: ${key} \u2192 ${normalized[0]} \u2014 confirme que \u00e9 intencional.`,
          );
        }
      } else if (!visited.has(target)) {
        dfs(target);
      }
    }

    stack.pop();
    inStack.delete(node);
  }

  for (const id of allIds) {
    if (!visited.has(id)) dfs(id);
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// (b) goto in always steps (ignored in teardown)
// ---------------------------------------------------------------------------

/** Detect `on_success`/`on_fail:{goto}` on always steps. */
function detectAlwaysGoto(steps: readonly StepConfig[]): string[] {
  const warnings: string[] = [];
  for (const step of steps) {
    if (!step.always) continue;
    const parts: string[] = [];
    if (step.on_success) parts.push("on_success");
    if (step.on_fail && typeof step.on_fail === "object") parts.push("on_fail");
    if (parts.length > 0) {
      warnings.push(
        `step "${step.id}": ${parts.join("/")} com goto \u00e9 ignorado no teardown (step always).`,
      );
    }
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Collect non-blocking pipeline warnings. Pure function — no I/O, no throws.
 * Returns `string[]` (empty when no warnings apply).
 */
export function collectPipelineWarnings(
  pipeline: readonly StepConfig[],
): string[] {
  return [...detectCycles(pipeline), ...detectAlwaysGoto(pipeline)];
}

/**
 * Format warnings for display (mirrors `formatValidationError` style, non-fatal).
 */
export function formatWarnings(
  warnings: readonly string[],
  sourcePath?: string,
): string {
  const suffix = sourcePath ? ` em "${sourcePath}"` : "";
  const lines = warnings.map((w) => `  - ${w}`);
  return `Aviso(s) no config${suffix}:\n${lines.join("\n")}`;
}
