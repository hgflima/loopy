/**
 * Tests for the human-annotation writers (`src/telemetry/annotate.ts`): upsert
 * `task_verdict`, delete it (tri-state → NULL, D20), insert `bug` (FK to task,
 * no change restriction — a bug from a previous change is the normal case), and
 * the single UPDATE of `change.status` outside the initial INSERT OR IGNORE
 * (D2/D20). Real `node:sqlite` on a temp file — no DB mock.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb, type TelemetryDb } from "../../src/telemetry/db";
import { bootstrap } from "../../src/telemetry/schema";
import { insertChange, insertTask } from "../../src/telemetry/write";
import {
  addBug,
  clearVerdict,
  setChangeStatus,
  setVerdict,
} from "../../src/telemetry/annotate";

function seedChange(db: TelemetryDb, id: string, createdAt: string): void {
  insertChange(db, {
    change_id: id,
    name: `${id}-name`,
    repo: "acp-agentic-loop",
    base_sha: "abc",
    pipeline_version: "sha256:pv",
    created_at: createdAt,
  });
}

function seedTask(db: TelemetryDb, changeId: string, taskId: string): void {
  insertTask(db, {
    task_id: taskId,
    change_id: changeId,
    task_number: taskId.split("/")[1] ?? taskId,
    name: "some task",
    created_at: "2026-07-14T00:00:00.000Z",
    ended_at: "2026-07-14T00:05:00.000Z",
    status: "merged",
    size_files: 1,
    size_added: 2,
    size_removed: 0,
  });
}

describe("telemetry annotate — task_verdict upsert / clear (D20)", () => {
  let dir: string;
  let db: TelemetryDb;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "loopy-annotate-verdict-"));
    db = await openDb(join(dir, "telemetry.db"));
    await bootstrap(db);
    seedChange(db, "C-0017", "2026-07-14T00:00:00.000Z");
    seedTask(db, "C-0017", "C-0017/T-001");
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("setVerdict inserts a new verdict row", () => {
    const res = setVerdict(db, {
      taskId: "C-0017/T-001",
      verdict: "pass",
      note: "looks good",
      by: "alice",
      at: "2026-07-14T10:00:00.000Z",
    });
    expect(res).toEqual({ ok: true });
    const row = db
      .prepare("SELECT * FROM task_verdict WHERE task_id='C-0017/T-001'")
      .get<Record<string, unknown>>();
    expect(row).toMatchObject({
      task_id: "C-0017/T-001",
      verdict: "pass",
      note: "looks good",
      by: "alice",
      at: "2026-07-14T10:00:00.000Z",
    });
  });

  it("setVerdict upserts — a second call flips verdict and updates by/at, still one row", () => {
    setVerdict(db, {
      taskId: "C-0017/T-001",
      verdict: "pass",
      note: null,
      by: "alice",
      at: "2026-07-14T10:00:00.000Z",
    });
    setVerdict(db, {
      taskId: "C-0017/T-001",
      verdict: "fail",
      note: "regression",
      by: "bob",
      at: "2026-07-15T09:00:00.000Z",
    });
    const rows = db.all<Record<string, unknown>>(
      "SELECT * FROM task_verdict WHERE task_id='C-0017/T-001'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      verdict: "fail",
      note: "regression",
      by: "bob",
      at: "2026-07-15T09:00:00.000Z",
    });
  });

  it("setVerdict on an unknown task returns unknown-task and writes nothing", () => {
    const res = setVerdict(db, {
      taskId: "C-0017/T-404",
      verdict: "pass",
      note: null,
      by: "alice",
      at: "2026-07-14T10:00:00.000Z",
    });
    expect(res).toEqual({ ok: false, reason: "unknown-task" });
    expect(db.all("SELECT * FROM task_verdict")).toHaveLength(0);
  });

  it("clearVerdict removes the row (tri-state back to NULL) and reports removed:true", () => {
    setVerdict(db, {
      taskId: "C-0017/T-001",
      verdict: "pass",
      note: null,
      by: "alice",
      at: "2026-07-14T10:00:00.000Z",
    });
    expect(clearVerdict(db, "C-0017/T-001")).toEqual({ removed: true });
    expect(db.all("SELECT * FROM task_verdict")).toHaveLength(0);
  });

  it("clearVerdict on a task with no verdict is idempotent (removed:false)", () => {
    expect(clearVerdict(db, "C-0017/T-001")).toEqual({ removed: false });
  });
});

describe("telemetry annotate — bug add (D14)", () => {
  let dir: string;
  let db: TelemetryDb;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "loopy-annotate-bug-"));
    db = await openDb(join(dir, "telemetry.db"));
    await bootstrap(db);
    seedChange(db, "C-0016", "2026-07-01T00:00:00.000Z");
    seedTask(db, "C-0016", "C-0016/T-002");
    seedChange(db, "C-0017", "2026-07-14T00:00:00.000Z");
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("adds an open bug linked to its task, found_in_change NULL by default", () => {
    const res = addBug(db, {
      taskId: "C-0016/T-002",
      severity: "high",
      title: "boom",
      detail: null,
      foundInChange: null,
      reportedAt: "2026-07-14T11:00:00.000Z",
    });
    expect(res.ok).toBe(true);
    const row = db
      .prepare("SELECT * FROM bug")
      .get<Record<string, unknown>>();
    expect(row).toMatchObject({
      task_id: "C-0016/T-002",
      severity: "high",
      title: "boom",
      status: "open",
      found_in_change: null,
      resolved_at: null,
    });
    if (res.ok) expect(row?.bug_id).toBe(res.bugId);
  });

  it("links a bug found in the CURRENT change to a task from a PREVIOUS change (the acceptance)", () => {
    const res = addBug(db, {
      taskId: "C-0016/T-002", // task lives in the previous change
      severity: "medium",
      title: "late regression",
      detail: "surfaced while working C-0017",
      foundInChange: "C-0017", // discovered in the current change
      reportedAt: "2026-07-14T11:00:00.000Z",
    });
    expect(res.ok).toBe(true);
    const row = db
      .prepare("SELECT task_id, found_in_change FROM bug")
      .get<{ task_id: string; found_in_change: string }>();
    expect(row?.task_id).toBe("C-0016/T-002");
    expect(row?.found_in_change).toBe("C-0017");
  });

  it("rejects a bug on an unknown task (unknown-task) and writes nothing", () => {
    const res = addBug(db, {
      taskId: "C-9999/T-1",
      severity: "low",
      title: "ghost",
      detail: null,
      foundInChange: null,
      reportedAt: "2026-07-14T11:00:00.000Z",
    });
    expect(res).toEqual({ ok: false, reason: "unknown-task" });
    expect(db.all("SELECT * FROM bug")).toHaveLength(0);
  });

  it("rejects a bug whose --found-in change does not exist (unknown-found-in-change)", () => {
    const res = addBug(db, {
      taskId: "C-0016/T-002",
      severity: "low",
      title: "x",
      detail: null,
      foundInChange: "C-0099",
      reportedAt: "2026-07-14T11:00:00.000Z",
    });
    expect(res).toEqual({ ok: false, reason: "unknown-found-in-change" });
    expect(db.all("SELECT * FROM bug")).toHaveLength(0);
  });

  it("assigns a distinct bug_id per add (many bugs per task allowed)", () => {
    const a = addBug(db, {
      taskId: "C-0016/T-002",
      severity: "low",
      title: "one",
      detail: null,
      foundInChange: null,
      reportedAt: "2026-07-14T11:00:00.000Z",
    });
    const b = addBug(db, {
      taskId: "C-0016/T-002",
      severity: "low",
      title: "two",
      detail: null,
      foundInChange: null,
      reportedAt: "2026-07-14T11:01:00.000Z",
    });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.bugId).not.toBe(b.bugId);
    expect(db.all("SELECT * FROM bug")).toHaveLength(2);
  });
});

describe("telemetry annotate — change status close (D2/D20)", () => {
  let dir: string;
  let db: TelemetryDb;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "loopy-annotate-change-"));
    db = await openDb(join(dir, "telemetry.db"));
    await bootstrap(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("closes an explicitly named open change as abandoned (status + ended_at)", () => {
    seedChange(db, "C-0017", "2026-07-14T00:00:00.000Z");
    const res = setChangeStatus(
      db,
      "abandoned",
      "2026-07-15T00:00:00.000Z",
      "C-0017",
    );
    expect(res).toEqual({ ok: true, changeId: "C-0017" });
    const row = db
      .prepare("SELECT status, ended_at FROM change WHERE change_id='C-0017'")
      .get<{ status: string; ended_at: string }>();
    expect(row?.status).toBe("abandoned");
    expect(row?.ended_at).toBe("2026-07-15T00:00:00.000Z");
  });

  it("closes as failed too", () => {
    seedChange(db, "C-0017", "2026-07-14T00:00:00.000Z");
    setChangeStatus(db, "failed", "t", "C-0017");
    const row = db
      .prepare("SELECT status FROM change WHERE change_id='C-0017'")
      .get<{ status: string }>();
    expect(row?.status).toBe("failed");
  });

  it("defaults to the single open change when --change is omitted", () => {
    seedChange(db, "C-0017", "2026-07-14T00:00:00.000Z");
    const res = setChangeStatus(db, "abandoned", "t");
    expect(res).toEqual({ ok: true, changeId: "C-0017" });
  });

  it("is ambiguous when more than one change is open", () => {
    seedChange(db, "C-0016", "2026-07-01T00:00:00.000Z");
    seedChange(db, "C-0017", "2026-07-14T00:00:00.000Z");
    const res = setChangeStatus(db, "failed", "t");
    expect(res).toEqual({
      ok: false,
      reason: "ambiguous",
      candidates: ["C-0016", "C-0017"],
    });
    // Nothing closed on ambiguity.
    expect(
      db.all("SELECT * FROM change WHERE status IS NOT NULL"),
    ).toHaveLength(0);
  });

  it("reports no-open-change when every change is already closed and no id given", () => {
    seedChange(db, "C-0017", "2026-07-14T00:00:00.000Z");
    db.prepare(
      "UPDATE change SET status='merged', ended_at='t' WHERE change_id='C-0017'",
    ).run();
    expect(setChangeStatus(db, "abandoned", "t")).toEqual({
      ok: false,
      reason: "no-open-change",
    });
  });

  it("reports unknown-change for a named change that does not exist", () => {
    expect(setChangeStatus(db, "failed", "t", "C-0099")).toEqual({
      ok: false,
      reason: "unknown-change",
      changeId: "C-0099",
    });
  });

  it("refuses to clobber a change a human already closed (already-closed)", () => {
    seedChange(db, "C-0017", "2026-07-14T00:00:00.000Z");
    db.prepare(
      "UPDATE change SET status='merged', ended_at='t0' WHERE change_id='C-0017'",
    ).run();
    const res = setChangeStatus(db, "abandoned", "t1", "C-0017");
    expect(res).toEqual({
      ok: false,
      reason: "already-closed",
      changeId: "C-0017",
      status: "merged",
    });
    // The original terminal status is untouched.
    const row = db
      .prepare("SELECT status, ended_at FROM change WHERE change_id='C-0017'")
      .get<{ status: string; ended_at: string }>();
    expect(row?.status).toBe("merged");
    expect(row?.ended_at).toBe("t0");
  });
});
