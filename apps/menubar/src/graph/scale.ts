/**
 * Derived scale constants for the dependency graph (D2).
 *
 * Card dimensions and gutters are the **single source** for:
 *   (a) the cell→pixel math in {@link DepsFlow}
 *   (b) CSS vars `--deps-card-w` / `--deps-card-h` on the card (future)
 *
 * `CELL_PX_Y` is the tight constraint: stacked nodes in the same rank sit
 * `MIN_ROW_GAP` rows apart (1 node row + 1 empty row preserved by the
 * motor's `MAX_EMPTY_ROWS` compaction), so `CELL_PX_Y` must map that gap
 * to at least `CARD_H + GUTTER_Y`.
 *
 * `CELL_PX_X` is relaxed: dagre already spaces ranks by char-width +
 * `ranksep:4`, so we just need each rank-step to clear `CARD_W`.
 */

// ── Card dimensions (D1) ────────────────────────────────────────────────
/** Card width in pixels (paridade com `.kanban-card`). */
export const CARD_W = 220;

/** Card height in pixels (dot + ID + título clamp 3 linhas ≈ 88px). */
export const CARD_H = 88;

// ── Gutters ─────────────────────────────────────────────────────────────
/** Vertical gap between cards in pixels. */
export const GUTTER_Y = 24;

/** Horizontal gap between cards in pixels. */
export const GUTTER_X = 40;

// ── Layout parameters ───────────────────────────────────────────────────
/**
 * Minimum row delta between stacked nodes in the same rank.
 * dagre + MAX_EMPTY_ROWS compaction produces at least this spacing
 * (1 row of node + 1 empty row preserved).
 */
export const MIN_ROW_GAP = 2;

/**
 * Minimum column delta between nodes in adjacent ranks (for short IDs).
 * dagre's `ranksep:4` + typical `nodeLabel` width guarantees at least this.
 */
export const MIN_RANK_COL_GAP = 5;

// ── Derived pixel-per-cell factors ──────────────────────────────────────
/**
 * Pixels per cell unit on the Y axis.
 * Tight constraint: `MIN_ROW_GAP * CELL_PX_Y >= CARD_H + GUTTER_Y`.
 */
export const CELL_PX_Y = (CARD_H + GUTTER_Y) / MIN_ROW_GAP;

/**
 * Pixels per cell unit on the X axis.
 * Relaxed: a rank-step of `MIN_RANK_COL_GAP` cells must clear `CARD_W`.
 */
export const CELL_PX_X = (CARD_W + GUTTER_X) / MIN_RANK_COL_GAP;

// ── Overlap helper ──────────────────────────────────────────────────────
/**
 * Returns `true` when two axis-aligned boxes of size `w × h` overlap
 * (strict interior intersection — touching edges are NOT overlap).
 */
export function boxesOverlap(
  a: { x: number; y: number },
  b: { x: number; y: number },
  w: number,
  h: number,
): boolean {
  return (
    Math.abs(a.x - b.x) < w &&
    Math.abs(a.y - b.y) < h
  );
}
