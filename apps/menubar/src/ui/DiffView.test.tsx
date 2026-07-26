/**
 * Tests for DiffView — the pure painter. It renders exactly the hunks it is
 * handed (no diffing here), tags add/del/ctx distinctly, shows `+`/`−`, and
 * degrades a truncated/empty result to an explicit notice instead of a blank.
 *
 * Run: `npm test -w apps/menubar -- DiffView`
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DiffView } from "./DiffView";
import { computeDiffHunks } from "./diff-hunks";
import * as barrel from "./index";
import type { DiffHunk } from "./diff-hunks";

/** U+2212, the same minus DiffView paints for a deletion. */
const MINUS = "−";

/** A single hunk: one context line, one deletion, one addition. */
const EDIT_HUNK: DiffHunk = {
  oldStart: 1,
  oldLines: 2,
  newStart: 1,
  newLines: 2,
  lines: [
    { sign: "ctx", text: "const a = 1;", oldLine: 1, newLine: 1 },
    { sign: "del", text: "const b = 2;", oldLine: 2 },
    { sign: "add", text: "const b = 3;", newLine: 2 },
  ],
};

/** A second, disjoint hunk — a pure addition further down the file. */
const ADD_HUNK: DiffHunk = {
  oldStart: 0,
  oldLines: 0,
  newStart: 10,
  newLines: 1,
  lines: [{ sign: "add", text: "// added", newLine: 10 }],
};

describe("DiffView", () => {
  it("paints one row per hunk line", () => {
    const { container } = render(<DiffView hunks={[EDIT_HUNK]} />);
    expect(container.querySelectorAll(".diff-line")).toHaveLength(3);
  });

  it("tags add / del / ctx with distinct classes", () => {
    const { container } = render(<DiffView hunks={[EDIT_HUNK]} />);
    expect(container.querySelectorAll(".diff-line--add")).toHaveLength(1);
    expect(container.querySelectorAll(".diff-line--del")).toHaveLength(1);
    expect(container.querySelectorAll(".diff-line--ctx")).toHaveLength(1);
  });

  it("paints + on additions and − on deletions", () => {
    const { container } = render(<DiffView hunks={[EDIT_HUNK]} />);
    const signOf = (cls: string) =>
      container.querySelector(`${cls} .diff-line__sign`)?.textContent?.trim();
    expect(signOf(".diff-line--add")).toBe("+");
    expect(signOf(".diff-line--del")).toBe(MINUS);
    // Context lines carry no sign glyph.
    expect(signOf(".diff-line--ctx")).toBe("");
  });

  it("shows line numbers in the gutters — old for del, new for add, both for ctx", () => {
    const { container } = render(<DiffView hunks={[EDIT_HUNK]} />);
    const gutters = (cls: string) =>
      [...container.querySelectorAll(`${cls} .diff-line__gutter`)].map(
        (g) => g.textContent,
      );
    expect(gutters(".diff-line--ctx")).toEqual(["1", "1"]);
    expect(gutters(".diff-line--del")).toEqual(["2", ""]);
    expect(gutters(".diff-line--add")).toEqual(["", "2"]);
  });

  it("paints only the hunks it receives (no diffing here)", () => {
    const { container } = render(<DiffView hunks={[EDIT_HUNK, ADD_HUNK]} />);
    expect(container.querySelectorAll(".diff-hunk")).toHaveLength(2);
    // 3 lines from EDIT_HUNK + 1 from ADD_HUNK.
    expect(container.querySelectorAll(".diff-line")).toHaveLength(4);
  });

  it("renders a notice for a truncated result and paints no lines", () => {
    const { container } = render(<DiffView hunks={[]} truncated />);
    expect(container.querySelector(".diff-view--notice")).not.toBeNull();
    expect(container.querySelectorAll(".diff-line")).toHaveLength(0);
  });

  it("renders a 'no changes' notice for zero hunks", () => {
    const { container } = render(<DiffView hunks={[]} />);
    const notice = container.querySelector(".diff-view--notice");
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("Sem alterações");
  });

  it("renders a notice (never a blank) for a hunk with zero lines — an empty file", () => {
    // `diff-hunks` keeps an empty body as a hunk with no lines so the view can
    // tell "created an empty file" from "nothing changed" (zero hunks). Painting
    // it as a blank hunk div would hide the change; show an explicit notice.
    const EMPTY_FILE_HUNK: DiffHunk = {
      oldStart: 0,
      oldLines: 0,
      newStart: 0,
      newLines: 0,
      lines: [],
    };
    const { container } = render(<DiffView hunks={[EMPTY_FILE_HUNK]} />);
    const notice = container.querySelector(".diff-view--notice");
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("Arquivo vazio");
    // No blank hunk/line survives.
    expect(container.querySelectorAll(".diff-line")).toHaveLength(0);
    expect(container.querySelectorAll(".diff-hunk")).toHaveLength(0);
  });

  it("shows the empty-file notice for a real created-empty-file diff", () => {
    // The end-to-end contract: `computeDiffHunks(undefined, "")` (a new, empty
    // file) is one zero-line hunk — DiffView must surface it, not blank out.
    const { hunks, truncated } = computeDiffHunks(undefined, "");
    const { container } = render(
      <DiffView hunks={hunks} truncated={truncated} />,
    );
    const notice = container.querySelector(".diff-view--notice");
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("Arquivo vazio");
  });

  it("is reachable from the ui barrel", () => {
    // A `memo` component is an exotic object, not a plain function — assert the
    // barrel re-exports the same reference.
    expect(barrel.DiffView).toBe(DiffView);
  });
});
