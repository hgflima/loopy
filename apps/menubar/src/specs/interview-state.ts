/**
 * Pure reducer for the Specs Interview flow (C-0018, ADR-0012).
 *
 * {@link advance} is a **pure** step of the interview — no I/O, no React, no
 * `Date.now()` (AD-6, the same shape as `applyLine`, `groupByStep`,
 * `configToStore`). It folds one {@link InterviewEvent} onto the current
 * {@link InterviewState}, never throwing (AD-5) and preserving structural
 * sharing: an event that changes nothing returns the **same reference**.
 *
 * Events arrive from two sources, unified here:
 * - **local** (human-driven) — `triaged`, `described`, `answered`,
 *   `gate_decision`, `wrap_up`, `cancel`;
 * - **process-driven** — control frames from `loopy interview` (T-001),
 *   adapted by `useInterviewProcess` (T-010): `phase_started`, `change_resolved`,
 *   `question_asked`, `activity`, `phase_finished`, `failed`, plus `warning`.
 *
 * The flow the reducer models (spec.md, "Fluxo, ponta a ponta"):
 *
 *   triage → describe → ┬ feature: phase spec → gate → phase refine → gate
 *                       │                       → phase plan → saved
 *                       └ bug|debt: handoff  (LOCAL — never spawns a process)
 *
 * The triage, the description, the gate and the hand-off are **local**: no
 * process is spawned until a Phase begins, and the bug/debt trails never spawn
 * one at all.
 */

import type { Phase, AskOption } from "loopy/tui/transport";

// ---------------------------------------------------------------------------
// Domain vocabulary
// ---------------------------------------------------------------------------

/** Which trail the Interview walks after triage. */
export type Track = "feature" | "bug" | "debt";

/** The next-step a gate offers (D12): refine again, go to plan, or close partial. */
export type GateChoice = "refine" | "plan" | "close";

/**
 * The screen the Interview is currently on. `phase` carries a sub-status in
 * {@link InterviewState.activity} (`running` | `asking`); the four terminal
 * stages absorb any further process frame (a late frame after cancel must not
 * corrupt the flow).
 */
export type Stage =
  | "triage" // pick feature/bug/debt/other — LOCAL
  | "describe" // free-text demand + attachments — LOCAL
  | "phase" // a devy Phase is running (a process was spawned)
  | "gate" // human gate between Phases (D12)
  | "handoff" // bug/debt terminal — LOCAL, never spawns a process
  | "saved" // feature finished (the plan Phase completed)
  | "closed" // human closed at a gate (the Change stays partial on disk)
  | "cancelled" // human cancelled (nothing is erased)
  | "failed"; // the process reported `interview_failed`

/** A pending question awaiting the human's answer (`<loopy-ask>`, or the D3 open fallback). */
export interface PendingQuestion {
  readonly questionId: string;
  readonly phase: Phase;
  readonly prompt: string;
  readonly options?: readonly AskOption[];
  readonly otherLabel?: string;
  readonly finding?: string;
  readonly source?: string;
}

/** One recorded answer — survives cancel (the Change reappears as partial). */
export interface Answer {
  readonly questionId: string;
  readonly text: string;
  readonly attachments?: readonly string[];
}

