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
 * - **`"control"`** — envelope-only frames that exist solely for the transport
 *   (`run_started`, `run_finished`, `approval_requested`).
 *
 * A third class exists on the **command** (stdin) direction:
 * - **`"command"`** — `approval_decision` sent by the app back to the motor.
 *
 * {@link parseTransportLine} handles all three directions and returns an
 * error-value on malformed input (AD-5 — never throws).
 */

import type { StoreEvent } from "./store";

// ---------------------------------------------------------------------------
// Control frames (motor → app, transport-only envelope)
// ---------------------------------------------------------------------------

export type ControlFrame =
  | { readonly control: "run_started" }
  | { readonly control: "run_finished"; readonly result: unknown }
  | {
      readonly control: "approval_requested";
      readonly requestId: string;
      readonly taskId: string;
      readonly stepId: string;
      readonly summary: string;
    };

// ---------------------------------------------------------------------------
// Command frames (app → motor, stdin)
// ---------------------------------------------------------------------------

export type CommandFrame = {
  readonly command: "approval_decision";
  readonly requestId: string;
  readonly approved: boolean;
};

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
