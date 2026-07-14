/**
 * Kanban board — Steps as columns, cards per task (SC #5 + SC #7).
 *
 * Thin React wrapper over pure grouper (T-011) + goto detection.
 * The fix-loop (card returning to an earlier column via `goto`) triggers
 * a single accent-ring pulse — the visual centrepiece of the Kanban view.
 *
 * Idle-mode features (T-012 / SC7):
 *  - "+ Add Step" ghost column at the end (calls `onAddStep`).
 *  - Drag handle on pipeline column headers for reordering (`onReorderStep`).
 *  - Remove step action via `onRemoveStep`.
 *  - Orphan ref badges on column headers + banner when goto/on_success
 *    references point to non-existent step ids.
 *
 * AD-6: presentation logic (groupByStep, detectGotoCards) is pure and tested
 * independently; this component just renders. Status → color/label comes from
 * the shared StatusIndicator vocabulary, not terminal glyphs.
 */
import { useRef, useState, useEffect, useMemo, useCallback } from "react";
import type { StoreState } from "loopy/tui/store";
import { groupByStep, type KanbanColumn } from "./grouper";
import { detectGotoCards } from "./goto-detect";
import type { OrphanRef } from "../config/pipeline-edit";
import { TaskStatusDot } from "../ui";
import "./kanban.css";

const GOTO_HIGHLIGHT_MS = 2_200;

const isPipelineCol = (colId: string) =>
  colId !== "backlog" && colId !== "fim";

interface KanbanBoardProps {
  store: StoreState;
  selectedTaskId?: string | null;
  onSelectTask?: (taskId: string) => void;
  /** Open the step editor for a column's step (idle only). */
  onEditStep?: (stepId: string) => void;
  /** Add a new step to the pipeline (idle only). */
  onAddStep?: () => void;
  /** Remove a step from the pipeline by id (idle only). */
  onRemoveStep?: (stepId: string) => void;
  /** Reorder a pipeline step from one index to another (idle only). */
  onReorderStep?: (from: number, to: number) => void;
  /** Orphan goto/on_success refs to highlight on column headers (idle only). */
  orphanRefs?: readonly OrphanRef[];
}

