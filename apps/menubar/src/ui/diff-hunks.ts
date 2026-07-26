/**
 * Real diff hunks from `oldText`/`newText` — pure (AD-6, R5).
 *
 * The ACP `Diff` is `{ path, oldText?, newText }`: no hunk, no sign, no line
 * number exists in the protocol, so the `+`/`−` view has to be *computed*. The
 * reference implementation (acp-inspector) paints the whole old file red and the
 * whole new file green — 4,000 coloured lines for a 3-line edit in a 2,000-line
 * file. This derives the actual changed regions (jsdiff's `diffLines`, Myers
 * with prefix/suffix trimming) and keeps ~3 lines of context around each.
 *
 * Hunks are built straight from jsdiff's change blocks: only changed lines and
 * their ±context are materialized, so a one-line edit in a 100k-line file costs
 * a handful of records, not 100k. `DiffView.tsx` (T-009) only paints what this
 * returns.
 */

import { diffLines, type Change } from "diff";

/** Which side a hunk line belongs to. */
export type DiffSign = "add" | "del" | "ctx";

/**
 * One line of a hunk. `oldLine`/`newLine` are 1-based and present only for the
 * side that has the line: `add` has no `oldLine`, `del` has no `newLine`, `ctx`
 * has both.
 */
export interface DiffLine {
  readonly sign: DiffSign;
  readonly text: string;
  readonly oldLine?: number;
  readonly newLine?: number;
}

/** A contiguous changed region with its unified-diff header numbers. */
export interface DiffHunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly DiffLine[];
}

/**
 * The result of diffing two texts.
 *
 * `truncated` is the diff analogue of R6's `elided` marker: when the inputs are
 * too large/divergent to diff inline, `hunks` is empty and `truncated` is true
 * so `DiffView` can show an explicit "diff too large" notice instead of a blank
 * card — the view never silently hides a change.
 */
export interface DiffResult {
  readonly hunks: readonly DiffHunk[];
  readonly truncated: boolean;
}

/** Context lines kept on each side of a change (git's default is 3). */
const CONTEXT_LINES = 3;

/**
 * Two context runs no wider than this get absorbed into a single hunk (git's
 * behaviour): a gap of at most `2·CONTEXT` lines means the two changes' context
 * windows touch. Wider gaps split into separate hunks.
 */
const MAX_MERGE_GAP = 2 * CONTEXT_LINES;

/**
 * Render-side guards. They cap the *rendering* cost, never the payload: the
 * texts themselves still travel whole across the wire (spec D6, "diffs viajam
 * inteiros") — this only declines to *render* the pathological case inline,
 * flagging it via `truncated` (spec C3, "mitigação só do lado do render").
 *
 * The two size guards are independent because they bound different pathologies.
 * `MAX_DIFF_CHARS` catches a few very long lines (megabytes of text) before
 * jsdiff even tokenizes them; `MAX_DIFF_LINES` catches very many short lines —
 * `"x\n"` a million times sits *under* the char cap yet would still jank the
 * single webview thread. Both size guards apply on *every* path: on a one-sided
 * add/delete, whose record count equals the file's line count, and on a
 * two-sided edit, where the line guard runs on both sides *before* `diffLines`
 * so jsdiff never tokenizes ~1M line records for a giant-but-similar pair.
 * `MAX_EDIT_LENGTH` additionally bounds `diffLines`'s O(N·D) Myers cost for two
 * large, wholly-different texts (jsdiff returns `undefined` past it); a
 * one-sided add/delete is built directly and never reaches Myers. The two
 * two-sided pathologies are thus split cleanly: a *tiny* edit in a giant file
 * (Myers would succeed → the line guard stops it) versus a *total* rewrite
 * (line count may be modest → the Myers guard stops it).
 */
const MAX_DIFF_CHARS = 2_000_000;
const MAX_DIFF_LINES = 20_000;
const MAX_EDIT_LENGTH = 2_000;

/**
 * Drop a single trailing "\r" from a line that a "\n" terminated — a CRLF line
 * split on "\n" keeps its "\r". Callers apply it only to newline-terminated
 * lines: a *bare* trailing "\r" on a final line with no "\n" is content, not a
 * separator, and is passed through untouched (see `splitLines`).
 */
