/**
 * Presentation helpers shared by the Ink components (T-017) and the line-log
 * fallback ({@link ../tui/line-reporter}). These are **pure** functions over the
 * store's value types — no React, no Ink, no I/O — so the display logic is unit
 * tested directly (AD-6: the TUI is validated through the store/state, not by
 * rendering pixels). The `.tsx` components stay thin wrappers that place these
 * strings into `<Text>`/`<Box>`; typecheck (`tsc`) is what proves the components.
 *
 * Keeping the symbol/color tables here (rather than inline in each component)
 * means the live TUI and the no-TTY line fallback speak the same visual
 * vocabulary — a check that "passed" reads `✓` in both.
 */
import { graphlib, layout as dagreLayout } from "@dagrejs/dagre";
import type { CheckState, CheckStatus, StepStatus, TaskStatus } from "./store";

// ---------------------------------------------------------------------------
// Symbol + color vocabulary — one entry per status union member
// ---------------------------------------------------------------------------

/** Status glyphs, keyed by the store's status unions (exhaustive by type). */
export const SYMBOLS: {
  readonly task: Readonly<Record<TaskStatus, string>>;
  readonly step: Readonly<Record<StepStatus, string>>;
  readonly check: Readonly<Record<CheckStatus, string>>;
} = {
  task: {
    pending: "•", blocked: "◦", running: "▶", done: "✔",
    escalated: "✖", skipped: "⊘", paused: "⏸",
  },
  step: { pending: "·", running: "→", ok: "✓", failed: "✗" },
  check: { running: "…", passed: "✓", failed: "✗" },
};

/** Ink `color` values, keyed by the same status unions. */
export const COLORS: {
  readonly task: Readonly<Record<TaskStatus, string>>;
  readonly step: Readonly<Record<StepStatus, string>>;
  readonly check: Readonly<Record<CheckStatus, string>>;
} = {
  task: {
    pending: "yellow", blocked: "yellow", running: "cyan", done: "green",
    escalated: "red", skipped: "gray", paused: "magenta",
  },
  step: { pending: "gray", running: "cyan", ok: "green", failed: "red" },
  check: { running: "yellow", passed: "green", failed: "red" },
};

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

/**
 * The `try k/max` label for a step's current inner-loop attempt (Success
 * Criterion #6). Empty before an attempt starts; drops the `/max` when the step
 * has no `verify` ceiling (`maxAttempts` unset), so a plain agent turn still
 * shows `try 1`.
 */
export function attemptLabel(step: {
  readonly attempt?: number;
  readonly maxAttempts?: number;
}): string {
  if (step.attempt === undefined) return "";
  return step.maxAttempts === undefined
    ? `try ${step.attempt}`
    : `try ${step.attempt}/${step.maxAttempts}`;
}

/** A single check rendered as `"<symbol> <name>"` (per-check status). */
export function checkText(check: CheckState): string {
  return `${SYMBOLS.check[check.status]} ${check.name}`;
}

/**
 * The last `maxLines` lines of accumulated agent stream text — what the live
 * {@link ../tui/components/StreamPane} shows for a running task. Trailing blank
 * lines (a stream that just emitted a newline) are dropped so they do not render
 * as phantom empty rows; interior blank lines are preserved.
 */
export function streamTail(text: string, maxLines = 8): string[] {
  if (text === "") return [];
  const lines = text.replace(/\n+$/, "").split("\n");
  return lines.slice(Math.max(0, lines.length - maxLines));
}

/**
 * Deterministic pulse phase for running-task animation. The `.tsx` component
 * maps `"on"` → `bold` and `"off"` → `dimColor` (or similar emphasis toggle).
 * Pure — no timer, no state; the caller drives the tick counter.
 */
export function pulseFrame(tick: number): "on" | "off" {
  return tick % 2 === 0 ? "on" : "off";
}

// ---------------------------------------------------------------------------
// Graph geometry types — cell-snapped DAG layout for the Graph pane (T-003)
// ---------------------------------------------------------------------------

/** Cell position of a node in the rendered graph (top-left corner). */
export interface NodeCell {
  readonly id: string;
  readonly col: number;
  readonly row: number;
  readonly width: number;
}

/** One cell of a rendered edge path (box-drawing character at grid position). */
export interface EdgeSegment {
  readonly col: number;
  readonly row: number;
  readonly char: string;
}

/** Full path of one edge between two nodes. */
export interface GraphEdgePath {
  readonly from: string;
  readonly to: string;
  readonly segments: readonly EdgeSegment[];
}

/**
 * Cell-snapped geometry of a DAG — all positions are integer cell coordinates.
 * Produced by {@link layoutGraph}, consumed by {@link renderGraph}.
 * Pure data, no I/O, renderer-agnostic (Ink and future Native UI share it).
 */
