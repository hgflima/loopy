import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb, type TelemetryDb } from "../../src/telemetry/db";
import { bootstrap } from "../../src/telemetry/schema";
import {
  createVisitRecorder,
  insertAgentConfig,
  insertChange,
  insertStep,
  insertTask,
  markChangeMerged,
  type AgentConfigRow,
  type ChangeRow,
  type StepRow,
  type TaskRow,
} from "../../src/telemetry/write";

// A complete non-agent step row; each test overrides only what it exercises.
function stepRow(over: Partial<StepRow> = {}): StepRow {
  return {
    task_id: "C-0017/T-001",
    change_id: "C-0017",
    name: "create-worktree",
    kind: "shell",
    visit_no: 1,
    attempt_no: 1,
    config_id: null,
    queued_at: null,
    started_at: "2026-07-14T00:00:00.000Z",
    ended_at: "2026-07-14T00:00:01.000Z",
    status: "pass",
    fail_reason: null,
    fail_detail: null,
    tokens_in: 0,
    tokens_out: 0,
    tokens_cache_read: 0,
    tokens_cache_write: 0,
    cost_usd: null,
    cost_confidence: "exact",
    price_version: null,
    human_seconds: null,
    ...over,
  };
}

const agentConfigRow: AgentConfigRow = {
  config_id: "cfg1",
  preset: "claude",
  model: "claude-opus",
  mode: "acceptEdits",
  effort: "high",
  prompt_version: "pv1",
  resolved_json: '{"command":["claude"]}',
  first_seen_at: "2026-07-14T00:00:00.000Z",
};

describe("telemetry write — insertStep", () => {
  let dir: string;
  let db: TelemetryDb;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "loopy-write-"));
    db = await openDb(join(dir, "telemetry.db"));
    await bootstrap(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("derives seq per-task in the statement (D25): 1, 2, ... within a task", () => {
    insertStep(db, stepRow({ name: "a" }));
    insertStep(db, stepRow({ name: "b" }));
    insertStep(db, stepRow({ name: "c" }));

    const seqs = db
      .all<{ name: string; seq: number }>(
        "SELECT name, seq FROM step WHERE task_id = 'C-0017/T-001' ORDER BY seq",
      )
      .map((r) => `${r.name}:${r.seq}`);
    expect(seqs).toEqual(["a:1", "b:2", "c:3"]);
  });

  it("scopes seq to task_id — a second task restarts at 1", () => {
    insertStep(db, stepRow({ task_id: "C-0017/T-001" }));
    insertStep(db, stepRow({ task_id: "C-0017/T-002" }));
    insertStep(db, stepRow({ task_id: "C-0017/T-002" }));

    const t1 = db.all<{ seq: number }>(
      "SELECT seq FROM step WHERE task_id = 'C-0017/T-001'",
    );
    const t2 = db.all<{ seq: number }>(
      "SELECT seq FROM step WHERE task_id = 'C-0017/T-002' ORDER BY seq",
    );
    expect(t1.map((r) => r.seq)).toEqual([1]);
    expect(t2.map((r) => r.seq)).toEqual([1, 2]);
  });

  it("assigns a unique step_id per physical insert (so resume re-visits never collide)", () => {
    insertStep(db, stepRow());
    insertStep(db, stepRow());
    const ids = db.all<{ step_id: string }>("SELECT step_id FROM step");
    expect(ids).toHaveLength(2);
    expect(new Set(ids.map((r) => r.step_id)).size).toBe(2);
  });

  it("persists a non-agent visit row with config_id NULL and zeroed tokens", () => {
    insertStep(db, stepRow({ kind: "checks", status: "fail" }));
    const row = db
      .prepare("SELECT * FROM step")
      .get<Record<string, unknown>>();
    expect(row?.kind).toBe("checks");
    expect(row?.status).toBe("fail");
    expect(row?.attempt_no).toBe(1);
    expect(row?.config_id).toBeNull();
    expect(row?.cost_usd).toBeNull();
    expect(row?.tokens_in).toBe(0);
  });

  it("never throws when the write fails (best-effort, safeEmit style)", () => {
    db.close();
    expect(() => insertStep(db, stepRow())).not.toThrow();
  });

  it("never throws on a CHECK violation (invalid status)", () => {
    expect(() =>
      insertStep(db, stepRow({ status: "bogus" as StepRow["status"] })),
    ).not.toThrow();
    expect(db.all("SELECT * FROM step")).toHaveLength(0);
  });
});

