/**
 * DiffView — paints the hunks `diff-hunks.ts` (T-007) computed. Nothing else.
 *
 * The math lives entirely in `computeDiffHunks`; this component is a pure
 * painter (AD-6): it receives the already-computed `DiffHunk[]` and lays out
 * `+`/`−`/context lines. `add`/`del` borrow the existing done/failed state hues
 * (both have light + dark mirrors, so the sign reads in either theme); the line
 * numbers ride in a muted mono gutter; context is `--ink-secondary`.
 *
 * `truncated` is `computeDiffHunks`'s "diff too large to render inline" flag
 * (spec C3): the payload still travelled whole over the wire (D6), we just
 * decline to paint it — shown as an explicit notice, never a blank.
 *
 * Styles live in `ToolCallCard.css` (a diff only ever appears inside a card).
 */
import { memo } from "react";
import type { DiffHunk, DiffSign } from "./diff-hunks";
import "./ToolCallCard.css";

export interface DiffViewProps {
  readonly hunks: readonly DiffHunk[];
  /** `computeDiffHunks` declined to render inline (C3) — show a notice. */
  readonly truncated?: boolean;
}

/** The single-column marker for each side. `−` is U+2212 (a real minus). */
const SIGN_CHAR: Readonly<Record<DiffSign, string>> = {
  add: "+",
  del: "−",
  ctx: " ",
};

/** A gutter cell shows the line number only for the side that owns the line. */
function gutter(n: number | undefined): string {
  return n === undefined ? "" : String(n);
}

export const DiffView = memo(function DiffView({
  hunks,
  truncated,
}: DiffViewProps) {
  if (truncated) {
    return (
      <div className="diff-view diff-view--notice t-data" role="note">
        Diferença grande demais para exibir.
      </div>
    );
  }
  if (hunks.length === 0) {
    return (
      <div className="diff-view diff-view--notice t-data" role="note">
        Sem alterações.
      </div>
    );
  }
  // A hunk carrying no lines is `diff-hunks`'s marker for an empty body — a file
  // created (or emptied) with no content — kept distinct from zero hunks
  // ("nothing changed"). Painting it would leave a blank hunk div; surface it as
  // an explicit notice instead (the view never silently hides a change).
  if (hunks.every((hunk) => hunk.lines.length === 0)) {
    return (
      <div className="diff-view diff-view--notice t-data" role="note">
        Arquivo vazio.
      </div>
    );
  }
  return (
    <div className="diff-view t-data">
      {hunks.map((hunk, hi) => (
        <div key={hi} className="diff-hunk">
          {hunk.lines.map((line, li) => (
            <div key={li} className={`diff-line diff-line--${line.sign}`}>
              <span className="diff-line__gutter" aria-hidden="true">
                {gutter(line.oldLine)}
              </span>
              <span className="diff-line__gutter" aria-hidden="true">
                {gutter(line.newLine)}
              </span>
              <span className="diff-line__sign" aria-hidden="true">
                {SIGN_CHAR[line.sign]}
              </span>
              <span className="diff-line__code">{line.text}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
});