export interface InterviewState {
  readonly stage: Stage;
  readonly track: Track | null;
  /** The free-text demand from the `describe` stage (the `/devy:*` argument). */
  readonly demand: string | null;
  /** The current (or last finished) Phase. */
  readonly phase: Phase | null;
  /** The devy command driving the current Phase, reported by `phase_started`. */
  readonly command: string | null;
  /** Sub-status while `stage === "phase"`. */
  readonly activity: "running" | "asking" | null;
  /** The last narration the Agent emitted (`agent_activity`) — D14. */
  readonly activityLine: string | null;
  /**
   * Every narration of the **running Phase**, accumulated in arrival order and
   * separated by a blank line (markdown paragraph break).
   *
   * `activityLine` alone was lossy: each `agent_activity` replaced the previous
   * one, so answering a question erased everything the Agent had narrated. The
   * engine sends the turn's FULL prose (`decideTurn` → `parsed.prose`), which is
   * markdown and often several paragraphs — this is what the view renders.
   * Reset per Phase (`enterPhase`/`phase_finished`): each Phase is its own
   * process and its own conversation.
   */
  readonly transcript: string;
  readonly pending: PendingQuestion | null;
  readonly answers: readonly Answer[];
  readonly changeDir: string | null;
  /** Files written by the last finished Phase (from `phase_finished`). */
  readonly files: readonly string[];
  /** "Chega, grave o que temos" pressed (D17); the Phase ends on `<loopy-done/>`. */
  readonly wrappingUp: boolean;
  readonly warnings: readonly string[];
  /** The `interview_failed` reason, set only in the `failed` stage. */
  readonly failure: string | null;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type InterviewEvent =
  // --- local (human-driven) ---
  | { readonly kind: "triaged"; readonly track: Track }
  | {
      readonly kind: "described";
      readonly text: string;
      readonly attachments?: readonly string[];
    }
  | {
      readonly kind: "answered";
      readonly questionId: string;
      readonly text: string;
      readonly attachments?: readonly string[];
    }
  | { readonly kind: "gate_decision"; readonly next: GateChoice }
  | { readonly kind: "wrap_up" }
  | { readonly kind: "cancel" }
  // --- process-driven (control frames, adapted by useInterviewProcess) ---
  | {
      readonly kind: "phase_started";
      readonly phase: Phase;
      readonly command: string;
      readonly changeDir?: string;
    }
  | { readonly kind: "change_resolved"; readonly changeDir: string }
  | { readonly kind: "question_asked"; readonly question: PendingQuestion }
  | { readonly kind: "activity"; readonly text: string }
  | {
      readonly kind: "phase_finished";
      readonly phase: Phase;
      readonly changeDir: string;
      readonly files: readonly string[];
    }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "warning"; readonly text: string };

// ---------------------------------------------------------------------------
// Constructors and helpers
// ---------------------------------------------------------------------------

export function initialInterviewState(): InterviewState {
  return {
    stage: "triage",
    track: null,
    demand: null,
    phase: null,
    command: null,
    activity: null,
    activityLine: null,
    transcript: "",
    pending: null,
    answers: [],
    changeDir: null,
    files: [],
    wrappingUp: false,
    warnings: [],
    failure: null,
  };
}

const TERMINAL: ReadonlySet<Stage> = new Set([
  "saved",
  "closed",
  "cancelled",
  "failed",
]);

/** A terminal stage absorbs any further process frame (structural sharing). */
function isTerminal(stage: Stage): boolean {
  return TERMINAL.has(stage);
}

/**
 * Maps a triage option label onto a {@link Track}. Anything unrecognized —
 * including the "Outro tipo de demanda…" escape hatch — falls to `feature`
 * (D24): the feature trail is the only one that produces files, so routing the
 * unknown to the sterile hand-off is the worst default.
 */
export function trackOf(label: string): Track {
  if (label.startsWith("Bug")) return "bug";
  if (label.startsWith("Débito")) return "debt";
  return "feature"; // "Nova feature", "Outro…", or anything else
}

/** One next-step choice a gate offers. */
export interface GateOption {
  readonly next: GateChoice;
}

/**
 * The next-step choices the gate offers (D12): `Refinar` / `Ir ao plano` /
 * `Fechar`. Returns `[]` outside the gate stage. The pt-BR labels live in the
 * component (`PhaseGate.tsx`); the reducer deals only in the English keys.
 */
export function gateOptions(state: InterviewState): readonly GateOption[] {
  if (state.stage !== "gate") return [];
  return [{ next: "refine" }, { next: "plan" }, { next: "close" }];
}

/**
 * A **fresh** Phase entry: running, no pending question, nothing carried over
 * from a prior Phase. Distinct from `phase_started`, which only *confirms* an
 * in-flight Phase and so preserves `command`/`pending`/`activityLine`. Callers
 * layer their own extras on top (`demand` from `described`, the `files` reset
 * from a gate decision).
 */
function enterPhase(state: InterviewState, phase: Phase): InterviewState {
  return {
    ...state,
    stage: "phase",
    phase,
    command: null,
    activity: "running",
    activityLine: null,
    transcript: "",
    pending: null,
    wrappingUp: false,
  };
}

// ---------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------