describe("telemetry write — insertAgentConfig (INSERT OR IGNORE)", () => {
  let dir: string;
  let db: TelemetryDb;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "loopy-write-cfg-"));
    db = await openDb(join(dir, "telemetry.db"));
    await bootstrap(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("inserts once and ignores a duplicate config_id (idempotent)", () => {
    insertAgentConfig(db, agentConfigRow);
    insertAgentConfig(db, { ...agentConfigRow, model: "changed" });
    const rows = db.all<{ config_id: string; model: string }>(
      "SELECT config_id, model FROM agent_config",
    );
    expect(rows).toHaveLength(1);
    // First write wins (OR IGNORE), so the model is the original.
    expect(rows[0]?.model).toBe("claude-opus");
  });

  it("lets a step row reference an inserted config_id (FK satisfied)", () => {
    insertAgentConfig(db, agentConfigRow);
    insertStep(db, stepRow({ config_id: "cfg1", kind: "agent" }));
    const row = db
      .prepare("SELECT config_id FROM step")
      .get<{ config_id: string }>();
    expect(row?.config_id).toBe("cfg1");
  });

  it("never throws when the write fails (best-effort)", () => {
    db.close();
    expect(() => insertAgentConfig(db, agentConfigRow)).not.toThrow();
  });
});

// A complete `change` dimension row; each test overrides only what it exercises.
function changeRow(over: Partial<ChangeRow> = {}): ChangeRow {
  return {
    change_id: "C-0017",
    name: "C-0017-telemetry-and-change-insights",
    repo: "acp-agentic-loop",
    base_sha: "abc123",
    pipeline_version: "sha256:deadbeef",
    created_at: "2026-07-14T00:00:00.000Z",
    ...over,
  };
}

