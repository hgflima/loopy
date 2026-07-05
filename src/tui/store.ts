/**
 * Observable run state for the live TUI (T-016).
 *
 * The store is a small, framework-agnostic reducer + subscription over the
 * progress of a run. It is **parallel-ready by construction**: everything is
 * keyed by `taskId` and there is **no singleton "current task"** (Q4 / SPEC
 * "store parallel-ready"). v1 runs `concurrency: 1`, but two tasks advancing at
 * once would each get their own {@link TaskState} — the reducer never reaches
 * for an implicit "active" task.
 *
 * It is fed by {@link StoreEvent}s the orchestrator and step interpreters emit
 * (task registered/started, step started, inner-loop attempt `try k/max`, per-
 * check status, agent stream chunks, step/task finished). The store only
 * *records* those events — it drives no loop behavior (AD-1). Wiring the emit
 * side into the orchestrator and the render side into Ink lands in T-017; here
 * the contract is defined and proven via state transitions (AD-6: Ink is
 * validated through the store, not visual rendering).
 *
 * The reducer is exported pure ({@link reduce}) so transitions are unit-tested
 * in isolation; {@link createStore} layers immutable snapshots + subscription
 * on top. Snapshots are structurally shared and only the touched task/step is
 * rebuilt, so a no-op event returns the *same* reference and skips notifying.
 */
import type { StepType } from "../types";

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

/** Lifecycle of a backlog task in the run. */
export type TaskStatus =
  /** Registered from the backlog, not yet started. */
  | "pending"
  /** Waiting for one or more dependencies to reach `done`. */
  | "blocked"
  /** Its pipeline is in progress. */
  | "running"
  /** Whole pipeline succeeded and the task was marked `- [x]`. */
  | "done"
  /** A step failed persistently and the task escalated (never marked done). */
  | "escalated"
  /** Skipped because an ancestor task failed (skip transitivo). */
  | "skipped"
  /** Paused (resumable) — escalation with `pause` policy. */
  | "paused";

/** Lifecycle of one pipeline step within a task. */
export type StepStatus = "pending" | "running" | "ok" | "failed";

/** Status of one named check in the current attempt. */
export type CheckStatus = "running" | "passed" | "failed";

/** A single named check's live status. */
export interface CheckState {
  readonly name: string;
  readonly status: CheckStatus;
}

/** Live state of one pipeline step. */
export interface StepState {
  readonly id: string;
  readonly type: StepType;
  readonly status: StepStatus;
  /** Inner-loop attempt (`${attempt}`); set once an attempt starts. */
  readonly attempt?: number;
  /** Inner-loop ceiling (`verify.max_attempts`), for the `try k/max` display. */
  readonly maxAttempts?: number;
  /** Per-check status for the current attempt (reset each attempt). */
  readonly checks: readonly CheckState[];
  /** Failure reason when `status` is `failed`. */
  readonly reason?: string;
}

/** Live state of one backlog task — the unit the TUI renders a row per. */
export interface TaskState {
  readonly id: string;
  readonly title: string;
  readonly status: TaskStatus;
  /** Id of the step currently running, if any (never a global singleton). */
  readonly currentStepId?: string;
  readonly steps: readonly StepState[];
  /** Accumulated agent stream text for the current turn (reset each attempt). */
  readonly stream: string;
  /** Terminal reason (e.g. the escalation cause) when done/escalated/failed. */
  readonly reason?: string;
}

/** Direction of an ACP message: sent to the agent or received from it. */
export type AcpDirection = "send" | "recv";

/** One line in the global ACP traffic log (ring bounded). */
export interface AcpLogLine {
  readonly taskId: string;
  readonly direction: AcpDirection;
  readonly method?: string;
  readonly summary: string;
  /**
   * How many identical entries this line stands for. Absent (≡ 1) for a single
   * event; set to N when N consecutive identical events were collapsed into one
   * (`session/update` floods dozens of identical chunks per turn — the pane
   * shows `×N` instead of a wall of repeats). See {@link reduce}'s `acp_traffic`.
   */
  readonly count?: number;
}

/** Maximum entries kept in {@link StoreState.acpLog} (ring bounded). */
export const ACP_LOG_CAP = 200;

/** The whole observable run state: tasks in backlog order + DAG edges. */
export interface StoreState {
  readonly tasks: readonly TaskState[];
  /** Dependency edges: `[dep, dependente]` — "dependente depends on dep". */
  readonly edges: readonly [string, string][];
  /** Global ACP traffic log — ring bounded to {@link ACP_LOG_CAP} entries. */
  readonly acpLog: readonly AcpLogLine[];
}

// ---------------------------------------------------------------------------
// Events — what the orchestrator / steps emit into the store
// ---------------------------------------------------------------------------

/**
 * A state-changing event (discriminated by `type`). Step-scoped events carry the
 * `stepId` they target; the reducer ignores any event for an unregistered task,
 * and any step-scoped event for a step that has not been `step_started` yet, so
 * the store never fabricates a task/step from partial information.
 */
