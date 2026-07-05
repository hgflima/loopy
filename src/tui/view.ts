/**
 * Presentation helpers shared by the Ink components (T-017) and the line-log
 * fallback ({@link ../tui/line-reporter}). These are **pure** functions over the
 * store's value types — no React, no Ink, no I/O — so the display logic is unit
 * tested directly (AD-6: the TUI is validated through the store/state, not by
 * rendering pixels). The `.tsx` components stay thin wrappers that place these
 * strings into `<Text>`/`<Box>`; typecheck (`tsc`) is what proves the components.
 *
 * Keeping the symbol/color tables here (rather than inline in each component)
 * means the live TUI and the no-TTY line fallback speak the same visual
 * vocabulary — a check that "passed" reads `✓` in both.
 */
import type { CheckState, CheckStatus, StepStatus, TaskStatus } from "./store";

// ---------------------------------------------------------------------------
// Symbol + color vocabulary — one entry per status union member
// ---------------------------------------------------------------------------

/** Status glyphs, keyed by the store's status unions (exhaustive by type). */
export const SYMBOLS: {
  readonly task: Readonly<Record<TaskStatus, string>>;
  readonly step: Readonly<Record<StepStatus, string>>;
  readonly check: Readonly<Record<CheckStatus, string>>;
} = {
  task: {
    pending: "•", blocked: "◦", running: "▶", done: "✔",
    escalated: "✖", skipped: "⊘", paused: "⏸",
  },
  step: { pending: "·", running: "→", ok: "✓", failed: "✗" },
  check: { running: "…", passed: "✓", failed: "✗" },
};

/** Ink `color` values, keyed by the same status unions. */
export const COLORS: {
  readonly task: Readonly<Record<TaskStatus, string>>;
  readonly step: Readonly<Record<StepStatus, string>>;
  readonly check: Readonly<Record<CheckStatus, string>>;
} = {
  task: {
    pending: "yellow", blocked: "yellow", running: "cyan", done: "green",
    escalated: "red", skipped: "gray", paused: "magenta",
  },
  step: { pending: "gray", running: "cyan", ok: "green", failed: "red" },
  check: { running: "yellow", passed: "green", failed: "red" },
};

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

/**
 * The `try k/max` label for a step's current inner-loop attempt (Success
 * Criterion #6). Empty before an attempt starts; drops the `/max` when the step
 * has no `verify` ceiling (`maxAttempts` unset), so a plain agent turn still
 * shows `try 1`.
 */
export function attemptLabel(step: {
  readonly attempt?: number;
  readonly maxAttempts?: number;
}): string {
  if (step.attempt === undefined) return "";
  return step.maxAttempts === undefined
    ? `try ${step.attempt}`
    : `try ${step.attempt}/${step.maxAttempts}`;
}

/** A single check rendered as `"<symbol> <name>"` (per-check status). */
export function checkText(check: CheckState): string {
  return `${SYMBOLS.check[check.status]} ${check.name}`;
}

/**
 * The last `maxLines` lines of accumulated agent stream text — what the live
 * {@link ../tui/components/StreamPane} shows for a running task. Trailing blank
 * lines (a stream that just emitted a newline) are dropped so they do not render
 * as phantom empty rows; interior blank lines are preserved.
 */
export function streamTail(text: string, maxLines = 8): string[] {
  if (text === "") return [];
  const lines = text.replace(/\n+$/, "").split("\n");
  return lines.slice(Math.max(0, lines.length - maxLines));
}

/**
 * Deterministic pulse phase for running-task animation. The `.tsx` component
 * maps `"on"` → `bold` and `"off"` → `dimColor` (or similar emphasis toggle).
 * Pure — no timer, no state; the caller drives the tick counter.
 */
export function pulseFrame(tick: number): "on" | "off" {
  return tick % 2 === 0 ? "on" : "off";
}