export function KanbanBoard({
  store,
  selectedTaskId,
  onSelectTask,
  onEditStep,
  onAddStep,
  onRemoveStep,
  onReorderStep,
  orphanRefs,
}: KanbanBoardProps) {
  const prevColumnsRef = useRef<KanbanColumn[] | undefined>(undefined);
  const [gotoIds, setGotoIds] = useState<ReadonlySet<string>>(new Set());
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const columns = useMemo(() => groupByStep(store), [store]);

  // Pipeline step ids (excludes backlog/fim virtual columns)
  const pipelineIds = useMemo(
    () => store.pipeline.map((s) => s.id),
    [store.pipeline],
  );

  // Orphan refs grouped by stepId for badge lookup
  const orphansByStep = useMemo(() => {
    if (!orphanRefs || orphanRefs.length === 0) return undefined;
    const map = new Map<string, OrphanRef[]>();
    for (const ref of orphanRefs) {
      let arr = map.get(ref.stepId);
      if (!arr) {
        arr = [];
        map.set(ref.stepId, arr);
      }
      arr.push(ref);
    }
    return map;
  }, [orphanRefs]);

  useEffect(() => {
    const detected = detectGotoCards(prevColumnsRef.current, columns);
    prevColumnsRef.current = columns;

    if (detected.size === 0) return;

    setGotoIds(detected);
    const timer = setTimeout(() => setGotoIds(new Set()), GOTO_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [columns]);

  // --- Drag-and-drop for column reorder ---
  const dragSrcIndex = useRef<number | null>(null);

  const handleDragStart = useCallback(
    (e: React.DragEvent, stepId: string) => {
      const idx = pipelineIds.indexOf(stepId);
      if (idx < 0) return;
      dragSrcIndex.current = idx;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", stepId);
    },
    [pipelineIds],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, stepId: string) => {
      if (dragSrcIndex.current == null) return;
      if (!pipelineIds.includes(stepId)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverId(stepId);
    },
    [pipelineIds],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, stepId: string) => {
      e.preventDefault();
      setDragOverId(null);
      const from = dragSrcIndex.current;
      if (from == null) return;
      const to = pipelineIds.indexOf(stepId);
      if (to < 0 || from === to) return;
      dragSrcIndex.current = null;
      onReorderStep?.(from, to);
    },
    [pipelineIds, onReorderStep],
  );

  const handleDragEnd = useCallback(() => {
    dragSrcIndex.current = null;
    setDragOverId(null);
  }, []);

  return (
    <div className="kanban-board">
      {/* Orphan refs banner */}
      {orphanRefs && orphanRefs.length > 0 && (
        <div className="kanban-orphan-banner" data-testid="orphan-banner">
          {orphanRefs.map((ref) => (
            <span key={`${ref.stepId}-${ref.field}`} className="kanban-orphan-banner__ref">
              <strong>{ref.stepId}</strong>.{ref.field} → <code>{ref.target}</code>
            </span>
          ))}
        </div>
      )}

      {columns.map((col) => {
        const isPipeline = isPipelineCol(col.id);
        const isDragOver = dragOverId === col.id;
        const colOrphans = orphansByStep?.get(col.id);
        const dragProps = isPipeline && onReorderStep
          ? {
              onDragOver: (e: React.DragEvent) => handleDragOver(e, col.id),
              onDrop: (e: React.DragEvent) => handleDrop(e, col.id),
              onDragLeave: () => setDragOverId(null),
            }
          : {};

        return (
          <section
            key={col.id}
            className={[
              "kanban-column",
              isDragOver && "kanban-column--drag-over",
            ]
              .filter(Boolean)
              .join(" ")}
            {...dragProps}
          >
            <header className="kanban-column-title t-label">
              {/* Drag handle (pipeline columns only) */}
              {isPipeline && onReorderStep && (
                <span
                  className="kanban-column-drag"
                  draggable
                  aria-label={`Drag ${col.id}`}
                  data-testid={`drag-handle-${col.id}`}
                  onDragStart={(e) => handleDragStart(e, col.id)}
                  onDragEnd={handleDragEnd}
                >
                  ⠿
                </span>
              )}

              <span className="kanban-column-name">{col.title}</span>
              {col.cards.length > 0 && (
                <span className="kanban-column-count">{col.cards.length}</span>
              )}

              {/* Orphan ref badge */}
              {colOrphans && colOrphans.length > 0 && (
                <span
                  className="kanban-orphan-badge"
                  data-testid={`orphan-badge-${col.id}`}
                  title={colOrphans
                    .map((r) => `${r.field} → ${r.target}`)
                    .join(", ")}
                >
                  ⚠
                </span>
              )}

              {onEditStep && isPipeline && (
                <button
                  className="kanban-column-edit"
                  type="button"
                  aria-label={`Edit step ${col.id}`}
                  onClick={() => onEditStep(col.id)}
                >
                  ⋯
                </button>
              )}

              {onRemoveStep && isPipeline && (
                <button
                  className="kanban-column-remove"
                  type="button"
                  aria-label={`Remove step ${col.id}`}
                  data-testid={`remove-step-${col.id}`}
                  onClick={() => onRemoveStep(col.id)}
                >
                  ✕
                </button>
              )}
            </header>
            <div className="kanban-column-cards">
              {col.cards.map((card) => {
                const isGoto = gotoIds.has(card.taskId);
                const isSelected = selectedTaskId === card.taskId;
                const cls = [
                  "kanban-card",
                  isGoto && "kanban-card--goto",
                  isSelected && "kanban-card--selected",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <article
                    key={card.taskId}
                    className={cls}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onClick={() => onSelectTask?.(card.taskId)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectTask?.(card.taskId);
                      }
                    }}
                  >
                    <TaskStatusDot status={card.status} />
                    <span className="kanban-card-id t-data">{card.taskId}</span>
                    <span className="kanban-card-title t-body">
                      {card.title}
                    </span>
                    {card.failedAtStepId && (
                      <span className="kanban-card-failed t-data">
                        @{card.failedAtStepId}
                      </span>
                    )}
                    {card.warned && (
                      <span className="kanban-card-warned t-data" title="Warning">
                        ⚠
                      </span>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* "+ Add Step" ghost column (idle only) */}
      {onAddStep && (
        <section className="kanban-column kanban-column--add" data-testid="add-step-column">
          <button
            className="kanban-add-step"
            type="button"
            onClick={onAddStep}
            aria-label="Add step"
          >
            + add step
          </button>
        </section>
      )}
    </div>
  );
}
