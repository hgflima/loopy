/**
 * Bridge between the NDJSON transport (sidecar stdout) and the app's state.
 *
 * {@link applyLine} parses one NDJSON line — reusing
 * {@link parseTransportLine} from the engine (T-004) — and routes it:
 *
 * - **event** frame → two **sibling** pure reducers, {@link reduce} (domain
 *   state) and {@link applyTimeline} (the per-task transcript); the frame is a
 *   no-op only when *both* held still.
 * - **control** frame → UI-only state (`runStatus`, `pendingApprovals`)
 * - **command** frame or malformed input → no-op (same reference)
 *
 * The {@link BridgeState} separates concerns: `store` holds the canonical
 * {@link StoreState} (AD-6 — no domain duplication), `transcript` is the
 * append-only timeline {@link applyTimeline} folds into, and `ui` holds
 * transport-level status that exists only for the Native UI surface. All three
 * are sub-states with their own reducer — none nested inside another's guard.
 *
 * Never throws (AD-5 — inherits from {@link parseTransportLine}).
 */

import { parseTransportLine, type ControlFrame } from "loopy/tui/transport";
import {
  reduce,
  initialState,
  type StoreState,
  type StoreEvent,
  type StreamUpdate,
} from "loopy/tui/store";
import { appendStreamItem } from "./stream-history";
import type { Transcript, TranscriptEntry, StreamItem } from "./stream-history";

// ---------------------------------------------------------------------------
// UI state (control frames only — never touches StoreState)
// ---------------------------------------------------------------------------

export interface ApprovalRequest {
  readonly requestId: string;
  readonly taskId: string;
  readonly stepId: string;
  readonly summary: string;
}

/**
 * Sidecar failure info — populated when the sidecar exits without a clean
 * `run_finished` control frame.
 *
 * - **start-fail**: exit arrived before `run_started` (process never got going).
 * - **death-mid-run**: exit arrived after `run_started` but before `run_finished`.
 */
export interface SidecarFailure {
  readonly type: "start-fail" | "death-mid-run";
  readonly exitCode: number;
}

/** Maximum stderr lines kept in {@link UIState.stderrTail}. */
export const STDERR_TAIL_CAP = 50;

/**
 * Run lifecycle as the UI sees it. `starting` spans the click on Iniciar up to
 * the `run_started` frame — seconds, while the motor spawns its agents — and
 * already counts as an active Run (C-0021 / B2).
 */
export type RunStatus = "idle" | "starting" | "running" | "finished";

export interface UIState {
  readonly runStatus: RunStatus;
  readonly runResult?: unknown;
  readonly pendingApprovals: readonly ApprovalRequest[];
  /** Rolling tail of sidecar stderr lines (capped at {@link STDERR_TAIL_CAP}). */
  readonly stderrTail: readonly string[];
  /** Present only when the sidecar exited without a clean `run_finished`. */
  readonly sidecarFailure?: SidecarFailure;
}

// ---------------------------------------------------------------------------
// Bridge state = StoreState + UIState
// ---------------------------------------------------------------------------

export interface BridgeState {
  readonly store: StoreState;
  readonly ui: UIState;
  /** Append-only transcript per task — survives `task_finished` (≠ `task.stream`). */
  readonly transcript: Transcript;
}

export function initialBridgeState(): BridgeState {
  return {
    store: initialState(),
    ui: { runStatus: "idle", pendingApprovals: [], stderrTail: [] },
    transcript: {},
  };
}

/** A fresh state for a Run being launched: `run_started` has not arrived yet. */
export function startingBridgeState(): BridgeState {
  const s = initialBridgeState();
  return { ...s, ui: { ...s.ui, runStatus: "starting" } };
}

// ---------------------------------------------------------------------------
// Control frame reducer (UI-only — never touches store)
// ---------------------------------------------------------------------------

function applyControl(ui: UIState, control: ControlFrame): UIState {
  switch (control.control) {
    case "run_started":
      return { ...ui, runStatus: "running" };
    case "run_finished":
      return { ...ui, runStatus: "finished", runResult: control.result };
    case "approval_requested":
      return {
        ...ui,
        pendingApprovals: [
          ...ui.pendingApprovals,
          {
            requestId: control.requestId,
            taskId: control.taskId,
            stepId: control.stepId,
            summary: control.summary,
          },
        ],
      };
    default:
      // Interview controls (C-0018 — `phase_started`, `question_asked`, …) run
      // in a separate process and do not belong to the Run's BridgeState. Ignore
      // them by returning the same reference (structural sharing, AD-5).
      return ui;
  }
}

// ---------------------------------------------------------------------------
// Approval decision (optimistic removal from FIFO queue)
// ---------------------------------------------------------------------------

