import { describe, it, expect } from "vitest";
import {
  CARD_W,
  CARD_H,
  GUTTER_Y,
  GUTTER_X,
  MIN_ROW_GAP,
  MIN_RANK_COL_GAP,
  CELL_PX_Y,
  CELL_PX_X,
  boxesOverlap,
} from "./scale.js";

// ---------------------------------------------------------------------------
// Derivation invariants (D2) — the scale must guarantee non-overlap
// ---------------------------------------------------------------------------

describe("scale derivation invariants", () => {
  it("vertical: MIN_ROW_GAP cells fit CARD_H + GUTTER_Y", () => {
    expect(MIN_ROW_GAP * CELL_PX_Y).toBeGreaterThanOrEqual(CARD_H + GUTTER_Y);
  });

  it("horizontal: MIN_RANK_COL_GAP cells fit CARD_W + GUTTER_X", () => {
    expect(MIN_RANK_COL_GAP * CELL_PX_X).toBeGreaterThanOrEqual(
      CARD_W + GUTTER_X,
    );
  });

  it("CELL_PX_Y is exactly (CARD_H + GUTTER_Y) / MIN_ROW_GAP", () => {
    expect(CELL_PX_Y).toBe((CARD_H + GUTTER_Y) / MIN_ROW_GAP);
  });

  it("CELL_PX_X is exactly (CARD_W + GUTTER_X) / MIN_RANK_COL_GAP", () => {
    expect(CELL_PX_X).toBe((CARD_W + GUTTER_X) / MIN_RANK_COL_GAP);
  });
});

// ---------------------------------------------------------------------------
// boxesOverlap — pure intersection test for two w×h boxes in flow coords
// ---------------------------------------------------------------------------

describe("boxesOverlap", () => {
  const w = CARD_W;
  const h = CARD_H;

  it("identical position → overlap", () => {
    expect(boxesOverlap({ x: 0, y: 0 }, { x: 0, y: 0 }, w, h)).toBe(true);
  });

  it("overlapping boxes → true", () => {
    expect(boxesOverlap({ x: 0, y: 0 }, { x: 100, y: 40 }, w, h)).toBe(true);
  });

  it("adjacent horizontally (touching edge) → false", () => {
    expect(boxesOverlap({ x: 0, y: 0 }, { x: w, y: 0 }, w, h)).toBe(false);
  });

  it("adjacent vertically (touching edge) → false", () => {
    expect(boxesOverlap({ x: 0, y: 0 }, { x: 0, y: h }, w, h)).toBe(false);
  });

  it("separated horizontally → false", () => {
    expect(boxesOverlap({ x: 0, y: 0 }, { x: w + 10, y: 0 }, w, h)).toBe(
      false,
    );
  });

  it("separated vertically → false", () => {
    expect(boxesOverlap({ x: 0, y: 0 }, { x: 0, y: h + 10 }, w, h)).toBe(
      false,
    );
  });

  it("overlap on one axis only (X) → false", () => {
    // X overlaps but Y does not
    expect(boxesOverlap({ x: 0, y: 0 }, { x: 50, y: h }, w, h)).toBe(false);
  });

  it("symmetric: order of a,b does not matter", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 40 };
    expect(boxesOverlap(a, b, w, h)).toBe(boxesOverlap(b, a, w, h));
  });
});
