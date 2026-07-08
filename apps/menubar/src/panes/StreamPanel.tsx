/**
 * StreamPanel — one column per running task (T-013).
 *
 * Mirrors the TUI's Streams region: each task with `status === "running"` gets
 * its own column showing the tail of its agent stream. When `concurrency: 1`,
 * a single column fills the space. No pin/selection interaction (refino #5).
 *
 * The pure data transformation ({@link streamColumns}) is exported for testing
 * (AD-6 — validate through the store, not by rendering pixels); the component
 * is a thin wrapper that maps columns to DOM.
 */

import { streamTail, prefixAgentLines } from "loopy/tui/view";
import type { StoreState } from "loopy/tui/store";
import { StatusDot } from "../ui";
import "./StreamPanel.css";

// ---------------------------------------------------------------------------
// Pure data transformation (AD-6)
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

// ---------------------------------------------------------------------------
// React component
// ---------------------------------------------------------------------------

interface StreamPanelProps {
  readonly store: StoreState;
}

export function StreamPanel({ store }: StreamPanelProps) {
  const columns = streamColumns(store);

  if (columns.length === 0) {
    return (
      <section className="stream-panel stream-panel--empty">
        <p className="stream-panel__placeholder t-body">
          Nenhuma task rodando — os streams do agente aparecem aqui quando um
          Step de Agente está em andamento.
        </p>
      </section>
    );
  }

  return (
    <section
      className="stream-panel"
      style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
    >
      {columns.map((col) => (
        <div key={col.taskId} className="stream-panel__column">
          <header className="stream-panel__header">
            <StatusDot tone="running" pulse label="running" />
            <span className="t-data stream-panel__id">{col.taskId}</span>
            <span className="t-body u-truncate stream-panel__title">
              {col.title}
            </span>
          </header>
          <pre className="stream-panel__tail t-data">{col.lines.join("\n")}</pre>
        </div>
      ))}
    </section>
  );
}
