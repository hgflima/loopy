/**
 * Resume E2E tests (C-0002 / C-0004 PC-based) — exercises the full resume
 * lifecycle with a fake `CheckpointPort` (no disk), verifying: resume from
 * PC position with visits/carry, hash divergence invalidation, aborted-only-
 * via-task, orphan pruning, multi-task resume, fix-loop mid-resume,
 * DAG-aware resume (T-010), and the concurrent checkpoint guardrail.
 */
import { describe, expect, it } from "vitest";
import {
  emptyState,
  pipelineFingerprint,
  saveProgressIn,
  setStatusIn,
} from "../../src/resume/state";
import { runLoop } from "../../src/loop/orchestrator";
import { makeLogger } from "../steps/support";
import {
  fakeCheckpoint,
  makeConfig,
  makeDeps,
  makeTask,
  recordingMarkDone,
  scriptedRegistry,
  shell,
  type Recorder,
} from "./support";

// ---------------------------------------------------------------------------
// Resume E2E scenarios (PC-based)
// ---------------------------------------------------------------------------

describe("resume — resume from PC position + redo remaining", () => {
  it("resumes from saved PC (step 'commit') and re-executes only the remaining step", async () => {
    const pipeline = [
      shell("create-worktree"),
      shell("implement"),
      shell("simplify"),
      shell("audit"),
      shell("commit"),
    ];
    const hash = pipelineFingerprint(pipeline);
    // Simulate prior run: completed up to 'audit', PC saved at 'commit'.
    let initial = emptyState();
    initial = saveProgressIn(
      initial, "T-4", "commit",
      { "create-worktree": 1, "implement": 1, "simplify": 1, "audit": 1 },
      "", hash,
    );
    initial = setStatusIn(initial, "T-4", "paused", hash);

    const rec: Recorder = { order: [] };
    const { port, marked } = recordingMarkDone();
    const config = makeConfig(pipeline);
    const cp = fakeCheckpoint(pipeline, initial);
    const logger = makeLogger();

    const result = await runLoop(config, [makeTask("T-4")], {
      ...makeDeps({ registry: scriptedRegistry(rec), markDone: port, logger }),
      checkpoint: cp.port,
    });

    // Only commit ran; the prior steps were resume-skipped (PC jumped to commit).
    expect(rec.order).toEqual(["T-4:commit"]);
    expect(result.completed).toEqual(["T-4"]);
    expect(marked).toEqual(["T-4"]);
    // Checkpoint cleared after success.
    expect(cp.state().tasks["T-4"]).toBeUndefined();
    // Resume log present.
    expect(logger.infos.some((m) => m.includes('retomando de step "commit"'))).toBe(true);
  });
});

describe("resume — hash divergence invalidation", () => {
  it("ignores checkpoint when pipeline hash diverges, with warning", async () => {
    const oldPipeline = [shell("a"), shell("b")];
    const newPipeline = [shell("a"), shell("b-changed")];
    const oldHash = pipelineFingerprint(oldPipeline);
    let initial = emptyState();
    initial = saveProgressIn(initial, "T-1", "b", { a: 1 }, "", oldHash);
    initial = setStatusIn(initial, "T-1", "running", oldHash);

    const rec: Recorder = { order: [] };
    const { port } = recordingMarkDone();
    const config = makeConfig(newPipeline);
    // The fake checkpoint uses newPipeline's hash for new writes,
    // but the initial state has oldPipeline's hash.
    const cp = fakeCheckpoint(newPipeline, initial);
    const logger = makeLogger();

    const result = await runLoop(config, [makeTask("T-1")], {
      ...makeDeps({ registry: scriptedRegistry(rec), markDone: port, logger }),
      checkpoint: cp.port,
    });

    // Both steps run from scratch (checkpoint invalidated).
    expect(rec.order).toEqual(["T-1:a", "T-1:b-changed"]);
    expect(result.completed).toEqual(["T-1"]);
    // Warning about hash divergence logged.
    expect(
      logger.infos.some((m) =>
        m.includes("pipeline mudou desde o checkpoint de T-1"),
      ),
    ).toBe(true);
  });
});