export type StoreEvent =
  | {
      readonly type: "edges_set";
      readonly edges: readonly [string, string][];
    }
  | {
      readonly type: "task_registered";
      readonly taskId: string;
      readonly title: string;
      /** Initial status; defaults to `"pending"` when omitted. */
      readonly status?: "pending" | "blocked";
    }
  | { readonly type: "task_started"; readonly taskId: string }
  | {
      readonly type: "step_started";
      readonly taskId: string;
      readonly stepId: string;
      readonly stepType: StepType;
    }
  | {
      readonly type: "attempt_started";
      readonly taskId: string;
      readonly stepId: string;
      readonly attempt: number;
      readonly maxAttempts: number;
    }
  | {
      readonly type: "check_started";
      readonly taskId: string;
      readonly stepId: string;
      readonly name: string;
    }
  | {
      readonly type: "check_finished";
      readonly taskId: string;
      readonly stepId: string;
      readonly name: string;
      readonly ok: boolean;
    }
  | {
      readonly type: "stream_chunk";
      readonly taskId: string;
      readonly text: string;
    }
  | {
      readonly type: "step_finished";
      readonly taskId: string;
      readonly stepId: string;
      readonly ok: boolean;
      readonly reason?: string;
    }
  | {
      readonly type: "task_finished";
      readonly taskId: string;
      readonly status: "done" | "escalated" | "skipped" | "paused";
      readonly reason?: string;
    }
  | {
      readonly type: "acp_traffic";
      readonly taskId: string;
      readonly direction: AcpDirection;
      readonly method?: string;
      readonly summary: string;
    };

// ---------------------------------------------------------------------------
// Immutable update helpers — rebuild only the touched task/step
// ---------------------------------------------------------------------------

/** The empty starting state (no tasks, no edges). */
export function initialState(): StoreState {
  return { tasks: [], edges: [], acpLog: [] };
}

/**
 * Apply `fn` to the task with `taskId`, returning a new state. When the task is
 * not registered, returns the **same** state reference (a no-op the store uses
 * to skip notifying). When `fn` returns the same task reference, likewise no-op.
 */
function updateTask(
  state: StoreState,
  taskId: string,
  fn: (task: TaskState) => TaskState,
): StoreState {
  const index = state.tasks.findIndex((t) => t.id === taskId);
  if (index === -1) return state;
  const current = state.tasks[index] as TaskState;
  const next = fn(current);
  if (next === current) return state;
  const tasks = [...state.tasks];
  tasks[index] = next;
  return { ...state, tasks };
}

/**
 * Apply `fn` to the step with `stepId` inside `task`. Returns the same task
 * reference when the step does not exist yet (step-scoped events are ignored
 * until `step_started`).
 */
function updateStep(
  task: TaskState,
  stepId: string,
  fn: (step: StepState) => StepState,
): TaskState {
  const index = task.steps.findIndex((s) => s.id === stepId);
  if (index === -1) return task;
  const steps = [...task.steps];
  steps[index] = fn(task.steps[index] as StepState);
  return { ...task, steps };
}

/**
 * Apply `fn` to the step with `stepId` of the task with `taskId` — the common
 * "update one step of one task" path. A no-op (same state reference) when either
 * the task or the step is unknown, inheriting {@link updateTask}/{@link updateStep}.
 */
function updateTaskStep(
  state: StoreState,
  taskId: string,
  stepId: string,
  fn: (step: StepState) => StepState,
): StoreState {
  return updateTask(state, taskId, (task) => updateStep(task, stepId, fn));
}

