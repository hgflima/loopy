/**
 * The human-annotation writers over the telemetry `.db` — the mutable
 * counterpart to the insert-only fact layer (`write.ts`). Three verbs, all
 * driven by the CLI (`loopy verdict|bug|change`, T-008 / D6/D20):
 *
 *  - `setVerdict` / `clearVerdict` — upsert and delete `task_verdict`. Delete is
 *    the tri-state "not evaluated" (NULL) the GUI reverts to (D20).
 *  - `addBug` — insert a `bug` (1:1 with a task, D14). No change restriction: a
 *    bug found while working the *current* change but belonging to a task from a
 *    *previous* one is the normal case (`found_in_change` records where it was
 *    found; `task_id` where it lives).
 *  - `setChangeStatus` — the single UPDATE of `change.status` outside the run's
 *    own INSERT OR IGNORE / `markChangeMerged` (D2/D20): close an **open** change
 *    as `abandoned` / `failed`.
 *
 * Unlike `write.ts` (which swallows every fault — collection must never throw
 * into the running engine, D9), these run one-shot from the CLI, so they return
 * a discriminated result the command layer turns into a clear message + exit
 * code. Expected failures (unknown task / change, ambiguity) are values, not
 * exceptions; they pre-check via {@link ./query} so the common misuse never
 * reaches the FK. A genuine driver fault still throws — the CLI action wraps it.
 */
import { randomUUID } from "node:crypto";

import type { TelemetryDb } from "./db";
import {
  changeStatus,
  openChangeIds,
  taskExists,
  type ChangeStatus,
} from "./query";

/** A human verdict on a task (`task_verdict.verdict`). */
export type Verdict = "pass" | "fail";

/** A bug severity (`bug.severity` CHECK). */
export type BugSeverity = "low" | "medium" | "high" | "critical";

/** The statuses the CLI can set on a change outside the auto `merged` path (D20). */
export type ClosedChangeStatus = "abandoned" | "failed";

// ---------------------------------------------------------------------------
// task_verdict — upsert / clear (D20)
// ---------------------------------------------------------------------------

// `by` is a SQLite keyword, so it is quoted in the SET clause (the column is
// declared unquoted in schema.sql, which CREATE TABLE tolerates).
const VERDICT_UPSERT = `
INSERT INTO task_verdict (task_id, verdict, note, "by", at)
VALUES (:task_id, :verdict, :note, :by, :at)
ON CONFLICT(task_id) DO UPDATE SET
  verdict = excluded.verdict,
  note    = excluded.note,
  "by"    = excluded."by",
  at      = excluded.at`;

/** The fields of one `verdict set` (upsert). */
export interface SetVerdictInput {
  readonly taskId: string;
  readonly verdict: Verdict;
  readonly note: string | null;
  readonly by: string;
  /** ISO timestamp; upsert refreshes it on every change (`task_verdict.at`). */
  readonly at: string;
}

/** Outcome of {@link setVerdict}: ok, or the task is not in the telemetry. */
export type SetVerdictResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "unknown-task" };

/**
 * Upsert a task's human verdict (D20). The `task_verdict.task_id` FK requires
 * the task fact to exist, so a missing task is reported as a clean value rather
 * than letting the FK throw. Re-running flips `verdict` and refreshes `by`/`at`.
 */
export function setVerdict(
  db: TelemetryDb,
  input: SetVerdictInput,
): SetVerdictResult {
  if (!taskExists(db, input.taskId)) return { ok: false, reason: "unknown-task" };
  db.prepare(VERDICT_UPSERT).run({
    task_id: input.taskId,
    verdict: input.verdict,
    note: input.note,
    by: input.by,
    at: input.at,
  });
  return { ok: true };
}

/**
 * Delete a task's verdict — the tri-state revert to "not evaluated" (NULL, D20).
 * Idempotent: `removed` is `false` when the task had no verdict to clear.
 */
export function clearVerdict(
  db: TelemetryDb,
  taskId: string,
): { readonly removed: boolean } {
  const res = db
    .prepare("DELETE FROM task_verdict WHERE task_id = :task_id")
    .run({ task_id: taskId });
  return { removed: Number(res.changes) > 0 };
}

// ---------------------------------------------------------------------------
// bug — insert (D14)
// ---------------------------------------------------------------------------

