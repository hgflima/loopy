import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseBacklog,
  pendingTasks,
  backlogOptionsFrom,
} from "../../src/backlog/todo";
import { parseConfig } from "../../src/config/load";
import { createGit } from "../../src/git/worktree";
import {
  createMarkDonePort,
  decideEscalation,
  runLoop,
  worktreePathFor,
  type OrchestratorDeps,
} from "../../src/loop/orchestrator";
import { createAgentStep } from "../../src/steps/agent";
import {
  createNonAgentRegistry,
  createStepRegistry,
} from "../../src/steps/index";
import type { RunShellCommand } from "../../src/steps/shell";
import {
  emptyState,
  pipelineFingerprint,
  recordStepIn,
  setStatusIn,
} from "../../src/resume/state";
import type {
  AgentSession,
  ChecksReport,
  ChecksRunnerPort,
  Step,
  StepConfig,
  StepContext,
  StepResult,
} from "../../src/types";
import { makeLogger } from "../steps/support";
import {
  DEFAULT_FLAGS,
  agent,
  approval,
  checks,
  fakeCheckpoint,
  makeConfig,
  makeDeps,
  makeTask,
  passingChecks,
  recordingMarkDone,
  scriptedRegistry,
  shell,
  type Recorder,
} from "./support";

// ---------------------------------------------------------------------------
// decideEscalation (pure)
// ---------------------------------------------------------------------------

describe("decideEscalation", () => {
  it("continues on skip_task and stops on pause/abort_loop", () => {
    expect(decideEscalation("skip_task")).toBe("continue");
    expect(decideEscalation("pause")).toBe("stop");
    expect(decideEscalation("abort_loop")).toBe("stop");
  });
});

// ---------------------------------------------------------------------------
// Outer-loop mechanics (scripted interpreters — deterministic, no I/O)
// ---------------------------------------------------------------------------

describe("runLoop — order + mark-done", () => {
  it("runs the pipeline in order for every task and marks each on success", async () => {
    const rec: Recorder = { order: [] };
    const registry = scriptedRegistry(rec);
    const { port, marked } = recordingMarkDone();
    const config = makeConfig([shell("a"), checks("b"), approval("c")]);

    const result = await runLoop(
      config,
      [makeTask("T-1"), makeTask("T-2")],
      makeDeps({ registry, markDone: port }),
    );

    expect(rec.order).toEqual([
      "T-1:a",
      "T-1:b",
      "T-1:c",
      "T-2:a",
      "T-2:b",
      "T-2:c",
    ]);
    expect(marked).toEqual(["T-1", "T-2"]);
    expect(result.completed).toEqual(["T-1", "T-2"]);
    expect(result.escalated).toEqual([]);
    expect(result.iterations).toBe(2);
    expect(result.stoppedBy).toBe("backlog_empty");
  });

  it("marks a task done only after the WHOLE pipeline succeeds (not mid-way)", async () => {
    const rec: Recorder = { order: [] };
    const registry = scriptedRegistry(rec, {
      mid: { ok: false, reason: "boom" },
    });
    const { port, marked } = recordingMarkDone();
    const config = makeConfig([shell("first"), shell("mid"), shell("last")]);

    const result = await runLoop(
      config,
      [makeTask("T-1")],
      makeDeps({ registry, markDone: port }),
    );

    // A failure part-way through means the task is never marked.
    expect(marked).toEqual([]);
    expect(result.completed).toEqual([]);
    expect(result.escalated).toEqual(["T-1"]);
  });
});

describe("runLoop — always + failure", () => {
  it("skips non-always steps after a failure but still runs always steps (keep_worktree off)", async () => {
    const rec: Recorder = { order: [] };
    const registry = scriptedRegistry(rec, {
      s2: { ok: false, reason: "boom" },
    });
    const { port, marked } = recordingMarkDone();
    // `keep_worktree: false` so the `always` teardown runs after a failure;
    // with the default `keep_worktree: true` it would be suppressed (see
    // `tests/policies/escalation.test.ts`).
    const config = makeConfig(
      [
        shell("s1"),
        shell("s2"),
        shell("s3"),
        shell("cleanup", { always: true }),
      ],
      {
        escalation: { action: "pause", keep_worktree: false, notify: "stderr" },
      },
    );

    const result = await runLoop(
      config,
      [makeTask("T-1")],
      makeDeps({ registry, markDone: port }),
    );

    // s3 is skipped (prior failure, not always); cleanup runs anyway.
    expect(rec.order).toEqual(["T-1:s1", "T-1:s2", "T-1:cleanup"]);
    // A failed pipeline is never marked done.
    expect(marked).toEqual([]);
    expect(result.escalated).toEqual(["T-1"]);
    // Default escalation action is `pause` → the outer loop halts.
    expect(result.stoppedBy).toBe("escalation_pause");
  });

  it("runs an always step even when EVERY prior step succeeded (happy path)", async () => {
    const rec: Recorder = { order: [] };
    const registry = scriptedRegistry(rec);
    const { port } = recordingMarkDone();
    const config = makeConfig([
      shell("work"),
      shell("cleanup", { always: true }),
    ]);

    await runLoop(
      config,
      [makeTask("T-1")],
      makeDeps({ registry, markDone: port }),
    );

    expect(rec.order).toEqual(["T-1:work", "T-1:cleanup"]);
  });
});

