import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeDagreLayout, type GraphGeometry } from "loopy/tui/view";
import type { TaskStatus, TaskState } from "loopy/tui/store";

// ---------------------------------------------------------------------------
// Mock — capture ReactFlow props for assertion
// ---------------------------------------------------------------------------

interface CapturedNode {
  id: string;
  position: { x: number; y: number };
  data: {
    status: TaskStatus;
    tick: number;
    title?: string;
    selected?: boolean;
    isRunning?: boolean;
    failedAtStepId?: string;
    reducedMotion?: boolean;
    onSelect?: (id: string) => void;
    onFocusNode?: (id: string) => void;
  };
}
interface CapturedEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  animated?: boolean;
  className?: string;
  style?: Record<string, string>;
}

let captured: {
  nodes: CapturedNode[];
  edges: CapturedEdge[];
  nodesFocusable?: boolean;
  elementsSelectable?: boolean;
  onNodeClick?: (event: unknown, node: { id: string }) => void;
  onPaneClick?: (() => void) | undefined;
  onInit?: (instance: unknown) => void;
} = {
  nodes: [],
  edges: [],
};

let capturedChildren: string[] = [];

const mockFitView = vi.fn();
let mockNodesInitialized = false;

vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: {
    nodes: CapturedNode[];
    edges: CapturedEdge[];
    nodesFocusable?: boolean;
    elementsSelectable?: boolean;
    onNodeClick?: (event: unknown, node: { id: string }) => void;
    onPaneClick?: () => void;
    onInit?: (instance: unknown) => void;
    children?: React.ReactNode;
  }) => {
    captured = {
      nodes: props.nodes,
      edges: props.edges,
      nodesFocusable: props.nodesFocusable,
      elementsSelectable: props.elementsSelectable,
      onNodeClick: props.onNodeClick,
      onPaneClick: props.onPaneClick,
      onInit: props.onInit,
    };
    return props.children ?? null;
  },
  Background: () => {
    capturedChildren.push("Background");
    return null;
  },
  BackgroundVariant: { Dots: "dots", Lines: "lines", Cross: "cross" },
  Controls: () => {
    capturedChildren.push("Controls");
    return null;
  },
  Handle: () => null,
  Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
  useReactFlow: () => ({ fitView: mockFitView }),
  useNodesInitialized: () => mockNodesInitialized,
}));

let mockReducedMotion = false;
vi.mock("../ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ui")>();
  return {
    ...actual,
    usePrefersReducedMotion: () => mockReducedMotion,
  };
});

const { DepsFlow } = await import("./DepsFlow");
const { render } = await import("@testing-library/react");
const { CELL_PX_X, CELL_PX_Y, CARD_W, CARD_H, boxesOverlap } = await import("./scale");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function task(id: string, status: TaskStatus = "pending"): TaskState {
  return { id, title: id, status, steps: [], stream: "" };
}

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

beforeEach(() => {
  captured = { nodes: [], edges: [] };
  capturedChildren = [];
  mockFitView.mockClear();
  mockNodesInitialized = false;
  mockReducedMotion = false;
});

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
// Edges — smoothstep type + running incident animation (D3)
// ---------------------------------------------------------------------------

