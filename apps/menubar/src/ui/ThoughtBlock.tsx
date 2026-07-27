/**
 * ThoughtBlock — an agent thought, COLLAPSED on birth (D7).
 *
 * The thought is noise until asked for, so it is born closed behind a native
 * `<details>` whose summary counts the paragraphs (`Pensando · N parágrafos`)
 * and opens on click. "Closed on birth" is the DEFAULT, not a persisted
 * preference — every thought starts folded, and the user opens the ones worth
 * reading. The prose renders through {@link MarkdownStream} (same sanitized path
 * as any agent text) only once the disclosure is opened, so a long thought never
 * parses until wanted.
 *
 * The family hue rides ONLY on the glyph stroke (`--tool-think` via
 * `currentColor`), never a fill/pill (C1) — the same rule the ToolCallCard obeys.
 */
import { memo } from "react";
import { MarkdownStream } from "./MarkdownStream";
import { IconToolThink } from "./icons";
import { useOpenOnToggle } from "./useOpenOnToggle";
import "./StreamTimeline.css";

/**
 * Count the paragraphs in a thought — blocks separated by a blank line, empty
 * blocks dropped. Pure and exported so the count is unit-tested without React.
 * A blank-line run of any width (`\n\n`, `\n \n`, `\n\n\n`) is one separator.
 */
export function countThoughtParagraphs(text: unknown): number {
  if (typeof text !== "string") return 0;
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0).length;
}

export interface ThoughtBlockProps {
  readonly text: string;
  /** Whether the thought is still streaming — forwarded to the lazily-mounted
   *  MarkdownStream so a growing thought memoizes its completed segments instead
   *  of reparsing the whole prose per chunk (avoids the O(n²) live reparse). */
  readonly streaming?: boolean;
}

export const ThoughtBlock = memo(function ThoughtBlock({
  text,
  streaming,
}: ThoughtBlockProps) {
  // Coerce once (D3): both the count and the lazily-mounted prose read a string.
  const safeText = typeof text === "string" ? text : "";
  const count = countThoughtParagraphs(safeText);
  const { opened, onToggle } = useOpenOnToggle();
  const noun = count === 1 ? "parágrafo" : "parágrafos";

  return (
    <details className="thought-block" onToggle={onToggle}>
      <summary className="thought-block__summary t-label">
        <span
          className="thought-block__glyph"
          aria-hidden="true"
          style={{ color: "var(--tool-think)" }}
        >
          <IconToolThink />
        </span>
        Pensando · {count} {noun}
      </summary>
      {opened && (
        <div className="thought-block__body">
          <MarkdownStream text={safeText} streaming={streaming} />
        </div>
      )}
    </details>
  );
});