export interface GraphGeometry {
  readonly nodes: readonly NodeCell[];
  readonly edges: readonly GraphEdgePath[];
  readonly width: number;
  readonly height: number;
}

/** A styled text segment within a rendered row. */
export interface StyledSpan {
  readonly text: string;
  readonly color?: string;
  readonly bold?: boolean;
  readonly dim?: boolean;
}

/** One row of the rendered graph (array of styled spans). */
export type StyledRow = readonly StyledSpan[];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** The display label for a task node: `"<glyph> <id>"`. */
export function nodeLabel(id: string, status: TaskStatus): string {
  return `${SYMBOLS.task[status]} ${id}`;
}

type Dir = "left" | "right" | "up" | "down";

function dirBetween(
  from: { col: number; row: number },
  to: { col: number; row: number },
): Dir {
  const dc = to.col - from.col;
  const dr = to.row - from.row;
  if (Math.abs(dc) >= Math.abs(dr)) return dc >= 0 ? "right" : "left";
  return dr > 0 ? "down" : "up";
}

/**
 * Direction-aware arrowhead glyphs. Deliberately the *small* triangles
 * (`▸◂▴▾`), visually distinct from the node's own running glyph `▶`
 * ({@link SYMBOLS}.task.running) — so an edge arriving at a running node never
 * reads as a confusing double arrow (`▶▶`). Consistent with the send/recv
 * glyphs in the ACP pane.
 */
const ARROWHEADS: Record<Dir, string> = {
  right: "▸",
  left: "◂",
  up: "▴",
  down: "▾",
};

/** True when `cell` sits exactly one step orthogonally outside the node's box. */
function adjacentToNode(
  cell: { readonly col: number; readonly row: number },
  n: NodeCell,
): boolean {
  const onRow = cell.row === n.row;
  const inCols = cell.col >= n.col && cell.col < n.col + n.width;
  // Flush against the node's left/right on its row, or directly above/below it.
  if (onRow && (cell.col === n.col - 1 || cell.col === n.col + n.width)) {
    return true;
  }
  return inCols && (cell.row === n.row - 1 || cell.row === n.row + 1);
}

/** Box-drawing character for a cell with given incoming/outgoing directions. */
const BOX_CHAR: Record<string, string> = {
  "right-right": "─",
  "left-left": "─",
  "down-down": "│",
  "up-up": "│",
  "right-down": "┐",
  "right-up": "┘",
  "left-down": "┌",
  "left-up": "└",
  "down-right": "└",
  "down-left": "┘",
  "up-right": "┌",
  "up-left": "┐",
};

/**
 * Expand dagre waypoints into a cell-by-cell path.
 * Diagonal segments are broken into H-then-V.
 */
function expandPath(
  points: readonly { col: number; row: number }[],
): { col: number; row: number }[] {
  if (points.length < 2) return [...points];
  const path: { col: number; row: number }[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i]!;
    const q = points[i + 1]!;

    if (p.row === q.row) {
      const step = q.col > p.col ? 1 : -1;
      for (let c = p.col; c !== q.col; c += step) path.push({ col: c, row: p.row });
    } else if (p.col === q.col) {
      const step = q.row > p.row ? 1 : -1;
      for (let r = p.row; r !== q.row; r += step) path.push({ col: p.col, row: r });
    } else {
      // Diagonal: go H first, then V
      const hStep = q.col > p.col ? 1 : -1;
      for (let c = p.col; c !== q.col; c += hStep) path.push({ col: c, row: p.row });
      const vStep = q.row > p.row ? 1 : -1;
      for (let r = p.row; r !== q.row; r += vStep) path.push({ col: q.col, row: r });
    }
  }

  // Add final point
  path.push(points[points.length - 1]!);

  // Deduplicate consecutive identical cells
  const out: { col: number; row: number }[] = [path[0]!];
  for (let i = 1; i < path.length; i++) {
    const prev = out[out.length - 1]!;
    const curr = path[i]!;
    if (prev.col !== curr.col || prev.row !== curr.row) out.push(curr);
  }
  return out;
}

/** Convert a cell-by-cell path to EdgeSegments with box-drawing characters. */
function pathToSegments(
  path: readonly { col: number; row: number }[],
): EdgeSegment[] {
  if (path.length < 2) return [];
  const segs: EdgeSegment[] = [];

  for (let i = 0; i < path.length; i++) {
    const curr = path[i]!;
    let ch: string;

    if (i === 0) {
      const outDir = dirBetween(curr, path[i + 1]!);
      ch = outDir === "right" || outDir === "left" ? "─" : "│";
    } else if (i === path.length - 1) {
      const inDir = dirBetween(path[i - 1]!, curr);
      ch = inDir === "right" || inDir === "left" ? "─" : "│";
    } else {
      const inDir = dirBetween(path[i - 1]!, curr);
      const outDir = dirBetween(curr, path[i + 1]!);
      ch = BOX_CHAR[`${inDir}-${outDir}`] ?? "·";
    }
    segs.push({ col: curr.col, row: curr.row, char: ch });
  }
  return segs;
}

