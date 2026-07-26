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

/** Lifecycle of a backlog task in the run. Mirrors `SchedulerTaskStatus`. */
export type TaskStatus =
  /** All deps are `done` (or it has none): startable, not yet started. */
  | "ready"
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

/** A single warning entry accumulated in the store. */
export interface WarningEntry {
  readonly taskId?: string;
  readonly stepId?: string;
  readonly agentName?: string;
  readonly message: string;
}

/** Maximum entries kept in {@link StoreState.warnings}. */
export const WARNINGS_CAP = 50;

/** Live state of one pipeline step. */
export interface StepState {
  readonly id: string;
  readonly type: StepType;
  readonly status: StepStatus;
  /** Resolved agent label (only for agent steps). */
  readonly agentName?: string;
  /** Model override for this step (only for agent steps). */
  readonly model?: string;
  /** Inner-loop attempt (`${attempt}`); set once an attempt starts. */
  readonly attempt?: number;
  /** Inner-loop ceiling (`verify.max_attempts`), for the `try k/max` display. */
  readonly maxAttempts?: number;
  /** Per-check status for the current attempt (reset each attempt). */
  readonly checks: readonly CheckState[];
  /** Failure reason when `status` is `failed`. */
  readonly reason?: string;
  /** True when this step has received at least one `warning` event. */
  readonly warned?: boolean;
  /** Live context-window tokens used (last `usage_update` sample, T-007). */
  readonly used?: number;
  /** Live context-window size limit (last `usage_update` sample, T-007). */
  readonly size?: number;
}

/** Live state of one backlog task — the unit the TUI renders a row per. */
export interface TaskState {
  readonly id: string;
  readonly title: string;
  readonly status: TaskStatus;
  /** Task body without the `Deps:` line (C-0010 T-003). */
  readonly description?: string;
  /** Task dependency ids (C-0010 T-003). */
  readonly deps?: readonly string[];
  /** Id of the step currently running, if any (never a global singleton). */
  readonly currentStepId?: string;
  /**
   * Id of the last step this task *entered* — set on every `step_started` and
   * never cleared. Unlike {@link currentStepId} it survives `step_finished`,
   * so a consumer can still place a running task while it sits between two
   * steps (the Kanban grouper does exactly that).
   *
   * It is **not** derivable from `steps`: that array is ordered by first
   * visit and a revisit updates in place, so after a Desvio the last entered
   * step is no longer the last element.
   */
  readonly lastStepId?: string;
  readonly steps: readonly StepState[];
  /** Accumulated agent stream text for the current turn (reset each attempt). */
  readonly stream: string;
  /** Name of the agent producing the current stream (T-008: multi-agent prefix). */
  readonly streamAgent?: string;
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
  /** Agent name that produced this entry (T-008: multi-agent prefix). */
  readonly agent?: string;
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

// ---------------------------------------------------------------------------
// Rich agent stream vocabulary (C-0019)
// ---------------------------------------------------------------------------
//
// The semantic shape of one `session/update` *after* the ACP shape is stripped
// at the `onUpdate` boundary — the engine translates, the GUI renders. These
// types live here, in this browser-safe subpath export, so the engine, **both**
// GUI reducers (the Run's timeline and the Interview's `advance`) and the
// Interview `agent_stream` control frame all speak one vocabulary. The GUI never
// imports from `@agentclientprotocol/sdk`.

/** The 10 tool families the SDK declares (`ToolKind`). Default `"other"`. */
export type ToolKindName =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other";

/** Live status of a tool call (`ToolCallStatus`). Default `"pending"`. */
export type ToolCallStatusName =
  "pending" | "in_progress" | "completed" | "failed";

/** A file location a tool call touches. */
export interface ToolLocation {
  readonly path: string;
  readonly line?: number;
}

/**
 * One renderable piece of a tool call's content. The `raw` variant is the
 * catch-all so image/audio/resource blocks never silently vanish (D3).
 */
export type ToolContentItem =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "diff";
      readonly path: string;
      readonly oldText?: string;
      readonly newText: string;
    }
  | { readonly kind: "terminal"; readonly terminalId: string }
  | { readonly kind: "raw"; readonly payload: unknown };

