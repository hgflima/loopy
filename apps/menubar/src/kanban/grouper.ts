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
import { failedStepId } from "./failed-step";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface KanbanCard {
  readonly taskId: string;
  readonly title: string;
  readonly status: TaskStatus;
  /** For escalated tasks — the pipeline step where the failure occurred. */
  readonly failedAtStepId?: string;
  /** True when at least one step received a warning event. */
  readonly warned?: boolean;
}

/**
 * A labelled run of cards inside a column. Only "Fim" uses it today: the
 * column is terminal for four *different* outcomes, and a `skipped` task
 * (never ran — a dependency broke first) must not read as a `done` one.
 */
export interface KanbanSection {
  readonly status: TaskStatus;
  readonly label: string;
  readonly cards: KanbanCard[];
}

export interface KanbanColumn {
  readonly id: string;
  readonly title: string;
  /** Every card in the column, flat and in render order. */
  readonly cards: KanbanCard[];
  /**
   * Optional breakdown of `cards` by outcome, same order. Present only when
   * the column holds more than one outcome — with a single one the column
   * header already says everything, and a lone section header is noise.
   */
  readonly sections?: readonly KanbanSection[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The terminal outcomes, in the order they read inside "Fim": what shipped
 * first, what never ran second, what needs a human last.
 */
const TERMINAL_ORDER: readonly (readonly [TaskStatus, string])[] = [
  ["done", "Concluídas"],
  ["skipped", "Puladas"],
  ["escalated", "Escalonadas"],
  ["paused", "Pausadas"],
];

const TERMINAL: ReadonlySet<TaskStatus> = new Set(
  TERMINAL_ORDER.map(([status]) => status),
);

function toCard(task: TaskState): KanbanCard {
  const fid = failedStepId(task);
  const hasWarning = task.steps.some((s) => s.warned);
  return {
    taskId: task.id,
    title: task.title,
    status: task.status,
    ...(fid && { failedAtStepId: fid }),
    ...(hasWarning && { warned: true }),
  };
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
    endColumn(fim),
  ];
}

/**
 * Build the "Fim" column, splitting its cards by outcome.
 *
 * `cards` stays flat (and is reordered to match the sections) so callers that
 * only care about membership — the header count, `detectGotoCards` — need to
 * know nothing about sections.
 */
function endColumn(cards: readonly KanbanCard[]): KanbanColumn {
  const sections = TERMINAL_ORDER.map(([status, label]) => ({
    status,
    label,
    cards: cards.filter((c) => c.status === status),
  })).filter((s) => s.cards.length > 0);

  const ordered = sections.flatMap((s) => s.cards);

  return {
    id: "fim",
    title: "Fim",
    cards: ordered,
    ...(sections.length > 1 && { sections }),
  };
}