/** Check if a cell overlaps with any node rectangle. */
function overlapsNode(
  col: number,
  row: number,
  nodes: readonly NodeCell[],
): boolean {
  return nodes.some(
    (n) => row === n.row && col >= n.col && col < n.col + n.width,
  );
}

// ---------------------------------------------------------------------------
// layoutGraph — dagre ➜ cell-snapped GraphGeometry (T-003, AD-6)
// ---------------------------------------------------------------------------

/**
 * Build a DAG layout using dagre (`rankdir:"LR"`) and snap all positions to
 * integer cell coordinates. Pure — no I/O, no React.
 *
 * @param edges    Dependency edges `[dep, dependent]` (from `StoreState.edges`).
 * @param statusById  Task status by id (for glyph → node width).
 * @param order    Backlog order (for within-rank tie-breaking).
 */
export function layoutGraph(
  edges: readonly [string, string][],
  statusById: ReadonlyMap<string, TaskStatus>,
  order: readonly string[],
): GraphGeometry {
  // Collect all node ids
  const nodeIds = new Set<string>(order);
  for (const [f, t] of edges) {
    nodeIds.add(f);
    nodeIds.add(t);
  }

  if (nodeIds.size === 0) return { nodes: [], edges: [], width: 0, height: 0 };

  // Build dagre graph
  const g = new graphlib.Graph();
  g.setGraph({
    rankdir: "LR",
    nodesep: 1,
    ranksep: 4,
    marginx: 0,
    marginy: 0,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Add nodes — order-first for dagre rank stability, then any edge-only ids
  const addNode = (id: string) => {
    const w = nodeLabel(id, statusById.get(id) ?? "pending").length;
    g.setNode(id, { width: w, height: 1 });
  };
  for (const id of order) if (nodeIds.has(id)) addNode(id);
  for (const id of nodeIds) if (!g.hasNode(id)) addNode(id);

  // Add edges
  for (const [f, t] of edges) g.setEdge(f, t);

  // Build ordering constraints: consecutive backlog pairs → left-above-right
  const constraints: { left: string; right: string }[] = [];
  for (let i = 0; i < order.length - 1; i++) {
    if (nodeIds.has(order[i]!) && nodeIds.has(order[i + 1]!)) {
      constraints.push({ left: order[i]!, right: order[i + 1]! });
    }
  }

  dagreLayout(g, { constraints });

  // Snap nodes to cell grid
  const rawNodes: { id: string; col: number; row: number; width: number }[] =
    [];
  let minCol = Infinity;
  let minRow = Infinity;

  for (const id of g.nodes()) {
    const n = g.node(id);
    if (!n) continue;
    const col = Math.round(n.x - n.width / 2);
    const row = Math.round(n.y - 0.5);
    rawNodes.push({ id, col, row, width: n.width });
    minCol = Math.min(minCol, col);
    minRow = Math.min(minRow, row);
  }

  // Consider edge points in min bounds
  for (const e of g.edges()) {
    const edge = g.edge(e);
    if (!edge?.points) continue;
    for (const p of edge.points) {
      minCol = Math.min(minCol, Math.round(p.x));
      minRow = Math.min(minRow, Math.round(p.y - 0.5));
    }
  }

  if (!isFinite(minCol)) minCol = 0;
  if (!isFinite(minRow)) minRow = 0;

  // Normalize to 0-based and sort by backlog order
  const orderIdx = new Map(order.map((id, i) => [id, i]));
  const nodes: NodeCell[] = rawNodes
    .map((n) => ({
      id: n.id,
      col: n.col - minCol,
      row: n.row - minRow,
      width: n.width,
    }))
    .sort(
      (a, b) =>
        (orderIdx.get(a.id) ?? Infinity) - (orderIdx.get(b.id) ?? Infinity),
    );

  // Build edge paths
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edgePaths: GraphEdgePath[] = [];
  for (const e of g.edges()) {
    const edge = g.edge(e);
    if (!edge?.points) continue;

    // Snap waypoints
    const waypoints = edge.points.map((p: { x: number; y: number }) => ({
      col: Math.round(p.x) - minCol,
      row: Math.round(p.y - 0.5) - minRow,
    }));

    // Expand to cell path, convert to segments, filter node overlaps
    const cellPath = expandPath(waypoints);
    const allSegs = pathToSegments(cellPath);
    const segs = allSegs.filter((s) => !overlapsNode(s.col, s.row, nodes));

    // Reserve a blank cell between the edge and its target so the arrowhead is
    // never flush against the node ("seta rente"): drop the last segment when it
    // is orthogonally adjacent to the target, as long as another remains to
    // carry the arrowhead. Keep the dropped cell — it is the final step *into*
    // the node, so it names the arrowhead's direction.
    const target = nodeById.get(e.w);
    let entryCell: { readonly col: number; readonly row: number } | undefined;
    if (
      segs.length > 1 &&
      target &&
      adjacentToNode(segs[segs.length - 1]!, target)
    ) {
      entryCell = segs.pop();
    }

    // Place a direction-aware arrowhead on the (new) last segment — a small
    // triangle distinct from the node's own glyph. Point it toward the node: at
    // the reserved entry cell when we made a gap (robust for L-shaped
    // approaches), else at the target's anchor.
    if (segs.length > 0) {
      const last = segs[segs.length - 1]!;
      const dir = entryCell
        ? dirBetween(last, entryCell)
        : target
          ? dirBetween(last, { col: target.col, row: target.row })
          : "right";
      segs[segs.length - 1] = { ...last, char: ARROWHEADS[dir] };
    }

    edgePaths.push({ from: e.v, to: e.w, segments: segs });
  }

  // Compute bounding box
  let maxCol = 0;
  let maxRow = 0;
  for (const n of nodes) {
    maxCol = Math.max(maxCol, n.col + n.width);
    maxRow = Math.max(maxRow, n.row + 1);
  }
  for (const ep of edgePaths) {
    for (const s of ep.segments) {
      maxCol = Math.max(maxCol, s.col + 1);
      maxRow = Math.max(maxRow, s.row + 1);
    }
  }

  return { nodes, edges: edgePaths, width: maxCol, height: maxRow };
}

// ---------------------------------------------------------------------------
// renderGraph — GraphGeometry ➜ StyledRow[] (T-003, AD-6)
// ---------------------------------------------------------------------------

/**
 * Rasterize a {@link GraphGeometry} into styled rows for the Graph pane.
 * Pure — no I/O, no React. Clips output to `panelSize`.
 */
export function renderGraph(
  geometry: GraphGeometry,
  statusById: ReadonlyMap<string, TaskStatus>,
  tick: number,
  panelSize: { readonly width: number; readonly height: number },
): StyledRow[] {
  const cols = Math.min(geometry.width, panelSize.width);
  const rows = Math.min(geometry.height, panelSize.height);

  if (cols <= 0 || rows <= 0) return [];

  type Cell = { char: string; color?: string; bold?: boolean; dim?: boolean };
  type Style = Pick<Cell, "color" | "bold" | "dim">;
  const sameStyle = (a: Style, b: Style) =>
    a.color === b.color && a.bold === b.bold && a.dim === b.dim;

  const grid: Cell[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ char: " " })),
  );

  // Paint edge segments first (dim, so nodes paint over them)
  for (const edge of geometry.edges) {
    for (const seg of edge.segments) {
      if (seg.row >= 0 && seg.row < rows && seg.col >= 0 && seg.col < cols) {
        grid[seg.row]![seg.col] = { char: seg.char, dim: true };
      }
    }
  }

  // Paint node labels (colored by status, pulse for running)
  for (const node of geometry.nodes) {
    if (node.row < 0 || node.row >= rows) continue;
    const status = statusById.get(node.id) ?? "pending";
    const label = nodeLabel(node.id, status);
    const color = COLORS.task[status];
    const isRunning = status === "running";
    const phase = pulseFrame(tick);

    for (let i = 0; i < label.length; i++) {
      const c = node.col + i;
      if (c < 0 || c >= cols) continue;
      grid[node.row]![c] = {
        char: label[i]!,
        color,
        bold: isRunning && phase === "on" ? true : undefined,
        dim: isRunning && phase === "off" ? true : undefined,
      };
    }
  }

  // Convert grid to StyledRow[] by coalescing adjacent cells with same style
  const result: StyledRow[] = [];
  for (let r = 0; r < rows; r++) {
    const spans: StyledSpan[] = [];
    let cur: { text: string; color?: string; bold?: boolean; dim?: boolean } = {
      text: "",
    };

    for (let c = 0; c < cols; c++) {
      const cell = grid[r]![c]!;
      if (cur.text.length > 0 && sameStyle(cur, cell)) {
        cur.text += cell.char;
      } else {
        if (cur.text.length > 0) spans.push({ ...cur });
        cur = {
          text: cell.char,
          color: cell.color,
          bold: cell.bold,
          dim: cell.dim,
        };
      }
    }
    if (cur.text.length > 0) spans.push({ ...cur });
    result.push(spans);
  }

  return result;
}
