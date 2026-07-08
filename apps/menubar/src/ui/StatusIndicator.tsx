/**
 * StatusIndicator — the semantic-state grammar (DESIGN.md §5, signature).
 *
 * The single source of truth mapping a task status to a state tone + label.
 * Color is NEVER the only channel: a dot carries an `aria-label`, and pairs
 * with either a visible label or its fixed Kanban column — so it survives
 * color-blindness (The Meaning-Only Rule).
 *
 * `Tone` is the small standardized vocabulary; `accent` is reserved for the
 * approval beacon (it demands a *person*, not just reports a state).
 */
import type { TaskStatus } from "loopy/tui/store";
import "./StatusIndicator.css";

export type Tone =
  | "running"
  | "done"
  | "blocked"
  | "failed"
  | "neutral"
  | "accent";

interface StatusMeta {
  readonly label: string;
  readonly tone: Tone;
  /** Ready/skipped render as a hollow ring, not a filled dot. */
  readonly hollow?: boolean;
  /** Running work gets a gentle "alive" pulse. */
  readonly pulse?: boolean;
}

/** Task status → tone + label. Exhaustive over {@link TaskStatus}. */
export const TASK_STATUS_META: Readonly<Record<TaskStatus, StatusMeta>> = {
  pending: { label: "Pending", tone: "neutral", hollow: true },
  blocked: { label: "Blocked", tone: "blocked", hollow: true },
  running: { label: "Running", tone: "running", pulse: true },
  done: { label: "Done", tone: "done" },
  escalated: { label: "Escalated", tone: "failed" },
  skipped: { label: "Skipped", tone: "neutral", hollow: true },
  paused: { label: "Paused", tone: "blocked" },
};

// ---------------------------------------------------------------------------
// Dot — an 8px state indicator
// ---------------------------------------------------------------------------

interface StatusDotProps {
  readonly tone: Tone;
  readonly hollow?: boolean;
  readonly pulse?: boolean;
  /** Accessible name; supply when the dot has no adjacent visible label. */
  readonly label?: string;
}

export function StatusDot({ tone, hollow, pulse, label }: StatusDotProps) {
  return (
    <span
      className={`status-dot status-dot--${tone}${hollow ? " status-dot--hollow" : ""}${
        pulse ? " status-dot--pulse" : ""
      }`}
      role={label ? "img" : "presentation"}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

/** Dot bound to a task status — reads its tone/hollow/pulse from the map. */
export function TaskStatusDot({ status }: { status: TaskStatus }) {
  const meta = TASK_STATUS_META[status];
  return (
    <StatusDot
      tone={meta.tone}
      hollow={meta.hollow}
      pulse={meta.pulse}
      label={meta.label}
    />
  );
}

// ---------------------------------------------------------------------------
// Pill — tinted background + `-ink` label, always dot + text
// ---------------------------------------------------------------------------

interface PillProps {
  readonly tone: Tone;
  readonly children: React.ReactNode;
  /** Suppress the leading dot (e.g. when the label already carries a glyph). */
  readonly noDot?: boolean;
  readonly hollow?: boolean;
  readonly pulse?: boolean;
}

export function Pill({ tone, children, noDot, hollow, pulse }: PillProps) {
  return (
    <span className={`status-pill status-pill--${tone} t-label`}>
      {!noDot && <StatusDot tone={tone} hollow={hollow} pulse={pulse} />}
      <span>{children}</span>
    </span>
  );
}

/** Pill bound to a task status — dot + human label from the map. */
export function TaskStatusPill({ status }: { status: TaskStatus }) {
  const meta = TASK_STATUS_META[status];
  return (
    <Pill tone={meta.tone} hollow={meta.hollow} pulse={meta.pulse}>
      {meta.label}
    </Pill>
  );
}
