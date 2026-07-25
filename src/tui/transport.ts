/**
 * NDJSON duplex transport for the Native UI (ADR-0007).
 *
 * Serializes {@link StoreEvent}s and **control frames** as one NDJSON line per
 * event on a `sink` (stdout in practice). Parses lines back into typed frames
 * via {@link parseTransportLine}. This module is **pure** (no React, no I/O
 * beyond the injected sink) and best-effort: the sink is never allowed to throw
 * back to the caller (AD-1 — transport is additive, never blocks the engine).
 *
 * Two classes of frame (discriminated by `frame`):
 * - **`"event"`** — wraps an existing {@link StoreEvent} (inline spread).
 * - **`"control"`** — envelope-only frames that exist solely for the transport.
 *   The **Run** direction has `run_started`, `run_finished`, `approval_requested`;
 *   the **Interview** direction (C-0018) adds `phase_started`, `change_resolved`,
 *   `question_asked`, `agent_activity`, `phase_finished`, `interview_failed`.
 *
 * A third class exists on the **command** (stdin) direction:
 * - **`"command"`** — the Run's `approval_decision`, plus the Interview's
 *   `question_answer`, `phase_wrap_up`, `interview_cancel`, sent by the app back
 *   to the motor.
 *
 * {@link parseTransportLine} handles all three directions and returns an
 * error-value on malformed input (AD-5 — never throws) — it is generic over the
 * frame payload, so new control/command variants need no parser change.
 */

import type { StoreEvent } from "./store";

// ---------------------------------------------------------------------------
// Interview wire vocabulary (C-0018) — declared here because it appears inside
// the frames below; this barrel is the subpath export the GUI consumes.
// ---------------------------------------------------------------------------

/** The three authoring phases of the Interview (`/devy:spec|refine|plan`). */
export type Phase = "spec" | "refine" | "plan";

/** One recommended-answer option carried by a `question_asked` control frame. */
export interface AskOption {
  readonly label: string;
  readonly detail?: string;
  readonly recommended?: boolean;
  readonly why?: string;
}

// ---------------------------------------------------------------------------
// Control frames (motor → app, transport-only envelope)
// ---------------------------------------------------------------------------

export type ControlFrame =
  // --- Run direction ---
  | { readonly control: "run_started" }
  | { readonly control: "run_finished"; readonly result: unknown }
  | {
      readonly control: "approval_requested";
      readonly requestId: string;
      readonly taskId: string;
      readonly stepId: string;
      readonly summary: string;
    }
  // --- Interview direction (C-0018) ---
  // `changeDir` is optional here **only** because a brand-new Change's `spec`
  // phase does not know it yet (D10); `change_resolved` delivers it later.
  | {
      readonly control: "phase_started";
      readonly phase: Phase;
      readonly command: string;
      readonly changeDir?: string;
    }
  | { readonly control: "change_resolved"; readonly changeDir: string }
  | {
      readonly control: "question_asked";
      readonly questionId: string;
      readonly phase: Phase;
      readonly prompt: string;
      readonly options?: readonly AskOption[];
      readonly otherLabel?: string;
      readonly finding?: string;
      readonly source?: string;
    }
  | {
      readonly control: "agent_activity";
      readonly phase: Phase;
      readonly text: string;
    }
  | {
      readonly control: "phase_finished";
      readonly phase: Phase;
      readonly changeDir: string;
      readonly files: readonly string[];
    }
  | { readonly control: "interview_failed"; readonly reason: string };

// ---------------------------------------------------------------------------
// Command frames (app → motor, stdin)
// ---------------------------------------------------------------------------

export type CommandFrame =
  // --- Run direction ---
  | {
      readonly command: "approval_decision";
      readonly requestId: string;
      readonly approved: boolean;
    }
  // --- Interview direction (C-0018) ---
  | {
      readonly command: "question_answer";
      readonly questionId: string;
      readonly text: string;
      readonly attachments?: readonly string[];
    }
  | { readonly command: "phase_wrap_up" }
  | { readonly command: "interview_cancel" };

// ---------------------------------------------------------------------------
// Parse result (AD-5 — errors as values)
// ---------------------------------------------------------------------------

export type ParseResult =
  | { readonly ok: true; readonly frame: "event"; readonly event: StoreEvent }
  | {
      readonly ok: true;
      readonly frame: "control";
      readonly control: ControlFrame;
    }
  | {
      readonly ok: true;
      readonly frame: "command";
      readonly command: CommandFrame;
    }
  | { readonly ok: false; readonly error: string };

// ---------------------------------------------------------------------------
// Transport (motor → sink)
// ---------------------------------------------------------------------------

export interface EventTransport {
  /** Serialize a StoreEvent as one NDJSON line. Best-effort — never throws. */
  emit(event: StoreEvent): void;
  /** Serialize a control frame as one NDJSON line. Best-effort — never throws. */
  emitControl(control: ControlFrame): void;
}

/**
 * Build an {@link EventTransport} that writes NDJSON lines to `sink`.
 *
 * The sink is called with exactly one `JSON.stringify(…) + "\n"` per event.
 * If the sink throws, the exception is swallowed (best-effort, AD-1) — the
 * engine must never be disturbed by a broken consumer.
 */
export function createEventTransport(
  sink: (line: string) => void,
): EventTransport {
  function writeLine(obj: object): void {
    try {
      sink(JSON.stringify(obj) + "\n");
    } catch {
      // best-effort — swallow (AD-1)
    }
  }

  return {
    emit(event: StoreEvent): void {
      writeLine({ frame: "event", ...event });
    },

    emitControl(control: ControlFrame): void {
      writeLine({ frame: "control", ...control });
    },
  };
}

// ---------------------------------------------------------------------------
// Parser (line → typed frame)
// ---------------------------------------------------------------------------

/**
 * Parse one NDJSON line into a typed {@link ParseResult}.
 *
 * Returns `{ ok: false, error }` for:
 * - empty / whitespace-only lines
 * - invalid JSON
 * - missing or unknown `frame` discriminant
 *
 * Never throws (AD-5).
 */
export function parseTransportLine(line: string): ParseResult {
  const trimmed = line.trim();
  if (trimmed === "") {
    return { ok: false, error: "empty line" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    return {
      ok: false,
      error: `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "not a JSON object" };
  }

  const obj = parsed as Record<string, unknown>;
  const frameType = obj["frame"];

  // Strip the wire-only `frame` discriminant; the payload is everything else.
  const payload = Object.fromEntries(
    Object.entries(obj).filter(([k]) => k !== "frame"),
  );

  switch (frameType) {
    case "event":
      return { ok: true, frame: "event", event: payload as unknown as StoreEvent };

    case "control":
      return {
        ok: true,
        frame: "control",
        control: payload as unknown as ControlFrame,
      };

    case "command":
      return {
        ok: true,
        frame: "command",
        command: payload as unknown as CommandFrame,
      };

    default:
      return {
        ok: false,
        error: `unknown frame type: ${JSON.stringify(frameType)}`,
      };
  }
}