describe("telemetry write — change dimension (D2)", () => {
  let dir: string;
  let db: TelemetryDb;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "loopy-change-"));
    db = await openDb(join(dir, "telemetry.db"));
    await bootstrap(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("inserts an in-progress change — status and ended_at NULL (D2)", () => {
    insertChange(db, changeRow());
    const row = db
      .prepare("SELECT * FROM change")
      .get<Record<string, unknown>>();
    expect(row?.change_id).toBe("C-0017");
    expect(row?.name).toBe("C-0017-telemetry-and-change-insights");
    expect(row?.repo).toBe("acp-agentic-loop");
    expect(row?.base_sha).toBe("abc123");
    expect(row?.pipeline_version).toBe("sha256:deadbeef");
    expect(row?.created_at).toBe("2026-07-14T00:00:00.000Z");
    // In progress: no terminal status, no end timestamp.
    expect(row?.status).toBeNull();
    expect(row?.ended_at).toBeNull();
  });

  it("stores base_sha NULL when the parent HEAD is unknown (best-effort)", () => {
    insertChange(db, changeRow({ base_sha: null }));
    const row = db
      .prepare("SELECT base_sha FROM change")
      .get<{ base_sha: string | null }>();
    expect(row?.base_sha).toBeNull();
  });

  it("is INSERT OR IGNORE — the first write of a change_id wins", () => {
    insertChange(db, changeRow({ name: "first" }));
    insertChange(db, changeRow({ name: "second" }));
    const rows = db.all<{ name: string }>("SELECT name FROM change");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("first");
  });

  it("markChangeMerged closes an open change (status='merged' + ended_at)", () => {
    insertChange(db, changeRow());
    markChangeMerged(db, "C-0017", "2026-07-14T12:00:00.000Z");
    const row = db
      .prepare("SELECT status, ended_at FROM change")
      .get<{ status: string; ended_at: string }>();
    expect(row?.status).toBe("merged");
    expect(row?.ended_at).toBe("2026-07-14T12:00:00.000Z");
  });

  it("markChangeMerged only closes an OPEN change — never clobbers a CLI-set status", () => {
    insertChange(db, changeRow());
    // Simulate `loopy change --abandoned` (T-008) having already closed it.
    db.prepare(
      "UPDATE change SET status='abandoned', ended_at='2026-07-14T09:00:00.000Z' WHERE change_id='C-0017'",
    ).run();
    markChangeMerged(db, "C-0017", "2026-07-14T12:00:00.000Z");
    const row = db
      .prepare("SELECT status, ended_at FROM change")
      .get<{ status: string; ended_at: string }>();
    expect(row?.status).toBe("abandoned");
    expect(row?.ended_at).toBe("2026-07-14T09:00:00.000Z");
  });

  it("lets a task row reference an inserted change_id — FK resolves (the acceptance)", () => {
    insertChange(db, changeRow());
    expect(() =>
      db
        .prepare(
          `INSERT INTO task (task_id, change_id, task_number, name, created_at, ended_at, status)
           VALUES ('C-0017/T-005','C-0017','T-005','x','a','b','merged')`,
        )
        .run(),
    ).not.toThrow();
    expect(db.all("SELECT * FROM task")).toHaveLength(1);
  });

  it("rejects a task row referencing an unknown change_id (FK enforced)", () => {
    // No change inserted → the FK to change(change_id) has nothing to resolve.
    expect(() =>
      db
        .prepare(
          `INSERT INTO task (task_id, change_id, task_number, name, created_at, ended_at, status)
           VALUES ('MISSING/T-1','MISSING','T-1','x','a','b','merged')`,
        )
        .run(),
    ).toThrow();
  });

  it("never throws when the write fails (best-effort, safeEmit style)", () => {
    db.close();
    expect(() => insertChange(db, changeRow())).not.toThrow();
    expect(() => markChangeMerged(db, "C-0017", "t")).not.toThrow();
  });
});

// A complete `task` fact row; each test overrides only what it exercises. The
// change dimension it references is seeded by the enclosing describe (FK).
function taskRow(over: Partial<TaskRow> = {}): TaskRow {
  return {
    task_id: "C-0017/T-006",
    change_id: "C-0017",
    task_number: "T-006",
    name: "Linha task + size_* via git diff --numstat",
    created_at: "2026-07-14T00:00:00.000Z",
    ended_at: "2026-07-14T00:05:00.000Z",
    status: "merged",
    size_files: 3,
    size_added: 42,
    size_removed: 7,
    ...over,
  };
}

