import type { TaskState } from "loopy/tui/store";

/**
 * Return the id of the last step with status "failed",
 * but only when the task itself is escalated.
 *
 * Shared helper — keeps Kanban grouper and deps-graph in parity.
 */
export function failedStepId(task: TaskState): string | undefined {
  if (task.status !== "escalated") return undefined;
  for (let i = task.steps.length - 1; i >= 0; i--) {
    const step = task.steps[i]!;
    if (step.status === "failed") return step.id;
  }
  return undefined;
}