/**
 * Remove a settled approval from the pending queue (optimistic — the command
 * was already sent to the motor's stdin). Returns the **same reference** when
 * the `requestId` is not found (idempotent, AD-5).
 */
export function dismissApproval(
  state: BridgeState,
  requestId: string,
): BridgeState {
  const next = state.ui.pendingApprovals.filter(
    (a) => a.requestId !== requestId,
  );
  if (next.length === state.ui.pendingApprovals.length) return state;
  return { ...state, ui: { ...state.ui, pendingApprovals: next } };
}

// ---------------------------------------------------------------------------
// applyLine — single entry point
// ---------------------------------------------------------------------------

/**
 * Parse one NDJSON line and route it to the appropriate sub-reducer.
 *
 * Returns the **same reference** when the line is malformed, a command frame,
 * or a no-op event (e.g. for an unregistered task), preserving structural
 * sharing for React's reconciliation.
 */
export function applyLine(state: BridgeState, line: string): BridgeState {
  const result = parseTransportLine(line);
  if (!result.ok) return state;

  switch (result.frame) {
    case "event": {
      const nextStore = reduce(state.store, result.event);
      const nextTranscript = applyTimeline(
        state.transcript,
        result.event,
        nextStore,
      );
      // The guard demands **both** sub-reducers held still. This is the whole
      // point of T-006: the six rich C-0019 events are an explicit no-op in
      // `reduce` (R4) yet MAY grow the transcript, so checking `nextStore`
      // alone would silently drop the entire timeline (compiles, runs, blank
      // screen). Fail-closed validation now lives in `applyTimeline`, not
      // inherited by accident from `reduce`'s unregistered-task no-op.
      if (nextStore === state.store && nextTranscript === state.transcript) {
        return state;
      }
      return { ...state, store: nextStore, transcript: nextTranscript };
    }
    case "control": {
      const nextUi = applyControl(state.ui, result.control);
      // An ignored control (e.g. an Interview frame) leaves `ui` untouched —
      // return the same BridgeState reference for React's reconciliation.
      if (nextUi === state.ui) return state;
      return { ...state, ui: nextUi };
    }
    case "command":
      return state;
  }
}

// ---------------------------------------------------------------------------
// Sidecar-level events (Tauri events, not NDJSON lines)
// ---------------------------------------------------------------------------

/**
 * Accumulate one stderr line into the rolling tail buffer.
 * Capped at {@link STDERR_TAIL_CAP} — oldest lines are dropped.
 */
export function applySidecarStderr(
  state: BridgeState,
  line: string,
): BridgeState {
  const next = [...state.ui.stderrTail.slice(-(STDERR_TAIL_CAP - 1)), line];
  return { ...state, ui: { ...state.ui, stderrTail: next } };
}

/**
 * Handle `sidecar://exit` — determine failure type or ignore clean exits.
 *
 * - `runStatus === "finished"` → clean exit, no failure (same reference).
 * - `runStatus === "idle" | "starting"` → **start-fail** (exit before
 *   `run_started`); `starting` falls back to `idle`, so the editor returns.
 * - `runStatus === "running"` → **death-mid-run** (exit after `run_started`).
 *
 * Never throws (AD-5).
 */
export function applySidecarExit(
  state: BridgeState,
  exitCode: number,
): BridgeState {
  if (state.ui.runStatus === "finished") return state;

  const type: SidecarFailure["type"] =
    state.ui.runStatus === "running" ? "death-mid-run" : "start-fail";

  return {
    ...state,
    ui: {
      ...state.ui,
      // A Run that never started is not active: back to the idle editor.
      ...(state.ui.runStatus === "starting" ? { runStatus: "idle" as const } : {}),
      sidecarFailure: { type, exitCode },
    },
  };
}

// ---------------------------------------------------------------------------
// applyTimeline — the transcript's own reducer (sibling to `reduce`)
// ---------------------------------------------------------------------------

/**
 * Route one {@link StoreEvent} to the {@link StreamUpdate} it carries, or `null`
 * when it is not a timeline event. Only the three step-bearing variants
 * (`stream_chunk`, `tool_call`, `tool_call_update`, R7a) declare a `stepId`; the
 * others resolve their Step from the task's `currentStepId` in
 * {@link applyTimeline}. `text` reuses the existing `stream_chunk` (R3), which is
 * why an older agent's plain chunk keeps flowing exactly as before.
 */
