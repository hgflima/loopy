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
import { useMemo } from "react";
import { ReactFlow, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { computeDagreLayout } from "loopy/tui/view";
import type { TaskStatus, TaskState } from "loopy/tui/store";
import TaskNode, { type TaskNodeType } from "./TaskNode";
import { CELL_PX_X, CELL_PX_Y } from "./scale";

/** Stable reference — must live outside the component to avoid re-registration. */
const nodeTypes = { task: TaskNode } as const;

export interface DepsFlowProps {
  readonly tasks: readonly TaskState[];
  readonly edges: readonly [string, string][];
  readonly tick: number;
}

export function DepsFlow({ tasks, edges, tick }: DepsFlowProps) {
  const statusById = useMemo(() => {
    const m = new Map<string, TaskStatus>();
    for (const t of tasks) m.set(t.id, t.status);
    return m;
  }, [tasks]);

  const order = useMemo(() => tasks.map((t) => t.id), [tasks]);

  const geometry = useMemo(
    () => computeDagreLayout(edges, statusById, order),
    [edges, statusById, order],
  );

  const rfNodes: Node<TaskNodeType["data"]>[] = useMemo(
    () =>
      geometry.nodes.map((n) => ({
        id: n.id,
        type: "task" as const,
        position: { x: n.col * CELL_PX_X, y: n.row * CELL_PX_Y },
        data: { status: statusById.get(n.id) ?? "pending", tick },
        draggable: false,
        selectable: false,
      })),
    [geometry.nodes, statusById, tick],
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      geometry.edges.map((e) => ({
        id: `${e.from}->${e.to}`,
        source: e.from,
        target: e.to,
      })),
    [geometry.edges],
  );

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      fitView
      proOptions={{ hideAttribution: true }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      panOnDrag={false}
      zoomOnScroll={false}
      zoomOnPinch={false}
      zoomOnDoubleClick={false}
      preventScrolling={false}
    />
  );
}
