/**
 * Custom React Flow node for a backlog task.
 *
 * Colors by {@link COLORS}.task[status] (CSS keywords directly) and pulses on
 * `running` via {@link pulseFrame}(tick). The tick counter is driven by a
 * **single** `setInterval` in `App` — no timer per node.
 *
 * Handles are positioned Left (target) / Right (source) because the dagre
 * layout uses `rankdir: "LR"`.
 */
import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { COLORS, SYMBOLS, pulseFrame } from "loopy/tui/view";
import type { TaskStatus } from "loopy/tui/store";

export interface TaskNodeData {
  readonly status: TaskStatus;
  readonly tick: number;
  readonly selected?: boolean;
  [key: string]: unknown;
}

export type TaskNodeType = Node<TaskNodeData, "task">;

function TaskNodeComponent({ id, data }: NodeProps<TaskNodeType>) {
  const { status, tick, selected } = data;
  const color = COLORS.task[status];
  const glyph = SYMBOLS.task[status];
  const isRunning = status === "running";
  const phase = pulseFrame(tick);

  return (
    <div
      data-testid={`task-node-${id}`}
      style={{
        color,
        fontFamily: "monospace",
        fontSize: 13,
        whiteSpace: "nowrap",
        padding: "4px 8px",
        fontWeight: isRunning && phase === "on" ? "bold" : undefined,
        opacity: isRunning && phase === "off" ? 0.5 : 1,
        outline: selected ? `2px solid ${color}` : undefined,
        borderRadius: selected ? 4 : undefined,
        cursor: "pointer",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ visibility: "hidden" }} />
      {glyph} {id}
      <Handle type="source" position={Position.Right} style={{ visibility: "hidden" }} />
    </div>
  );
}

export default memo(TaskNodeComponent);
