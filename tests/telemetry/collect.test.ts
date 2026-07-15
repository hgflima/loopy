import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb, type TelemetryDb } from "../../src/telemetry/db";
import { bootstrap } from "../../src/telemetry/schema";
import {
  runLoop,
  telemetryChangeId,
  telemetryTaskId,
} from "../../src/loop/orchestrator";
import type {
  LoopyConfig,
  Step,
  StepConfig,
  StepResult,
  StepType,
} from "../../src/types";
import {
  approval,
  checks,
  makeConfig,
  makeDeps,
  makeTask,
  recordingMarkDone,
  scriptedRegistry,
  shell,
  type Recorder,
} from "../loop/support";
import { createStepRegistry } from "../../src/steps/index";

// Override the backlog path so change/task ids carry a real `C-\d+` prefix (D26).
function changeConfig(config: LoopyConfig): LoopyConfig {
  return {
    ...config,
    inputs: {
      ...config.inputs,
      todo: ".harn/devy/changes/C-0017-telemetry-and-change-insights/todo.md",
    },
  };
}

// A monotonic clock: each call advances 1s, so started_at < ended_at per Visit.
function tickingClock(startMs = 1_000_000): () => number {
  let t = startMs - 1000;
  return () => (t += 1000);
}

interface StepRowShape {
  task_id: string;
  change_id: string;
  seq: number;
  name: string;
  kind: string;
  visit_no: number;
  attempt_no: number;
  status: string;
  config_id: string | null;
  started_at: string;
  ended_at: string;
}

const ALL_STEPS = "SELECT * FROM step ORDER BY seq";

describe("telemetry collection — non-agent Visit rows via runLoop (C-0017 / T-004)", () => {
  let dir: string;
  let db: TelemetryDb;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "loopy-collect-"));
    db = await openDb(join(dir, "telemetry.db"));
    await bootstrap(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("derives change_id / task_id from the backlog dir (D26)", () => {
    const config = changeConfig(makeConfig([shell("a")]));
    expect(telemetryChangeId(config)).toBe("C-0017");
    expect(telemetryTaskId(config, makeTask("T-4"))).toBe("C-0017/T-4");
  });

  it("writes one Visit row per executed non-agent step, in seq order, with derived ids", async () => {
    const rec: Recorder = { order: [] };
    const registry = scriptedRegistry(rec);
    const { port } = recordingMarkDone();
    const config = changeConfig(
      makeConfig([shell("create-worktree"), checks("run-ci"), approval("merge")]),
    );

    await runLoop(config, [makeTask("T-1")], makeDeps({
      registry,
      markDone: port,
      telemetry: db,
      now: tickingClock(),
    }));

    const rows = db.all<StepRowShape>(ALL_STEPS);
    expect(rows.map((r) => `${r.name}:${r.kind}:${r.seq}`)).toEqual([
      "create-worktree:shell:1",
      "run-ci:checks:2",
      "merge:approval:3",
    ]);
    for (const r of rows) {
      expect(r.task_id).toBe("C-0017/T-1");
      expect(r.change_id).toBe("C-0017");
      expect(r.visit_no).toBe(1);
      expect(r.attempt_no).toBe(1);
      expect(r.status).toBe("pass");
      expect(r.config_id).toBeNull();
      // The ticking clock makes each Visit's window a non-empty interval.
      expect(r.ended_at > r.started_at).toBe(true);
    }
  });

  it("records status 'fail' for a failed non-agent step", async () => {
    const rec: Recorder = { order: [] };
    // The `checks` step fails; default escalation pauses the task afterwards.
    const registry = scriptedRegistry(rec, { gate: { ok: false, reason: "boom" } });
    const { port } = recordingMarkDone();
    const config = changeConfig(makeConfig([shell("setup"), checks("gate")]));

    await runLoop(config, [makeTask("T-2")], makeDeps({
      registry,
      markDone: port,
      telemetry: db,
      now: tickingClock(),
    }));

    const rows = db.all<StepRowShape>(ALL_STEPS);
    expect(rows.find((r) => r.name === "setup")?.status).toBe("pass");
    expect(rows.find((r) => r.name === "gate")?.status).toBe("fail");
  });

  it("threads visit_no across a fix-loop (goto revisits bump visit_no)", async () => {
    // `verify` fails on its first Visit and passes on the second; on failure it
    // loops back to `fix` via on_fail goto — so `fix` and `verify` are visited
    // twice (visit_no reaches 2).
    let verifyCalls = 0;
    const make = (type: StepType): Step => ({
      type,
      async execute(ctx): Promise<StepResult> {
        if (ctx.step.id === "verify") {
          verifyCalls += 1;
          return verifyCalls >= 2 ? { ok: true } : { ok: false, reason: "retry" };
        }
        return { ok: true };
      },
    });
    const registry = createStepRegistry([make("shell"), make("checks")]);
    const { port } = recordingMarkDone();
    // Pipeline: fix (shell) → verify (checks, on_fail goto fix). visit_no reaches 2.
    const verifyStep: StepConfig = { ...checks("verify"), on_fail: { goto: "fix" } };
    const looped = changeConfig(makeConfig([shell("fix"), verifyStep]));

    await runLoop(looped, [makeTask("T-3")], makeDeps({
      registry,
      markDone: port,
      telemetry: db,
      now: tickingClock(),
    }));

    const rows = db.all<StepRowShape>(ALL_STEPS);
    const verifyVisits = rows
      .filter((r) => r.name === "verify")
      .map((r) => r.visit_no)
      .sort();
    expect(verifyVisits).toEqual([1, 2]);
    // Every physical Visit is its own row, ordered by the derived seq.
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3, 4]);
  });

  it("writes NOTHING when telemetry is not injected (opt-in gate, AD-1)", async () => {
    const rec: Recorder = { order: [] };
    const registry = scriptedRegistry(rec);
    const { port } = recordingMarkDone();
    const config = changeConfig(makeConfig([shell("a"), checks("b")]));

    // No `telemetry` in deps → ctx.telemetry undefined → finalize is a no-op.
    await runLoop(config, [makeTask("T-9")], makeDeps({ registry, markDone: port }));

    expect(db.all(ALL_STEPS)).toHaveLength(0);
  });
});
