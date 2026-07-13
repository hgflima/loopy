/**
 * Custom React Flow node — card de design-system (paridade .kanban-card).
 *
 * Dot de status (estático, sem pulse) + ID (mono) + título (sans, clamp 3) +
 * step falho (@id). Running pulsa a **borda interna** via {@link pulseFrame};
 * o dot não pulsa (D7). Selected + running = anéis concêntricos (D4).
 *
 * Handles Left (target) / Right (source), hidden (rankdir LR).
 */
import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { pulseFrame } from "loopy/tui/view";
import type { TaskStatus } from "loopy/tui/store";
import { StatusDot, TASK_STATUS_META } from "../ui";
import "./TaskNode.css";

export interface TaskNodeData {
  readonly status: TaskStatus;
  readonly tick: number;
  /** All fields below degrade gracefully when omitted (spec: "todos opcionais degradam"). */
  readonly title?: string;
  readonly selected?: boolean;
  readonly isRunning?: boolean;
  readonly failedAtStepId?: string;
  readonly reducedMotion?: boolean;
  readonly onSelect?: (id: string) => void;
  readonly onFocusNode?: (id: string) => void;
  [key: string]: unknown;
}

export type TaskNodeType = Node<TaskNodeData, "task">;

function TaskNodeComponent({ id, data }: NodeProps<TaskNodeType>) {
  const {
    status,
    title = "",
    tick,
    selected = false,
    isRunning = false,
    failedAtStepId,
    reducedMotion = false,
    onSelect,
    onFocusNode,
  } = data;

  const meta = TASK_STATUS_META[status];

  const isPulseOff = isRunning && !reducedMotion && pulseFrame(tick) === "off";

  const cls = [
    "deps-node",
    `deps-node--tone-${meta.tone}`,
    selected && "deps-node--selected",
    isPulseOff && "deps-node--pulse-off",
  ]
    .filter(Boolean)
    .join(" ");

  const handleSelect = () => {
    onSelect?.(id);
  };

  return (
    <div
      className={cls}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${id}: ${title}`}
      data-testid={`task-node-${id}`}
      onClick={handleSelect}
      onFocus={() => onFocusNode?.(id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleSelect();
        }
      }}
    >
      <Handle type="target" position={Position.Left} style={{ visibility: "hidden" }} />
      <StatusDot tone={meta.tone} hollow={meta.hollow} label={meta.label} />
      <span className="deps-node__id t-data">{id}</span>
      <span className="deps-node__title t-body">{title}</span>
      {failedAtStepId && (
        <span className="deps-node__failed t-data">@{failedAtStepId}</span>
      )}
      <Handle type="source" position={Position.Right} style={{ visibility: "hidden" }} />
    </div>
  );
}

const MemoTaskNode = memo(TaskNodeComponent);
export default MemoTaskNode;

/** Stable nodeTypes object — outside the component to avoid RF re-registration. */
export const nodeTypes = { task: MemoTaskNode } as const;