describe("runLoop — escalation actions", () => {
  const failing = { s: { ok: false, reason: "nope" } } as const;

  it("skip_task: does not mark the failed task and continues to the next", async () => {
    const rec: Recorder = { order: [] };
    // Only T-1's step fails; T-2 succeeds.
    const registry = scriptedRegistry(rec, {
      "T-1:s": { ok: false, reason: "nope" },
    });
    const { port, marked } = recordingMarkDone();
    const config = makeConfig([shell("s")], {
      escalation: {
        action: "skip_task",
        keep_worktree: true,
        notify: "stderr",
      },
    });

    const result = await runLoop(
      config,
      [makeTask("T-1"), makeTask("T-2")],
      makeDeps({ registry, markDone: port }),
    );

    // T-1 fails and is skipped (never marked); T-2 still runs and is marked.
    expect(rec.order).toEqual(["T-1:s", "T-2:s"]);
    expect(result.escalated).toEqual(["T-1"]);
    expect(result.completed).toEqual(["T-2"]);
    expect(marked).toEqual(["T-2"]);
    expect(result.iterations).toBe(2);
    expect(result.stoppedBy).toBe("backlog_empty");
  });

  it("abort_loop: stops immediately after the failing task", async () => {
    const rec: Recorder = { order: [] };
    const registry = scriptedRegistry(rec, failing);
    const { port } = recordingMarkDone();
    const config = makeConfig([shell("s")], {
      escalation: {
        action: "abort_loop",
        keep_worktree: false,
        notify: "stderr",
      },
    });

    const result = await runLoop(
      config,
      [makeTask("T-1"), makeTask("T-2")],
      makeDeps({ registry, markDone: port }),
    );

    // T-2 never starts.
    expect(rec.order).toEqual(["T-1:s"]);
    expect(result.iterations).toBe(1);
    expect(result.escalated).toEqual(["T-1"]);
    expect(result.stoppedBy).toBe("escalation_abort");
  });
});