/** Accumulated state of a tool call (`tool_call` + every `tool_call_update`). */
export interface ToolCallState {
  readonly toolCallId: string;
  readonly title: string;
  readonly kind: ToolKindName;
  readonly status: ToolCallStatusName;
  readonly locations: readonly ToolLocation[];
  readonly content: readonly ToolContentItem[];
  readonly rawInput?: unknown;
  readonly rawOutput?: unknown;
}

/**
 * A partial update to a {@link ToolCallState}: the same shape, everything
 * optional but `toolCallId`. A field that is `null` or `undefined` means
 * "unchanged", **never** "clear it" (see {@link mergeToolCall}). Nullable
 * because the wire — translated straight from the SDK's optional-nullable
 * `ToolCallUpdate` — can carry an explicit `null`.
 */
export interface ToolCallDelta {
  readonly toolCallId: string;
  readonly title?: string | null;
  readonly kind?: ToolKindName | null;
  readonly status?: ToolCallStatusName | null;
  readonly locations?: readonly ToolLocation[] | null;
  readonly content?: readonly ToolContentItem[] | null;
  readonly rawInput?: unknown;
  readonly rawOutput?: unknown;
}

/** One entry of the agent's plan for the current turn. */
export interface PlanEntryState {
  readonly content: string;
  readonly priority: "high" | "medium" | "low";
  readonly status: "pending" | "in_progress" | "completed";
}

/**
 * What one `session/update` became, already free of the ACP shape — one per
 * notification. The **wire carries this** (as a {@link StoreEvent} in the Run,
 * as the `agent_stream` control frame in the Interview); the GUI turns it into a
 * {@link StreamItem}. The `raw` variant is the catch-all (C2/D3): an update the
 * UI does not model still travels, tagged by its `updateKind`.
 */
export type StreamUpdate =
  | {
      readonly kind: "text";
      readonly text: string;
      readonly messageId?: string;
    }
  | {
      readonly kind: "thought";
      readonly text: string;
      readonly messageId?: string;
    }
  | { readonly kind: "tool_call"; readonly call: ToolCallState }
  | { readonly kind: "tool_delta"; readonly delta: ToolCallDelta }
  | { readonly kind: "plan"; readonly entries: readonly PlanEntryState[] }
  | { readonly kind: "mode"; readonly modeId: string }
  | {
      readonly kind: "raw";
      readonly updateKind: string;
      readonly payload: unknown;
    };

/**
 * A renderable item of a Step-of-Agent timeline, discriminated by `item`. The
 * GUI accumulates these (R4); the engine `StoreState` never does. `elided` is
 * the ring's cut marker (R6) — the list may shrink but never lies about what it
 * dropped.
 */
export type StreamItem =
  | {
      readonly item: "text";
      readonly text: string;
      readonly messageId?: string;
    }
  | {
      readonly item: "thought";
      readonly text: string;
      readonly messageId?: string;
    }
  | { readonly item: "tool"; readonly call: ToolCallState }
  | { readonly item: "plan"; readonly entries: readonly PlanEntryState[] }
  | { readonly item: "mode"; readonly modeId: string }
  | { readonly item: "raw"; readonly kind: string; readonly payload: unknown }
  | { readonly item: "elided"; readonly count: number };

