/**
 * Tests for sentence-split: conservative sentence-per-line splitter.
 *
 * Covers:
 * - Real sentence boundaries (`. ` + uppercase)
 * - Negative whitelist: abbreviations, versions, filenames, decimals, URLs,
 *   ellipses, Node.js and friends
 * - Preserves existing line breaks
 * - Empty / single-sentence input unchanged
 * - No split on `?` or `!`
 *
 * Run: `npm test -w apps/menubar -- sentence-split`
 */

import { describe, it, expect } from "vitest";
import { splitSentences } from "./sentence-split";

// ---------------------------------------------------------------------------
// Real sentence boundaries — should split
// ---------------------------------------------------------------------------

describe("splitSentences — real boundaries", () => {
  it("splits two sentences", () => {
    expect(splitSentences("Hello world. This is great.")).toBe(
      "Hello world.\nThis is great.",
    );
  });

  it("splits three sentences", () => {
    expect(splitSentences("One. Two. Three.")).toBe("One.\nTwo.\nThree.");
  });

  it("splits with multiple spaces after dot", () => {
    expect(splitSentences("First.  Second.")).toBe("First.\nSecond.");
  });

  it("splits with accented uppercase", () => {
    expect(splitSentences("Done. Última etapa.")).toBe(
      "Done.\nÚltima etapa.",
    );
  });
});

// ---------------------------------------------------------------------------
// Negative whitelist — should NOT split
// ---------------------------------------------------------------------------

describe("splitSentences — negative whitelist", () => {
  it("does not split on e.g.", () => {
    const input = "Use e.g. React for UIs.";
    expect(splitSentences(input)).toBe(input);
  });

  it("does not split on i.e.", () => {
    const input = "The engine i.e. The motor runs.";
    expect(splitSentences(input)).toBe(input);
  });

  it("does not split on vs.", () => {
    const input = "React vs. Vue comparison.";
    expect(splitSentences(input)).toBe(input);
  });

  it("does not split on etc.", () => {
    const input = "Colors, shapes, etc. More stuff.";
    expect(splitSentences(input)).toBe(input);
  });

  it("does not split on version numbers like v0.26", () => {
    const input = "Upgrade to v0.26. See changelog.";
    expect(splitSentences(input)).toBe(input);
  });

  it("does not split on filenames like session.ts", () => {
    const input = "Edit session.ts. Save it.";
    expect(splitSentences(input)).toBe(input);
  });

  it("does not split on decimals like 20.5", () => {
    const input = "The value is 20.5. No split.";
    expect(splitSentences(input)).toBe(input);
  });

  it("does not split on ellipsis ...", () => {
    const input = "Wait... Something happened.";
    expect(splitSentences(input)).toBe(input);
  });

  it("does not split on Node.js", () => {
    const input = "Use Node.js. It works well.";
    expect(splitSentences(input)).toBe(input);
  });

  it("does not split on Next.js", () => {
    const input = "Try Next.js. Build fast.";
    expect(splitSentences(input)).toBe(input);
  });

  it("does not split inside URLs", () => {
    const input = "Visit https://example.com. Read more.";
    expect(splitSentences(input)).toBe(input);
  });

  it("does not split on Dr.", () => {
    const input = "Talk to Dr. Smith about it.";
    expect(splitSentences(input)).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// No split on ? or !
// ---------------------------------------------------------------------------

describe("splitSentences — no split on ? or !", () => {
  it("does not split on question mark", () => {
    const input = "Is this right? Yes it is.";
    expect(splitSentences(input)).toBe(input);
  });

  it("does not split on exclamation mark", () => {
    const input = "Great! Now do this.";
    expect(splitSentences(input)).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("splitSentences — edge cases", () => {
  it("returns empty string unchanged", () => {
    expect(splitSentences("")).toBe("");
  });

  it("returns single sentence unchanged", () => {
    const input = "Just one sentence.";
    expect(splitSentences(input)).toBe(input);
  });

  it("returns dot without following uppercase unchanged", () => {
    const input = "end. no uppercase here.";
    expect(splitSentences(input)).toBe(input);
  });

  it("preserves existing line breaks", () => {
    const input = "Line one.\nLine two. Line three.";
    expect(splitSentences(input)).toBe("Line one.\nLine two.\nLine three.");
  });

  it("handles mixed real boundaries and whitelist items", () => {
    const input = "Use Node.js for the backend. The version is v0.26. Start now.";
    // Node.js → no split, v0.26 → no split (filename match on "26" or version)
    // "backend." + " The" → real split; "v0.26." + " Start" → no split (version)
    expect(splitSentences(input)).toBe(
      "Use Node.js for the backend.\nThe version is v0.26. Start now.",
    );
  });
});