/** Upsert a check's status inside a step (create it if unseen). */
function upsertCheck(
  step: StepState,
  name: string,
  status: CheckStatus,
): StepState {
  const index = step.checks.findIndex((c) => c.name === name);
  if (index === -1) {
    return { ...step, checks: [...step.checks, { name, status }] };
  }
  const checks = [...step.checks];
  checks[index] = { name, status };
  return { ...step, checks };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/**
 * The pure state transition. Given the current state and one event, return the
 * next state — or the same reference when the event is a no-op (unknown task,
 * step-scoped event before `step_started`, or a duplicate registration).
 */
export function reduce(state: StoreState, event: StoreEvent): StoreState {
  switch (event.type) {
    case "edges_set":
      return { ...state, edges: [...event.edges] };

    case "task_registered": {
      if (state.tasks.some((t) => t.id === event.taskId)) return state;
      return {
        ...state,
        tasks: [
          ...state.tasks,
          {
            id: event.taskId,
            title: event.title,
            status: event.status ?? "pending",
            steps: [],
            stream: "",
          },
        ],
      };
    }

    case "task_started":
      return updateTask(state, event.taskId, (task) => ({
        ...task,
        status: "running",
      }));

    case "step_started":
      return updateTask(state, event.taskId, (task) => {
        const step: StepState = {
          id: event.stepId,
          type: event.stepType,
          status: "running",
          checks: [],
        };
        const exists = task.steps.some((s) => s.id === event.stepId);
        const steps = exists
          ? task.steps.map((s) => (s.id === event.stepId ? step : s))
          : [...task.steps, step];
        return { ...task, steps, currentStepId: event.stepId, stream: "" };
      });

    case "attempt_started":
      return updateTask(state, event.taskId, (task) =>
        updateStep({ ...task, stream: "" }, event.stepId, (step) => ({
          ...step,
          status: "running",
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          checks: [],
        })),
      );

    case "check_started":
      return updateTaskStep(state, event.taskId, event.stepId, (step) =>
        upsertCheck(step, event.name, "running"),
      );

    case "check_finished":
      return updateTaskStep(state, event.taskId, event.stepId, (step) =>
        upsertCheck(step, event.name, event.ok ? "passed" : "failed"),
      );

    case "stream_chunk":
      return updateTask(state, event.taskId, (task) => ({
        ...task,
        stream: task.stream + event.text,
      }));

    case "step_finished":
      return updateTask(state, event.taskId, (task) => {
        const withStep = updateStep(task, event.stepId, (step) => ({
          ...step,
          status: event.ok ? "ok" : "failed",
          reason: event.reason,
        }));
        // Clear the "running" pointer if it was this step.
        return withStep.currentStepId === event.stepId
          ? { ...withStep, currentStepId: undefined }
          : withStep;
      });

    case "task_finished":
      return updateTask(state, event.taskId, (task) => ({
        ...task,
        status: event.status,
        reason: event.reason,
        currentStepId: undefined,
      }));

    case "acp_traffic": {
      const line: AcpLogLine = {
        taskId: event.taskId,
        direction: event.direction,
        method: event.method,
        summary: event.summary,
      };
      // Collapse a run of identical events into a single line with a `count`, so
      // the flood of `session/update` chunks reads as `agent_message_chunk ×N`
      // rather than N indistinguishable rows.
      const last = state.acpLog[state.acpLog.length - 1];
      if (
        last &&
        last.taskId === line.taskId &&
        last.direction === line.direction &&
        last.method === line.method &&
        last.summary === line.summary
      ) {
        const merged: AcpLogLine = { ...last, count: (last.count ?? 1) + 1 };
        return {
          ...state,
          acpLog: [...state.acpLog.slice(0, -1), merged],
        };
      }
      const log = [...state.acpLog, line];
      return {
        ...state,
        acpLog: log.length > ACP_LOG_CAP ? log.slice(-ACP_LOG_CAP) : log,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Derived selectors — pure functions over the state (AD-6)
// ---------------------------------------------------------------------------

/**
 * Tasks whose dependencies (per `edges`) are **all** `done` and that are either
 * `pending` (no deps) or `blocked` (deps just cleared). A task with no inbound
 * edges in `state.edges` is ready as soon as it is `pending`.
 */
export function readyTasks(state: StoreState): readonly TaskState[] {
  return state.tasks.filter((t) => {
    if (t.status === "pending") return true;
    if (t.status !== "blocked") return false;
    // Blocked → ready only when every dep is done.
    return state.edges
      .filter(([, dependent]) => dependent === t.id)
      .every(
        ([dep]) => state.tasks.find((d) => d.id === dep)?.status === "done",
      );
  });
}

/** Tasks currently executing their pipeline. */
export function runningTasks(state: StoreState): readonly TaskState[] {
  return state.tasks.filter((t) => t.status === "running");
}

/** Tasks waiting for at least one dependency that is not yet `done`. */
export function blockedTasks(state: StoreState): readonly TaskState[] {
  return state.tasks.filter((t) => t.status === "blocked");
}

/** Tasks skipped because an ancestor failed. */
export function skippedTasks(state: StoreState): readonly TaskState[] {
  return state.tasks.filter((t) => t.status === "skipped");
}

// ---------------------------------------------------------------------------
// Observable store
// ---------------------------------------------------------------------------

/** An observable wrapper over {@link reduce}: snapshot + dispatch + subscribe. */
export interface Store {
  /** The current immutable snapshot. */
  getState(): StoreState;
  /** Apply an event; notifies subscribers only when the state actually changes. */
  dispatch(event: StoreEvent): void;
  /** Subscribe to state changes; returns an idempotent unsubscribe. */
  subscribe(listener: (state: StoreState) => void): () => void;
}

/** Build an observable {@link Store} (optionally seeded with an initial state). */
export function createStore(initial: StoreState = initialState()): Store {
  let state = initial;
  const listeners = new Set<(state: StoreState) => void>();

  return {
    getState: () => state,

    dispatch(event) {
      const next = reduce(state, event);
      if (next === state) return;
      state = next;
      // Copy so a listener that (un)subscribes mid-notify can't disturb the walk.
      for (const listener of [...listeners]) listener(state);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
