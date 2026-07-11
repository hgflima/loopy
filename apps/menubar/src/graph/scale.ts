// scale.ts — D2: derived scale constants for cell→px conversion
//
// Source of truth for card dimensions, gutter, and the cell-to-pixel factors
// consumed by DepsFlow (layout) and TaskNode CSS (--deps-card-w / --deps-card-h).
// No magic literals: CELL_PX_* are derived from named constants.

/** Card width in pixels (D1 — paridade com .kanban-card). */
export const CARD_W = 220;

/** Card height in pixels (D1 — título clamp 3 linhas ≈ 88px). */
export const CARD_H = 88;

/** Vertical gutter between cards (px). */
export const GUTTER_Y = 12;

/** Horizontal gutter between cards (px). */
export const GUTTER_X = 20;

/**
 * Minimum row gap between stacked nodes in the same rank (cell units).
 * dagre compaction (MAX_EMPTY_ROWS in the engine) preserves at least 1 empty
 * row between adjacent nodes → 1 node row + 1 empty = 2 rows minimum.
 */
export const MIN_ROW_GAP = 2;

/**
 * Minimum column delta between adjacent ranks for short task ids (cell units).
 * dagre uses ranksep:4 + node char-width; for short ids the snapped delta can
 * be as low as 2 columns. This is the adjustment lever if scale errs.
 */
export const MIN_RANK_COL_GAP = 2;

/**
 * Vertical pixels per cell row.
 * Derived so that MIN_ROW_GAP rows exactly span CARD_H + GUTTER_Y.
 */
export const CELL_PX_Y = (CARD_H + GUTTER_Y) / MIN_ROW_GAP;

/**
 * Horizontal pixels per cell column.
 * Derived so that MIN_RANK_COL_GAP columns exactly span CARD_W + GUTTER_X.
 */
export const CELL_PX_X = (CARD_W + GUTTER_X) / MIN_RANK_COL_GAP;

// ---------------------------------------------------------------------------
// boxesOverlap — axis-aligned intersection test
// ---------------------------------------------------------------------------

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Returns true if two axis-aligned boxes of size `w × h` placed at `a` and `b`
 * strictly overlap (touching edges are NOT considered overlap).
 */
export function boxesOverlap(a: Point, b: Point, w: number, h: number): boolean {
  return a.x < b.x + w && b.x < a.x + w && a.y < b.y + h && b.y < a.y + h;
}
