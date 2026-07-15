/**
 * Internal typed SELECTs over the telemetry `.db`, reused by {@link ./annotate}.
 *
 * These are **not** a CLI read surface (D19): the only reader of telemetry for
 * display is the GUI's Rust `rusqlite` layer (SELECT-only over the views). This
 * module exists solely so the annotation writers (verdict / bug / change) can
 * pre-check existence and resolve the default open change with a clean, typed
 * result — instead of leaning on FK exceptions bubbling up from the driver.
 * There is deliberately no `loopy report`.
 */
import type { TelemetryDb } from "./db";

/** A terminal status a change can carry (NULL = still open / in progress, D2). */
export type ChangeStatus = "merged" | "abandoned" | "failed";

/** `true` iff a `task` fact row exists — the FK target of task_verdict / bug. */
export function taskExists(db: TelemetryDb, taskId: string): boolean {
  return (
    db
      .prepare("SELECT 1 AS ok FROM task WHERE task_id = :task_id")
      .get<{ ok: number }>({ task_id: taskId }) !== undefined
  );
}

/**
 * The current status of a change, or `undefined` when the change does not exist.
 * A present row with `status: null` is an **open** change (in progress) — the
 * distinction the caller needs to tell "unknown change" from "already closed".
 */
export function changeStatus(
  db: TelemetryDb,
  changeId: string,
): { readonly status: ChangeStatus | null } | undefined {
  return db
    .prepare("SELECT status FROM change WHERE change_id = :change_id")
    .get<{ status: ChangeStatus | null }>({ change_id: changeId });
}

/** The ids of every currently-open change (`status IS NULL`), oldest first. */
export function openChangeIds(db: TelemetryDb): readonly string[] {
  return db
    .all<{ change_id: string }>(
      "SELECT change_id FROM change WHERE status IS NULL ORDER BY created_at, change_id",
    )
    .map((r) => r.change_id);
}
