import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDb, type TelemetryDb } from "../../src/telemetry/db";
import { bootstrap } from "../../src/telemetry/schema";
import { runLoop } from "../../src/loop/orchestrator";
import type {
  DiffNumstat,
  EscalationPolicy,
  GitPort,
  LoopyConfig,
  Step,
  StepConfig,
  StepResult,
  StepType,
  Task,
} from "../../src/types";
import { createStepRegistry } from "../../src/steps/index";
import {
  makeConfig,
  makeDeps,
  makeTask,
  recordingMarkDone,
  scriptedRegistry,
  shell,
  type Recorder,
} from "../loop/support";

// Point the backlog at a real change dir so ids carry a `C-\d+` prefix (D26).
function changeConfig(config: LoopyConfig): LoopyConfig {
  return {
    ...config,
    inputs: {
      ...config.inputs,
      todo: ".harn/devy/changes/C-0017-telemetry-and-change-insights/todo.md",
    },
  };
}

// Monotonic clock: each call advances 1s, so created_at < ended_at.
function tickingClock(startMs = 1_000_000): () => number {
  let t = startMs - 1000;
  return () => (t += 1000);
}

// A GitPort stub. By default git lookups succeed with a base sha (so `size_*`
// churn is captured) and report no churn; each test overrides what it needs.
function gitStub(over: Partial<GitPort> = {}): GitPort {
  return {
    addWorktree: async () => {},
    removeWorktree: async () => {},
    merge: async () => ({ ok: true, conflict: false }),
    isParentClean: async () => true,
    isMergeInProgress: async () => false,
    rebaseOnto: async () => ({ ok: true, conflict: false }),
    revParseHead: async () => "base0000",
    remoteOriginUrl: async () => null,
    diffNumstat: async () => ({ files: 0, added: 0, removed: 0 }),
    ...over,
  };
}

const SKIP_TASK: EscalationPolicy = {
  action: "skip_task",
  keep_worktree: false,
  notify: "",
};
const PAUSE: EscalationPolicy = {
  action: "pause",
  keep_worktree: true,
  notify: "",
};

interface TaskShape {
  task_id: string;
  change_id: string;
  task_number: string;
  name: string;
  status: string;
  size_files: number | null;
  size_added: number | null;
  size_removed: number | null;
}

const ALL_TASKS = "SELECT * FROM task";

/** Run a scripted single/multi-task loop with the C-0017 change config. */
async function runTaskLoop(opts: {
  pipeline: StepConfig[];
  tasks: Task[];
  registry?: ReturnType<typeof scriptedRegistry>;
  script?: Record<string, StepResult>;
  escalation?: EscalationPolicy;
  telemetry?: TelemetryDb;
  git?: GitPort;
}): Promise<void> {
  const rec: Recorder = { order: [] };
  const config = changeConfig(
    makeConfig(
      opts.pipeline,
      opts.escalation ? { escalation: opts.escalation } : {},
    ),
  );
  const { port } = recordingMarkDone();
  await runLoop(
    config,
    opts.tasks,
    makeDeps({
      registry: opts.registry ?? scriptedRegistry(rec, opts.script ?? {}),
      markDone: port,
      telemetry: opts.telemetry,
      git: opts.git,
      now: tickingClock(),
    }),
  );
}

