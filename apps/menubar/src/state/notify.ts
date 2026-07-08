/**
 * Pure notification decision helper (T-017 — signal discipline, refino #8).
 *
 * Given a {@link ControlFrame} or {@link StoreEvent}, returns a
 * {@link NotificationPayload} when the event warrants a system notification,
 * or `null` when it should be silent.
 *
 * Exactly 4 triggers:
 * 1. `approval_requested` — gate requiring human decision (always)
 * 2. `run_finished` — backlog complete
 * 3. `task_finished` + `"escalated"` — persistent failure, human needed
 * 4. `task_finished` + `"paused"` — resumable, awaiting human
 *
 * Never notifies on `task_finished` + `"done"` (noise — signal discipline)
 * or `"skipped"` (transitive, not actionable).
 */

import type { ControlFrame } from "loopy/tui/transport";
import type { StoreEvent } from "loopy/tui/store";

export interface NotificationPayload {
  readonly title: string;
  readonly body: string;
}

export function shouldNotify(
  input: ControlFrame | StoreEvent,
): NotificationPayload | null {
  // --- Control frames ---
  if ("control" in input) {
    switch (input.control) {
      case "approval_requested":
        return {
          title: `Aprovação: ${input.taskId}`,
          body: input.summary,
        };
      case "run_finished":
        return {
          title: "Run concluído",
          body: "Backlog processado.",
        };
      default:
        return null;
    }
  }

  // --- Store events (only task_finished is relevant) ---
  if (input.type !== "task_finished") return null;

  switch (input.status) {
    case "escalated":
      return {
        title: `Escalonada: ${input.taskId}`,
        body: input.reason ?? "Task escalonada — ação humana necessária.",
      };
    case "paused":
      return {
        title: `Pausada: ${input.taskId}`,
        body: input.reason ?? "Task pausada — pode ser retomada.",
      };
    default:
      // "done" and "skipped" — never notify (signal discipline)
      return null;
  }
}
