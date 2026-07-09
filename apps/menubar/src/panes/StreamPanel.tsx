/**
 * StreamPanel — streaming region with fold, max 4 panes, overflow chip,
 * cross-step markdown + labeled dividers + auto-stick scroll (T-008, T-009).
 *
 * Occupies `var(--stream-h)` (~45%) of the app height. **Fold** collapses to a
 * persistent thin bar `var(--stream-fold-h)` (~28px) showing "▸ Streams · N
 * rodando" + chevron; a single click re-expands to default. **Never disappears**.
 *
 * Shows at most 4 panes; when >4 tasks are running, displays 4 + a "＋N rodando"
 * chip. Fold state is session-only (not persisted).
 *
 * Each pane renders the **cross-step transcript** (from `segmentsFor`, T-004)
 * with `MarkdownStream` (T-005). Steps are separated by a **labeled divider**
 * (hairline + centered pill). Scroll **auto-sticks** to the bottom when the
 * user is anchored there; completed segments are memoized.
 *
 * Pure data transformations ({@link streamColumns}, {@link visiblePanes}) are
 * exported for testing (AD-6).
 */

import { useState, useRef, useEffect, useCallback } from "react";
import type { StoreState } from "loopy/tui/store";
import {
  segmentsFor,
  overlayStepUsage,
  type Transcript,
  type StreamSegment,
} from "../state/stream-history";
import { StatusDot, MarkdownStream, StepDivider } from "../ui";
import { formatUsage } from "../ui/context-window";
import "./StreamPanel.css";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_VISIBLE_PANES = 4;
/** Pixel threshold for considering scroll "at bottom". */
const STICK_THRESHOLD = 24;

// ---------------------------------------------------------------------------
// Pure data transformations (AD-6)
// ---------------------------------------------------------------------------

export interface StreamColumn {
  readonly taskId: string;
  readonly title: string;
  readonly segments: readonly StreamSegment[];
}

/**
 * Compute the stream columns for all running tasks using the cross-step
 * transcript (T-004, T-009). Each column carries `StreamSegment[]` from
 * `segmentsFor` — not the per-step `task.stream` that resets.
 */
export function streamColumns(
  store: StoreState,
  transcript: Transcript,
): StreamColumn[] {
  return store.tasks
    .filter((t) => t.status === "running")
    .map((task) => ({
      taskId: task.id,
      title: task.title,
      // Overlay LIVE per-step usage (C-0011 #5): the transcript snapshot misses
      // the late `usage_sample`; `task.steps` is authoritative.
      segments: overlayStepUsage(segmentsFor(task.id, transcript), task.steps),
    }));
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
// StreamPane — one pane with auto-stick scroll
// ---------------------------------------------------------------------------

function StreamPane({ col }: { readonly col: StreamColumn }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stuckRef = useRef(true);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stuckRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
  }, []);

  // Auto-stick: scroll to bottom when new content arrives and user was at bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stuckRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  });

  const lastIdx = col.segments.length - 1;

  return (
    <div className="stream-panel__column">
      <header className="stream-panel__header">
        <StatusDot tone="running" pulse label="running" />
        <span className="t-data stream-panel__id">{col.taskId}</span>
        <span className="t-body u-truncate stream-panel__title">
          {col.title}
        </span>
      </header>
      <div
        className="stream-panel__scroll"
        ref={scrollRef}
        onScroll={handleScroll}
      >
        {col.segments.map((seg, i) => (
          <div key={`${seg.stepId}-${i}`}>
            {i > 0 && (
              <StepDivider
                label={seg.label}
                agent={seg.agent}
                usage={formatUsage(seg.usedTokens, seg.size, seg.model)}
              />
            )}
            <MarkdownStream
              text={seg.text}
              streaming={i === lastIdx}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// React component
// ---------------------------------------------------------------------------

interface StreamPanelProps {
  readonly store: StoreState;
  readonly transcript: Transcript;
}

export function StreamPanel({ store, transcript }: StreamPanelProps) {
  const [folded, setFolded] = useState(false);

  const columns = streamColumns(store, transcript);
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
                <StreamPane key={col.taskId} col={col} />
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