describe("telemetry task row — terminal facts via runLoop (C-0017 / T-006)", () => {
  let dir: string;
  let db: TelemetryDb;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "loopy-task-run-"));
    db = await openDb(join(dir, "telemetry.db"));
    await bootstrap(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes one merged task row carrying the git diff --numstat churn", async () => {
    const churn: DiffNumstat = { files: 2, added: 10, removed: 3 };
    await runTaskLoop({
      pipeline: [shell("work")],
      tasks: [makeTask("T-1")],
      telemetry: db,
      git: gitStub({ diffNumstat: async () => churn }),
    });

    const rows = db.all<TaskShape>(ALL_TASKS);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.task_id).toBe("C-0017/T-1");
    expect(row.change_id).toBe("C-0017");
    expect(row.task_number).toBe("T-1");
    expect(row.name).toBe("Task T-1");
    expect(row.status).toBe("merged");
    expect(row.size_files).toBe(2);
    expect(row.size_added).toBe(10);
    expect(row.size_removed).toBe(3);
  });

  it("captures the churn BEFORE the always cleanup step deletes the branch", async () => {
    // A shared timeline: the git snapshot and the cleanup step both record when
    // they run, proving the numstat is taken while the branch is still alive.
    const events: string[] = [];
    const make = (type: StepType): Step => ({
      type,
      async execute(ctx): Promise<StepResult> {
        events.push(`step:${ctx.step.id}`);
        return { ok: true };
      },
    });
    const registry = createStepRegistry([make("shell")]);
    const git = gitStub({
      diffNumstat: async () => {
        events.push("numstat");
        return { files: 1, added: 5, removed: 1 };
      },
    });

    await runTaskLoop({
      // `cleanup` is the canonical teardown step: last, `always: true`, and it
      // is what deletes the worktree/branch.
      pipeline: [shell("work"), shell("cleanup", { always: true })],
      tasks: [makeTask("T-1")],
      registry,
      telemetry: db,
      git,
    });

    // The snapshot precedes the cleanup step running.
    expect(events).toEqual(["step:work", "numstat", "step:cleanup"]);
    // And the churn survived teardown onto the row.
    const row = db.all<TaskShape>(ALL_TASKS)[0]!;
    expect(row.status).toBe("merged");
    expect(row.size_added).toBe(5);
  });

  it("writes a failed task row with size_* NULL on escalation (skip_task)", async () => {
    await runTaskLoop({
      pipeline: [shell("work")],
      tasks: [makeTask("T-2")],
      script: { work: { ok: false, reason: "boom" } },
      escalation: SKIP_TASK,
      telemetry: db,
      // Even if git *would* report churn, a failed task records size_* NULL.
      git: gitStub({ diffNumstat: async () => ({ files: 9, added: 9, removed: 9 }) }),
    });

    const rows = db.all<TaskShape>(ALL_TASKS);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.task_id).toBe("C-0017/T-2");
    expect(row.status).toBe("failed");
    expect(row.size_files).toBeNull();
    expect(row.size_added).toBeNull();
    expect(row.size_removed).toBeNull();
  });

  it("writes NO task row for a paused task (only merged/failed are recorded)", async () => {
    await runTaskLoop({
      pipeline: [shell("work")],
      tasks: [makeTask("T-3")],
      script: { work: { ok: false, reason: "boom" } },
      escalation: PAUSE,
      telemetry: db,
      git: gitStub(),
    });

    expect(db.all(ALL_TASKS)).toHaveLength(0);
  });

  it("degrades size_* to NULL when no base sha is available (best-effort)", async () => {
    await runTaskLoop({
      pipeline: [shell("work")],
      tasks: [makeTask("T-4")],
      telemetry: db,
      // No parent HEAD → no diff base → size_* NULL, but still a merged row.
      git: gitStub({ revParseHead: async () => null }),
    });

    const row = db.all<TaskShape>(ALL_TASKS)[0]!;
    expect(row.status).toBe("merged");
    expect(row.size_files).toBeNull();
    expect(row.size_added).toBeNull();
  });

  it("joins step rows in v_task for a merged task (D-0008 plumbing)", async () => {
    await runTaskLoop({
      pipeline: [shell("a"), shell("b")],
      tasks: [makeTask("T-5")],
      telemetry: db,
      git: gitStub({ diffNumstat: async () => ({ files: 1, added: 4, removed: 2 }) }),
    });

    const vt = db
      .prepare("SELECT * FROM v_task WHERE task_id = 'C-0017/T-5'")
      .get<{ size_added: number; cost_usd: number; status: string }>();
    expect(vt?.status).toBe("merged");
    expect(vt?.size_added).toBe(4);
    // Non-agent Visit rows carry no cost yet (agent costs land in T-007) → 0.
    expect(vt?.cost_usd).toBe(0);
  });

  it("writes NOTHING when telemetry is off (opt-in gate, AD-1)", async () => {
    await runTaskLoop({
      pipeline: [shell("work")],
      tasks: [makeTask("T-9")],
      git: gitStub(),
    });

    expect(db.all(ALL_TASKS)).toHaveLength(0);
  });
});