describe("DepsFlow — edge type and running animation (D3)", () => {
  it("all edges use type smoothstep", () => {
    const tasks = [task("T-001"), task("T-002"), task("T-003")];
    const edges: [string, string][] = [
      ["T-001", "T-002"],
      ["T-001", "T-003"],
    ];

    render(<DepsFlow tasks={tasks} edges={edges} tick={0} />);

    for (const e of captured.edges) {
      expect(e.type).toBe("smoothstep");
    }
  });

  it("edges incident to a running node are animated with running class", () => {
    const tasks = [
      task("T-001", "done"),
      task("T-002", "running"),
      task("T-003", "pending"),
    ];
    const edges: [string, string][] = [
      ["T-001", "T-002"],
      ["T-002", "T-003"],
    ];

    render(<DepsFlow tasks={tasks} edges={edges} tick={0} />);

    const e1 = captured.edges.find(
      (e) => e.source === "T-001" && e.target === "T-002",
    )!;
    expect(e1.animated).toBe(true);
    expect(e1.className).toContain("deps-edge--running");
    expect(e1.style?.stroke).toBe("var(--state-running)");

    const e2 = captured.edges.find(
      (e) => e.source === "T-002" && e.target === "T-003",
    )!;
    expect(e2.animated).toBe(true);
    expect(e2.className).toContain("deps-edge--running");
    expect(e2.style?.stroke).toBe("var(--state-running)");
  });

  it("edges NOT incident to a running node are quiet (no animated)", () => {
    const tasks = [
      task("T-001", "done"),
      task("T-002", "pending"),
      task("T-003", "running"),
    ];
    const edges: [string, string][] = [["T-001", "T-002"]];

    render(<DepsFlow tasks={tasks} edges={edges} tick={0} />);

    const e = captured.edges.find(
      (e) => e.source === "T-001" && e.target === "T-002",
    )!;
    expect(e.animated).toBeUndefined();
    expect(e.className).toBeUndefined();
    expect(e.style?.stroke).toBe("var(--border)");
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

// ---------------------------------------------------------------------------
// a11y — nodesFocusable=false + pan-to-focus (D5)
// ---------------------------------------------------------------------------

describe("DepsFlow — a11y (D5)", () => {
  it("nodesFocusable is false (native RF node focus disabled)", () => {
    const tasks = [task("T-001"), task("T-002")];
    render(<DepsFlow tasks={tasks} edges={[["T-001", "T-002"]]} tick={0} />);

    expect(captured.nodesFocusable).toBe(false);
  });

  it("each node data carries an onFocusNode callback", () => {
    const tasks = [task("T-001"), task("T-002")];
    render(<DepsFlow tasks={tasks} edges={[["T-001", "T-002"]]} tick={0} />);

    for (const n of captured.nodes) {
      expect(typeof n.data.onFocusNode).toBe("function");
    }
  });

  it("onFocusNode calls setCenter with node center position (pan-to-focus)", () => {
    const tasks = [task("T-001"), task("T-002"), task("T-003")];
    const edges: [string, string][] = [
      ["T-001", "T-002"],
      ["T-001", "T-003"],
    ];

    render(<DepsFlow tasks={tasks} edges={edges} tick={0} />);

    // Simulate onInit — provide a mock ReactFlow instance
    const mockSetCenter = vi.fn();
    const nodeMap = new Map(
      captured.nodes.map((n) => [n.id, { position: n.position }]),
    );
    const mockInstance = {
      setCenter: mockSetCenter,
      getNode: (id: string) => nodeMap.get(id) ?? null,
    };

    // Call onInit to register the instance
    expect(captured.onInit).toBeDefined();
    captured.onInit!(mockInstance);

    // Trigger onFocusNode for T-002
    const n2 = captured.nodes.find((n) => n.id === "T-002")!;
    n2.data.onFocusNode!("T-002");

    expect(mockSetCenter).toHaveBeenCalledTimes(1);
    const [x, y, opts] = mockSetCenter.mock.calls[0];
    // setCenter should target the center of the node (position + half card size)
    expect(x).toBe(n2.position.x + CARD_W / 2);
    expect(y).toBe(n2.position.y + CARD_H / 2);
    expect(opts).toEqual(expect.objectContaining({ duration: expect.any(Number) }));
  });

  it("onFocusNode is a no-op if instance is not yet initialized", () => {
    const tasks = [task("T-001")];
    render(<DepsFlow tasks={tasks} edges={[]} tick={0} />);

    // Do NOT call onInit — instance is null
    const n1 = captured.nodes.find((n) => n.id === "T-001")!;
    // Should not throw
    expect(() => n1.data.onFocusNode!("T-001")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Background and Controls are mounted
// ---------------------------------------------------------------------------

describe("DepsFlow — Background & Controls", () => {
  it("renders Background and Controls as children of ReactFlow", () => {
    const tasks = [task("T-001")];
    render(<DepsFlow tasks={tasks} edges={[]} tick={0} />);

    expect(capturedChildren).toContain("Background");
    expect(capturedChildren).toContain("Controls");
  });
});

// ---------------------------------------------------------------------------
// fitView — only on first reveal (active + nodesInitialized)
// ---------------------------------------------------------------------------

describe("DepsFlow — fitView on first reveal", () => {
  it("does NOT call fitView when active=false", () => {
    mockNodesInitialized = true;
    const tasks = [task("T-001")];
    render(<DepsFlow tasks={tasks} edges={[]} tick={0} active={false} />);

    expect(mockFitView).not.toHaveBeenCalled();
  });

  it("calls fitView once when active becomes true and nodes are initialized", () => {
    mockNodesInitialized = true;
    const tasks = [task("T-001")];
    const { rerender } = render(
      <DepsFlow tasks={tasks} edges={[]} tick={0} active={false} />,
    );

    expect(mockFitView).not.toHaveBeenCalled();

    rerender(<DepsFlow tasks={tasks} edges={[]} tick={0} active={true} />);
    expect(mockFitView).toHaveBeenCalledTimes(1);
  });

  it("does NOT re-fit on subsequent toggles", () => {
    mockNodesInitialized = true;
    const tasks = [task("T-001")];
    const { rerender } = render(
      <DepsFlow tasks={tasks} edges={[]} tick={0} active={true} />,
    );

    expect(mockFitView).toHaveBeenCalledTimes(1);

    rerender(<DepsFlow tasks={tasks} edges={[]} tick={0} active={false} />);
    rerender(<DepsFlow tasks={tasks} edges={[]} tick={0} active={true} />);

    expect(mockFitView).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Non-overlap: no two CARD_W×CARD_H boxes overlap (D2 guardrail)
// ---------------------------------------------------------------------------

describe("DepsFlow — non-overlap (D2)", () => {
  it("no two cards overlap in a DAG with stacking and adjacent ranks", () => {
    // Representative DAG: A fans out to B,C,D (stacked in same rank),
    // then B,C,D converge into E (adjacent rank after the stack).
    //
    //       ┌─► B ─┐
    //  A ───┼─► C ─┼──► E
    //       └─► D ─┘
    //
    const tasks = ["A", "B", "C", "D", "E"].map((id) => task(id));
    const edges: [string, string][] = [
      ["A", "B"],
      ["A", "C"],
      ["A", "D"],
      ["B", "E"],
      ["C", "E"],
      ["D", "E"],
    ];

    render(<DepsFlow tasks={tasks} edges={edges} tick={0} />);

    const positions = captured.nodes.map((n) => ({
      id: n.id,
      ...n.position,
    }));

    // For every pair, assert no overlap of CARD_W×CARD_H boxes
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i]!;
        const b = positions[j]!;
        expect(
          boxesOverlap(a, b, CARD_W, CARD_H),
          `cards ${a.id} (${a.x},${a.y}) and ${b.id} (${b.x},${b.y}) must not overlap ` +
            `(CARD_W=${CARD_W}, CARD_H=${CARD_H})`,
        ).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// T-006 — card data: title, failedAtStepId, isRunning, selected, reducedMotion
// ---------------------------------------------------------------------------

describe("DepsFlow — card data fields (T-006)", () => {
  it("each node data carries title from task.title", () => {
    const tasks = [
      { ...task("T-001"), title: "Setup infra" },
      { ...task("T-002"), title: "Build UI" },
    ];
    render(<DepsFlow tasks={tasks} edges={[["T-001", "T-002"]]} tick={0} />);

    expect(captured.nodes.find((n) => n.id === "T-001")!.data.title).toBe("Setup infra");
    expect(captured.nodes.find((n) => n.id === "T-002")!.data.title).toBe("Build UI");
  });

  it("isRunning is true only for running tasks", () => {
    const tasks = [task("T-001", "running"), task("T-002", "done")];
    render(<DepsFlow tasks={tasks} edges={[["T-001", "T-002"]]} tick={0} />);

    expect(captured.nodes.find((n) => n.id === "T-001")!.data.isRunning).toBe(true);
    expect(captured.nodes.find((n) => n.id === "T-002")!.data.isRunning).toBe(false);
  });

  it("failedAtStepId is set for escalated tasks with a failed step", () => {
    const escalatedTask: TaskState = {
      id: "T-001",
      title: "Broken",
      status: "escalated",
      steps: [
        { id: "build", type: "shell", status: "ok", checks: [] },
        { id: "test", type: "checks", status: "failed", checks: [] },
      ],
      stream: "",
    };
    const okTask = task("T-002", "done");
    render(<DepsFlow tasks={[escalatedTask, okTask]} edges={[["T-001", "T-002"]]} tick={0} />);

    expect(captured.nodes.find((n) => n.id === "T-001")!.data.failedAtStepId).toBe("test");
    expect(captured.nodes.find((n) => n.id === "T-002")!.data.failedAtStepId).toBeUndefined();
  });

  it("reducedMotion reflects the hook value", () => {
    mockReducedMotion = true;
    const tasks = [task("T-001")];
    render(<DepsFlow tasks={tasks} edges={[]} tick={0} />);

    expect(captured.nodes[0]!.data.reducedMotion).toBe(true);
  });

  it("selected is true only for node matching selectedTaskId", () => {
    const tasks = [task("T-001"), task("T-002"), task("T-003")];
    render(
      <DepsFlow tasks={tasks} edges={[]} tick={0} selectedTaskId="T-002" />,
    );

    expect(captured.nodes.find((n) => n.id === "T-001")!.data.selected).toBe(false);
    expect(captured.nodes.find((n) => n.id === "T-002")!.data.selected).toBe(true);
    expect(captured.nodes.find((n) => n.id === "T-003")!.data.selected).toBe(false);
  });

  it("each node data carries an onSelect callback", () => {
    const tasks = [task("T-001")];
    render(<DepsFlow tasks={tasks} edges={[]} tick={0} />);

    for (const n of captured.nodes) {
      expect(typeof n.data.onSelect).toBe("function");
    }
  });
});

// ---------------------------------------------------------------------------
// T-006 — onNodeClick → onSelectTask; onPaneClick is absent (no deselect)
// ---------------------------------------------------------------------------

describe("DepsFlow — selection + click (T-006)", () => {
  it("onNodeClick calls onSelectTask with the node id", () => {
    const spy = vi.fn();
    const tasks = [task("T-001"), task("T-002")];
    render(
      <DepsFlow tasks={tasks} edges={[["T-001", "T-002"]]} tick={0} onSelectTask={spy} />,
    );

    expect(captured.onNodeClick).toBeDefined();
    captured.onNodeClick!(new MouseEvent("click"), { id: "T-002" });
    expect(spy).toHaveBeenCalledWith("T-002");
  });

  it("onPaneClick is not wired (clicking empty canvas does not deselect)", () => {
    const spy = vi.fn();
    render(
      <DepsFlow tasks={[task("T-001")]} edges={[]} tick={0} onSelectTask={spy} />,
    );

    // onPaneClick should not be set (no-op = absent)
    expect(captured.onPaneClick).toBeUndefined();
  });

  it("elementsSelectable is true", () => {
    render(<DepsFlow tasks={[task("T-001")]} edges={[]} tick={0} />);
    expect(captured.elementsSelectable).toBe(true);
  });
});