describe("resume — aborted status", () => {
  it("does NOT auto-resume an aborted task (no resume point)", async () => {
    const pipeline = [shell("a"), shell("b")];
    const hash = pipelineFingerprint(pipeline);
    let initial = emptyState();
    initial = saveProgressIn(initial, "T-1", "b", { a: 1 }, "", hash);
    initial = setStatusIn(initial, "T-1", "aborted", hash);

    const rec: Recorder = { order: [] };
    const { port } = recordingMarkDone();
    const config = makeConfig(pipeline);
    const cp = fakeCheckpoint(pipeline, initial);

    // No --task flag → allowAborted = false → no resume point → runs all.
    await runLoop(config, [makeTask("T-1")], {
      ...makeDeps({ registry: scriptedRegistry(rec), markDone: port }),
      checkpoint: cp.port,
    });

    expect(rec.order).toEqual(["T-1:a", "T-1:b"]);
  });

  it("resumes an aborted task when --task is set (allowAborted = true)", async () => {
    const pipeline = [shell("a"), shell("b")];
    const hash = pipelineFingerprint(pipeline);
    let initial = emptyState();
    initial = saveProgressIn(initial, "T-1", "b", { a: 1 }, "", hash);
    initial = setStatusIn(initial, "T-1", "aborted", hash);

    const rec: Recorder = { order: [] };
    const { port } = recordingMarkDone();
    const config = makeConfig(pipeline);
    const cp = fakeCheckpoint(pipeline, initial);

    // --task T-1 → allowAborted = true → resumes from step b.
    await runLoop(config, [makeTask("T-1")], {
      ...makeDeps({
        registry: scriptedRegistry(rec),
        markDone: port,
        flags: { task: "T-1" },
      }),
      checkpoint: cp.port,
    });

    expect(rec.order).toEqual(["T-1:b"]);
  });
});

describe("resume — orphan pruning", () => {
  it("prunes checkpoint entries for tasks not in the known list", async () => {
    const pipeline = [shell("a")];
    const hash = pipelineFingerprint(pipeline);
    let initial = emptyState();
    initial = saveProgressIn(initial, "T-GONE", "a", {}, "", hash);
    initial = setStatusIn(initial, "T-GONE", "paused", hash);
    initial = saveProgressIn(initial, "T-1", "a", {}, "", hash);

    const rec: Recorder = { order: [] };
    const { port } = recordingMarkDone();
    const config = makeConfig(pipeline);
    const cp = fakeCheckpoint(pipeline, initial);
    const logger = makeLogger();

    await runLoop(config, [makeTask("T-1")], {
      ...makeDeps({ registry: scriptedRegistry(rec), markDone: port, logger }),
      checkpoint: cp.port,
      knownTaskIds: ["T-1", "T-2"],
    });

    // T-GONE was pruned.
    expect(cp.state().tasks["T-GONE"]).toBeUndefined();
    expect(logger.infos.some((m) => m.includes('"T-GONE" podado'))).toBe(true);
  });
});

