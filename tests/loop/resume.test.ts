/**
 * Resume E2E tests (C-0002, T-021) — exercises the full resume lifecycle with
 * a fake `CheckpointPort` (no disk), verifying: skip completed steps, hash
 * divergence invalidation, aborted-only-via-task, orphan pruning, and
 * multi-task resume across escalation states.
 */
import { describe, expect, it } from "vitest";
import {
  emptyState,
  pipelineFingerprint,
  recordStepIn,
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
// Resume E2E scenarios
// ---------------------------------------------------------------------------

describe("resume — skip completed + redo remaining", () => {
  it("skips the 4 completed steps and re-executes only the remaining one", async () => {
    const pipeline = [
      shell("create-worktree"),
      shell("implement"),
      shell("simplify"),
      shell("audit"),
      shell("commit"),
    ];
    const hash = pipelineFingerprint(pipeline);
    let initial = emptyState();
    for (const id of ["create-worktree", "implement", "simplify", "audit"]) {
      initial = recordStepIn(initial, "T-4", id, hash);
    }
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

    // Only commit ran; the 4 prior steps were resume-skipped.
    expect(rec.order).toEqual(["T-4:commit"]);
    expect(result.completed).toEqual(["T-4"]);
    expect(marked).toEqual(["T-4"]);
    // Checkpoint cleared after success.
    expect(cp.state().tasks["T-4"]).toBeUndefined();
    // Resume-skip logs present.
    for (const id of ["create-worktree", "implement", "simplify", "audit"]) {
      expect(logger.infos.some((m) => m.includes(`"${id}" já concluído`))).toBe(true);
    }
  });
});

describe("resume — hash divergence invalidation", () => {
  it("ignores checkpoint when pipeline hash diverges, with warning", async () => {
    const oldPipeline = [shell("a"), shell("b")];
    const newPipeline = [shell("a"), shell("b-changed")];
    const oldHash = pipelineFingerprint(oldPipeline);
    let initial = emptyState();
    initial = recordStepIn(initial, "T-1", "a", oldHash);
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
  it("does NOT auto-resume an aborted task (completedSteps empty)", async () => {
    const pipeline = [shell("a"), shell("b")];
    const hash = pipelineFingerprint(pipeline);
    let initial = emptyState();
    initial = recordStepIn(initial, "T-1", "a", hash);
    initial = setStatusIn(initial, "T-1", "aborted", hash);

    const rec: Recorder = { order: [] };
    const { port } = recordingMarkDone();
    const config = makeConfig(pipeline);
    const cp = fakeCheckpoint(pipeline, initial);

    // No --task flag → allowAborted = false → completedSteps empty → runs all.
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
    initial = recordStepIn(initial, "T-1", "a", hash);
    initial = setStatusIn(initial, "T-1", "aborted", hash);

    const rec: Recorder = { order: [] };
    const { port } = recordingMarkDone();
    const config = makeConfig(pipeline);
    const cp = fakeCheckpoint(pipeline, initial);

    // --task T-1 → allowAborted = true → step a skipped.
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
    initial = recordStepIn(initial, "T-GONE", "a", hash);
    initial = setStatusIn(initial, "T-GONE", "paused", hash);
    initial = recordStepIn(initial, "T-1", "a", hash);

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
  it("pause on T-1, then resume skips T-1's completed steps; T-2 runs fresh", async () => {
    const pipeline = [shell("a"), shell("b")];
    const hash = pipelineFingerprint(pipeline);

    // Simulate prior run: T-1 completed step a, then paused.
    let initial = emptyState();
    initial = recordStepIn(initial, "T-1", "a", hash);
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

    // T-1: only step b ran (a was resume-skipped); T-2: both steps ran.
    expect(rec.order).toEqual(["T-1:b", "T-2:a", "T-2:b"]);
    expect(result.completed).toEqual(["T-1", "T-2"]);
    expect(marked).toEqual(["T-1", "T-2"]);
    // Both checkpoints cleared after success.
    expect(Object.keys(cp.state().tasks)).toEqual([]);
  });
});