const BUG_INSERT = `
INSERT INTO bug (
  bug_id, task_id, found_in_change, title, detail, severity, status, reported_at, resolved_at
) VALUES (
  :bug_id, :task_id, :found_in_change, :title, :detail, :severity, 'open', :reported_at, NULL
)`;

/** The fields of one `bug add`. */
export interface AddBugInput {
  readonly taskId: string;
  readonly severity: BugSeverity;
  readonly title: string;
  readonly detail: string | null;
  /** Change the bug was found in (nullable FK); NULL when `--found-in` is absent. */
  readonly foundInChange: string | null;
  readonly reportedAt: string;
}

/** Outcome of {@link addBug}: the new bug id, or a missing FK target. */
export type AddBugResult =
  | { readonly ok: true; readonly bugId: string }
  | {
      readonly ok: false;
      readonly reason: "unknown-task" | "unknown-found-in-change";
    };

/**
 * Insert an open bug linked to its task (D14). Both FK targets are pre-checked
 * so a mistyped task or `--found-in` change is a clean value, not an FK throw;
 * the bug's task may live in any change (a previous-change bug is the norm).
 */
export function addBug(db: TelemetryDb, input: AddBugInput): AddBugResult {
  if (!taskExists(db, input.taskId)) return { ok: false, reason: "unknown-task" };
  if (
    input.foundInChange !== null &&
    changeStatus(db, input.foundInChange) === undefined
  ) {
    return { ok: false, reason: "unknown-found-in-change" };
  }
  const bugId = randomUUID();
  db.prepare(BUG_INSERT).run({
    bug_id: bugId,
    task_id: input.taskId,
    found_in_change: input.foundInChange,
    title: input.title,
    detail: input.detail,
    severity: input.severity,
    reported_at: input.reportedAt,
  });
  return { ok: true, bugId };
}

// ---------------------------------------------------------------------------
// change — close status (D2/D20)
// ---------------------------------------------------------------------------

// Guarded by `status IS NULL` so it only ever closes an OPEN change and never
// clobbers a terminal status (mirrors markChangeMerged) — the resolver has
// already asserted the target is open, so this always affects exactly one row.
const CHANGE_STATUS_UPDATE = `
UPDATE change SET status = :status, ended_at = :ended_at
WHERE change_id = :change_id AND status IS NULL`;

/** Outcome of {@link setChangeStatus}. */
export type SetChangeStatusResult =
  | { readonly ok: true; readonly changeId: string }
  | { readonly ok: false; readonly reason: "unknown-change"; readonly changeId: string }
  | {
      readonly ok: false;
      readonly reason: "already-closed";
      readonly changeId: string;
      readonly status: ChangeStatus;
    }
  | { readonly ok: false; readonly reason: "no-open-change" }
  | { readonly ok: false; readonly reason: "ambiguous"; readonly candidates: readonly string[] };

/**
 * Close a change as `abandoned` / `failed` — the sole UPDATE outside the run's
 * own change lifecycle (D2/D20). With `changeId` given, the change must exist
 * and still be open; omitted, it targets the single open change (ambiguous when
 * more than one is open, so the caller is asked to name it).
 */
export function setChangeStatus(
  db: TelemetryDb,
  status: ClosedChangeStatus,
  endedAt: string,
  changeId?: string,
): SetChangeStatusResult {
  const target = resolveChangeTarget(db, changeId);
  if ("error" in target) return target.error;
  db.prepare(CHANGE_STATUS_UPDATE).run({
    change_id: target.changeId,
    status,
    ended_at: endedAt,
  });
  return { ok: true, changeId: target.changeId };
}

/**
 * Resolve which change `setChangeStatus` should close: the named one (validated
 * open), or the single open change when unnamed. Returns the target id or the
 * failure value to surface.
 */
function resolveChangeTarget(
  db: TelemetryDb,
  changeId: string | undefined,
): { readonly changeId: string } | { readonly error: SetChangeStatusResult } {
  if (changeId !== undefined) {
    const current = changeStatus(db, changeId);
    if (current === undefined) {
      return { error: { ok: false, reason: "unknown-change", changeId } };
    }
    if (current.status !== null) {
      return {
        error: { ok: false, reason: "already-closed", changeId, status: current.status },
      };
    }
    return { changeId };
  }
  const open = openChangeIds(db);
  if (open.length === 0) return { error: { ok: false, reason: "no-open-change" } };
  if (open.length > 1) {
    return { error: { ok: false, reason: "ambiguous", candidates: open } };
  }
  return { changeId: open[0]! };
}
