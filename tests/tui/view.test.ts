import { describe, expect, it } from "vitest";
import {
  attemptLabel,
  checkText,
  COLORS,
  layoutGraph,
  nodeLabel,
  prefixAgentLines,
  pulseFrame,
  renderGraph,
  streamTail,
  SYMBOLS,
} from "../../src/tui/view";
import type { GraphGeometry, StyledRow, StyledSpan } from "../../src/tui/view";
import type { CheckState, TaskStatus } from "../../src/tui/store";

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

/** All-pending status map for the given ids. */
function pendingMap(...ids: string[]): ReadonlyMap<string, TaskStatus> {
  return new Map(ids.map((id) => [id, "pending" as TaskStatus]));
}

/** Lookup map from a geometry's node list. */
function nodeMap(geo: GraphGeometry) {
  return new Map(geo.nodes.map((n) => [n.id, n]));
}

// ---------------------------------------------------------------------------
// attemptLabel — the `try k/max` display fed by the store's attempt fields
// ---------------------------------------------------------------------------

describe("attemptLabel", () => {
  it("renders `try k/max` when both attempt and max are set", () => {
    expect(attemptLabel({ attempt: 2, maxAttempts: 4 })).toBe("try 2/4");
  });

  it("renders `try k` when only the attempt is known (no verify ceiling)", () => {
    expect(attemptLabel({ attempt: 1, maxAttempts: undefined })).toBe("try 1");
  });

  it("is empty before any attempt has started", () => {
    expect(attemptLabel({ attempt: undefined, maxAttempts: undefined })).toBe(
      "",
    );
  });
});

// ---------------------------------------------------------------------------
// checkText — per-check status line (symbol + name)
// ---------------------------------------------------------------------------

describe("checkText", () => {
  const check = (status: CheckState["status"]): CheckState => ({
    name: "typecheck",
    status,
  });

  it("pairs the passed symbol with the name", () => {
    expect(checkText(check("passed"))).toBe(
      `${SYMBOLS.check.passed} typecheck`,
    );
  });

  it("pairs the failed symbol with the name", () => {
    expect(checkText(check("failed"))).toBe(
      `${SYMBOLS.check.failed} typecheck`,
    );
  });

  it("pairs the running symbol with the name", () => {
    expect(checkText(check("running"))).toBe(
      `${SYMBOLS.check.running} typecheck`,
    );
  });
});

// ---------------------------------------------------------------------------
// streamTail — the last N lines of accumulated agent stream text
// ---------------------------------------------------------------------------

describe("streamTail", () => {
  it("returns an empty array for empty text", () => {
    expect(streamTail("", 8)).toEqual([]);
  });

  it("keeps only the last `maxLines` lines", () => {
    expect(streamTail("a\nb\nc\nd", 2)).toEqual(["c", "d"]);
  });

  it("returns every line when under the limit", () => {
    expect(streamTail("a\nb", 8)).toEqual(["a", "b"]);
  });

  it("drops trailing blank lines so a fresh newline is not a phantom row", () => {
    expect(streamTail("x\n\n", 8)).toEqual(["x"]);
  });

  it("preserves interior blank lines", () => {
    expect(streamTail("a\n\nb", 8)).toEqual(["a", "", "b"]);
  });
});

// ---------------------------------------------------------------------------
// prefixAgentLines — T-008: prefix stream lines with [agent] when multi-agent
// ---------------------------------------------------------------------------