function stripCr(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/**
 * Split a jsdiff change value into lines. The value keeps its newlines, so a
 * trailing "\n" yields a final "" that is not a real line (a file with no
 * trailing newline has no such artifact) — drop it.
 *
 * Only newline-terminated lines get their CRLF "\r" stripped. A bare "\r" on a
 * final line that had no "\n" is real content and is preserved — otherwise a
 * `"a\r"` → `"a"` edit would render as two identical `"a"` lines and hide the
 * change. (jsdiff already rewrites "\r\n"→"\n" in its values under
 * `stripTrailingCr`, so the only "\r" reaching here from a diff is such a bare
 * one; the one-sided add/delete paths skip jsdiff and rely on this to strip
 * their own CRLF separators.)
 */
function splitLines(value: string): string[] {
  if (value.length === 0) return [];
  const parts = value.split("\n");
  const newlineTerminated = parts[parts.length - 1] === "";
  if (newlineTerminated) parts.pop();
  const last = parts.length - 1;
  return parts.map((line, i) =>
    i < last || newlineTerminated ? stripCr(line) : line,
  );
}

/**
 * Line count of `value` without materializing the lines — matches
 * `splitLines(value).length` but allocates nothing, so it can gate the
 * render-line guard before any per-line records exist.
 */
function countLines(value: string): number {
  if (value.length === 0) return 0;
  let n = 1;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\n") n++;
  }
  // A trailing "\n" terminates the last line; it does not start a new one.
  if (value[value.length - 1] === "\n") n--;
  return n;
}

function tooManyLines(value: string): boolean {
  return countLines(value) > MAX_DIFF_LINES;
}

/**
 * First `n` real lines of `value`, without materializing the rest — used to
 * take the leading edge of a large context block as a hunk's trailing context.
 */
function firstLines(value: string, n: number): string[] {
  const out: string[] = [];
  let start = 0;
  while (out.length < n && start < value.length) {
    const nl = value.indexOf("\n", start);
    if (nl === -1) {
      // Final line, no "\n": a trailing "\r" here is content, not a separator.
      out.push(value.slice(start));
      break;
    }
    out.push(stripCr(value.slice(start, nl)));
    start = nl + 1;
  }
  return out;
}

/**
 * Last `n` real lines of `value`, without materializing the rest — used to take
 * the trailing edge of a large context block as the next hunk's leading context.
 */
function lastLines(value: string, n: number): string[] {
  if (value.length === 0) return [];
  // The window [0, end) is the content minus a single trailing "\n" (which
  // terminates the last line, it does not start a new one).
  let end = value.length;
  const newlineTerminated = value[end - 1] === "\n";
  if (newlineTerminated) end--;
  const out: string[] = [];
  let atFinalLine = true;
  while (out.length < n) {
    // The last unconsumed line runs from just past the preceding "\n" to `end`.
    // `end === 0` means no preceding "\n" *and* no earlier content — but the
    // trim above may have left a real empty first line still owed, so emit it
    // (nl = -1) instead of dropping it; a lone "\n" is one empty line, not none.
    const nl = end === 0 ? -1 : value.lastIndexOf("\n", end - 1);
    const raw = value.slice(nl + 1, end);
    // Only the value's final line, and only when it had no trailing "\n", keeps
    // a bare "\r" (content, not a CRLF separator).
    out.unshift(atFinalLine && !newlineTerminated ? raw : stripCr(raw));
    atFinalLine = false;
    if (nl === -1) break;
    end = nl;
  }
  return out;
}

function summarizeHunkLines(
  lines: readonly DiffLine[],
): Omit<DiffHunk, "lines"> {
  let oldStart = 0;
  let oldLines = 0;
  let newStart = 0;
  let newLines = 0;

  for (const line of lines) {
    if (line.oldLine !== undefined) {
      oldStart = oldStart === 0 ? line.oldLine : oldStart;
      oldLines++;
    }
    if (line.newLine !== undefined) {
      newStart = newStart === 0 ? line.newLine : newStart;
      newLines++;
    }
  }

  return { oldStart, oldLines, newStart, newLines };
}