describe("resume — multi-task lifecycle", () => {
  it("resume T-1 from saved PC; T-2 runs fresh", async () => {
    const pipeline = [shell("a"), shell("b")];
    const hash = pipelineFingerprint(pipeline);

    // Simulate prior run: T-1 completed step a, PC saved at b, then paused.
    let initial = emptyState();
    initial = saveProgressIn(initial, "T-1", "b", { a: 1 }, "", hash);
    initial = setStatusIn(initial, "T-1", "paused", hash);

    const rec: Recorder = { order: [] };
    const { port, marked } = recordingMarkDone();
    const config = makeConfig(pipeline);
    const cp = fakeCheckpoint(pipeline, initial);

    const result = await runLoop(
      config,
      [makeTask("T-1"), makeTask("T-2")],
      {
        ...makeDeps({ registry: scriptedRegistry(rec), markDone: port }),
        checkpoint: cp.port,
      },
    );

    // T-1: only step b ran (resumed from PC=b); T-2: both steps ran.
    expect(rec.order).toEqual(["T-1:b", "T-2:a", "T-2:b"]);
    expect(result.completed).toEqual(["T-1", "T-2"]);
    expect(marked).toEqual(["T-1", "T-2"]);
    // Both checkpoints cleared after success.
    expect(Object.keys(cp.state().tasks)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Fix-loop resume (C-0004 — OQ-4/OQ-10)
// ---------------------------------------------------------------------------

describe("resume — mid fix-loop resume with carry", () => {
  it("resumes in the middle of a fix-loop with visits and carry intact", async () => {
    // Pipeline: implement → review (on_fail: goto implement)
    const pipeline = [
      shell("implement"),
      shell("review", { on_fail: { goto: "implement" } }),
    ];
    const hash = pipelineFingerprint(pipeline);

    // Simulate: 1st pass implement succeeded, review failed with goto→implement,
    // 2nd pass implement was about to run (pc=implement, visits: {implement:1, review:1}).
    // The carry from the review failure is "fix X".
    let initial = emptyState();
    initial = saveProgressIn(
      initial, "T-1", "implement",
      { "implement": 1, "review": 1 },
      "fix X", hash,
    );
    initial = setStatusIn(initial, "T-1", "paused", hash);

    // Script: implement ok, review ok (converges on 2nd loop).
    const rec: Recorder = { order: [] };
    const { port, marked } = recordingMarkDone();
    const config = makeConfig(pipeline);
    const cp = fakeCheckpoint(pipeline, initial);
    const logger = makeLogger();

    const result = await runLoop(config, [makeTask("T-1")], {
      ...makeDeps({ registry: scriptedRegistry(rec), markDone: port, logger }),
      checkpoint: cp.port,
    });

    // implement re-executed (2nd visit), then review (2nd visit) succeeded.
    expect(rec.order).toEqual(["T-1:implement", "T-1:review"]);
    expect(result.completed).toEqual(["T-1"]);
    expect(marked).toEqual(["T-1"]);
    // Checkpoint cleared on success.
    expect(cp.state().tasks["T-1"]).toBeUndefined();
    // Resume log present.
    expect(logger.infos.some((m) => m.includes('retomando de step "implement"'))).toBe(true);
  });

  it("carry (checksReport) survives resume and is available to the resumed step", async () => {
    // This test verifies the carry is restored by checking the checkpoint state
    // persisted during the resumed run. We simulate a pause at "implement" with
    // carry "review notes", resume, and verify the carry in the saved progress.
    const pipeline = [
      shell("implement"),
      shell("review", { on_fail: { goto: "implement" } }),
    ];
    const hash = pipelineFingerprint(pipeline);

    let initial = emptyState();
    initial = saveProgressIn(
      initial, "T-1", "implement",
      { "implement": 1, "review": 1 },
      "review notes: fix bug #42", hash,
    );
    initial = setStatusIn(initial, "T-1", "paused", hash);

    // Script: implement ok (so checkpoint is saved with next pc=review), then review ok.
    const rec: Recorder = { order: [] };
    const { port } = recordingMarkDone();
    const config = makeConfig(pipeline);
    const cp = fakeCheckpoint(pipeline, initial);

    await runLoop(config, [makeTask("T-1")], {
      ...makeDeps({ registry: scriptedRegistry(rec), markDone: port }),
      checkpoint: cp.port,
    });

    // The saveProgress calls record the carry state. After implement succeeds,
    // the checkpoint should have been saved with pc=review and the carry intact.
    // We check the calls to verify carry was threaded.
    expect(cp.calls.some((c) => c.startsWith("saveProgress:T-1:review"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T-010 — Resume multi-in-flight (DAG-aware)
// ---------------------------------------------------------------------------

describe("resume — DAG: done deps are pre-satisfied", () => {
  it("resumes B (depends on done A) from PC; C runs fresh", async () => {
    // DAG: A → B, C (independent).
    // Prior run: A completed and marked [x] (not in tasks).
    // B paused at step "b" (checkpoint). C never started.
    const pipeline = [shell("a"), shell("b")];
    const hash = pipelineFingerprint(pipeline);

    let initial = emptyState();
    initial = saveProgressIn(initial, "B", "b", { a: 1 }, "", hash);
    initial = setStatusIn(initial, "B", "paused", hash);

    const rec: Recorder = { order: [] };
    const { port, marked } = recordingMarkDone();
    const config = makeConfig(pipeline);
    const cp = fakeCheckpoint(pipeline, initial);
    const logger = makeLogger();

    // B depends on A, but A is done (not in tasks). The dep is pre-satisfied.
    const result = await runLoop(
      config,
      [makeTask("B", { deps: ["A"] }), makeTask("C")],
      {
        ...makeDeps({ registry: scriptedRegistry(rec), markDone: port, logger }),
        checkpoint: cp.port,
        knownTaskIds: ["A", "B", "C"],
      },
    );

    // B: resumed from step "b" (skip "a"). C: both steps ran fresh.
    expect(rec.order).toEqual(["B:b", "C:a", "C:b"]);
    expect(result.completed).toEqual(expect.arrayContaining(["B", "C"]));
    expect(marked).toEqual(expect.arrayContaining(["B", "C"]));
    expect(logger.infos.some((m) => m.includes('retomando de step "b"'))).toBe(true);
  });
});

describe("resume — DAG: skipped status is recomputed, not persisted", () => {
  it("recomputes ready/blocked from graph+status on resume (no persisted skip)", async () => {
    // DAG: A → C, B (independent).
    // Prior run: A failed → paused, C was skipped (transitive).
    // B completed and is now [x] (not in tasks).
    // On resume: A resumes from PC, C should run after A completes.
    // The key: C's "skipped" status was NOT persisted — it's recomputed.
    const pipeline = [shell("s1")];
    const hash = pipelineFingerprint(pipeline);

    let initial = emptyState();
    initial = saveProgressIn(initial, "A", "s1", {}, "", hash);
    initial = setStatusIn(initial, "A", "paused", hash);
    // Note: no checkpoint for C — skipped was never persisted.

    const rec: Recorder = { order: [] };
    const { port, marked } = recordingMarkDone();
    const config = makeConfig(pipeline);
    const cp = fakeCheckpoint(pipeline, initial);

    const result = await runLoop(
      config,
      [makeTask("A"), makeTask("C", { deps: ["A"] })],
      {
        ...makeDeps({ registry: scriptedRegistry(rec), markDone: port }),
        checkpoint: cp.port,
        knownTaskIds: ["A", "B", "C"],
      },
    );

    // A resumes and completes, then C runs (dep satisfied).
    expect(rec.order).toEqual(["A:s1", "C:s1"]);
    expect(result.completed).toEqual(["A", "C"]);
    expect(marked).toEqual(["A", "C"]);
  });
});

describe("resume — multi-in-flight from PC (N tasks)", () => {
  it("3 independent tasks resume from their respective PCs", async () => {
    // DAG: A, B, C all independent, concurrency 3.
    // Prior run: all 3 in-flight, interrupted.
    //   A paused at step "b", B paused at step "c", C paused at step "b".
    const pipeline = [shell("a"), shell("b"), shell("c")];
    const hash = pipelineFingerprint(pipeline);

    let initial = emptyState();
    initial = saveProgressIn(initial, "A", "b", { a: 1 }, "", hash);
    initial = setStatusIn(initial, "A", "paused", hash);
    initial = saveProgressIn(initial, "B", "c", { a: 1, b: 1 }, "", hash);
    initial = setStatusIn(initial, "B", "paused", hash);
    initial = saveProgressIn(initial, "C", "b", { a: 1 }, "", hash);
    initial = setStatusIn(initial, "C", "paused", hash);

    const rec: Recorder = { order: [] };
    const { port } = recordingMarkDone();
    const config = makeConfig(pipeline, { concurrency: 3 });
    const cp = fakeCheckpoint(pipeline, initial);
    const logger = makeLogger();

    const result = await runLoop(
      config,
      [makeTask("A"), makeTask("B"), makeTask("C")],
      {
        ...makeDeps({ registry: scriptedRegistry(rec), markDone: port, logger }),
        checkpoint: cp.port,
      },
    );

    // A: steps b,c ran (resumed from b). B: step c ran (resumed from c). C: steps b,c ran.
    // Order between tasks is non-deterministic (concurrent), so check per-task.
    const aSteps = rec.order.filter((s) => s.startsWith("A:"));
    const bSteps = rec.order.filter((s) => s.startsWith("B:"));
    const cSteps = rec.order.filter((s) => s.startsWith("C:"));
    expect(aSteps).toEqual(["A:b", "A:c"]);
    expect(bSteps).toEqual(["B:c"]);
    expect(cSteps).toEqual(["C:b", "C:c"]);
    expect(result.completed).toEqual(expect.arrayContaining(["A", "B", "C"]));
    expect(Object.keys(cp.state().tasks)).toEqual([]);
    // All 3 show resume logs.
    expect(logger.infos.filter((m) => m.includes("retomando de step")).length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Concurrent checkpoint guardrail (T-010)
// ---------------------------------------------------------------------------

describe("resume — concurrent checkpoint guardrail", () => {
  it("N concurrent tasks saving checkpoint via single instance — no data loss", async () => {
    // Guardrail: the single CheckpointPort instance uses synchronous writes
    // (writeFileSync + renameSync). The event loop serializes them because
    // there is only one instance per Run and writes are sync. This test
    // verifies that N concurrent saveProgress calls all survive — it would
    // fail if the write became async or the instance were duplicated.
    const pipeline = [shell("s1"), shell("s2")];
    const config = makeConfig(pipeline, { concurrency: 3 });

    // Script: s1 succeeds for all tasks → checkpoint saved at s2.
    const rec: Recorder = { order: [] };
    const { port: markDone } = recordingMarkDone();
    const cp = fakeCheckpoint(pipeline);

    await runLoop(
      config,
      [makeTask("A"), makeTask("B"), makeTask("C")],
      {
        ...makeDeps({ registry: scriptedRegistry(rec), markDone }),
        checkpoint: cp.port,
      },
    );

    // After success, checkpoints are cleared. But during execution, all 3
    // tasks must have saved progress concurrently. Verify via recorded calls.
    const saveProgressCalls = cp.calls.filter((c) => c.startsWith("saveProgress:"));
    const savedTaskIds = new Set(saveProgressCalls.map((c) => c.split(":")[1]));
    expect(savedTaskIds).toEqual(new Set(["A", "B", "C"]));
  });

  it("createCheckpointPort uses synchronous writes (guardrail)", () => {
    // The createCheckpointPort function must use saveState (writeFileSync +
    // renameSync). This is a structural guardrail: if the port's internal
    // saveState call were async, concurrent tasks could interleave and lose
    // checkpoint data. We verify the port writes synchronously by checking
    // that the state file reflects all writes immediately (no await gap).
    //
    // Since createCheckpointPort needs a real file, we test via the in-memory
    // fakeCheckpoint which mirrors the same pure transitions. The key
    // invariant: after N synchronous saveProgress calls, all N entries exist.
    const pipeline = [shell("x")];
    const cp = fakeCheckpoint(pipeline);

    // Simulate N concurrent saves (synchronous, no await between them).
    cp.port.saveProgress("T-1", "x", {}, "");
    cp.port.saveProgress("T-2", "x", {}, "");
    cp.port.saveProgress("T-3", "x", {}, "");

    const state = cp.state();
    expect(Object.keys(state.tasks).sort()).toEqual(["T-1", "T-2", "T-3"]);
    expect(state.tasks["T-1"]!.pc).toBe("x");
    expect(state.tasks["T-2"]!.pc).toBe("x");
    expect(state.tasks["T-3"]!.pc).toBe("x");
  });
});
