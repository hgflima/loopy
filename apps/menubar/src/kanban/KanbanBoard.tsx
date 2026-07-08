/**
 * Kanban board — Steps as columns, cards per task (SC #5).
 *
 * Thin React wrapper over pure grouper (T-011) + goto detection.
 * The fix-loop (card returning to an earlier column via `goto`) triggers
 * a pulse animation — the visual centrepiece of the Kanban view.
 *
 * AD-6: presentation logic (groupByStep, detectGotoCards, COLORS, SYMBOLS)
 * is pure and tested independently; this component just renders.
 */
import { useRef, useState, useEffect, useMemo } from "react";
import type { StoreState } from "loopy/tui/store";
import { COLORS, SYMBOLS } from "loopy/tui/view";
import { groupByStep, type KanbanColumn } from "./grouper";
import { detectGotoCards } from "./goto-detect";
import "./kanban.css";

const GOTO_HIGHLIGHT_MS = 2_200;

interface KanbanBoardProps {
  store: StoreState;
}

export function KanbanBoard({ store }: KanbanBoardProps) {
  const prevColumnsRef = useRef<KanbanColumn[] | undefined>(undefined);
  const [gotoIds, setGotoIds] = useState<ReadonlySet<string>>(new Set());

  const columns = useMemo(() => groupByStep(store), [store]);

  useEffect(() => {
    const detected = detectGotoCards(prevColumnsRef.current, columns);
    prevColumnsRef.current = columns;

    if (detected.size === 0) return;

    setGotoIds(detected);
    const timer = setTimeout(() => setGotoIds(new Set()), GOTO_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [columns]);

  return (
    <div className="kanban-board">
      {columns.map((col) => (
        <div key={col.id} className="kanban-column">
          <div className="kanban-column-title">
            {col.title}
            {col.cards.length > 0 && (
              <span className="kanban-column-count">({col.cards.length})</span>
            )}
          </div>
          {col.cards.map((card) => {
            const isGoto = gotoIds.has(card.taskId);
            const color = COLORS.task[card.status];
            return (
              <div
                key={card.taskId}
                className={`kanban-card${isGoto ? " kanban-card--goto" : ""}`}
              >
                <span className="kanban-card-glyph" style={{ color }}>
                  {SYMBOLS.task[card.status]}
                </span>
                <span className="kanban-card-id" style={{ color }}>
                  {card.taskId}
                </span>
                <span className="kanban-card-title">{card.title}</span>
                {card.failedAtStepId && (
                  <span className="kanban-card-failed-step">
                    @ {card.failedAtStepId}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
