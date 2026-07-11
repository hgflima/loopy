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
  Background,
  BackgroundVariant,
  Controls,
  useReactFlow,
  useNodesInitialized,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./DepsFlow.css";
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
  /** Whether the Deps pane is the currently visible view. */
  readonly active?: boolean;
  readonly selectedTaskId?: string | null;
  readonly onSelectTask?: (taskId: string) => void;
}

export function DepsFlow({ tasks, edges, tick, active, selectedTaskId, onSelectTask }: DepsFlowProps) {
  const { fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const hasFitted = useRef(false);
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
        data: { status: statusById.get(n.id) ?? "pending", tick, selected: n.id === selectedTaskId },
        draggable: false,
        selectable: false,
      })),
    [geometry.nodes, statusById, tick, selectedTaskId],
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      geometry.edges.map((e) => {
        const incident =
          statusById.get(e.from) === "running" ||
          statusById.get(e.to) === "running";
        return {
          id: `${e.from}->${e.to}`,
          source: e.from,
          target: e.to,
          type: "smoothstep" as const,
          ...(incident && { animated: true, className: "deps-edge--running" }),
          style: {
            stroke: incident ? "var(--state-running)" : "var(--border)",
          },
        };
      }),
    [geometry.edges, statusById],
  );

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => { onSelectTask?.(node.id); },
    [onSelectTask],
  );

  useEffect(() => {
    if (active && nodesInitialized && !hasFitted.current) {
      hasFitted.current = true;
      fitView();
    }
  }, [active, nodesInitialized, fitView]);

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      proOptions={{ hideAttribution: true }}
      onNodeClick={handleNodeClick}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
    >
      <Background variant={BackgroundVariant.Dots} gap={18} color="var(--border)" />
      <Controls />
    </ReactFlow>
  );
}
