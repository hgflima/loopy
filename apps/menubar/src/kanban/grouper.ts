/**
 * Pure Kanban grouper — maps StoreState into columns: Backlog → Steps → Fim.
 *
 * Zero React. The function is deterministic: same state in → same columns out.
 *
 * Column layout:
 *  - **Backlog**: pending / blocked tasks (or running with no currentStepId).
 *  - **One column per pipeline step** (declared order).
 *  - **Fim**: terminal tasks (done / escalated / skipped / paused).
 *
 * An escalated card carries `failedAtStepId` — the last step that failed —
 * so the UI can show *where* it broke (spec refino #6).
 *
 * A `goto` (desvio) naturally places the card in an earlier column because
 * the reducer resets `currentStepId` to the goto target on `step_started`.
 */
import type { StoreState, TaskState, TaskStatus } from "loopy/tui/store";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface KanbanCard {
  readonly taskId: string;
  readonly title: string;
  readonly status: TaskStatus;
  /** For escalated tasks — the pipeline step where the failure occurred. */
  readonly failedAtStepId?: string;
}

export interface KanbanColumn {
  readonly id: string;
  readonly title: string;
  readonly cards: KanbanCard[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TERMINAL: ReadonlySet<TaskStatus> = new Set([
  "done",
  "escalated",
  "skipped",
  "paused",
]);

/** Find the last step with status "failed" in a task's step history. */
function lastFailedStepId(task: TaskState): string | undefined {
  for (let i = task.steps.length - 1; i >= 0; i--) {
    const step = task.steps[i]!;
    if (step.status === "failed") return step.id;
  }
  return undefined;
}

function toCard(task: TaskState): KanbanCard {
  const card: KanbanCard = {
    taskId: task.id,
    title: task.title,
    status: task.status,
  };
  if (task.status === "escalated") {
    const fid = lastFailedStepId(task);
    if (fid) return { ...card, failedAtStepId: fid };
  }
  return card;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Group tasks into Kanban columns by their current pipeline step.
 *
 * @param state - The current store state snapshot.
 * @returns Ordered columns: Backlog, then one per declared pipeline step, then Fim.
 */
export function groupByStep(state: StoreState): KanbanColumn[] {
  const backlog: KanbanCard[] = [];
  const fim: KanbanCard[] = [];
  const stepBuckets = new Map<string, KanbanCard[]>();
  for (const s of state.pipeline) stepBuckets.set(s.id, []);

  for (const task of state.tasks) {
    if (TERMINAL.has(task.status)) {
      fim.push(toCard(task));
    } else if (task.currentStepId && stepBuckets.has(task.currentStepId)) {
      stepBuckets.get(task.currentStepId)!.push(toCard(task));
    } else {
      backlog.push(toCard(task));
    }
  }

  return [
    { id: "backlog", title: "Backlog", cards: backlog },
    ...state.pipeline.map((s) => ({
      id: s.id,
      title: s.id,
      cards: stepBuckets.get(s.id)!,
    })),
    { id: "fim", title: "Fim", cards: fim },
  ];
}
