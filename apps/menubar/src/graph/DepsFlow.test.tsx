import { describe, it, expect, vi } from "vitest";
import { computeDagreLayout, type GraphGeometry } from "loopy/tui/view";
import type { TaskStatus, TaskState } from "loopy/tui/store";

// ---------------------------------------------------------------------------
// Mock — capture ReactFlow props for assertion
// ---------------------------------------------------------------------------

interface CapturedNode {
  id: string;
  position: { x: number; y: number };
  data: { status: TaskStatus; tick: number };
}
interface CapturedEdge {
  id: string;
  source: string;
  target: string;
}

let captured: { nodes: CapturedNode[]; edges: CapturedEdge[] } = {
  nodes: [],
  edges: [],
};

vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: { nodes: CapturedNode[]; edges: CapturedEdge[] }) => {
    captured = { nodes: props.nodes, edges: props.edges };
    return null;
  },
  Handle: () => null,
  Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
}));

const { DepsFlow } = await import("./DepsFlow");
const { render } = await import("@testing-library/react");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function task(id: string, status: TaskStatus = "pending"): TaskState {
  return { id, title: id, status, steps: [], stream: "" };
}

const CELL_PX_X = 120;
const CELL_PX_Y = 50;

/** Compute geometry from tasks+edges (same inputs DepsFlow uses internally). */
function geometry(
  tasks: readonly TaskState[],
  edges: readonly [string, string][],
): GraphGeometry {
  const statusById = new Map<string, TaskStatus>(
    tasks.map((t) => [t.id, t.status]),
  );
  return computeDagreLayout(
    edges,
    statusById,
    tasks.map((t) => t.id),
  );
}

// ---------------------------------------------------------------------------
// Layout positions match computeDagreLayout (SC #4)
// ---------------------------------------------------------------------------

describe("DepsFlow — positions from computeDagreLayout", () => {
  it("node positions are cell coords × pixel scale factor", () => {
    const tasks = [task("T-001"), task("T-002"), task("T-003")];
    const edges: [string, string][] = [
      ["T-001", "T-002"],
      ["T-001", "T-003"],
    ];
    const geo = geometry(tasks, edges);

    render(<DepsFlow tasks={tasks} edges={edges} tick={0} />);

    for (const gn of geo.nodes) {
      const rfNode = captured.nodes.find((n) => n.id === gn.id);
      expect(rfNode, `RF node for ${gn.id}`).toBeTruthy();
      expect(rfNode!.position).toEqual({
        x: gn.col * CELL_PX_X,
        y: gn.row * CELL_PX_Y,
      });
    }
    expect(captured.nodes.length).toBe(geo.nodes.length);
  });

  it("passes empty nodes/edges when tasks array is empty", () => {
    render(<DepsFlow tasks={[]} edges={[]} tick={0} />);
    expect(captured.nodes).toHaveLength(0);
    expect(captured.edges).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Edges from StoreState.edges
// ---------------------------------------------------------------------------

describe("DepsFlow — edges from StoreState.edges", () => {
  it("creates RF edges matching the geometry edges (from→to)", () => {
    const tasks = [task("T-001"), task("T-002"), task("T-003")];
    const edges: [string, string][] = [
      ["T-001", "T-002"],
      ["T-001", "T-003"],
    ];
    const geo = geometry(tasks, edges);

    render(<DepsFlow tasks={tasks} edges={edges} tick={0} />);

    for (const ge of geo.edges) {
      const rfEdge = captured.edges.find(
        (e) => e.source === ge.from && e.target === ge.to,
      );
      expect(rfEdge, `RF edge ${ge.from}→${ge.to}`).toBeTruthy();
    }
    expect(captured.edges.length).toBe(geo.edges.length);
  });
});

// ---------------------------------------------------------------------------
// Node data carries status + tick
// ---------------------------------------------------------------------------

describe("DepsFlow — node data", () => {
  it("each RF node data contains correct status and tick", () => {
    const tasks = [task("T-001", "running"), task("T-002", "done")];
    render(<DepsFlow tasks={tasks} edges={[["T-001", "T-002"]]} tick={42} />);

    const n1 = captured.nodes.find((n) => n.id === "T-001")!;
    expect(n1.data.status).toBe("running");
    expect(n1.data.tick).toBe(42);

    const n2 = captured.nodes.find((n) => n.id === "T-002")!;
    expect(n2.data.status).toBe("done");
    expect(n2.data.tick).toBe(42);
  });
});
