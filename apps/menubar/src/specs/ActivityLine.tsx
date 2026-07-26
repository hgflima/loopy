/**
 * ActivityLine — proof of life while a Phase runs (D14).
 *
 * The spike measured **328 s to the first question** (the agent spawns
 * sub-explorers before it asks), so a still screen reads as "frozen". This
 * component keeps a pulsing header alive and renders, below it, everything the
 * Agent has narrated so far in the running Phase.
 *
 * **The narration is markdown, not a line.** `agent_activity` carries the turn's
 * FULL prose (`decideTurn` → `parsed.prose`) — several paragraphs, headings,
 * lists. It used to be squeezed into a one-line `u-truncate`, which hid
 * everything past the first ~80 characters behind an ellipsis. It now goes
 * through the app's {@link MarkdownStream}, which also turns sentence
 * boundaries into real `<br>`s — the engine concatenates the Agent's paragraphs
 * without separators, so that split is what makes the text readable at all.
 *
 * The pulsing dot is the accent in its "alive" meaning — one of the three the
 * accent is allowed to carry.
 */
import { MarkdownStream, StatusDot } from "../ui";
import "./specs.css";

interface ActivityLineProps {
  /** The last narration — the readout before any transcript accumulates. */
  readonly line: string | null;
  /** The accumulated markdown narration of the running Phase. */
  readonly transcript?: string;
  /** True while the Phase is still running (pulse + streaming markdown). */
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
  const hasTranscript = transcript !== undefined && transcript !== "";
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
          <MarkdownStream text={transcript} streaming={busy} />
        </div>
      )}
    </div>
  );
}
