/**
 * CardDetail — drawer content for the selected card (D1/D2, T-011; gate T-012).
 *
 * Three content sections inside the scrollable body:
 * - **Description** — task body rendered as sanitized markdown (MarkdownStream).
 * - **Deps chips** — dependency IDs as chips with status dots.
 * - **Log** — persisted transcript (segmentsFor) with step dividers.
 *
 * When a pending approval exists for this task (T-012), a **gate section**
 * renders at the top with Approve (accent) / Reject (secondary) buttons,
 * edge-top accent and `--shadow-gate`.  Keyboard: `⏎`=Approve, `⎋`=Reject
 * (precedence over closing the drawer).
 *
 * All sections are gracefully hidden when their data is absent, ensuring the
 * card never breaks with --emit-events off or pre-registration state.
 */
import { useEffect, useMemo } from "react";
import type { TaskStatus } from "loopy/tui/store";
import {
  segmentsFor,
  overlayStepUsage,
  type Transcript,
  type StepTelemetry,
} from "../state/stream-history";
import type { ApprovalRequest } from "../state/store-bridge";
import { escalationCost } from "../panes/ApprovalPrompt";
import { TaskStatusDot, MarkdownStream, StepDivider } from "../ui";
import { formatUsage } from "../ui/context-window";
import "./CardDetail.css";

export interface CardDetailProps {
  taskId: string;
  title: string;
  onClose: () => void;
  description?: string;
  deps?: readonly string[];
  /** All tasks — used to resolve dep status for chips. */
  tasks?: readonly { readonly id: string; readonly status: TaskStatus }[];
  transcript?: Transcript;
  /** Live per-step telemetry for this task — feeds the raia's usage (C-0011 #5).
   *  Authoritative over the transcript snapshot, which misses the late
   *  `usage_sample`. Structurally satisfied by `store.tasks[i].steps`. */
  steps?: readonly StepTelemetry[];
  /** Head of the FIFO approval queue for this task (T-012). */
  approval?: ApprovalRequest;
  /** Total pending approvals across all tasks (T-012). */
  queueSize?: number;
  /** Callback to approve/reject (T-012). */
  onApprovalDecision?: (requestId: string, approved: boolean) => void;
}

export function CardDetail({
  taskId,
  title,
  onClose,
  description,
  deps,
  tasks = [],
  transcript = {},
  steps = [],
  approval,
  queueSize = 0,
  onApprovalDecision,
}: CardDetailProps) {
  const hasGate = !!(approval && onApprovalDecision);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // Gate active: ⎋ = Reject (precedence over close), ⏎ = Approve
      if (hasGate) {
        if (e.key === "Escape") {
          e.preventDefault();
          onApprovalDecision!(approval!.requestId, false);
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          onApprovalDecision!(approval!.requestId, true);
          return;
        }
      }
      // No gate: ⎋ closes the drawer
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, hasGate, approval, onApprovalDecision]);

  const segments = useMemo(
    () => overlayStepUsage(segmentsFor(taskId, transcript), steps),
    [taskId, transcript, steps],
  );

  return (
    <aside
      className={`card-detail${hasGate ? " card-detail--gate" : ""}`}
      aria-label={`Detail for ${taskId}`}
    >
      {hasGate && (
        <section
          className="card-detail__gate"
          role="alertdialog"
          aria-label="Aprovação necessária"
        >
          <div className="card-detail__gate-header">
            <span className="card-detail__gate-icon">⚠</span>
            <span className="card-detail__gate-title t-body">
              Aprovação necessária
            </span>
            {queueSize > 1 && (
              <span className="card-detail__gate-queue t-label u-muted">
                ＋{queueSize - 1} na fila
              </span>
            )}
          </div>

          <div className="card-detail__gate-context t-label">
            <span className="card-detail__gate-task">{approval!.taskId}</span>
            <span>·</span>
            <span>{approval!.stepId}</span>
          </div>

          <p className="card-detail__gate-summary t-body">
            {approval!.summary}
          </p>

          <p className="card-detail__gate-cost t-label">
            Custo de reprovar: {escalationCost()}
          </p>

          <div className="card-detail__gate-actions">
            <button
              className="card-detail__gate-btn card-detail__gate-btn--reject"
              onClick={() => onApprovalDecision!(approval!.requestId, false)}
              type="button"
            >
              Reprovar
            </button>
            <button
              className="card-detail__gate-btn card-detail__gate-btn--approve"
              onClick={() => onApprovalDecision!(approval!.requestId, true)}
              type="button"
            >
              Aprovar
            </button>
          </div>
        </section>
      )}

      <header className="card-detail__header">
        <span className="card-detail__id t-data">{taskId}</span>
        <span className="card-detail__title t-body">{title}</span>
        <button
          className="card-detail__close"
          onClick={onClose}
          aria-label="Close detail"
          type="button"
        >
          ✕
        </button>
      </header>

      <div className="card-detail__body">
        {description && (
          <section className="card-detail__desc">
            <MarkdownStream text={description} />
          </section>
        )}

        {deps && deps.length > 0 && (
          <section className="card-detail__deps">
            {deps.map((depId) => {
              const depTask = tasks.find((t) => t.id === depId);
              const status: TaskStatus = depTask?.status ?? "ready";
              return (
                <span key={depId} className="card-detail__dep-chip">
                  <TaskStatusDot status={status} />
                  <span className="t-data">{depId}</span>
                </span>
              );
            })}
          </section>
        )}

        {segments.length > 0 && (
          <section className="card-detail__log">
            {segments.map((seg, i) => (
              <div key={`${seg.stepId}-${i}`}>
                {i > 0 && (
                  <StepDivider
                    label={seg.label}
                    agent={seg.agent}
                    usage={formatUsage(seg.usedTokens, seg.size, seg.model)}
                  />
                )}
                <MarkdownStream text={seg.text} />
              </div>
            ))}
          </section>
        )}
      </div>
    </aside>
  );
}
