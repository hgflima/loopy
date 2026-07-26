/**
 * Tests for diff-hunks: computeDiffHunks pure function (R5).
 *
 * The ACP `Diff` is `{ path, oldText?, newText }` — no hunk, no sign, no line
 * number lives in the protocol. This function derives real hunks (jsdiff's
 * `diffLines`) so a 3-line edit in a 2,000-line file paints ~12 lines, not
 * 4,000 (the acp-inspector failure mode).
 *
 * Covers the acceptance criteria:
 * - 3 changed lines in a 2,000-line file → 1 hunk with context, not 4,000 lines
 * - `oldText` absent/null → one all-addition hunk
 * - a file with no trailing newline does not break
 * - identical texts → zero hunks
 * - pure, and never throws on empty-on-both-sides input
 * Plus the cost guard (two large, wholly-different texts → truncated, not a
 * frozen UI thread) and line-ending edges (CRLF, trailing-newline-only).
 *
 * Run: `npm test -w apps/menubar -- diff-hunks`
 */

import { describe, it, expect } from "vitest";
import { computeDiffHunks } from "./diff-hunks.js";

describe("computeDiffHunks", () => {
  it("collapses a 3-line edit in a 2,000-line file to 1 small hunk", () => {
    const base = Array.from({ length: 2000 }, (_, i) => `line ${i + 1}`);
    const oldText = base.join("\n") + "\n";

    const modified = [...base];
    modified[999] = "CHANGED A";
    modified[1000] = "CHANGED B";
    modified[1001] = "CHANGED C";
    const newText = modified.join("\n") + "\n";

    const { hunks, truncated } = computeDiffHunks(oldText, newText);

    expect(truncated).toBe(false);
    expect(hunks).toHaveLength(1);
    // context (~3) + 3 removed + 3 added + context (~3) — nowhere near 4,000.
    expect(hunks[0].lines.length).toBeLessThan(20);

    const dels = hunks[0].lines
      .filter((l) => l.sign === "del")
      .map((l) => l.text);
    const adds = hunks[0].lines
      .filter((l) => l.sign === "add")
      .map((l) => l.text);
    expect(dels).toEqual(["line 1000", "line 1001", "line 1002"]);
    expect(adds).toEqual(["CHANGED A", "CHANGED B", "CHANGED C"]);
  });

  it("carries ~3 lines of context around the change", () => {
    const oldText = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n";
    const newText = "a\nb\nc\nd\ne\nZ\ng\nh\ni\nj\n";

    const { hunks } = computeDiffHunks(oldText, newText);

    expect(hunks).toHaveLength(1);
    const ctx = hunks[0].lines
      .filter((l) => l.sign === "ctx")
      .map((l) => l.text);
    // 3 lines of context on each side of the single change.
    expect(ctx).toEqual(["c", "d", "e", "g", "h", "i"]);
  });

  it("preserves a leading blank line as context (does not drop it)", () => {
    // The change's only leading context is an empty first line, so the pending
    // context block is just "\n". Trimming the block's trailing newline must not
    // also swallow that real empty line — otherwise the hunk opens on the change
    // and silently omits line 1.
    const { hunks } = computeDiffHunks("\nfoo\n", "\nbar\n");

    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines[0]).toEqual({
      sign: "ctx",
      text: "",
      oldLine: 1,
      newLine: 1,
    });
    const dels = hunks[0].lines
      .filter((l) => l.sign === "del")
      .map((l) => l.text);
    const adds = hunks[0].lines
      .filter((l) => l.sign === "add")
      .map((l) => l.text);
    expect(dels).toEqual(["foo"]);
    expect(adds).toEqual(["bar"]);
  });

  it("tags each line with the correct sign and side line numbers", () => {
    const { hunks } = computeDiffHunks("a\nb\nc\n", "a\nX\nc\n");

    expect(hunks).toHaveLength(1);
    const [hunk] = hunks;

    expect(hunk.lines).toEqual([
      { sign: "ctx", text: "a", oldLine: 1, newLine: 1 },
      { sign: "del", text: "b", oldLine: 2 },
      { sign: "add", text: "X", newLine: 2 },
      { sign: "ctx", text: "c", oldLine: 3, newLine: 3 },
    ]);
    expect(hunk).toMatchObject({
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 3,
    });
  });

  it("treats an absent oldText as one all-addition hunk", () => {
    const { hunks, truncated } = computeDiffHunks(
      undefined,
      "one\ntwo\nthree\n",
    );

    expect(truncated).toBe(false);
    expect(hunks).toHaveLength(1);
    const [hunk] = hunks;
    expect(hunk.lines.every((l) => l.sign === "add")).toBe(true);
    expect(hunk.lines.map((l) => l.text)).toEqual(["one", "two", "three"]);
    expect(hunk).toMatchObject({
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 3,
    });
  });

  it("treats a null oldText the same as absent (all-addition)", () => {
    const { hunks } = computeDiffHunks(null, "only\n");

    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines).toEqual([{ sign: "add", text: "only", newLine: 1 }]);
  });

  it("treats a new but empty file as one (empty) addition hunk, not zero", () => {
    // A newly created empty file is `oldText` absent, `newText === ""`. It must
    // stay distinguishable from "nothing changed" (both texts empty), so the
    // presence of `newText` is preserved before the `?? ""` normalization.
    const { hunks, truncated } = computeDiffHunks(undefined, "");

    expect(truncated).toBe(false);
    expect(hunks).toHaveLength(1);
    const [hunk] = hunks;
    // No lines to add, but the hunk exists (and is vacuously all-addition).
    expect(hunk.lines).toEqual([]);
    expect(hunk.lines.every((l) => l.sign === "add")).toBe(true);
    expect(hunk).toMatchObject({ oldLines: 0, newLines: 0 });
  });

  it("distinguishes a new empty file from an unchanged empty file", () => {
    // Same normalized strings ("" on both sides) but different provenance: an
    // absent `oldText` is a creation (one hunk); a present-but-empty `oldText`
    // is an unchanged empty file (zero hunks).
    expect(computeDiffHunks(undefined, "").hunks).toHaveLength(1);
    expect(computeDiffHunks("", "").hunks).toHaveLength(0);
  });

  it("does not break on a file with no trailing newline", () => {
    const { hunks } = computeDiffHunks("a\nb", "a\nc");

    expect(hunks).toHaveLength(1);
    const dels = hunks[0].lines
      .filter((l) => l.sign === "del")
      .map((l) => l.text);
    const adds = hunks[0].lines
      .filter((l) => l.sign === "add")
      .map((l) => l.text);
    expect(dels).toEqual(["b"]);
    expect(adds).toEqual(["c"]);
    // The last line, sans "\n", must not leak a phantom empty line.
    expect(hunks[0].lines.some((l) => l.text === "")).toBe(false);
  });

  it("does not throw when only the trailing newline changes", () => {
    // "a\nb" → "a\nb\n": the file gained a final newline. jsdiff reports it as
    // the last line changing; the point is it stays one small hunk, never throws,
    // and never leaks a phantom empty line.
    const { hunks, truncated } = computeDiffHunks("a\nb", "a\nb\n");

    expect(truncated).toBe(false);
    expect(hunks.length).toBeLessThanOrEqual(1);
    for (const hunk of hunks) {
      expect(hunk.lines.some((l) => l.text === "")).toBe(false);
    }
  });

  it("handles CRLF endings without exploding into a whole-file diff", () => {
    // Consistent CRLF, one line changed. Without stripTrailingCr a CRLF-vs-LF
    // mismatch would diff every line (the whole-file failure mode); here the
    // "\r" is stripped so the rendered text is clean and only line "b" changes.
    const oldText = "a\r\nb\r\nc\r\n";
    const newText = "a\r\nX\r\nc\r\n";

    const { hunks, truncated } = computeDiffHunks(oldText, newText);

    expect(truncated).toBe(false);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines.every((l) => !l.text.includes("\r"))).toBe(true);
    const dels = hunks[0].lines
      .filter((l) => l.sign === "del")
      .map((l) => l.text);
    const adds = hunks[0].lines
      .filter((l) => l.sign === "add")
      .map((l) => l.text);
    expect(dels).toEqual(["b"]);
    expect(adds).toEqual(["X"]);
  });

  it("does not explode when one side is CRLF and the other is LF", () => {
    const { hunks, truncated } = computeDiffHunks(
      "alpha\r\nbeta\r\ngamma\r\n",
      "alpha\nbeta\ngamma\n",
    );

    // stripTrailingCr makes the two sides identical → nothing to show, and
    // certainly not one add + one del for every line.
    expect(truncated).toBe(false);
    expect(hunks).toEqual([]);
  });

  it("preserves a bare trailing carriage return (not a CRLF separator)", () => {
    // "a\r" → "a": the only change is a stray trailing CR with no following LF.
    // It is not a line separator, so it must survive into the rendered text —
    // otherwise the del and the add both read "a" and the edit vanishes. jsdiff
    // keeps the bare "\r" in its change values (it only rewrites "\r\n"→"\n"),
    // so the render is what must not strip it.
    const { hunks, truncated } = computeDiffHunks("a\r", "a");

    expect(truncated).toBe(false);
    expect(hunks).toHaveLength(1);
    const dels = hunks[0].lines
      .filter((l) => l.sign === "del")
      .map((l) => l.text);
    const adds = hunks[0].lines
      .filter((l) => l.sign === "add")
      .map((l) => l.text);
    expect(dels).toEqual(["a\r"]);
    expect(adds).toEqual(["a"]);
  });

  it("strips CRLF separators but keeps a bare final CR in a new file", () => {
    // One-sided add (no jsdiff): the inner "\r" of each "\r\n" is a separator and
    // is dropped for clean rendering; the bare "\r" ending the final, unterminated
    // line is content and stays. Proves the distinction holds off the diff path.
    const { hunks } = computeDiffHunks(undefined, "a\r\nb\r\nc\r");

    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines.map((l) => l.text)).toEqual(["a", "b", "c\r"]);
    expect(hunks[0].lines.every((l) => l.sign === "add")).toBe(true);
  });

  it("produces zero hunks for identical texts", () => {
    expect(computeDiffHunks("a\nb\nc\n", "a\nb\nc\n").hunks).toEqual([]);
    expect(computeDiffHunks("no newline", "no newline").hunks).toEqual([]);
  });

  it("produces zero hunks (not truncated) for identical texts past the char guard", () => {
    // Two identical multi-megabyte sides sit past MAX_DIFF_CHARS *combined*, yet
    // an unchanged file is "no change" (zero hunks), never "diff too large":
    // identity is decided before the render-cost guards. Comparing the two whole
    // strings is O(n) but far cheaper than the diff it replaces.
    const text = "x".repeat(1_100_000);

    expect(computeDiffHunks(text, text)).toEqual({
      hunks: [],
      truncated: false,
    });
  });

  it("produces zero hunks (not truncated) for identical texts past the line guard", () => {
    // Identical but > MAX_DIFF_LINES lines each: the two-sided line guard would
    // flag `truncated`, but an unchanged file stays zero hunks regardless of size.
    const text =
      Array.from({ length: 25_000 }, (_, i) => `L${i}`).join("\n") + "\n";

    expect(computeDiffHunks(text, text)).toEqual({
      hunks: [],
      truncated: false,
    });
  });

  it("is pure and never throws on empty-on-both-sides input", () => {
    expect(() => computeDiffHunks("", "")).not.toThrow();
    expect(computeDiffHunks("", "")).toEqual({ hunks: [], truncated: false });
    expect(() => computeDiffHunks(undefined, undefined)).not.toThrow();
    expect(computeDiffHunks(undefined, undefined).hunks).toEqual([]);
    expect(() => computeDiffHunks(null, null)).not.toThrow();
  });

  it("splits far-apart changes into separate hunks", () => {
    const base = Array.from({ length: 40 }, (_, i) => `L${i + 1}`);
    const oldText = base.join("\n") + "\n";

    const modified = [...base];
    modified[4] = "EARLY"; // line 5
    modified[34] = "LATE"; // line 35
    const newText = modified.join("\n") + "\n";

    const { hunks } = computeDiffHunks(oldText, newText);

    // Two changes 30 lines apart cannot share a 3-line context window.
    expect(hunks).toHaveLength(2);
    expect(hunks[0].lines.some((l) => l.text === "EARLY")).toBe(true);
    expect(hunks[1].lines.some((l) => l.text === "LATE")).toBe(true);
  });

  it("keeps nearby changes in a single hunk", () => {
    const base = Array.from({ length: 20 }, (_, i) => `L${i + 1}`);
    const oldText = base.join("\n") + "\n";

    const modified = [...base];
    modified[9] = "TEN"; // line 10
    modified[13] = "FOURTEEN"; // line 14 — only 3 context lines between
    const newText = modified.join("\n") + "\n";

    const { hunks } = computeDiffHunks(oldText, newText);

    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines.some((l) => l.text === "TEN")).toBe(true);
    expect(hunks[0].lines.some((l) => l.text === "FOURTEEN")).toBe(true);
  });

  it("truncates two large, wholly-different texts instead of churning", () => {
    // Every line differs → edit distance is ~2× the line count, far past the
    // Myers ceiling. The guard must bail with an explicit marker, not a frozen
    // thread and not a silent empty diff.
    const oldText =
      Array.from({ length: 5000 }, (_, i) => `old-${i}`).join("\n") + "\n";
    const newText =
      Array.from({ length: 5000 }, (_, i) => `new-${i}`).join("\n") + "\n";

    const result = computeDiffHunks(oldText, newText);

    expect(result.truncated).toBe(true);
    expect(result.hunks).toEqual([]);
  });

  it("truncates when the combined payload is enormous", () => {
    // Two multi-megabyte one-liners: the cheap char guard bails before jsdiff
    // even tokenizes them.
    const oldText = "a".repeat(1_100_000);
    const newText = "b".repeat(1_100_000);

    const result = computeDiffHunks(oldText, newText);

    expect(result.truncated).toBe(true);
    expect(result.hunks).toEqual([]);
  });

  it("never truncates a large new file (pure addition stays linear)", () => {
    // A big new file is all-addition — O(N), never quadratic — so the cost
    // guards must not fire even though it dwarfs the edit-distance ceiling.
    const newText =
      Array.from({ length: 5000 }, (_, i) => `line ${i}`).join("\n") + "\n";

    const { hunks, truncated } = computeDiffHunks(undefined, newText);

    expect(truncated).toBe(false);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines).toHaveLength(5000);
    expect(hunks[0].lines.every((l) => l.sign === "add")).toBe(true);
  });

  it("truncates a new file whose payload is enormous", () => {
    // A one-sided add is linear, but still materializes one record per line: an
    // ACP tool sending a multi-megabyte new file would jank the webview thread.
    // The render-side char guard must apply to additions too, not just two-sided
    // edits — the full payload still travels the wire (D6); only rendering bails.
    const newText = "x".repeat(3_000_000);

    const result = computeDiffHunks(undefined, newText);

    expect(result.truncated).toBe(true);
    expect(result.hunks).toEqual([]);
  });

  it("truncates a new file with pathologically many short lines", () => {
    // Just under MAX_DIFF_CHARS (2 chars × 999,999 ≈ 2 MB) yet ~1M lines: the
    // char guard passes, but materializing one record per line would jank the
    // single webview thread. An independent render-line guard must bail before
    // allocating the line records.
    const newText = "x\n".repeat(999_999);

    const result = computeDiffHunks(undefined, newText);

    expect(result.truncated).toBe(true);
    expect(result.hunks).toEqual([]);
  });

  it("truncates a one-sided deletion of pathologically many short lines", () => {
    // The delete-side twin: a huge file emptied (newText === ""). Under the char
    // cap but ~1M removed lines — the line guard must bail before it materializes
    // one del record per line *and* before diffLines runs Myers (whose edit
    // distance here equals the line count, i.e. O(N²) on the unguarded path).
    const oldText = "x\n".repeat(999_999);

    const result = computeDiffHunks(oldText, "");

    expect(result.truncated).toBe(true);
    expect(result.hunks).toEqual([]);
  });

  it("keeps a single edit in a large file to one small hunk", () => {
    // 15k lines (just under MAX_DIFF_LINES, so the two-sided line guard stays
    // dormant), one line changed near the middle: the result must be one small
    // hunk (a handful of lines), proving hunks are built from the change blocks
    // and their context, not by materializing every unchanged line of the file.
    const base = Array.from({ length: 15_000 }, (_, i) => `L${i + 1}`);
    const oldText = base.join("\n") + "\n";

    const modified = [...base];
    modified[7_499] = "EDITED"; // line 7500
    const newText = modified.join("\n") + "\n";

    const { hunks, truncated } = computeDiffHunks(oldText, newText);

    expect(truncated).toBe(false);
    expect(hunks).toHaveLength(1);
    // ~3 context + 1 del + 1 add + ~3 context — nowhere near 15k.
    expect(hunks[0].lines.length).toBeLessThan(12);
    const del = hunks[0].lines.find((l) => l.sign === "del");
    const add = hunks[0].lines.find((l) => l.sign === "add");
    expect(del).toMatchObject({ text: "L7500", oldLine: 7_500 });
    expect(add).toMatchObject({ text: "EDITED", newLine: 7_500 });
    // Context around the edit carries the right line numbers on both sides.
    expect(hunks[0].lines[0]).toMatchObject({
      sign: "ctx",
      text: "L7497",
      oldLine: 7_497,
      newLine: 7_497,
    });
  });

  it("truncates a small two-sided edit buried in two giant texts", () => {
    // The bilateral twin of the line guard: both sides are huge but nearly
    // identical (one changed line in a 25k-line file). Myers *would* succeed —
    // edit distance is 2, far under MAX_EDIT_LENGTH — so the Myers ceiling does
    // not catch it; and short lines keep the combined payload under
    // MAX_DIFF_CHARS, so the char guard misses it too. Without a line guard
    // applied to *both* sides before `diffLines`, jsdiff would still tokenize
    // ~25k line records per side, janking the single webview thread for a
    // trivial change. The guard must bail with an explicit marker; the full text
    // still travels the wire (D6).
    const base = Array.from({ length: 25_000 }, (_, i) => `L${i}`);
    const oldText = base.join("\n") + "\n";

    const modified = [...base];
    modified[12_500] = "EDITED";
    const newText = modified.join("\n") + "\n";

    const result = computeDiffHunks(oldText, newText);

    expect(result.truncated).toBe(true);
    expect(result.hunks).toEqual([]);
  });

  it("does not mutate its inputs", () => {
    const oldText = "a\nb\n";
    const newText = "a\nc\n";
    computeDiffHunks(oldText, newText);
    expect(oldText).toBe("a\nb\n");
    expect(newText).toBe("a\nc\n");
  });
});
