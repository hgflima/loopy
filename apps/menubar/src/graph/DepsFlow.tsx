/**
 * Dependency graph rendered with React Flow.
 *
 * Node positions come from {@link computeDagreLayout} (from `loopy/tui/view`)
 * — **never** from React Flow's auto-layout. The same dagre geometry that the
 * TUI uses (AD-6, SC #4) drives the pixel positions here via a cell→pixel
 * scaling factor.
 *
 * Edges from {@link StoreState.edges} are rendered as React Flow edges.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  PanOnScrollMode,
  Background,
  BackgroundVariant,
  Controls,
  useReactFlow,
  useNodesInitialized,
  type Node,
  type Edge,
  type NodeChange,
  type ReactFlowInstance,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./DepsFlow.css";
import { computeDagreLayout } from "loopy/tui/view";
import type { TaskStatus, TaskState } from "loopy/tui/store";
import TaskNode, { type TaskNodeType } from "./TaskNode";
import { CELL_PX_X, CELL_PX_Y, CARD_W, CARD_H } from "./scale";
import { usePrefersReducedMotion } from "../ui";
import { failedStepId } from "../kanban/failed-step";
import { useShiftWheelPan } from "./useShiftWheelPan";
import { wavefront, edgeFlow, type EdgeFlow } from "./flow-state";

/** Stable reference — must live outside the component to avoid re-registration. */
const nodeTypes = { task: TaskNode } as const;

/** Per-flow edge styling: cyan animated (entra na running), amber static (entra na frente de onda), green (percorrido). */
const FLOW_STYLE: Record<EdgeFlow, { animated?: true; className: string; stroke: string }> = {
  running: { animated: true, className: "deps-edge--running", stroke: "var(--state-running)" },
  next:    { className: "deps-edge--next", stroke: "var(--state-blocked)" },
  done:    { className: "deps-edge--done", stroke: "var(--state-done)" },
};

export interface DepsFlowProps {
  readonly tasks: readonly TaskState[];
  readonly edges: readonly [string, string][];
  readonly tick: number;
  /** Whether the Deps pane is the currently visible view. */
  readonly active?: boolean;
  /** Teto da frente de onda (`concurrency` do yml). Omitido = não corta. */
  readonly concurrency?: number;
  readonly selectedTaskId?: string | null;
  readonly onSelectTask?: (taskId: string) => void;
}