/** One step of the interview. Pure: no I/O, no React, no `Date.now()`. */
export function advance(
  state: InterviewState,
  event: InterviewEvent,
): InterviewState {
  switch (event.kind) {
    case "triaged":
      if (state.stage !== "triage") return state;
      return { ...state, stage: "describe", track: event.track };

    case "described": {
      if (state.stage !== "describe") return state;
      // bug/debt never spawn a process — straight to the local hand-off.
      if (state.track === "bug" || state.track === "debt") {
        return { ...state, stage: "handoff", demand: event.text };
      }
      // feature (incl. "Outro" via D24) begins the spec Phase; the process is
      // spawned by the bridge, which confirms with `phase_started`.
      return { ...enterPhase(state, "spec"), demand: event.text };
    }

    case "answered":
      // Structural sharing: an answer to a question that is not the pending one
      // is a no-op that returns the SAME reference — a late frame after cancel
      // (or a double click) must not corrupt the flow. This also covers an
      // answer arriving when nothing is pending (`pending?.questionId` is
      // undefined).
      if (state.pending?.questionId !== event.questionId) return state;
      return {
        ...state,
        pending: null,
        activity: "running",
        answers: [
          ...state.answers,
          {
            questionId: event.questionId,
            text: event.text,
            attachments: event.attachments,
          },
        ],
      };

    case "gate_decision":
      if (state.stage !== "gate") return state;
      if (event.next === "close") return { ...state, stage: "closed" };
      // Refinar / Ir ao plano — a new process (and Session) per Phase (D13); a
      // fresh Phase drops the previous Phase's files.
      return { ...enterPhase(state, event.next), files: [] };

    case "wrap_up":
      // "Chega, grave o que temos" (D17): mark the Phase as wrapping up, but the
      // Phase only ends on the agent's `<loopy-done/>` (→ `phase_finished`). The
      // pending question is dismissed — the human gave up on it.
      if (state.stage !== "phase") return state;
      return { ...state, wrappingUp: true, pending: null, activity: "running" };

    case "cancel":
      // Cancel erases NOTHING (D25): answers, changeDir and files stay — the
      // Change reappears in the list as partial. Only the flow stops.
      if (isTerminal(state.stage)) return state;
      return { ...state, stage: "cancelled", pending: null, activity: null };

    case "phase_started":
      if (isTerminal(state.stage)) return state;
      return {
        ...state,
        stage: "phase",
        phase: event.phase,
        command: event.command,
        // A fresh start has no pending question → running; keep `asking` if a
        // question is somehow already up.
        activity: state.pending ? "asking" : "running",
        changeDir: event.changeDir ?? state.changeDir,
      };

    case "change_resolved":
      if (isTerminal(state.stage)) return state;
      if (state.changeDir === event.changeDir) return state;
      return { ...state, changeDir: event.changeDir };

    case "question_asked":
      if (isTerminal(state.stage)) return state;
      return {
        ...state,
        stage: "phase",
        activity: "asking",
        pending: event.question,
      };

    case "activity":
      if (isTerminal(state.stage)) return state;
      // A repeated narration is a duplicate frame, not new work — same
      // reference, and nothing appended (the transcript must not double up).
      if (state.activityLine === event.text) return state;
      return {
        ...state,
        activityLine: event.text,
        transcript:
          state.transcript === ""
            ? event.text
            : `${state.transcript}\n\n${event.text}`,
      };

    case "phase_finished": {
      if (isTerminal(state.stage)) return state;
      const base: InterviewState = {
        ...state,
        pending: null,
        activity: null,
        activityLine: null,
        transcript: "",
        wrappingUp: false,
        changeDir: event.changeDir,
        files: event.files,
      };
      // The plan Phase is the last one — its completion is the "saved" screen.
      // spec/refine hand control to the human gate (D12).
      return event.phase === "plan"
        ? { ...base, stage: "saved" }
        : { ...base, stage: "gate", phase: event.phase };
    }

    case "failed":
      if (isTerminal(state.stage)) return state;
      return {
        ...state,
        stage: "failed",
        failure: event.reason,
        pending: null,
        activity: null,
      };

    case "warning":
      // Warnings accumulate without interrupting the flow (D25).
      return { ...state, warnings: [...state.warnings, event.text] };
  }
}