describe("runLoop — stop conditions", () => {
  it("empty backlog: no iterations, stopped by backlog_empty", async () => {
    const rec: Recorder = { order: [] };
    const { port } = recordingMarkDone();
    const config = makeConfig([shell("s")]);

    const result = await runLoop(
      config,
      [],
      makeDeps({ registry: scriptedRegistry(rec), markDone: port }),
    );

    expect(result.iterations).toBe(0);
    expect(result.completed).toEqual([]);
    expect(result.stoppedBy).toBe("backlog_empty");
    expect(rec.order).toEqual([]);
  });

  it("max_iterations: halts the outer loop at the ceiling", async () => {
    const rec: Recorder = { order: [] };
    const registry = scriptedRegistry(rec);
    const { port, marked } = recordingMarkDone();
    const config = makeConfig([shell("s")], {
      stop: { max_iterations: 2, max_step_visits: 10, stop_signal_file: ".loopy.stop" },
    });

    const result = await runLoop(
      config,
      [makeTask("T-1"), makeTask("T-2"), makeTask("T-3")],
      makeDeps({ registry, markDone: port }),
    );

    expect(marked).toEqual(["T-1", "T-2"]);
    expect(result.iterations).toBe(2);
    expect(result.stoppedBy).toBe("max_iterations");
    // T-3 never starts.
    expect(rec.order).toEqual(["T-1:s", "T-2:s"]);
  });

  it("stop_signal_file created mid-run halts AFTER the current task", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "loopy-stop-")));
    try {
      const rec: Recorder = { order: [] };
      const registry = scriptedRegistry(rec);
      // Drop the stop file the moment T-1 is marked done.
      const { port, marked } = recordingMarkDone((id) => {
        if (id === "T-1") writeFileSync(join(root, ".loopy.stop"), "");
      });
      const config = makeConfig([shell("s")]);

      const result = await runLoop(
        config,
        [makeTask("T-1"), makeTask("T-2"), makeTask("T-3")],
        makeDeps({ registry, markDone: port, root }),
      );

      // T-1 completes; the signal is seen before T-2 starts.
      expect(marked).toEqual(["T-1"]);
      expect(result.iterations).toBe(1);
      expect(result.stoppedBy).toBe("stop_signal");
      expect(rec.order).toEqual(["T-1:s"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("runLoop — registry gaps + report threading", () => {
  it("skips a step whose type has no interpreter (agent stub) without failing", async () => {
    const rec: Recorder = { order: [] };
    const registry = scriptedRegistry(rec); // shell/checks/approval only, no agent
    const { port, marked } = recordingMarkDone();
    const config = makeConfig([
      shell("before"),
      agent("think"),
      shell("after"),
    ]);

    const result = await runLoop(
      config,
      [makeTask("T-1")],
      makeDeps({ registry, markDone: port }),
    );

    // The agent step is a no-op skip; the pipeline still succeeds and marks done.
    expect(rec.order).toEqual(["T-1:before", "T-1:after"]);
    expect(marked).toEqual(["T-1"]);
    expect(result.completed).toEqual(["T-1"]);
  });

  it("threads the latest ${checks.report} into a later step (real interpreters)", async () => {
    const ran: string[] = [];
    const recordingRunner: RunShellCommand = async (argv) => {
      const command = argv.join(" ");
      ran.push(command);
      return { command, exitCode: 0, ok: true, stdout: "", stderr: "" };
    };
    const report: ChecksReport = {
      ok: true,
      results: [],
      text: "RELATORIO-DOS-CHECKS",
    };
    const checksPort: ChecksRunnerPort = { run: async () => report };
    const { port } = recordingMarkDone();

    const config = makeConfig(
      [
        checks("verify", "ci"),
        shell("log", { run: ["echo ${checks.report}"] }),
      ],
      { checks: { ci: [{ name: "x", run: "true" }] } },
    );

    await runLoop(
      config,
      [makeTask("T-1")],
      makeDeps({
        registry: createNonAgentRegistry({ runCommand: recordingRunner }),
        markDone: port,
        checks: checksPort,
      }),
    );

    // The shell step saw the report the checks step produced.
    expect(ran).toEqual(["echo RELATORIO-DOS-CHECKS"]);
  });
});

// ---------------------------------------------------------------------------
// Agent session wiring (T-015) — the orchestrator hands agent steps a session
// opened lazily via `sessionProvider`, keyed by the task's worktree cwd.
// ---------------------------------------------------------------------------

describe("runLoop — agent session wiring", () => {
  it("supplies agent steps the sessionProvider session, opened once per task keyed by worktree cwd", async () => {
    // Records which worktree cwd the provider was asked to open a session for.
    const providerCalls: string[] = [];
    const sessionProvider = async (cwd: string): Promise<AgentSession> => {
      providerCalls.push(cwd);
      return {
        sessionId: `sess:${cwd}`,
        setMode: async () => {},
        clear: async () => {},
        prompt: async () => "end_turn",
        readText: () => "",
        cancel: async () => {},
      };
    };

    // A stand-in agent interpreter that reaches for the session (which lazily
    // opens it) and records the sessionId it observed.
    const seen: string[] = [];
    const agentInterpreter: Step = {
      type: "agent",
      async execute(ctx: StepContext): Promise<StepResult> {
        await ctx.session.setMode("acceptEdits"); // triggers the lazy open
        seen.push(ctx.session.sessionId);
        return { ok: true };
      },
    };

    const { port, marked } = recordingMarkDone();
    const config = makeConfig([agent("implement"), agent("audit")]);
    const root = "/abs/workspace";

    const result = await runLoop(config, [makeTask("T-7")], {
      ...makeDeps({
        registry: createStepRegistry([agentInterpreter]),
        markDone: port,
        root,
      }),
      sessionProvider,
    });

    const expectedCwd = resolve(root, worktreePathFor(config, makeTask("T-7")));
    // Both agent steps of the one task share a SINGLE session (opened once).
    expect(providerCalls).toEqual([expectedCwd]);
    expect(seen).toEqual([`sess:${expectedCwd}`, `sess:${expectedCwd}`]);
    expect(marked).toEqual(["T-7"]);
    expect(result.completed).toEqual(["T-7"]);
  });

  it("never opens a session for a task with no agent steps (lazy)", async () => {
    const providerCalls: string[] = [];
    const sessionProvider = async (cwd: string): Promise<AgentSession> => {
      providerCalls.push(cwd);
      throw new Error("must not be called for a non-agent pipeline");
    };
    const rec: Recorder = { order: [] };
    const { port } = recordingMarkDone();
    const config = makeConfig([shell("a"), checks("b")]);

    await runLoop(config, [makeTask("T-1")], {
      ...makeDeps({ registry: scriptedRegistry(rec), markDone: port }),
      sessionProvider,
    });

    // No agent step ran, so the lazy session was never opened.
    expect(providerCalls).toEqual([]);
    expect(rec.order).toEqual(["T-1:a", "T-1:b"]);
  });
});

// ---------------------------------------------------------------------------
// Checkpoint / resume (C-0002 — T-021)
// ---------------------------------------------------------------------------

describe("runLoop — checkpoint: skip + record + status", () => {
  it("records each successful step via checkpoint.recordStep", async () => {
    const pipeline = [shell("a"), shell("b")];
    const rec: Recorder = { order: [] };
    const registry = scriptedRegistry(rec);
    const { port } = recordingMarkDone();
    const config = makeConfig(pipeline);
    const cp = fakeCheckpoint(pipeline);

    await runLoop(config, [makeTask("T-1")], {
      ...makeDeps({ registry, markDone: port }),
      checkpoint: cp.port,
    });

    expect(cp.calls).toContain("recordStep:T-1:a");
    expect(cp.calls).toContain("recordStep:T-1:b");
  });

  it("skips steps already in completedSteps (resume-skip)", async () => {
    const pipeline = [shell("a"), shell("b"), shell("c")];
    const rec: Recorder = { order: [] };
    const registry = scriptedRegistry(rec);
    const { port, marked } = recordingMarkDone();
    const config = makeConfig(pipeline);
    // Pre-populate checkpoint: steps a and b already done.
    const hash = pipelineFingerprint(pipeline);
    let initial = emptyState();
    initial = recordStepIn(initial, "T-1", "a", hash);
    initial = recordStepIn(initial, "T-1", "b", hash);
    initial = setStatusIn(initial, "T-1", "running", hash);
    const cp = fakeCheckpoint(pipeline, initial);

    const logger = makeLogger();
    const result = await runLoop(config, [makeTask("T-1")], {
      ...makeDeps({ registry, markDone: port }),
      checkpoint: cp.port,
      logger,
    });

    // Only step c actually ran.
    expect(rec.order).toEqual(["T-1:c"]);
    expect(marked).toEqual(["T-1"]);
    expect(result.completed).toEqual(["T-1"]);
    // Resume-skip messages logged.
    expect(logger.infos.some((m) => m.includes('step "a" já concluído'))).toBe(true);
    expect(logger.infos.some((m) => m.includes('step "b" já concluído'))).toBe(true);
  });

  it("sets status running before pipeline, clears on success", async () => {
    const pipeline = [shell("a")];
    const rec: Recorder = { order: [] };
    const { port } = recordingMarkDone();
    const config = makeConfig(pipeline);
    const cp = fakeCheckpoint(pipeline);

    await runLoop(config, [makeTask("T-1")], {
      ...makeDeps({ registry: scriptedRegistry(rec), markDone: port }),
      checkpoint: cp.port,
    });

    expect(cp.calls).toContain("setStatus:T-1:running");
    expect(cp.calls).toContain("clearTask:T-1");
    // After success, the task has no checkpoint entry.
    expect(cp.state().tasks["T-1"]).toBeUndefined();
  });

  it("sets status paused on escalation pause", async () => {
    const pipeline = [shell("s")];
    const rec: Recorder = { order: [] };
    const registry = scriptedRegistry(rec, { s: { ok: false, reason: "boom" } });
    const { port } = recordingMarkDone();
    const config = makeConfig(pipeline, {
      escalation: { action: "pause", keep_worktree: true, notify: "stderr" },
    });
    const cp = fakeCheckpoint(pipeline);

    const result = await runLoop(config, [makeTask("T-1")], {
      ...makeDeps({ registry, markDone: port }),
      checkpoint: cp.port,
    });

    expect(result.stoppedBy).toBe("escalation_pause");
    expect(cp.calls).toContain("setStatus:T-1:paused");
    expect(cp.state().tasks["T-1"]?.status).toBe("paused");
  });

  it("sets status aborted on escalation abort_loop", async () => {
    const pipeline = [shell("s")];
    const rec: Recorder = { order: [] };
    const registry = scriptedRegistry(rec, { s: { ok: false, reason: "boom" } });
    const { port } = recordingMarkDone();
    const config = makeConfig(pipeline, {
      escalation: { action: "abort_loop", keep_worktree: false, notify: "stderr" },
    });
    const cp = fakeCheckpoint(pipeline);

    const result = await runLoop(config, [makeTask("T-1")], {
      ...makeDeps({ registry, markDone: port }),
      checkpoint: cp.port,
    });

    expect(result.stoppedBy).toBe("escalation_abort");
    expect(cp.calls).toContain("setStatus:T-1:aborted");
    expect(cp.state().tasks["T-1"]?.status).toBe("aborted");
  });

  it("clears checkpoint on skip_task escalation", async () => {
    const pipeline = [shell("s")];
    const rec: Recorder = { order: [] };
    const registry = scriptedRegistry(rec, {
      "T-1:s": { ok: false, reason: "nope" },
    });
    const { port } = recordingMarkDone();
    const config = makeConfig(pipeline, {
      escalation: { action: "skip_task", keep_worktree: true, notify: "stderr" },
    });
    const cp = fakeCheckpoint(pipeline);

    const result = await runLoop(config, [makeTask("T-1"), makeTask("T-2")], {
      ...makeDeps({ registry, markDone: port }),
      checkpoint: cp.port,
    });

    expect(result.stoppedBy).toBe("backlog_empty");
    // T-1 failed and was skipped — checkpoint cleared (not resumable).
    expect(cp.calls).toContain("clearTask:T-1");
    expect(cp.state().tasks["T-1"]).toBeUndefined();
    // T-2 succeeded — also cleared.
    expect(cp.state().tasks["T-2"]).toBeUndefined();
  });

  it("without checkpoint in deps, behavior is identical (no crash)", async () => {
    const rec: Recorder = { order: [] };
    const registry = scriptedRegistry(rec);
    const { port, marked } = recordingMarkDone();
    const config = makeConfig([shell("a"), shell("b")]);

    const result = await runLoop(
      config,
      [makeTask("T-1")],
      makeDeps({ registry, markDone: port }),
    );

    expect(rec.order).toEqual(["T-1:a", "T-1:b"]);
    expect(marked).toEqual(["T-1"]);
    expect(result.completed).toEqual(["T-1"]);
  });
});

// ---------------------------------------------------------------------------
// Program counter: goto flow (T-006)
// ---------------------------------------------------------------------------

describe("runLoop — program counter (goto flow)", () => {
  it("sequential (no goto): declared order, failure → escalate (regression zero)", async () => {
    const rec: Recorder = { order: [] };
    const registry = scriptedRegistry(rec, {
      b: { ok: false, reason: "boom" },
    });
    const { port, marked } = recordingMarkDone();
    const config = makeConfig([shell("a"), shell("b"), shell("c")]);

    const result = await runLoop(
      config,
      [makeTask("T-1")],
      makeDeps({ registry, markDone: port }),
    );

    // a runs, b fails → escalate. c is never reached by PC.
    expect(rec.order).toEqual(["T-1:a", "T-1:b"]);
    expect(marked).toEqual([]);
    expect(result.escalated).toEqual(["T-1"]);
  });

  it("on_success: { goto } jumps to target, skipping intermediate steps", async () => {
    const rec: Recorder = { order: [] };
    const registry = scriptedRegistry(rec);
    const { port, marked } = recordingMarkDone();
    const config = makeConfig([
      shell("a", { on_success: { goto: "c" } }),
      shell("b"),
      shell("c"),
    ]);

    const result = await runLoop(
      config,
      [makeTask("T-1")],
      makeDeps({ registry, markDone: port }),
    );

    // a succeeds → goto c → c succeeds → done. b never runs.
    expect(rec.order).toEqual(["T-1:a", "T-1:c"]);
    expect(marked).toEqual(["T-1"]);
    expect(result.completed).toEqual(["T-1"]);
  });

  it("on_fail: { goto } jumps to target instead of escalating", async () => {
    const rec: Recorder = { order: [] };
    const registry = scriptedRegistry(rec, {
      a: { ok: false, reason: "a failed" },
    });
    const { port, marked } = recordingMarkDone();
    const config = makeConfig([
      shell("a", { on_fail: { goto: "c" } }),
      shell("b"),
      shell("c"),
    ]);

    const result = await runLoop(
      config,
      [makeTask("T-1")],
      makeDeps({ registry, markDone: port }),
    );

    // a fails → goto c → c succeeds → done. b never runs.
    expect(rec.order).toEqual(["T-1:a", "T-1:c"]);
    expect(marked).toEqual(["T-1"]);
    expect(result.completed).toEqual(["T-1"]);
  });

  it("fix-loop: review→implement cycle runs until max_step_visits then escalates with reason", async () => {
    const rec: Recorder = { order: [] };
    const registry = scriptedRegistry(rec, {
      review: { ok: false, reason: "review failed" },
    });
    const { port, marked } = recordingMarkDone();
    const config = makeConfig(
      [
        shell("implement"),
        shell("review", { on_fail: { goto: "implement" } }),
      ],
      {
        stop: {
          max_iterations: 25,
          max_step_visits: 2,
          stop_signal_file: ".loopy.stop",
        },
      },
    );

    const logger = makeLogger();
    const result = await runLoop(
      config,
      [makeTask("T-1")],
      makeDeps({ registry, markDone: port, logger }),
    );

    // implement(1) → review(1,fail) → implement(2) → review(2,fail) →
    // implement(visit 3 > 2) → escalate WITHOUT executing
    expect(rec.order).toEqual([
      "T-1:implement",
      "T-1:review",
      "T-1:implement",
      "T-1:review",
    ]);
    expect(marked).toEqual([]);
    expect(result.escalated).toEqual(["T-1"]);
    // The escalation message carries the reason for the visit exceeded.
    expect(
      logger.errors.some((m) => m.includes("max_step_visits")),
    ).toBe(true);
  });

  it("terminal (success) still runs pending always steps linearly", async () => {
    const rec: Recorder = { order: [] };
    const registry = scriptedRegistry(rec);
    const { port, marked } = recordingMarkDone();
    // goto jumps over cleanup → cleanup runs in teardown after terminal success.
    const config = makeConfig(
      [
        shell("a", { on_success: { goto: "c" } }),
        shell("cleanup", { always: true }),
        shell("c"),
      ],
      {
        escalation: {
          action: "pause",
          keep_worktree: false,
          notify: "stderr",
        },
      },
    );

    const result = await runLoop(
      config,
      [makeTask("T-1")],
      makeDeps({ registry, markDone: port }),
    );

    // a → c (cleanup skipped by goto) → terminal success → cleanup in teardown.
    expect(rec.order).toEqual(["T-1:a", "T-1:c", "T-1:cleanup"]);
    expect(marked).toEqual(["T-1"]);
    expect(result.completed).toEqual(["T-1"]);
  });

  it("terminal (escalate) still runs pending always steps (keep_worktree off)", async () => {
    const rec: Recorder = { order: [] };
    const registry = scriptedRegistry(rec, {
      b: { ok: false, reason: "boom" },
    });
    const { port } = recordingMarkDone();
    const config = makeConfig(
      [shell("a"), shell("b"), shell("cleanup", { always: true })],
      {
        escalation: {
          action: "pause",
          keep_worktree: false,
          notify: "stderr",
        },
      },
    );

    const result = await runLoop(
      config,
      [makeTask("T-1")],
      makeDeps({ registry, markDone: port }),
    );

    // a → b(fail) → terminal escalate → cleanup in teardown (keep_worktree off).
    expect(rec.order).toEqual(["T-1:a", "T-1:b", "T-1:cleanup"]);
    expect(result.escalated).toEqual(["T-1"]);
  });

  it("terminal (escalate) suppresses always steps when keep_worktree on", async () => {
    const rec: Recorder = { order: [] };
    const registry = scriptedRegistry(rec, {
      a: { ok: false, reason: "boom" },
    });
    const { port } = recordingMarkDone();
    const config = makeConfig(
      [shell("a"), shell("cleanup", { always: true })],
      {
        escalation: {
          action: "pause",
          keep_worktree: true,
          notify: "stderr",
        },
      },
    );

    const result = await runLoop(
      config,
      [makeTask("T-1")],
      makeDeps({ registry, markDone: port }),
    );

    // a(fail) → terminal escalate + keep_worktree → cleanup suppressed.
    expect(rec.order).toEqual(["T-1:a"]);
    expect(result.escalated).toEqual(["T-1"]);
  });

  it("on_fail: { goto } seeds checksReport from result.output (feedback carry, OQ-8)", async () => {
    // Custom interpreter that captures the resolved ${checks.report} from its context.
    const capturedReports: string[] = [];
    const capturingShell: Step = {
      type: "shell",
      async execute(ctx: StepContext): Promise<StepResult> {
        capturedReports.push(ctx.resolve("${checks.report}"));
        return { ok: true };
      },
    };
    // Custom interpreter for "review" that fails with output (no report).
    const failingChecks: Step = {
      type: "checks",
      async execute(): Promise<StepResult> {
        return { ok: false, reason: "review failed", output: "Fix bug in line 42" };
      },
    };

    const registry = createStepRegistry([capturingShell, failingChecks]);
    const { port } = recordingMarkDone();
    const reviewStep: StepConfig = {
      id: "review",
      type: "checks",
      run: "ci",
      on_fail: { goto: "implement" },
    };
    const config = makeConfig(
      [
        // type: shell → capturingShell
        shell("implement"),
        // type: checks → failingChecks; on_fail goto back to implement
        reviewStep,
      ],
      {
        stop: {
          max_iterations: 25,
          max_step_visits: 2,
          stop_signal_file: ".loopy.stop",
        },
      },
    );

    await runLoop(
      config,
      [makeTask("T-1")],
      makeDeps({ registry, markDone: port }),
    );

    // 1st implement: empty report (no prior review)
    expect(capturedReports[0]).toBe("");
    // 2nd implement (after review failed with goto): sees review's output
    expect(capturedReports[1]).toBe("Fix bug in line 42");
  });

  it("on_fail: { goto } threads output into agent step prompt via ${checks.report} (T-007 e2e)", async () => {
    // A scripted session recording all prompts sent to it.
    const sentPrompts: string[] = [];
    const sessionProvider = async (): Promise<AgentSession> => ({
      sessionId: "sess",
      setMode: async () => {},
      clear: async () => {},
      prompt: async (text) => {
        sentPrompts.push(text);
        return "end_turn";
      },
      readText: () => "",
      cancel: async () => {},
    });

    // Review: a checks interpreter that always fails with output (no report).
    const failingReview: Step = {
      type: "checks",
      async execute(): Promise<StepResult> {
        return { ok: false, reason: "review failed", output: "Fix bug in line 42" };
      },
    };

    const agentInterp = createAgentStep();
    const registry = createStepRegistry([agentInterp, failingReview]);
    const { port } = recordingMarkDone();

    const config = makeConfig(
      [
        {
          id: "implement",
          type: "agent",
          prompt: "Implement ${task.id}. Feedback: ${checks.report}",
          retry_prompt: "Corrija.\n${checks.report}",
        } as StepConfig,
        {
          id: "review",
          type: "checks",
          run: "ci",
          on_fail: { goto: "implement" },
        } as StepConfig,
      ],
      {
        stop: {
          max_iterations: 25,
          max_step_visits: 2,
          stop_signal_file: ".loopy.stop",
        },
      },
    );

    await runLoop(config, [makeTask("T-1")], {
      ...makeDeps({ registry, markDone: port }),
      sessionProvider,
    });

    // 1st implement: fresh run — empty ${checks.report}.
    expect(sentPrompts[0]).toContain("Implement T-1.");
    expect(sentPrompts[0]).not.toContain("Fix bug");
    // 2nd implement (re-entered via goto): sees review's output in ${checks.report}.
    expect(sentPrompts[1]).toContain("Fix bug in line 42");
    // Re-entry uses `prompt` (not `retry_prompt`) — retry_prompt is inner-loop only.
    expect(sentPrompts[1]).toContain("Implement T-1.");
    expect(sentPrompts[1]).not.toContain("Corrija");
  });

  it("normal sequential flow does NOT leak output to next step's ${checks.report} (regression zero)", async () => {
    // An interpreter that returns output but no report.
    const outputOnlyStep: Step = {
      type: "shell",
      async execute(): Promise<StepResult> {
        return { ok: true, output: "SHOULD NOT LEAK" };
      },
    };
    // An agent that captures what it sees in ${checks.report}.
    const sentPrompts: string[] = [];
    const sessionProvider = async (): Promise<AgentSession> => ({
      sessionId: "sess",
      setMode: async () => {},
      clear: async () => {},
      prompt: async (text) => {
        sentPrompts.push(text);
        return "end_turn";
      },
      readText: () => "",
      cancel: async () => {},
    });

    const agentInterp = createAgentStep();
    const registry = createStepRegistry([agentInterp, outputOnlyStep]);
    const { port } = recordingMarkDone();

    const config = makeConfig([
      { id: "step-a", type: "shell", run: [] } as StepConfig,
      {
        id: "implement",
        type: "agent",
        prompt: "Report: [${checks.report}]",
      } as StepConfig,
    ]);

    await runLoop(config, [makeTask("T-1")], {
      ...makeDeps({ registry, markDone: port }),
      sessionProvider,
    });

    // The agent step must NOT see step-a's output in ${checks.report}.
    expect(sentPrompts[0]).toContain("Report: []");
  });
});

// ---------------------------------------------------------------------------
// End-to-end over a real git repo — non-agent spine (AD-6: real git, not mocked)
// ---------------------------------------------------------------------------

const E2E_YML = `
version: "1"
name: e2e-nonagent
workspace:
  root: "."
  parent_branch: "main"
  worktrees_dir: ".worktrees"
acp:
  command: ["npx", "-y", "@agentclientprotocol/claude-agent-acp"]
  request_timeout_seconds: 1800
  permissions: { default_mode: acceptEdits, on_request: allow }
inputs:
  spec: "SPEC.md"
  plan: "tasks/plan.md"
  todo: "tasks/todo.md"
  backlog:
    pending_marker: "- [ ]"
    done_marker: "- [x]"
    task_id_pattern: "T-\\\\d+"
    body: indented
    mark_done_on_success: true
checks:
  ci:
    - { name: noop, run: "true" }
pipeline:
  - id: create-worktree
    type: shell
    run:
      - git worktree add -b "\${task.branch}" "\${worktree.path}" "\${workspace.parent_branch}"
  - id: implement
    type: shell
    run:
      # Steps run as argv (no shell), so shell redirection (\`>\`) is not
      # available; write the file with node instead of \`echo > file\`.
      - 'node -e "require(''fs'').writeFileSync(process.argv[1], process.argv[2])" "\${worktree.path}/feature.txt" "\${task.id}"'
      - git -C "\${worktree.path}" add -A
      - 'git -C "\${worktree.path}" commit -m "feat: \${task.id}"'
  - id: merge
    type: approval
    prompt: "Aprovar merge de \${task.id}?"
    run:
      - 'git -C "\${workspace.root}" merge --no-ff "\${task.branch}" -m "merge: \${task.id}"'
    on_fail: escalate
  - id: cleanup
    type: shell
    always: true
    run:
      - git -C "\${workspace.root}" worktree remove --force "\${worktree.path}"
      - git -C "\${workspace.root}" branch -D "\${task.branch}"
stop_conditions:
  max_iterations: 25
  stop_signal_file: ".loopy.stop"
concurrency: 1
policies:
  escalation: { action: pause, keep_worktree: true, notify: stderr }
  git: { require_clean_parent: true }
logging: { dir: ".loopy/logs", per_task: true, capture_acp_traffic: false }
`;

const TODO_MD = `# Backlog

- [ ] T-100: Primeira task
      Corpo da primeira task.
`;

describe("runLoop — e2e over a real repo (non-agent spine)", () => {
  let root: string;

  async function git(args: readonly string[]): Promise<void> {
    await execa("git", args, {
      cwd: root,
      env: { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
    });
  }

  beforeEach(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "loopy-loop-")));
    await git(["init", "-b", "main"]);
    await git(["config", "user.email", "test@example.com"]);
    await git(["config", "user.name", "Loopy Test"]);
    await git(["config", "commit.gpgsign", "false"]);
    writeFileSync(
      join(root, ".gitignore"),
      ".worktrees/\n.loopy/\n.loopy.stop\n",
    );
    mkdirSync(join(root, "tasks"), { recursive: true });
    writeFileSync(join(root, "tasks", "todo.md"), TODO_MD);
    await git(["add", "-A"]);
    await git(["commit", "-m", "init"]);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("worktree → commit → merge(--yes) → cleanup → mark-done + commit", { timeout: 15_000 }, async () => {
    const config = parseConfig(E2E_YML);
    const todoPath = join(root, "tasks", "todo.md");
    const backlogOptions = backlogOptionsFrom(config.inputs.backlog);
    const tasks = pendingTasks(
      parseBacklog(readFileSync(todoPath, "utf8"), backlogOptions),
    );
    const g = createGit({ root });

    const deps: OrchestratorDeps = {
      root,
      flags: { ...DEFAULT_FLAGS, yes: true },
      registry: createNonAgentRegistry(),
      checks: passingChecks,
      ui: {
        requestApproval: async () => {
          throw new Error("under --yes the human gate must not be consulted");
        },
      },
      logger: makeLogger(),
      markDone: createMarkDonePort({
        todoPath,
        commit: g.commitPaths,
        backlogOptions,
      }),
    };

    const result = await runLoop(config, tasks, deps);

    expect(result.completed).toEqual(["T-100"]);
    expect(result.escalated).toEqual([]);
    expect(result.stoppedBy).toBe("backlog_empty");

    // The task branch's file was merged into the parent working tree.
    expect(readFileSync(join(root, "feature.txt"), "utf8")).toBe("T-100");
    // The worktree and its branch were cleaned up.
    expect(existsSync(join(root, ".worktrees", "T-100"))).toBe(false);
    const branches = await execa(
      "git",
      ["branch", "--list", tasks[0]!.branch],
      {
        cwd: root,
        env: { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
      },
    );
    expect(branches.stdout.trim()).toBe("");
    // The backlog was marked done...
    expect(readFileSync(todoPath, "utf8")).toContain("- [x] T-100:");
    // ...and that mark was committed on the parent (keeping it clean).
    const log = await execa("git", ["log", "--oneline"], {
      cwd: root,
      env: { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
    });
    expect(log.stdout).toContain("conclui T-100");
    // Parent working tree is clean after a successful run.
    expect(await g.isParentClean()).toBe(true);
  });
});