export function DepsFlow({ tasks, edges, tick, active, concurrency, selectedTaskId, onSelectTask }: DepsFlowProps) {
  const reducedMotion = usePrefersReducedMotion();
  const wrapperRef = useRef<HTMLDivElement>(null);
  useShiftWheelPan(wrapperRef);
  const instanceRef = useRef<ReactFlowInstance<Node<TaskNodeType["data"]>> | null>(null);
  const { fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const hasFitted = useRef(false);

  const onFocusNode = useCallback((id: string) => {
    const inst = instanceRef.current;
    if (!inst) return;
    const node = inst.getNode(id);
    if (!node) return;
    const { x, y } = node.position;
    inst.setCenter(x + CARD_W / 2, y + CARD_H / 2, {
      duration: 300,
    });
  }, []);
  const statusById = useMemo(() => {
    const m = new Map<string, TaskStatus>();
    for (const t of tasks) m.set(t.id, t.status);
    return m;
  }, [tasks]);

  const order = useMemo(() => tasks.map((t) => t.id), [tasks]);

  /** Quem roda a seguir — derivado do grafo, não do status cru (ver flow-state). */
  const front = useMemo(
    () => wavefront(statusById, edges, concurrency ?? Infinity),
    [statusById, edges, concurrency],
  );

  const geometry = useMemo(
    () => computeDagreLayout(edges, statusById, order),
    [edges, statusById, order],
  );

  const handleSelect = useCallback(
    (id: string) => { onSelectTask?.(id); },
    [onSelectTask],
  );

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => { handleSelect(node.id); },
    [handleSelect],
  );

  const taskById = useMemo(() => {
    const m = new Map<string, TaskState>();
    for (const t of tasks) m.set(t.id, t);
    return m;
  }, [tasks]);

  /**
   * Dimensões que o React Flow mediu, por nó — **a memória entre rebuilds**.
   *
   * O RF só grava `measured` no seu nó *interno*; o objeto que passamos em
   * `nodes` nunca o recebe de volta. Como este componente deriva os nós da
   * geometria a cada render (referências novas a cada evento da store e a cada
   * `tick`), o `adoptUserNodes` do RF descarta o nó interno e reconstrói um com
   * `measured` e `handleBounds` zerados — o que esconde TODOS os cards
   * (`visibility: hidden`) e derruba TODAS as arestas (`getEdgePosition` → null)
   * até o ResizeObserver medir tudo outra vez. Ou seja: o grafo piscava para
   * vazio a cada troca de Step. Capturar as dimensões aqui pelo canal oficial
   * (`onNodesChange`) e devolvê-las em cada nó fecha o ciclo — com `measured`
   * presente, o RF preserva também os `handleBounds` (ver `parseHandles`).
   */
  const measuredRef = useRef(new Map<string, { width: number; height: number }>());

  const handleNodesChange = useCallback(
    (changes: readonly NodeChange<Node<TaskNodeType["data"]>>[]) => {
      for (const c of changes) {
        if (c.type === "dimensions" && c.dimensions) {
          measuredRef.current.set(c.id, c.dimensions);
        }
      }
    },
    [],
  );

  const rfNodes: Node<TaskNodeType["data"]>[] = useMemo(
    () =>
      geometry.nodes.map((n) => {
        const t = taskById.get(n.id);
        const status = statusById.get(n.id) ?? "pending";
        const measured = measuredRef.current.get(n.id);
        return {
          id: n.id,
          type: "task" as const,
          position: { x: n.col * CELL_PX_X, y: n.row * CELL_PX_Y },
          ...(measured && { measured }),
          data: {
            status,
            tick,
            title: t?.title,
            isRunning: status === "running",
            onWavefront: front.has(n.id),
            failedAtStepId: t ? failedStepId(t) : undefined,
            selected: n.id === selectedTaskId,
            reducedMotion,
            onSelect: handleSelect,
            onFocusNode,
          },
          draggable: false,
          selectable: true,
        };
      }),
    [geometry.nodes, statusById, taskById, tick, front, onFocusNode, selectedTaskId, reducedMotion, handleSelect],
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      geometry.edges.map((e) => {
        const flow = edgeFlow(e.from, e.to, statusById, front);
        const fp = flow && FLOW_STYLE[flow];

        return {
          id: `${e.from}->${e.to}`,
          source: e.from,
          target: e.to,
          type: "smoothstep" as const,
          ...(fp?.animated && { animated: true }),
          ...(fp && { className: fp.className }),
          style: { stroke: fp?.stroke ?? "var(--border)" },
        };
      }),
    [geometry.edges, statusById, front],
  );

  useEffect(() => {
    if (active && nodesInitialized && !hasFitted.current) {
      hasFitted.current = true;
      fitView();
    }
  }, [active, nodesInitialized, fitView]);

  // panActivationKeyCode and zoomActivationKeyCode are intentionally omitted —
  // their RF defaults ("Space" / "Meta" on macOS) provide space+drag panning
  // and cmd+wheel zoom. Hardcoding would break non-macOS platforms for no
  // gain (D8).
  return (
    <div className="deps-flow" ref={wrapperRef}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={handleNodesChange}
        nodeTypes={nodeTypes}
        proOptions={{ hideAttribution: true }}
        onNodeClick={handleNodeClick}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        elementsSelectable={true}
        panOnDrag={false}
        panOnScroll
        panOnScrollMode={PanOnScrollMode.Free}
        zoomOnScroll={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
        preventScrolling
        minZoom={0.25}
        onInit={(instance) => {
          instanceRef.current = instance;
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} color="var(--border)" />
        <Controls />
      </ReactFlow>
    </div>
  );
}