/** The whole observable run state: tasks in backlog order + DAG edges. */
export interface StoreState {
  readonly tasks: readonly TaskState[];
  /** Dependency edges: `[dep, dependente]` — "dependente depends on dep". */
  readonly edges: readonly [string, string][];
  /** Global ACP traffic log — ring bounded to {@link ACP_LOG_CAP} entries. */
  readonly acpLog: readonly AcpLogLine[];
  /** Distinct agent names seen so far (T-008: prefix when size > 1). */
  readonly activeAgents: ReadonlySet<string>;
  /** Declared pipeline steps in order (T-003: populated by `pipeline_declared`). */
  readonly pipeline: readonly { id: string; type: StepType }[];
  /** Accumulated warnings — bounded to {@link WARNINGS_CAP}. */
  readonly warnings: readonly WarningEntry[];
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
      /** Initial status; defaults to `"ready"` when omitted. */
      readonly status?: "ready" | "blocked";
      /** Task body without the `Deps:` line (C-0010 T-003). */
      readonly description?: string;
      /** Task dependency ids (C-0010 T-003). */
      readonly deps?: readonly string[];
    }
  | { readonly type: "task_started"; readonly taskId: string }
  | {
      readonly type: "step_started";
      readonly taskId: string;
      readonly stepId: string;
      readonly stepType: StepType;
      /** Resolved agent label (only for agent steps). */
      readonly agentName?: string;
      /** Model override for this step (only for agent steps). */
      readonly model?: string;
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
      /** Agent producing this chunk (T-008: multi-agent prefix). */
      readonly agent?: string;
      /**
       * Step this text belongs to (C-0019 R3, additive). Absent for an older
       * agent — the GUI timeline falls back to `task.currentStepId`. The engine
       * reducer ignores it, so the Ink renderer stays byte-identical.
       */
      readonly stepId?: string;
      /**
       * Id shared by chunks of the same agent message (C-0019 R3, additive): a
       * change of `messageId` closes a text block in the GUI timeline. The
       * engine reducer ignores it.
       */
      readonly messageId?: string;
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
      /** Agent producing this entry (T-008: multi-agent prefix). */
      readonly agent?: string;
    }
  | {
      readonly type: "usage_sample";
      readonly taskId: string;
      readonly stepId: string;
      readonly used: number;
      readonly size: number;
    }
  | {
      readonly type: "pipeline_declared";
      readonly steps: readonly { id: string; type: StepType }[];
    }
  | {
      readonly type: "warning";
      readonly taskId?: string;
      readonly stepId?: string;
      readonly agentName?: string;
      readonly message: string;
    }
  // --- C-0019: rich session/update events (C2). All carry `taskId` and an
  // optional `agent`; the tool events also carry the Step (R7a). They exist as
  // typed events so the wire stays typed while the union growth trips `reduce`'s
  // exhaustiveness alarm. The reducer treats all six as an **explicit no-op**:
  // the timeline accumulates in the GUI (R4), never in `StoreState`.
  | {
      readonly type: "tool_call";
      readonly taskId: string;
      readonly stepId?: string;
      readonly agent?: string;
      readonly call: ToolCallState;
    }
  | {
      readonly type: "tool_call_update";
      readonly taskId: string;
      readonly stepId?: string;
      readonly agent?: string;
      readonly delta: ToolCallDelta;
    }
  | {
      readonly type: "thought_chunk";
      readonly taskId: string;
      readonly agent?: string;
      readonly text: string;
      readonly messageId?: string;
    }
  | {
      readonly type: "plan";
      readonly taskId: string;
      readonly agent?: string;
      readonly entries: readonly PlanEntryState[];
    }
  | {
      readonly type: "mode_changed";
      readonly taskId: string;
      readonly agent?: string;
      readonly modeId: string;
    }
  | {
      /** Catch-all (C2/D3): an update the UI does not model, tagged by kind. */
      readonly type: "agent_update";
      readonly taskId: string;
      readonly agent?: string;
      readonly updateKind: string;
      readonly payload: unknown;
    };

// ---------------------------------------------------------------------------
// Immutable update helpers — rebuild only the touched task/step
// ---------------------------------------------------------------------------