describe("prefixAgentLines", () => {
  it("prefixes each line with [agent] when multiAgent is true", () => {
    expect(prefixAgentLines(["a", "b"], "codex", true)).toEqual([
      "[codex] a",
      "[codex] b",
    ]);
  });

  it("returns lines unchanged when multiAgent is false (single-agent)", () => {
    const lines = ["hello", "world"];
    expect(prefixAgentLines(lines, "claude", false)).toEqual(lines);
  });

  it("returns lines unchanged when agent is undefined", () => {
    const lines = ["foo"];
    expect(prefixAgentLines(lines, undefined, true)).toEqual(lines);
  });

  it("returns empty array for empty input", () => {
    expect(prefixAgentLines([], "codex", true)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Symbol / color tables — one entry per status, keyed by the store's unions
// ---------------------------------------------------------------------------

describe("SYMBOLS / COLORS", () => {
  it("covers every task status with a symbol and a color", () => {
    for (const status of [
      "pending", "blocked", "running", "done",
      "escalated", "skipped", "paused",
    ] as const) {
      expect(SYMBOLS.task[status]).toBeTruthy();
      expect(COLORS.task[status]).toBeTruthy();
    }
  });

  it("maps amarelo=aguardando (pending/blocked yellow)", () => {
    expect(COLORS.task.pending).toBe("yellow");
    expect(COLORS.task.blocked).toBe("yellow");
  });

  it("maps vermelho=falhou (escalated red)", () => {
    expect(COLORS.task.escalated).toBe("red");
  });

  it("keeps running=cyan and done=green", () => {
    expect(COLORS.task.running).toBe("cyan");
    expect(COLORS.task.done).toBe("green");
  });

  it("maps skipped→gray and paused→magenta", () => {
    expect(COLORS.task.skipped).toBe("gray");
    expect(COLORS.task.paused).toBe("magenta");
  });

  it("keeps SYMBOLS.task unchanged", () => {
    expect(SYMBOLS.task).toEqual({
      pending: "•", blocked: "◦", running: "▶", done: "✔",
      escalated: "✖", skipped: "⊘", paused: "⏸",
    });
  });

  it("covers every check status with a symbol and a color", () => {
    for (const status of ["running", "passed", "failed"] as const) {
      expect(SYMBOLS.check[status]).toBeTruthy();
      expect(COLORS.check[status]).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// pulseFrame — deterministic on/off alternation per tick
// ---------------------------------------------------------------------------

describe("pulseFrame", () => {
  it("returns 'on' for even ticks", () => {
    expect(pulseFrame(0)).toBe("on");
    expect(pulseFrame(2)).toBe("on");
    expect(pulseFrame(100)).toBe("on");
  });

  it("returns 'off' for odd ticks", () => {
    expect(pulseFrame(1)).toBe("off");
    expect(pulseFrame(3)).toBe("off");
    expect(pulseFrame(99)).toBe("off");
  });
});

// ---------------------------------------------------------------------------
// nodeLabel — glyph + id
// ---------------------------------------------------------------------------

describe("nodeLabel", () => {
  it("formats glyph + space + id", () => {
    expect(nodeLabel("T-001", "pending")).toBe("• T-001");
    expect(nodeLabel("A", "running")).toBe("▶ A");
    expect(nodeLabel("X", "done")).toBe("✔ X");
  });
});

// ---------------------------------------------------------------------------
// layoutGraph — dagre layout → cell-snapped geometry (T-003)
// ---------------------------------------------------------------------------

describe("layoutGraph", () => {
  it("returns empty geometry for no nodes", () => {
    const geo = layoutGraph([], new Map(), []);
    expect(geo.nodes).toEqual([]);
    expect(geo.edges).toEqual([]);
    expect(geo.width).toBe(0);
    expect(geo.height).toBe(0);
  });

  it("places a single node at (0,0)", () => {
    const geo = layoutGraph([], pendingMap("A"), ["A"]);
    expect(geo.nodes).toHaveLength(1);
    const a = geo.nodes[0]!;
    expect(a.id).toBe("A");
    expect(a.col).toBe(0);
    expect(a.row).toBe(0);
    expect(a.width).toBe(nodeLabel("A", "pending").length);
  });

  it("places linear chain A→B→C in successive layers (cols increase)", () => {
    const geo = layoutGraph(
      [["A", "B"], ["B", "C"]],
      pendingMap("A", "B", "C"),
      ["A", "B", "C"],
    );
    const m = nodeMap(geo);
    expect(m.get("A")!.col).toBeLessThan(m.get("B")!.col);
    expect(m.get("B")!.col).toBeLessThan(m.get("C")!.col);
  });

  it("places diamond A→{B,C}→D with B,C in the same layer and D last", () => {
    const geo = layoutGraph(
      [["A", "B"], ["A", "C"], ["B", "D"], ["C", "D"]],
      pendingMap("A", "B", "C", "D"),
      ["A", "B", "C", "D"],
    );
    const m = nodeMap(geo);
    // A first layer
    expect(m.get("A")!.col).toBeLessThan(m.get("B")!.col);
    // B and C same layer (same col)
    expect(m.get("B")!.col).toBe(m.get("C")!.col);
    // D last layer
    expect(m.get("B")!.col).toBeLessThan(m.get("D")!.col);
  });

  it("respects backlog order for within-rank tie-breaking (B above C)", () => {
    const geo = layoutGraph(
      [["A", "B"], ["A", "C"], ["B", "D"], ["C", "D"]],
      pendingMap("A", "B", "C", "D"),
      ["A", "B", "C", "D"],
    );
    const m = nodeMap(geo);
    expect(m.get("B")!.row).toBeLessThan(m.get("C")!.row);
  });

  it("generates edge segments between nodes", () => {
    const geo = layoutGraph(
      [["A", "B"]],
      pendingMap("A", "B"),
      ["A", "B"],
    );
    expect(geo.edges).toHaveLength(1);
    const edge = geo.edges[0]!;
    expect(edge.from).toBe("A");
    expect(edge.to).toBe("B");
    expect(edge.segments.length).toBeGreaterThan(0);
  });

  it("produces a direction-aware arrowhead (▸) at the end of a rightward edge", () => {
    const geo = layoutGraph(
      [["A", "B"]],
      pendingMap("A", "B"),
      ["A", "B"],
    );
    const edge = geo.edges[0]!;
    const last = edge.segments[edge.segments.length - 1]!;
    // Small triangle — distinct from the node's own running glyph (▶) so an
    // edge arriving at a running node never reads as a double arrow.
    expect(last.char).toBe("▸");
  });

  it("leaves a blank gap between the arrowhead and the target node", () => {
    const geo = layoutGraph([["A", "B"]], pendingMap("A", "B"), ["A", "B"]);
    const b = nodeMap(geo).get("B")!;
    const edge = geo.edges[0]!;
    const last = edge.segments[edge.segments.length - 1]!;
    // The arrowhead sits at least one cell to the left of the node (not flush).
    expect(last.col).toBeLessThan(b.col - 1);
    expect(last.row).toBe(b.row);
  });

  it("edge segments do not overlap with node cells", () => {
    const geo = layoutGraph(
      [["A", "B"], ["A", "C"], ["B", "D"], ["C", "D"]],
      pendingMap("A", "B", "C", "D"),
      ["A", "B", "C", "D"],
    );
    for (const edge of geo.edges) {
      for (const seg of edge.segments) {
        for (const n of geo.nodes) {
          const inNode =
            seg.row === n.row && seg.col >= n.col && seg.col < n.col + n.width;
          expect(inNode).toBe(false);
        }
      }
    }
  });

  it("node widths match the label length", () => {
    const statuses = new Map<string, TaskStatus>([
      ["A", "running"],
      ["B", "done"],
    ]);
    const geo = layoutGraph([["A", "B"]], statuses, ["A", "B"]);
    const m = nodeMap(geo);
    expect(m.get("A")!.width).toBe(nodeLabel("A", "running").length);
    expect(m.get("B")!.width).toBe(nodeLabel("B", "done").length);
  });

  it("all coordinates are non-negative integers", () => {
    const geo = layoutGraph(
      [["A", "B"], ["A", "C"], ["B", "D"], ["C", "D"]],
      pendingMap("A", "B", "C", "D"),
      ["A", "B", "C", "D"],
    );
    for (const n of geo.nodes) {
      expect(n.col).toBeGreaterThanOrEqual(0);
      expect(n.row).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(n.col)).toBe(true);
      expect(Number.isInteger(n.row)).toBe(true);
    }
    for (const e of geo.edges) {
      for (const s of e.segments) {
        expect(s.col).toBeGreaterThanOrEqual(0);
        expect(s.row).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(s.col)).toBe(true);
        expect(Number.isInteger(s.row)).toBe(true);
      }
    }
  });

  it("geometry dimensions bound all content", () => {
    const geo = layoutGraph(
      [["A", "B"], ["B", "C"]],
      pendingMap("A", "B", "C"),
      ["A", "B", "C"],
    );
    for (const n of geo.nodes) {
      expect(n.col + n.width).toBeLessThanOrEqual(geo.width);
      expect(n.row + 1).toBeLessThanOrEqual(geo.height);
    }
    for (const e of geo.edges) {
      for (const s of e.segments) {
        expect(s.col + 1).toBeLessThanOrEqual(geo.width);
        expect(s.row + 1).toBeLessThanOrEqual(geo.height);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// renderGraph — geometry → styled rows (T-003)
// ---------------------------------------------------------------------------

describe("renderGraph", () => {
  /** Flatten a StyledRow into a plain string. */
  function rowText(row: StyledRow): string {
    return row.map((s) => s.text).join("");
  }

  /** Find all spans whose text contains the given substring. */
  function findSpans(
    rows: StyledRow[],
    substring: string,
  ): StyledSpan[] {
    const found: StyledSpan[] = [];
    for (const row of rows) {
      for (const span of row) {
        if (span.text.includes(substring)) found.push(span);
      }
    }
    return found;
  }

  /** Build a simple 2-node geometry for render tests. */
  function twoNodeSetup(statusA: TaskStatus, statusB: TaskStatus) {
    const statuses = new Map<string, TaskStatus>([
      ["A", statusA],
      ["B", statusB],
    ]);
    const geo = layoutGraph([["A", "B"]], statuses, ["A", "B"]);
    return { geo, statuses };
  }

  it("produces rows matching geometry height (or less when clipped)", () => {
    const { geo, statuses } = twoNodeSetup("pending", "done");
    const rows = renderGraph(geo, statuses, 0, { width: 80, height: 24 });
    expect(rows.length).toBe(geo.height);
  });

  it("colors nodes by task status", () => {
    const { geo, statuses } = twoNodeSetup("pending", "done");
    const rows = renderGraph(geo, statuses, 0, { width: 80, height: 24 });

    const aParts = findSpans(rows, SYMBOLS.task.pending);
    expect(aParts.length).toBeGreaterThan(0);
    expect(aParts[0]!.color).toBe(COLORS.task.pending);

    const bParts = findSpans(rows, SYMBOLS.task.done);
    expect(bParts.length).toBeGreaterThan(0);
    expect(bParts[0]!.color).toBe(COLORS.task.done);
  });

  it("applies bold on even tick for running nodes (pulse on)", () => {
    const statuses = new Map<string, TaskStatus>([
      ["A", "running"],
      ["B", "pending"],
    ]);
    const geo = layoutGraph([["A", "B"]], statuses, ["A", "B"]);
    const rows = renderGraph(geo, statuses, 0, { width: 80, height: 24 });

    const runSpans = findSpans(rows, SYMBOLS.task.running);
    expect(runSpans.length).toBeGreaterThan(0);
    expect(runSpans[0]!.bold).toBe(true);
    expect(runSpans[0]!.dim).toBeUndefined();
  });

  it("applies dim on odd tick for running nodes (pulse off)", () => {
    const statuses = new Map<string, TaskStatus>([
      ["A", "running"],
      ["B", "pending"],
    ]);
    const geo = layoutGraph([["A", "B"]], statuses, ["A", "B"]);
    const rows = renderGraph(geo, statuses, 1, { width: 80, height: 24 });

    const runSpans = findSpans(rows, SYMBOLS.task.running);
    expect(runSpans.length).toBeGreaterThan(0);
    expect(runSpans[0]!.dim).toBe(true);
    expect(runSpans[0]!.bold).toBeUndefined();
  });

  it("renders edges as dim spans", () => {
    const { geo, statuses } = twoNodeSetup("pending", "pending");
    const rows = renderGraph(geo, statuses, 0, { width: 80, height: 24 });

    // At least one dim span should exist (the edge)
    const dimSpans = rows.flatMap((row) => row.filter((s) => s.dim === true));
    expect(dimSpans.length).toBeGreaterThan(0);
  });

  it("clips output to panel size", () => {
    const { geo, statuses } = twoNodeSetup("pending", "pending");
    const tiny = { width: 5, height: 1 };
    const rows = renderGraph(geo, statuses, 0, tiny);
    expect(rows.length).toBeLessThanOrEqual(tiny.height);
    for (const row of rows) {
      const w = row.reduce((sum, s) => sum + s.text.length, 0);
      expect(w).toBeLessThanOrEqual(tiny.width);
    }
  });

  it("returns empty array when panel has zero size", () => {
    const { geo, statuses } = twoNodeSetup("pending", "pending");
    expect(renderGraph(geo, statuses, 0, { width: 0, height: 0 })).toEqual([]);
  });

  it("renders box-drawing characters for edges in diamond graph", () => {
    const statuses = pendingMap("A", "B", "C", "D");
    const geo = layoutGraph(
      [["A", "B"], ["A", "C"], ["B", "D"], ["C", "D"]],
      statuses,
      ["A", "B", "C", "D"],
    );
    const rows = renderGraph(geo, statuses, 0, {
      width: geo.width,
      height: geo.height,
    });

    // Flatten all text to verify box-drawing characters appear
    const allText = rows.map(rowText).join("\n");
    // At least one of ─│┌┐└┘▶ should appear
    expect(/[─│┌┐└┘▶]/.test(allText)).toBe(true);
  });

  it("is pure — calling with same inputs produces identical output", () => {
    const statuses = pendingMap("A", "B", "C");
    const geo = layoutGraph(
      [["A", "B"], ["B", "C"]],
      statuses,
      ["A", "B", "C"],
    );
    const panel = { width: 80, height: 24 };
    const r1 = renderGraph(geo, statuses, 0, panel);
    const r2 = renderGraph(geo, statuses, 0, panel);
    expect(r1).toEqual(r2);
  });
});