function finishHunk(lines: readonly DiffLine[]): DiffHunk {
  return { ...summarizeHunkLines(lines), lines };
}

function pushContextLines(
  target: DiffLine[],
  texts: readonly string[],
  oldNo: number,
  newNo: number,
): void {
  let oldLine = oldNo;
  let newLine = newNo;
  for (const text of texts) {
    target.push({ sign: "ctx", text, oldLine: oldLine++, newLine: newLine++ });
  }
}

function pushAddedLines(
  target: DiffLine[],
  texts: readonly string[],
  newNo: number,
): void {
  let newLine = newNo;
  for (const text of texts) {
    target.push({ sign: "add", text, newLine: newLine++ });
  }
}

function pushDeletedLines(
  target: DiffLine[],
  texts: readonly string[],
  oldNo: number,
): void {
  let oldLine = oldNo;
  for (const text of texts) {
    target.push({ sign: "del", text, oldLine: oldLine++ });
  }
}

/**
 * A one-sided change — a whole file added (a new file, `oldText` absent) or a
 * whole file removed (`newText` emptied) — is a single hunk of all-`add` or
 * all-`del` lines, built directly without diffing. An empty body yields a hunk
 * with zero lines, which stays distinct from "no change" (zero hunks) so the
 * view can tell "created/emptied a file" from "nothing happened".
 */
function oneSidedHunk(body: string, sign: "add" | "del"): DiffHunk {
  const texts = splitLines(body);
  const lines: DiffLine[] = [];
  for (const [i, text] of texts.entries()) {
    lines.push(
      sign === "add"
        ? { sign, text, newLine: i + 1 }
        : { sign, text, oldLine: i + 1 },
    );
  }
  const lineCount = lines.length;
  return {
    oldStart: sign === "del" && lineCount > 0 ? 1 : 0,
    oldLines: sign === "del" ? lineCount : 0,
    newStart: sign === "add" && lineCount > 0 ? 1 : 0,
    newLines: sign === "add" ? lineCount : 0,
    lines,
  };
}

function truncatedResult(): DiffResult {
  return { hunks: [], truncated: true };
}

function oneSidedResult(body: string, sign: "add" | "del"): DiffResult {
  if (tooManyLines(body)) return truncatedResult();
  return { hunks: [oneSidedHunk(body, sign)], truncated: false };
}

/** A context block the algorithm has seen but not yet decided how to spend. */
interface PendingContext {
  readonly value: string;
  readonly oldNo: number;
  readonly newNo: number;
  readonly count: number;
}

/**
 * Turn jsdiff's change blocks into hunks, materializing only changed lines and
 * the ±CONTEXT lines around them. A context block never becomes per-line records
 * unless it is small enough to sit inside a hunk (gap ≤ `MAX_MERGE_GAP`) or is a
 * hunk's leading/trailing edge — so a huge unchanged region costs O(context),
 * not O(region).
 */
