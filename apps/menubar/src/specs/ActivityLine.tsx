/**
 * ActivityLine — proof of life while a Phase runs (D14).
 *
 * The spike measured **328 s to the first question** (the agent spawns
 * sub-explorers before it asks), so a still screen reads as "frozen". This
 * component keeps a single live line moving — fed by `agent_activity`, which
 * comes from `session/update` live, never sliced from the final turn text — and
 * hangs a **collapsible transcript** off it that reuses the app's
 * {@link MarkdownStream}. The transcript is **born closed**: this is a flow, not
 * a chat.
 *
 * The pulsing dot is the accent in its "alive" meaning — one of the three the
 * accent is allowed to carry.
 */
import { MarkdownStream, StatusDot } from "../ui";
import "./specs.css";

interface ActivityLineProps {
  /** The live one-line activity readout (`state.activityLine`). */
  readonly line: string | null;
  /** The accumulated markdown transcript; omit to hide the disclosure. */
  readonly transcript?: string;
  /** True while the Phase is still running (pulse + streaming markdown). */
  readonly busy?: boolean;
}

export function ActivityLine({ line, transcript, busy }: ActivityLineProps) {
  return (
    <div className="spec-activity" role="status" aria-live="polite">
      <div className="spec-activity__line">
        {busy && <StatusDot tone="accent" pulse label="Trabalhando" />}
        <span className="spec-activity__text u-truncate">
          {line ?? "Trabalhando…"}
        </span>
      </div>

      {transcript && (
        <details className="spec-activity__transcript">
          <summary className="spec-activity__toggle">Ver transcript</summary>
          <div className="spec-activity__body">
            <MarkdownStream text={transcript} streaming={busy} />
          </div>
        </details>
      )}
    </div>
  );
}
