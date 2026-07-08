/**
 * Bridge between the NDJSON transport (sidecar stdout) and the app's state.
 *
 * {@link applyLine} parses one NDJSON line — reusing
 * {@link parseTransportLine} from the engine (T-004) — and routes it:
 *
 * - **event** frame → {@link reduce} from `loopy/tui/store` (domain state)
 * - **control** frame → UI-only state (`runStatus`, `pendingApprovals`)
 * - **command** frame or malformed input → no-op (same reference)
 *
 * The {@link BridgeState} separates concerns: `store` holds the canonical
 * {@link StoreState} (AD-6 — no domain duplication), `ui` holds transport-
 * level status that exists only for the Native UI surface.
 *
 * Never throws (AD-5 — inherits from {@link parseTransportLine}).
 */

import { parseTransportLine, type ControlFrame } from "loopy/tui/transport";
import { reduce, initialState, type StoreState } from "loopy/tui/store";

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

export interface UIState {
  readonly runStatus: "idle" | "running" | "finished";
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
}

export function initialBridgeState(): BridgeState {
  return {
    store: initialState(),
    ui: { runStatus: "idle", pendingApprovals: [], stderrTail: [] },
  };
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
      return nextStore === state.store ? state : { ...state, store: nextStore };
    }
    case "control":
      return { ...state, ui: applyControl(state.ui, result.control) };
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
 * - `runStatus === "idle"` → **start-fail** (exit before `run_started`).
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
    state.ui.runStatus === "idle" ? "start-fail" : "death-mid-run";

  return {
    ...state,
    ui: {
      ...state.ui,
      sidecarFailure: { type, exitCode },
    },
  };
}
