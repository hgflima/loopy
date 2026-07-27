/**
 * RawUpdateRow — the catch-all fallback of C2/D3.
 *
 * Anything the timeline does not model semantically lands here: a line with the
 * update's `kind` visible, and its JSON payload behind a CLOSED `<details>`.
 * This is where the six R7d update types fall — `plan_update`, `plan_removed`,
 * `available_commands_update`, `config_option_update`, `session_info_update` and
 * `user_message_chunk`. On the Interview that last one is our Envelope coming
 * back: nothing vanishes (D3), but it is born folded — visible to whoever opens
 * it, invisible to whoever only glances.
 *
 * The payload mounts LAZILY (first open), so a giant `rawOutput` never runs
 * through `formatPayload` until asked (C3 render-side; the wire still carries
 * everything, D6).
 */
import { memo } from "react";
import { useOpenOnToggle } from "./useOpenOnToggle";
import "./StreamTimeline.css";

/** Machine payload → a string to drop in a `<pre>`; never throws. */
function formatPayload(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export interface RawUpdateRowProps {
  readonly kind: string;
  readonly payload: unknown;
}

export const RawUpdateRow = memo(function RawUpdateRow({
  kind,
  payload,
}: RawUpdateRowProps) {
  const { opened, onToggle } = useOpenOnToggle();
  return (
    <details
      className="raw-row"
      onToggle={onToggle}
    >
      <summary className="raw-row__summary">
        <span className="raw-row__badge t-label">raw</span>
        <span className="raw-row__kind t-data">{kind}</span>
      </summary>
      {opened && (
        <pre className="raw-row__payload t-data">{formatPayload(payload)}</pre>
      )}
    </details>
  );
});