describe("telemetry write — insertTask (terminal task fact, T-006)", () => {
  let dir: string;
  let db: TelemetryDb;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "loopy-task-"));
    db = await openDb(join(dir, "telemetry.db"));
    await bootstrap(db);
    // The task FK needs its change dimension to exist first (D2).
    insertChange(db, changeRow());
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("inserts a merged task carrying its size_* churn", () => {
    insertTask(db, taskRow());
    const row = db.prepare("SELECT * FROM task").get<Record<string, unknown>>();
    expect(row?.task_id).toBe("C-0017/T-006");
    expect(row?.change_id).toBe("C-0017");
    expect(row?.task_number).toBe("T-006");
    expect(row?.status).toBe("merged");
    expect(row?.size_files).toBe(3);
    expect(row?.size_added).toBe(42);
    expect(row?.size_removed).toBe(7);
  });

  it("inserts a failed task with size_* NULL", () => {
    insertTask(db, taskRow({
      task_id: "C-0017/T-007",
      task_number: "T-007",
      status: "failed",
      size_files: null,
      size_added: null,
      size_removed: null,
    }));
    const row = db
      .prepare("SELECT status, size_files, size_added, size_removed FROM task")
      .get<Record<string, unknown>>();
    expect(row?.status).toBe("failed");
    expect(row?.size_files).toBeNull();
    expect(row?.size_added).toBeNull();
    expect(row?.size_removed).toBeNull();
  });

  it("SUM(step.cost_usd) matches v_task.cost_usd for the task (D-0008)", () => {
    insertTask(db, taskRow());
    // Three per-attempt-ish step rows with known costs summing to 0.30.
    for (const [name, cost] of [["a", 0.1], ["b", 0.15], ["c", 0.05]] as const) {
      insertStep(db, stepRow({ task_id: "C-0017/T-006", name, cost_usd: cost }));
    }
    const agg = db
      .prepare("SELECT cost_usd FROM v_task WHERE task_id = 'C-0017/T-006'")
      .get<{ cost_usd: number }>();
    expect(agg?.cost_usd).toBeCloseTo(0.3, 6);
  });

  it("never throws when the write fails (best-effort, safeEmit style)", () => {
    db.close();
    expect(() => insertTask(db, taskRow())).not.toThrow();
  });

  it("never throws on an FK violation (unknown change_id)", () => {
    expect(() =>
      insertTask(db, taskRow({ task_id: "X/T-1", change_id: "MISSING" })),
    ).not.toThrow();
    expect(db.all("SELECT * FROM task WHERE change_id = 'MISSING'")).toHaveLength(0);
  });
});

