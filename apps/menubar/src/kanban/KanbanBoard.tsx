/**
 * Kanban board — Steps as columns, cards per task (SC #5).
 *
 * Thin React wrapper over pure grouper (T-011) + goto detection.
 * The fix-loop (card returning to an earlier column via `goto`) triggers
 * a single accent-ring pulse — the visual centrepiece of the Kanban view.
 *
 * AD-6: presentation logic (groupByStep, detectGotoCards) is pure and tested
 * independently; this component just renders. Status → color/label comes from
 * the shared StatusIndicator vocabulary, not terminal glyphs.
 */
import { useRef, useState, useEffect, useMemo } from "react";
import type { StoreState } from "loopy/tui/store";
import { groupByStep, type KanbanColumn } from "./grouper";
import { detectGotoCards } from "./goto-detect";
import { TaskStatusDot } from "../ui";
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
        <section key={col.id} className="kanban-column">
          <header className="kanban-column-title t-label">
            <span className="kanban-column-name">{col.title}</span>
            {col.cards.length > 0 && (
              <span className="kanban-column-count">{col.cards.length}</span>
            )}
          </header>
          <div className="kanban-column-cards">
            {col.cards.map((card) => {
              const isGoto = gotoIds.has(card.taskId);
              return (
                <article
                  key={card.taskId}
                  className={`kanban-card${isGoto ? " kanban-card--goto" : ""}`}
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
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
