/**
 * ActivityLine — proof of life while a Phase runs (D14 / C-0019 T-014).
 *
 * The spike measured **328 s to the first question** (the agent spawns
 * sub-explorers before it asks), so a still screen reads as "frozen". This
 * component keeps a pulsing header alive and, below it, mounts the running
 * Phase's timeline — the **same** {@link StreamTimeline} the Run's StreamPanel
 * uses, fed the Interview's `transcript` (`readonly StreamItem[]`).
 *
 * That timeline is what closes the silence: tool cards stream live via
 * `agent_stream`, and the turn's prose arrives once, at end of turn, as a
 * `text` item (`agent_activity`, R1). One type, two channels, one React
 * component — the Run and the Interview never diverge. `agent_message_chunk` is
 * **never** streamed here (the barrier is the engine, T-013), so no raw
 * `<loopy-…>` Envelope ever reaches the screen.
 *
 * The pulsing dot is the accent in its "alive" meaning — one of the three the
 * accent is allowed to carry.
 */
import type { StreamItem } from "loopy/tui/store";
import { StreamTimeline, StatusDot } from "../ui";
import "./specs.css";

interface ActivityLineProps {
  /** The last narration — the readout the header shows above the timeline. */
  readonly line: string | null;
  /** The running Phase's timeline (tool cards + prose), in arrival order. */
  readonly transcript?: readonly StreamItem[];
  /** True while the Phase is still running (pulse + live-streaming timeline). */
  readonly busy?: boolean;
}

/**
 * The header text. With a transcript below, the header states the *state* (the
 * prose is right there); without one, it carries the last narration itself, so
 * the box is never empty. Pure (AD-6).
 */
export function headerLabel(
  line: string | null,
  hasTranscript: boolean,
  busy?: boolean,
): string {
  if (!hasTranscript) return line ?? "Trabalhando…";
  return busy ? "Trabalhando…" : "Narração do agente";
}

export function ActivityLine({ line, transcript, busy }: ActivityLineProps) {
  const items = transcript ?? [];
  const hasTranscript = items.length > 0;
  return (
    <div className="spec-activity" role="status" aria-live="polite">
      <div className="spec-activity__line">
        {busy && <StatusDot tone="accent" pulse label="Trabalhando" />}
        <span className="spec-activity__text">
          {headerLabel(line, hasTranscript, busy)}
        </span>
      </div>

      {hasTranscript && (
        <div className="spec-activity__narration">
          <StreamTimeline items={items} streaming={busy} />
        </div>
      )}
    </div>
  );
}