describe("telemetry write — createVisitRecorder (per-Visit, non-agent)", () => {
  let dir: string;
  let db: TelemetryDb;
  // Deterministic clock: started at t0, ended at t1 (1s later).
  const clock = () => {
    const seq = [1_000_000, 1_001_000];
    let i = 0;
    return () => seq[Math.min(i++, seq.length - 1)]!;
  };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "loopy-recorder-"));
    db = await openDb(join(dir, "telemetry.db"));
    await bootstrap(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("finalize inserts one Visit row for a non-agent step (status from result.ok)", () => {
    const rec = createVisitRecorder(db, {
      taskId: "C-0017/T-001",
      changeId: "C-0017",
      stepName: "run-ci",
      kind: "checks",
      visitNo: 2,
      now: clock(),
    });
    rec.finalize({ ok: true });

    const row = db.prepare("SELECT * FROM step").get<Record<string, unknown>>();
    expect(row?.task_id).toBe("C-0017/T-001");
    expect(row?.change_id).toBe("C-0017");
    expect(row?.name).toBe("run-ci");
    expect(row?.kind).toBe("checks");
    expect(row?.visit_no).toBe(2);
    expect(row?.attempt_no).toBe(1);
    expect(row?.seq).toBe(1);
    expect(row?.status).toBe("pass");
    expect(row?.config_id).toBeNull();
    expect(row?.cost_usd).toBeNull();
    expect(row?.started_at).toBe(new Date(1_000_000).toISOString());
    expect(row?.ended_at).toBe(new Date(1_001_000).toISOString());
  });

  it("finalize maps a failed result to status 'fail'", () => {
    const rec = createVisitRecorder(db, {
      taskId: "C-0017/T-001",
      changeId: "C-0017",
      stepName: "gate",
      kind: "approval",
      visitNo: 1,
      now: clock(),
    });
    rec.finalize({ ok: false, reason: "rejected" });
    const row = db.prepare("SELECT status FROM step").get<{ status: string }>();
    expect(row?.status).toBe("fail");
  });

  it("finalize records NOTHING for an agent step with no pushed samples (no phantom row)", () => {
    const rec = createVisitRecorder(db, {
      taskId: "C-0017/T-001",
      changeId: "C-0017",
      stepName: "implement",
      kind: "agent",
      visitNo: 1,
      configId: "cfg1",
      now: clock(),
    });
    rec.finalize({ ok: true });
    expect(db.all("SELECT * FROM step")).toHaveLength(0);
  });

  it("finalize inserts one row per pushed AttemptSample for an agent step (T-007 / D3)", () => {
    // Seed the config dimension so the step.config_id FK resolves.
    insertAgentConfig(db, agentConfigRow);
    const rec = createVisitRecorder(db, {
      taskId: "C-0017/T-007",
      changeId: "C-0017",
      stepName: "implement",
      kind: "agent",
      visitNo: 3,
      configId: "cfg1",
      now: clock(),
    });
    rec.push({
      attemptNo: 1,
      startedAt: 1_000_000,
      endedAt: 1_002_000,
      status: "fail",
      failReason: "test-fail",
      failDetail: "unit-test",
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cachedReadTokens: 5,
        cachedWriteTokens: 3,
        totalTokens: 128,
        available: true,
      },
      costDelta: 0.1,
    });
    rec.push({
      attemptNo: 2,
      startedAt: 1_002_000,
      endedAt: 1_003_000,
      status: "pass",
      failReason: null,
      failDetail: null,
      usage: null,
      costDelta: 0.15,
    });
    // finalize ignores the aggregate result for an agent step — it never
    // re-drains; the pushed samples are the source of truth.
    rec.finalize({ ok: true });

    const rows = db.all<Record<string, unknown>>(
      "SELECT * FROM step ORDER BY attempt_no",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      task_id: "C-0017/T-007",
      name: "implement",
      kind: "agent",
      visit_no: 3,
      attempt_no: 1,
      seq: 1,
      status: "fail",
      fail_reason: "test-fail",
      fail_detail: "unit-test",
      config_id: "cfg1",
      tokens_in: 100,
      tokens_out: 20,
      tokens_cache_read: 5,
      tokens_cache_write: 3,
    });
    expect(rows[0]!.cost_usd).toBeCloseTo(0.1, 10);
    expect(rows[0]!.started_at).toBe(new Date(1_000_000).toISOString());
    expect(rows[0]!.ended_at).toBe(new Date(1_002_000).toISOString());
    expect(rows[1]).toMatchObject({
      attempt_no: 2,
      seq: 2,
      status: "pass",
      fail_reason: null,
      // Zeroed token counters when usage was unreported (NULL usage).
      tokens_in: 0,
      tokens_out: 0,
    });
    expect(rows[1]!.cost_usd).toBeCloseTo(0.15, 10);
  });

  it("finalize carries human_seconds and fail_reason onto a non-agent row", () => {
    const rec = createVisitRecorder(db, {
      taskId: "C-0017/T-001",
      changeId: "C-0017",
      stepName: "merge",
      kind: "approval",
      visitNo: 1,
      now: clock(),
    });
    rec.setHumanSeconds(42);
    rec.setFailReason("human-rejected");
    rec.finalize({ ok: false, reason: "rejected" });

    const row = db
      .prepare("SELECT * FROM step")
      .get<Record<string, unknown>>();
    expect(row?.status).toBe("fail");
    expect(row?.fail_reason).toBe("human-rejected");
    expect(row?.human_seconds).toBe(42);
    expect(row?.attempt_no).toBe(1);
  });

  it("exposes the injected clock via now() (delegates, monotonic)", () => {
    let t = 100;
    const rec = createVisitRecorder(db, {
      taskId: "C-0017/T-001",
      changeId: "C-0017",
      stepName: "implement",
      kind: "agent",
      visitNo: 1,
      now: () => {
        const v = t;
        t += 5;
        return v;
      },
    });
    // now() forwards to the injected clock regardless of construction-time reads.
    const a = rec.now();
    const b = rec.now();
    expect(b - a).toBe(5);
  });

  it("finalize never throws even if the DB write fails", () => {
    const rec = createVisitRecorder(db, {
      taskId: "C-0017/T-001",
      changeId: "C-0017",
      stepName: "run-ci",
      kind: "checks",
      visitNo: 1,
      now: clock(),
    });
    db.close();
    expect(() => rec.finalize({ ok: true })).not.toThrow();
  });
});