function routeTimeline(event: StoreEvent): {
  readonly taskId: string;
  readonly stepId?: string;
  readonly update: StreamUpdate;
} | null {
  switch (event.type) {
    case "stream_chunk":
      return {
        taskId: event.taskId,
        ...(event.stepId !== undefined && { stepId: event.stepId }),
        update: {
          kind: "text",
          text: event.text,
          ...(event.messageId !== undefined && { messageId: event.messageId }),
        },
      };
    case "thought_chunk":
      return {
        taskId: event.taskId,
        update: {
          kind: "thought",
          text: event.text,
          ...(event.messageId !== undefined && { messageId: event.messageId }),
        },
      };
    case "tool_call":
      return {
        taskId: event.taskId,
        ...(event.stepId !== undefined && { stepId: event.stepId }),
        update: { kind: "tool_call", call: event.call },
      };
    case "tool_call_update":
      return {
        taskId: event.taskId,
        ...(event.stepId !== undefined && { stepId: event.stepId }),
        update: { kind: "tool_delta", delta: event.delta },
      };
    case "plan":
      return {
        taskId: event.taskId,
        update: { kind: "plan", entries: event.entries },
      };
    case "mode_changed":
      return {
        taskId: event.taskId,
        update: { kind: "mode", modeId: event.modeId },
      };
    case "agent_update":
      return {
        taskId: event.taskId,
        update: {
          kind: "raw",
          updateKind: event.updateKind,
          payload: event.payload,
        },
      };
    default:
      return null;
  }
}

/**
 * The transcript's pure reducer — a **sibling** to the store's {@link reduce},
 * not a step nested inside its guard. Fold one {@link StoreEvent} onto the
 * per-task {@link Transcript}, returning the next transcript (or the **same**
 * reference on a no-op, so structural sharing holds).
 *
 * It owns, **explicitly**, the validation the old event guard used to inherit
 * from `reduce` by accident: with the six rich C-0019 events now a no-op in
 * `reduce` (R4), "the store ignored it" and "there is nothing to append" stopped
 * being the same thing. So this is fail-closed:
 *
 * - a non-timeline event → the same transcript;
 * - a timeline event whose task is absent from `store.tasks` → the same
 *   transcript (never fabricate a ghost task's entry — the whole failure mode
 *   a naive reorder would reintroduce);
 * - a timeline event whose Step is unresolvable — neither the event's `stepId`
 *   nor the task's `currentStepId` names a Step in `store` — → the same
 *   transcript (a step with no `step_started` is a ghost segment, same as a
 *   ghost task);
 * - an update `appendStreamItem` treats as a no-op (e.g. an orphan `tool_delta`)
 *   → the same transcript.
 *
 * Otherwise the update becomes {@link StreamItem}(s) through the shared
 * {@link appendStreamItem} (T-005 — the single place the ring/merge rules live),
 * each **new** entry tagged by the event's `stepId` (falling back to the task's
 * `currentStepId` for an older agent) and stamped with the Step's live telemetry
 * from `store`. Entries whose item was untouched keep their own reference (so a
 * `tool_delta` merging into a card mid-list, or a `messageId` concat, rebuilds
 * only what changed).
 */
export function applyTimeline(
  transcript: Transcript,
  event: StoreEvent,
  store: StoreState,
): Transcript {
  const route = routeTimeline(event);
  if (!route) return transcript;

  const task = store.tasks.find((t) => t.id === route.taskId);
  if (!task) return transcript; // fail-closed: unregistered task

  const stepId = route.stepId ?? task.currentStepId;
  if (!stepId) return transcript;

  const step = task.steps.find((s) => s.id === stepId);
  if (!step) return transcript; // fail-closed: a step with no `step_started`

  const entries = transcript[route.taskId] ?? [];
  const items = entries.map((e) => e.item);
  const nextItems = appendStreamItem(items, route.update);
  // `appendStreamItem` returns the same array reference on a genuine no-op
  // (orphan delta, or a within-cap change that changed nothing).
  if (nextItems === items) return transcript;

  const kept = new Map<StreamItem, TranscriptEntry>(
    entries.map((e) => [e.item, e]),
  );
  const nextEntries = nextItems.map((item, i): TranscriptEntry => {
    const existing = kept.get(item);
    if (existing) return existing;
    // The `elided` ring marker (T-005 rule d) is synthetic and always sits at
    // the head. Tag it with the FIRST SURVIVOR's step/telemetry — not the
    // current event's — so `segmentsFor` folds it into that leading segment
    // instead of splitting the timeline `current step → old steps → current`.
    if (item.item === "elided") {
      const followerItem = nextItems[i + 1];
      const follower = followerItem ? kept.get(followerItem) : undefined;
      if (follower) return { ...follower, item };
    }
    return {
      stepId,
      item,
      agent: step.agentName,
      model: step.model,
      usedTokens: step.used,
      size: step.size,
    };
  });

  return { ...transcript, [route.taskId]: nextEntries };
}