/** The empty starting state (no tasks, no edges). */
export function initialState(): StoreState {
  return { tasks: [], edges: [], acpLog: [], activeAgents: new Set<string>(), pipeline: [], warnings: [] };
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
 * Return an updated `activeAgents` set if `agent` is new, or the same
 * reference if already tracked (or absent). Shared by `stream_chunk` and
 * `acp_traffic` (T-008).
 */
function trackAgent(
  current: ReadonlySet<string>,
  agent: string | undefined,
): ReadonlySet<string> {
  if (!agent || current.has(agent)) return current;
  return new Set([...current, agent]);
}

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
            status: event.status ?? "ready",
            ...(event.description !== undefined && { description: event.description }),
            ...(event.deps !== undefined && { deps: event.deps }),
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
          ...(event.agentName !== undefined && { agentName: event.agentName }),
          ...(event.model !== undefined && { model: event.model }),
          checks: [],
        };
        const exists = task.steps.some((s) => s.id === event.stepId);
        const steps = exists
          ? task.steps.map((s) => (s.id === event.stepId ? step : s))
          : [...task.steps, step];
        return {
          ...task,
          steps,
          currentStepId: event.stepId,
          lastStepId: event.stepId,
          stream: "",
        };
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

    case "stream_chunk": {
      const next = updateTask(state, event.taskId, (task) => ({
        ...task,
        stream: task.stream + event.text,
        streamAgent: event.agent ?? task.streamAgent,
      }));
      const agents = trackAgent(state.activeAgents, event.agent);
      return agents === state.activeAgents ? next : { ...next, activeAgents: agents };
    }

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
        agent: event.agent,
      };
      const nextAgents = trackAgent(state.activeAgents, event.agent);

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
          activeAgents: nextAgents,
        };
      }
      const log = [...state.acpLog, line];
      return {
        ...state,
        acpLog: log.length > ACP_LOG_CAP ? log.slice(-ACP_LOG_CAP) : log,
        activeAgents: nextAgents,
      };
    }

    case "usage_sample":
      return updateTaskStep(state, event.taskId, event.stepId, (step) => ({
        ...step,
        used: event.used,
        size: event.size,
      }));

    case "pipeline_declared":
      return { ...state, pipeline: [...event.steps] };

    case "warning": {
      if (state.warnings.at(-1)?.message === event.message) return state;

      const entry: WarningEntry = {
        message: event.message,
        ...(event.taskId !== undefined && { taskId: event.taskId }),
        ...(event.stepId !== undefined && { stepId: event.stepId }),
        ...(event.agentName !== undefined && { agentName: event.agentName }),
      };
      const warnings = [...state.warnings, entry];

      const withWarnings = { ...state, warnings: warnings.length > WARNINGS_CAP ? warnings.slice(-WARNINGS_CAP) : warnings };
      if (event.taskId && event.stepId) {
        return updateTaskStep(
          withWarnings,
          event.taskId,
          event.stepId,
          (step) => ({ ...step, warned: true }),
        );
      }
      return withWarnings;
    }

    // C-0019 R4: the rich stream accumulates in the GUI timeline
    // (BridgeState/InterviewState), never in `StoreState` — which keeps
    // describing only the current turn. These six are an **explicit** no-op:
    // returning the *same* reference (structural sharing) lets the observable
    // store skip notifying and lets `line-reporter.ts`'s `next === state` guard
    // filter them, so the Ink renderer never grows a single case and stays
    // byte-identical (D1). They are explicit cases on purpose — the switch has
    // no `default`, so a future union member without a case here fails `tsc`.
    case "tool_call":
    case "tool_call_update":
    case "thought_chunk":
    case "plan":
    case "mode_changed":
    case "agent_update":
      return state;
  }
}

// ---------------------------------------------------------------------------
// Rich stream helpers — pure (AD-6), shared across the Run and the Interview
// ---------------------------------------------------------------------------

/**
 * Merge a {@link ToolCallDelta} onto the accumulated {@link ToolCallState} —
 * pure (R2). It lives here, not in the GUI, because **both** GUI reducers (the
 * Run's timeline and the Interview's `advance`) import it: one implementation,
 * one test, zero divergence. The engine itself stays memoryless — it only
 * translates deltas onto the wire.
 *
 * A field that is `null` or `undefined` in the delta means "unchanged", never
 * "clear it"; `content` and `locations` **replace** (they do not concatenate)
 * when present. When `current` is `undefined` a fresh card is built with
 * defaults (`kind: "other"`, `status: "pending"`, `title` = `delta.title ??
 * toolCallId`).
 */
