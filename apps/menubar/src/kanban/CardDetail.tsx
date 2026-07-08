/**
 * CardDetail — drawer content for the selected card (D1/D2, T-011).
 *
 * Three content sections inside the scrollable body:
 * - **Description** — task body rendered as sanitized markdown (MarkdownStream).
 * - **Deps chips** — dependency IDs as chips with status dots.
 * - **Log** — persisted transcript (segmentsFor) with step dividers.
 *
 * All sections are gracefully hidden when their data is absent, ensuring the
 * card never breaks with --emit-events off or pre-registration state.
 */
import { useEffect, useMemo } from "react";
import type { TaskStatus } from "loopy/tui/store";
import { segmentsFor, type Transcript } from "../state/stream-history";
import { TaskStatusDot, MarkdownStream, StepDivider } from "../ui";
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
}

export function CardDetail({
  taskId,
  title,
  onClose,
  description,
  deps,
  tasks = [],
  transcript = {},
}: CardDetailProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const segments = useMemo(
    () => segmentsFor(taskId, transcript),
    [taskId, transcript],
  );

  return (
    <aside className="card-detail" aria-label={`Detail for ${taskId}`}>
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
              const status: TaskStatus = depTask?.status ?? "pending";
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
                {i > 0 && <StepDivider label={seg.label} />}
                <MarkdownStream text={seg.text} />
              </div>
            ))}
          </section>
        )}
      </div>
    </aside>
  );
}
