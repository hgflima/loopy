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

export interface UIState {
  readonly runStatus: "idle" | "running" | "finished";
  readonly runResult?: unknown;
  readonly pendingApprovals: readonly ApprovalRequest[];
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
    ui: { runStatus: "idle", pendingApprovals: [] },
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