export function mergeToolCall(
  current: ToolCallState | undefined,
  delta: ToolCallDelta,
): ToolCallState {
  // `??` collapses both null and undefined to "unchanged"; a falsy-but-present
  // rawInput/rawOutput (0, false, "") is kept because only null/undefined fall
  // through to the prior value.
  const rawInput = delta.rawInput ?? current?.rawInput;
  const rawOutput = delta.rawOutput ?? current?.rawOutput;
  return {
    toolCallId: delta.toolCallId,
    title: delta.title ?? current?.title ?? delta.toolCallId,
    kind: delta.kind ?? current?.kind ?? "other",
    status: delta.status ?? current?.status ?? "pending",
    locations: delta.locations ?? current?.locations ?? [],
    content: delta.content ?? current?.content ?? [],
    ...(rawInput !== undefined && { rawInput }),
    ...(rawOutput !== undefined && { rawOutput }),
  };
}

/**
 * The base scope every rich {@link StoreEvent} carries: the Task and, when
 * known, the producing Agent. The **Step is deliberately not here** — only the
 * three step-bearing variants (`stream_chunk`, `tool_call`, `tool_call_update`,
 * R7a) declare `stepId`, so {@link toStoreEvent} spreads it in per case. Optional
 * fields are omitted rather than set to `undefined`, so the wire stays clean.
 */
function buildStoreEventScope(ctx: {
  taskId: string;
  agent?: string;
}): { taskId: string; agent?: string } {
  const scope: { taskId: string; agent?: string } = { taskId: ctx.taskId };
  if (ctx.agent !== undefined) scope.agent = ctx.agent;
  return scope;
}

/**
 * Stamp a {@link StreamUpdate} with its Run scope into a {@link StoreEvent} —
 * pure, the mapping the Run's `onUpdate` applies. Text reuses the existing
 * `stream_chunk` (R3), so no token crosses the pipe twice; the other kinds map
 * to their typed events and `raw` to the `agent_update` catch-all (C2/D3).
 *
 * `stepId` rides **only** on the three variants whose contract declares it
 * (`stream_chunk`, `tool_call`, `tool_call_update`, R7a) — the other four never
 * carry it, even when the Run scope has a Step. Optional scope fields are
 * omitted rather than set to `undefined`, so the wire stays clean and an
 * older-agent chunk reduces exactly as before.
 */
export function toStoreEvent(
  update: StreamUpdate,
  ctx: { taskId: string; stepId?: string; agent?: string },
): StoreEvent {
  const scope = buildStoreEventScope(ctx);
  const stepScope = ctx.stepId !== undefined && { stepId: ctx.stepId };
  switch (update.kind) {
    case "text":
      return {
        type: "stream_chunk",
        ...scope,
        ...stepScope,
        text: update.text,
        ...(update.messageId !== undefined && { messageId: update.messageId }),
      };
    case "thought":
      return {
        type: "thought_chunk",
        ...scope,
        text: update.text,
        ...(update.messageId !== undefined && { messageId: update.messageId }),
      };
    case "tool_call":
      return {
        type: "tool_call",
        ...scope,
        ...stepScope,
        call: update.call,
      };
    case "tool_delta":
      return {
        type: "tool_call_update",
        ...scope,
        ...stepScope,
        delta: update.delta,
      };
    case "plan":
      return {
        type: "plan",
        ...scope,
        entries: update.entries,
      };
    case "mode":
      return {
        type: "mode_changed",
        ...scope,
        modeId: update.modeId,
      };
    case "raw":
      return {
        type: "agent_update",
        ...scope,
        updateKind: update.updateKind,
        payload: update.payload,
      };
  }
}

// ---------------------------------------------------------------------------
// Derived selectors — pure functions over the state (AD-6)
// ---------------------------------------------------------------------------

/**
 * Tasks whose dependencies (per `edges`) are **all** `done` and that are either
 * already `ready` (no deps) or `blocked` (deps just cleared). A task with no
 * inbound edges in `state.edges` is startable as soon as it is `ready`.
 */
export function readyTasks(state: StoreState): readonly TaskState[] {
  return state.tasks.filter((t) => {
    if (t.status === "ready") return true;
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