function buildHunks(changes: readonly Change[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let oldNo = 1;
  let newNo = 1;
  let current: DiffLine[] | null = null;
  let pending: PendingContext | null = null;

  for (const change of changes) {
    if (change.added || change.removed) {
      const sign: DiffSign = change.added ? "add" : "del";
      if (current === null) {
        // Opening a hunk: its leading context is the tail of the pending block.
        current = [];
        if (pending !== null) {
          const lead = lastLines(pending.value, CONTEXT_LINES);
          const skip = pending.count - lead.length;
          pushContextLines(
            current,
            lead,
            pending.oldNo + skip,
            pending.newNo + skip,
          );
        }
      } else if (pending !== null) {
        // Continuing a hunk across a small gap: the whole block is context.
        pushContextLines(
          current,
          splitLines(pending.value),
          pending.oldNo,
          pending.newNo,
        );
      }
      pending = null;

      const lines = splitLines(change.value);
      if (sign === "add") {
        pushAddedLines(current, lines, newNo);
        newNo += lines.length;
      } else {
        pushDeletedLines(current, lines, oldNo);
        oldNo += lines.length;
      }
    } else {
      // Context block. jsdiff never emits two in a row, so this either bridges
      // two changes (small gap) or ends a hunk / precedes one (large gap).
      const count = change.count ?? splitLines(change.value).length;
      if (current !== null && count > MAX_MERGE_GAP) {
        // Gap too wide to merge: close the hunk with its trailing context.
        pushContextLines(
          current,
          firstLines(change.value, CONTEXT_LINES),
          oldNo,
          newNo,
        );
        hunks.push(finishHunk(current));
        current = null;
      }
      pending = { value: change.value, oldNo, newNo, count };
      oldNo += count;
      newNo += count;
    }
  }

  if (current !== null) {
    // A hunk left open ends at the tail of the file; its trailing context is the
    // head of whatever context block followed the last change.
    if (pending !== null) {
      pushContextLines(
        current,
        firstLines(pending.value, CONTEXT_LINES),
        pending.oldNo,
        pending.newNo,
      );
    }
    hunks.push(finishHunk(current));
  }

  return hunks;
}

/**
 * Compute the changed hunks between two texts. A missing/null `oldText` (with a
 * present `newText`, even empty) is a new file — one all-addition hunk. Identical
 * texts (and both-absent) yield zero hunks. Inputs too large/divergent to render
 * inline yield `truncated: true` with no hunks. Pure; never throws.
 */
export function computeDiffHunks(
  oldText: string | null | undefined,
  newText: string | null | undefined,
): DiffResult {
  const oldStr = oldText ?? "";
  const newStr = newText ?? "";

  // Identity beats every render guard: two *present*, textually-identical sides
  // are an unchanged file — zero hunks, never "diff too large". This runs before
  // the size guards below, or two large identical texts would wrongly flag
  // `truncated`. Requiring both sides present keeps a new empty file (`oldText`
  // absent, `newText` "") on the one-addition-hunk path rather than collapsing it
  // to "nothing changed". The O(n) compare is far cheaper than the diff it skips.
  if (oldText != null && newText != null && oldStr === newStr) {
    return { hunks: [], truncated: false };
  }

  // Render-side char guard, on both sides: bail before materializing a payload
  // large enough to jank the webview — a one-sided huge add/delete included.
  if (oldStr.length + newStr.length > MAX_DIFF_CHARS) {
    return truncatedResult();
  }

  // A new file: `oldText` absent but `newText` present (even ""). Preserving that
  // field presence — rather than collapsing both to "" — is what keeps "created
  // an empty file" distinct from "nothing changed". One all-addition hunk, still
  // subject to the render-line guard (short-lined files slip past the char cap).
  if (oldText == null && newText != null) {
    return oneSidedResult(newStr, "add");
  }

  // A one-sided edit — exactly one side empty — is a pure add or delete. Build it
  // directly: its rendered cost is the non-empty side's line count (guarded), and
  // skipping diffLines dodges the O(N·D) Myers pass whose edit distance would be
  // that whole line count. Both sides empty is a no-op (zero hunks).
  if (oldStr.length === 0 || newStr.length === 0) {
    if (oldStr.length === 0 && newStr.length === 0) {
      return { hunks: [], truncated: false };
    }
    const sign = oldStr.length === 0 ? "add" : "del";
    const body = sign === "add" ? newStr : oldStr;
    return oneSidedResult(body, sign);
  }

  // Both sides non-empty: a real edit. Guard the line count on *both* sides
  // before diffLines tokenizes them. Two large, nearly-identical texts (a tiny
  // edit in a giant file) slip under the char cap — short lines — and have a
  // small edit distance, so neither MAX_DIFF_CHARS nor maxEditLength catches
  // them; yet diffLines still materializes one line token per line on each side,
  // janking the single webview thread even for an identical-or-trivial change.
  // Bail here, flagging truncated; the full text still travels the wire (D6).
  if (tooManyLines(oldStr) || tooManyLines(newStr)) {
    return truncatedResult();
  }

  // `maxEditLength` bounds Myers's O(N·D) cost (and hence the changed-line count)
  // for two large, wholly-different texts.
  const changes = diffLines(oldStr, newStr, {
    stripTrailingCr: true,
    maxEditLength: MAX_EDIT_LENGTH,
  });
  if (changes === undefined) {
    return truncatedResult();
  }

  return { hunks: buildHunks(changes), truncated: false };
}
