import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeDagreLayout, type GraphGeometry } from "loopy/tui/view";
import type { TaskStatus, TaskState } from "loopy/tui/store";

// ---------------------------------------------------------------------------
// Mock — capture ReactFlow props for assertion
// ---------------------------------------------------------------------------

interface CapturedNode {
  id: string;
  position: { x: number; y: number };
  measured?: { width: number; height: number };
  data: {
    status: TaskStatus;
    tick: number;
    title?: string;
    selected?: boolean;
    isRunning?: boolean;
    onWavefront?: boolean;
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

/** The subset of React Flow's NodeChange we care about: the measured dimensions. */
interface DimensionsChange {
  id: string;
  type: "dimensions";
  dimensions: { width: number; height: number };
}

/** Props captured from the ReactFlow mock for assertion. */
interface CapturedProps {
  nodes: CapturedNode[];
  edges: CapturedEdge[];
  nodesFocusable?: boolean;
  elementsSelectable?: boolean;
  panOnDrag?: boolean;
  panOnScroll?: boolean;
  panOnScrollMode?: string;
  zoomOnScroll?: boolean;
  zoomOnPinch?: boolean;
  zoomOnDoubleClick?: boolean;
  preventScrolling?: boolean;
  minZoom?: number;
  panActivationKeyCode?: unknown;
  zoomActivationKeyCode?: unknown;
  onNodeClick?: (event: unknown, node: { id: string }) => void;
  onNodesChange?: (changes: readonly DimensionsChange[]) => void;
  onPaneClick?: (() => void) | undefined;
  onInit?: (instance: unknown) => void;
}

let captured: CapturedProps = { nodes: [], edges: [] };

let capturedChildren: string[] = [];

const mockFitView = vi.fn();
const mockGetViewport = vi.fn(() => ({ x: 0, y: 0, zoom: 1 }));
const mockSetViewport = vi.fn();
let mockNodesInitialized = false;

vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: CapturedProps & { children?: React.ReactNode }) => {
    const { children, ...rest } = props;
    captured = rest;
    return children ?? null;
  },
  PanOnScrollMode: { Free: "free", Vertical: "vertical", Horizontal: "horizontal" },
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
  useReactFlow: () => ({ fitView: mockFitView, getViewport: mockGetViewport, setViewport: mockSetViewport }),
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

function task(id: string, status: TaskStatus = "ready"): TaskState {
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
  mockGetViewport.mockClear();
  mockSetViewport.mockClear();
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
// Edges — directional flow: cyan enters, amber exits (D1/D2/D3)
// ---------------------------------------------------------------------------

describe("DepsFlow — edge direction and flow coloring (D1/D2/D3)", () => {
  it("all edges use type smoothstep", () => {
    const tasks = [task("A"), task("B"), task("C")];
    const edges: [string, string][] = [["A", "B"], ["B", "C"]];

    render(<DepsFlow tasks={tasks} edges={edges} tick={0} />);

    for (const e of captured.edges) {
      expect(e.type).toBe("smoothstep");
    }
  });

  // DAG: A → B → C, B is running
  // A→B feeds INTO running → cyan + animated (upstream)
  // B→C entra na frente de onda (C só espera por B) → amber + static
  it("A→B (feeds running) = cyan+animated; B→C (entra na frente) = amber+static", () => {
    const tasks = [task("A", "done"), task("B", "running"), task("C", "ready")];
    const edges: [string, string][] = [["A", "B"], ["B", "C"]];

    render(<DepsFlow tasks={tasks} edges={edges} tick={0} />);

    const ab = captured.edges.find((e) => e.source === "A" && e.target === "B")!;
    expect(ab.animated).toBe(true);
    expect(ab.className).toContain("deps-edge--running");
    expect(ab.style?.stroke).toBe("var(--state-running)");

    const bc = captured.edges.find((e) => e.source === "B" && e.target === "C")!;
    expect(bc.animated).toBeUndefined();
    expect(bc.className).toContain("deps-edge--next");
    expect(bc.style?.stroke).toBe("var(--state-blocked)");
  });

  // A regressão da tela: a aresta que SAI da running mas cujo destino ainda
  // espera outra dep não é "a próxima" — e portanto fica quieta.
  it("aresta que sai da running para quem ainda espera outra dep = --border", () => {
    const tasks = [task("A", "running"), task("B", "ready"), task("C", "blocked")];
    // C depende de A (running) e de B (nem começou) → C não é a próxima.
    const edges: [string, string][] = [["A", "C"], ["B", "C"]];

    render(<DepsFlow tasks={tasks} edges={edges} tick={0} />);

    const ac = captured.edges.find((e) => e.source === "A" && e.target === "C")!;
    expect(ac.animated).toBeUndefined();
    expect(ac.className).toBeUndefined();
    expect(ac.style?.stroke).toBe("var(--border)");
  });

  it("edge cujo destino não é a frente nem roda = --border, no class, no animated", () => {
    const tasks = [
      task("A", "done"),
      task("Z", "ready"),
      task("B", "blocked"),
      task("C", "running"),
    ];
    // B espera A (done) e Z (nem começou) → fora da frente; C roda longe daqui.
    const edges: [string, string][] = [["A", "B"], ["Z", "B"]];

    render(<DepsFlow tasks={tasks} edges={edges} tick={0} />);

    const ab = captured.edges.find((e) => e.source === "A" && e.target === "B")!;
    expect(ab.animated).toBeUndefined();
    expect(ab.className).toBeUndefined();
    expect(ab.style?.stroke).toBe("var(--border)");
  });

  // D2: tie — both A and B are running, edge A→B resolves to cyan+animated
  it("tie (both ends running) resolves to cyan + animated (D2)", () => {
    const tasks = [task("A", "running"), task("B", "running"), task("C", "ready")];
    const edges: [string, string][] = [["A", "B"], ["B", "C"]];

    render(<DepsFlow tasks={tasks} edges={edges} tick={0} />);

    const ab = captured.edges.find((e) => e.source === "A" && e.target === "B")!;
    expect(ab.animated).toBe(true);
    expect(ab.className).toContain("deps-edge--running");
    expect(ab.style?.stroke).toBe("var(--state-running)");
  });

  // Sem nada rodando não há ciano — mas o caminho até quem roda a seguir segue
  // aceso, do mesmo jeito que o card dela (a frente de onda não depende de haver
  // uma running).
  it("sem nenhuma running: nada de ciano; o caminho até a próxima segue âmbar", () => {
    const tasks = [task("A", "done"), task("B", "ready"), task("C", "ready")];
    const edges: [string, string][] = [["A", "B"], ["B", "C"]];

    render(<DepsFlow tasks={tasks} edges={edges} tick={0} />);

    for (const e of captured.edges) {
      expect(e.animated).toBeUndefined();
      expect(e.className ?? "").not.toContain("deps-edge--running");
    }

    const ab = captured.edges.find((e) => e.source === "A" && e.target === "B")!;
    expect(ab.className).toContain("deps-edge--next");
    expect(ab.style?.stroke).toBe("var(--state-blocked)");

    const bc = captured.edges.find((e) => e.source === "B" && e.target === "C")!;
    expect(bc.className).toBeUndefined();
    expect(bc.style?.stroke).toBe("var(--border)");
  });
});

// ---------------------------------------------------------------------------
// Edges — o caminho já percorrido é verde
// ---------------------------------------------------------------------------

describe("DepsFlow — edges entre tasks concluídas (verde)", () => {
  it("done→done = verde, estática", () => {
    const tasks = [task("A", "done"), task("B", "done"), task("C", "running")];
    const edges: [string, string][] = [["A", "B"], ["B", "C"]];

    render(<DepsFlow tasks={tasks} edges={edges} tick={0} />);

    const ab = captured.edges.find((e) => e.source === "A" && e.target === "B")!;
    expect(ab.animated).toBeUndefined();
    expect(ab.className).toContain("deps-edge--done");
    expect(ab.style?.stroke).toBe("var(--state-done)");
  });

  it("done→running continua cyan (o antes vence o já-percorrido)", () => {
    const tasks = [task("A", "done"), task("B", "running")];

    render(<DepsFlow tasks={tasks} edges={[["A", "B"]]} tick={0} />);

    const ab = captured.edges.find((e) => e.source === "A" && e.target === "B")!;
    expect(ab.className).toContain("deps-edge--running");
    expect(ab.style?.stroke).toBe("var(--state-running)");
  });

  it("done→task que ainda não rodou (e não é a próxima) fica cinza (trecho não andado)", () => {
    // B ainda espera Z além de A → não é a frente de onda; a aresta A→B não é
    // verde (o trecho não foi andado) nem âmbar (não leva à próxima).
    const tasks = [task("A", "done"), task("Z", "ready"), task("B", "blocked")];

    render(
      <DepsFlow tasks={tasks} edges={[["A", "B"], ["Z", "B"]]} tick={0} />,
    );

    const ab = captured.edges.find((e) => e.source === "A" && e.target === "B")!;
    expect(ab.className).toBeUndefined();
    expect(ab.style?.stroke).toBe("var(--border)");
  });

  it("done→próxima acende âmbar (o caminho que destrava quem roda a seguir)", () => {
    const tasks = [task("A", "done"), task("B", "blocked")];

    render(<DepsFlow tasks={tasks} edges={[["A", "B"]]} tick={0} />);

    const ab = captured.edges.find((e) => e.source === "A" && e.target === "B")!;
    expect(ab.animated).toBeUndefined();
    expect(ab.className).toContain("deps-edge--next");
    expect(ab.style?.stroke).toBe("var(--state-blocked)");
  });
});

// ---------------------------------------------------------------------------
// Nós — só a frente de onda acende (o caso do print: T-019 não pode acender)
// ---------------------------------------------------------------------------

describe("DepsFlow — frente de onda nos nós", () => {
  it("acende quem espera pelo que roda agora, não quem está dois saltos à frente", () => {
    const tasks = [
      task("T-016", "running"),
      task("T-017", "blocked"),
      task("T-018", "blocked"),
      task("T-019", "blocked"),
    ];
    const edges: [string, string][] = [
      ["T-016", "T-017"],
      ["T-016", "T-018"],
      ["T-017", "T-019"],
      ["T-018", "T-019"],
    ];

    render(<DepsFlow tasks={tasks} edges={edges} tick={0} />);

    const wavefrontOf = (id: string) =>
      captured.nodes.find((n) => n.id === id)!.data.onWavefront;

    expect(wavefrontOf("T-017")).toBe(true);
    expect(wavefrontOf("T-018")).toBe(true);
    expect(wavefrontOf("T-019")).toBe(false);
    expect(wavefrontOf("T-016")).toBe(false); // já roda
  });

  it("concurrency corta a frente num backlog sem deps (não acende tudo)", () => {
    const tasks = [task("T-001"), task("T-002"), task("T-003")];

    render(<DepsFlow tasks={tasks} edges={[]} tick={0} concurrency={1} />);

    expect(captured.nodes.find((n) => n.id === "T-001")!.data.onWavefront).toBe(true);
    expect(captured.nodes.find((n) => n.id === "T-002")!.data.onWavefront).toBe(false);
    expect(captured.nodes.find((n) => n.id === "T-003")!.data.onWavefront).toBe(false);
  });

  it("sem concurrency conhecido, não corta (fallback seguro)", () => {
    const tasks = [task("T-001"), task("T-002")];

    render(<DepsFlow tasks={tasks} edges={[]} tick={0} />);

    for (const n of captured.nodes) expect(n.data.onWavefront).toBe(true);
  });

  // --- T-004: concurrency "auto" resolve com a função do motor (D7/D12) ---

  it('"auto" num backlog sem deps com max_concurrency: 4 → frente de 4 (não 20)', () => {
    const tasks = Array.from({ length: 20 }, (_, i) =>
      task(`T-${String(i + 1).padStart(3, "0")}`),
    );

    render(<DepsFlow tasks={tasks} edges={[]} tick={0} concurrency="auto" maxConcurrency={4} />);

    const onWave = captured.nodes.filter((n) => n.data.onWavefront);
    expect(onWave).toHaveLength(4);
    // São as 4 primeiras do backlog
    expect(onWave.map((n) => n.id)).toEqual(["T-001", "T-002", "T-003", "T-004"]);
  });

  it('"auto" num DAG de camadas [3,2,1] com teto 4 → frente de 3', () => {
    // Layer 0: A,B,C (width 3); Layer 1: D,E; Layer 2: F
    const tasks = [task("A"), task("B"), task("C"), task("D"), task("E"), task("F")];
    const edges: [string, string][] = [
      ["A", "D"], ["B", "D"], ["C", "E"],
      ["D", "F"], ["E", "F"],
    ];

    render(<DepsFlow tasks={tasks} edges={edges} tick={0} concurrency="auto" maxConcurrency={4} />);

    const onWave = captured.nodes.filter((n) => n.data.onWavefront);
    // Only layer-0 tasks (A,B,C) are on the wavefront — limit 3 via auto
    expect(onWave).toHaveLength(3);
    expect(onWave.map((n) => n.id).sort()).toEqual(["A", "B", "C"]);
  });

  it('"auto" sem max_concurrency → usa o default 4', () => {
    const tasks = Array.from({ length: 10 }, (_, i) =>
      task(`T-${String(i + 1).padStart(3, "0")}`),
    );

    render(<DepsFlow tasks={tasks} edges={[]} tick={0} concurrency="auto" />);

    const onWave = captured.nodes.filter((n) => n.data.onWavefront);
    expect(onWave).toHaveLength(4);
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

// ---------------------------------------------------------------------------
// Measured dimensions survive store updates (regressão: grafo sumia no Run)
// ---------------------------------------------------------------------------

describe("DepsFlow — measured dimensions survive a store update", () => {
  it("re-attaches the measured size to every node when the tasks change", () => {
    const edges: [string, string][] = [["T-001", "T-002"]];
    const { rerender } = render(
      <DepsFlow tasks={[task("T-001", "running"), task("T-002")]} edges={edges} tick={0} />,
    );

    // React Flow has not measured anything on the first paint.
    expect(captured.nodes.every((n) => n.measured === undefined)).toBe(true);

    // It measures the cards and reports the sizes back through onNodesChange —
    // the ONLY channel by which a controlled flow learns its own dimensions.
    expect(captured.onNodesChange).toBeDefined();
    captured.onNodesChange!(
      captured.nodes.map((n) => ({
        id: n.id,
        type: "dimensions" as const,
        dimensions: { width: CARD_W, height: CARD_H },
      })),
    );

    // A Step change rebuilds every TaskState (new refs) and bumps the tick, so
    // the whole node array is derived anew.
    rerender(
      <DepsFlow tasks={[task("T-001", "running"), task("T-002")]} edges={edges} tick={1} />,
    );

    // The rebuilt nodes must still carry their size. Without it React Flow
    // resets `measured` *and* `handleBounds`, which hides every card
    // (visibility: hidden) and drops every edge (getEdgePosition → null) —
    // the whole graph blinked out on each Step transition.
    expect(captured.nodes).not.toHaveLength(0);
    for (const n of captured.nodes) {
      expect(n.measured).toEqual({ width: CARD_W, height: CARD_H });
    }
  });
});

// ---------------------------------------------------------------------------
// T-004 — Navigation props (D4/D6/D8)
// ---------------------------------------------------------------------------

describe("DepsFlow — navigation props (T-004, D4/D6/D8)", () => {
  function renderMinimal() {
    render(<DepsFlow tasks={[task("T-001")]} edges={[]} tick={0} />);
  }

  it("panOnScroll is true (wheel = pan)", () => {
    renderMinimal();
    expect(captured.panOnScroll).toBe(true);
  });

  it("panOnScrollMode is Free (deltaY→vertical, deltaX→horizontal)", () => {
    renderMinimal();
    expect(captured.panOnScrollMode).toBe("free");
  });

  it("zoomOnScroll is false (wheel never zooms)", () => {
    renderMinimal();
    expect(captured.zoomOnScroll).toBe(false);
  });

  it("zoomOnPinch is true (pinch/trackpad = zoom, D4)", () => {
    renderMinimal();
    expect(captured.zoomOnPinch).toBe(true);
  });

  it("preventScrolling is true (wheel doesn't leak to the app)", () => {
    renderMinimal();
    expect(captured.preventScrolling).toBe(true);
  });

  it("panOnDrag is false (no mouse-drag panning)", () => {
    renderMinimal();
    expect(captured.panOnDrag).toBe(false);
  });

  it("minZoom is 0.25 (fitView can shrink below 0.5x for large DAGs, D6)", () => {
    renderMinimal();
    expect(captured.minZoom).toBe(0.25);
  });

  it("panActivationKeyCode is NOT passed (RF default = Space, D8)", () => {
    renderMinimal();
    expect(captured.panActivationKeyCode).toBeUndefined();
  });

  it("zoomActivationKeyCode is NOT passed (RF default = Meta on macOS, D8)", () => {
    renderMinimal();
    expect(captured.zoomActivationKeyCode).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// T-004 — .deps-flow wrapper + useShiftWheelPan integration
// ---------------------------------------------------------------------------

describe("DepsFlow — .deps-flow wrapper + shift+wheel hook (T-004)", () => {
  it("renders a .deps-flow wrapper around ReactFlow", () => {
    const { container } = render(
      <DepsFlow tasks={[task("T-001")]} edges={[]} tick={0} />,
    );
    const wrapper = container.querySelector(".deps-flow");
    expect(wrapper).toBeTruthy();
  });

  it("shift+wheel on .deps-flow calls setViewport (hook is mounted)", () => {
    const { container } = render(
      <DepsFlow tasks={[task("T-001")]} edges={[]} tick={0} />,
    );
    const wrapper = container.querySelector(".deps-flow")!;

    const wheelEvent = new WheelEvent("wheel", {
      deltaY: 100,
      deltaX: 0,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    wrapper.dispatchEvent(wheelEvent);

    expect(mockSetViewport).toHaveBeenCalledTimes(1);
  });
});
