/**
 * StreamPanel — streaming region with fold, max 4 panes, overflow chip (T-008).
 *
 * Occupies `var(--stream-h)` (~45%) of the app height. **Fold** collapses to a
 * persistent thin bar `var(--stream-fold-h)` (~28px) showing "▸ Streams · N
 * rodando" + chevron; a single click re-expands to default. **Never disappears**.
 *
 * Shows at most 4 panes; when >4 tasks are running, displays 4 + a "＋N rodando"
 * chip. Fold state is session-only (not persisted).
 *
 * Pure data transformations ({@link streamColumns}, {@link visiblePanes}) are
 * exported for testing (AD-6).
 */

import { useState } from "react";
import { streamTail, prefixAgentLines } from "loopy/tui/view";
import type { StoreState } from "loopy/tui/store";
import { StatusDot } from "../ui";
import "./StreamPanel.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_VISIBLE_PANES = 4;

// ---------------------------------------------------------------------------
// Pure data transformations (AD-6)
// ---------------------------------------------------------------------------

export interface StreamColumn {
  readonly taskId: string;
  readonly title: string;
  readonly lines: readonly string[];
}

/**
 * Compute the stream columns for all running tasks.
 *
 * - Single agent (`activeAgents.size ≤ 1`): no prefix — byte-identical output.
 * - Multi-agent: each line is prefixed with `[agent]`.
 */
export function streamColumns(
  store: StoreState,
  maxLines = 8,
): StreamColumn[] {
  const multiAgent = store.activeAgents.size > 1;

  return store.tasks
    .filter((t) => t.status === "running")
    .map((task) => {
      const tail = streamTail(task.stream, maxLines);
      const lines = prefixAgentLines(tail, task.streamAgent, multiAgent);
      return { taskId: task.id, title: task.title, lines };
    });
}

/**
 * Cap visible columns at {@link MAX_VISIBLE_PANES} and compute overflow count.
 */
export function visiblePanes(columns: StreamColumn[]): {
  visible: StreamColumn[];
  overflow: number;
} {
  if (columns.length <= MAX_VISIBLE_PANES) {
    return { visible: columns, overflow: 0 };
  }
  return {
    visible: columns.slice(0, MAX_VISIBLE_PANES),
    overflow: columns.length - MAX_VISIBLE_PANES,
  };
}

// ---------------------------------------------------------------------------
// React component
// ---------------------------------------------------------------------------

interface StreamPanelProps {
  readonly store: StoreState;
}

export function StreamPanel({ store }: StreamPanelProps) {
  const [folded, setFolded] = useState(false);

  const columns = streamColumns(store);
  const runningCount = columns.length;
  const { visible, overflow } = visiblePanes(columns);

  // Fold bar — always rendered; clicking toggles fold state.
  const foldBar = (
    <button
      type="button"
      className="stream-panel__fold-bar"
      onClick={() => setFolded((f) => !f)}
      aria-expanded={!folded}
      aria-label={folded ? "Expandir streams" : "Recolher streams"}
    >
      <span className="stream-panel__fold-label t-label">
        ▸ Streams · {runningCount} rodando
      </span>
      <span
        className={`stream-panel__chevron${folded ? "" : " stream-panel__chevron--open"}`}
        aria-hidden="true"
      >
        ▾
      </span>
    </button>
  );

  return (
    <section
      className={`stream-panel${folded ? " stream-panel--folded" : ""}`}
      data-testid="stream-panel"
    >
      {foldBar}

      {!folded && (
        <div
          className="stream-panel__grid"
          style={{
            gridTemplateColumns: `repeat(${visible.length || 1}, minmax(0, 1fr))`,
          }}
        >
          {visible.length === 0 ? (
            <p className="stream-panel__placeholder t-body">
              Nenhuma task rodando — os streams do agente aparecem aqui quando um
              Step de Agente está em andamento.
            </p>
          ) : (
            <>
              {visible.map((col) => (
                <div key={col.taskId} className="stream-panel__column">
                  <header className="stream-panel__header">
                    <StatusDot tone="running" pulse label="running" />
                    <span className="t-data stream-panel__id">{col.taskId}</span>
                    <span className="t-body u-truncate stream-panel__title">
                      {col.title}
                    </span>
                  </header>
                  <pre className="stream-panel__tail t-data">
                    {col.lines.join("\n")}
                  </pre>
                </div>
              ))}
              {overflow > 0 && (
                <span className="stream-panel__chip t-label" aria-label={`${overflow} tasks adicionais rodando`}>
                  ＋{overflow} rodando
                </span>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
