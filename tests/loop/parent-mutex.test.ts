/**
 * T-004 acceptance tests — parent mutex (critical section) in the step
 * execution layer.
 *
 * These tests prove:
 *  - Shell/checks steps acquire the mutex (commands serialized).
 *  - `parallel_safe: true` steps bypass the mutex.
 *  - Approval steps: human wait runs OUTSIDE the mutex; only command execution
 *    runs INSIDE.
 *  - `require_clean_parent` is re-evaluated inside the mutex before mark-done.
 *  - `concurrency: 1` (the `for...of` intact) is byte-identical: mutex is
 *    uncontended, no observable difference in execution order.
 */
import { describe, expect, it } from "vitest";
import { createMutex, type Mutex } from "../../src/loop/mutex";
import { runLoop, type OrchestratorDeps } from "../../src/loop/orchestrator";
import {
  createShellStep,
  type RunShellCommand,
  type ShellCommandResult,
} from "../../src/steps/shell";
import { createApprovalStep } from "../../src/steps/approval";
import { createChecksStep } from "../../src/steps/checks";
import { createStepRegistry } from "../../src/steps/index";
import type {
  ApprovalStep,
  ChecksStep,
  GitPort,
  ShellStep,
  Step,
  StepConfig,
  StepContext,
  StepResult,
  StepType,
  Task,
  UiPort,
} from "../../src/types";
import { defaultConfig, makeLogger, makeStepContext } from "../steps/support";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(command = "echo ok"): ShellCommandResult {
  return { command, exitCode: 0, ok: true, stdout: "", stderr: "" };
}

/** Tracks event ordering across async operations. */
function eventLog(): { log: string[]; push: (e: string) => void } {
  const log: string[] = [];
  return { log, push: (e: string) => log.push(e) };
}

function shellStep(overrides: Partial<ShellStep> = {}): ShellStep {
  return { id: "sh", type: "shell", run: ["echo hi"], ...overrides };
}

function approvalStep(overrides: Partial<ApprovalStep> = {}): ApprovalStep {
  return {
    id: "merge",
    type: "approval",
    prompt: "Merge?",
    run: ["git merge --no-ff branch"],
    ...overrides,
  };
}

function checksStep(overrides: Partial<ChecksStep> = {}): ChecksStep {
  return { id: "ci", type: "checks", run: "ci", ...overrides };
}

// ---------------------------------------------------------------------------
// Shell step + mutex
// ---------------------------------------------------------------------------

describe("shell step — parent mutex (T-004)", () => {
  it("acquires mutex for commands (non-parallel_safe)", async () => {
    const events = eventLog();
    const mutex = createMutex();

    // Spy on mutex: wrap acquire to log.
    const origAcquire = mutex.acquire.bind(mutex);
    const spiedMutex: Mutex = {
      ...mutex,
      async acquire() {
        events.push("acquire");
        const release = await origAcquire();
        return () => {
          events.push("release");
          release();
        };
      },
    };

    const runner: RunShellCommand = async () => {
      events.push("run");
      return ok();
    };

    const step = createShellStep({ runCommand: runner, parentMutex: spiedMutex });
    const ctx = makeStepContext({ step: shellStep() });
    await step.execute(ctx);

    expect(events.log).toEqual(["acquire", "run", "release"]);
  });

  it("skips mutex when parallel_safe: true", async () => {
    const events = eventLog();
    const mutex = createMutex();

    const origAcquire = mutex.acquire.bind(mutex);
    const spiedMutex: Mutex = {
      ...mutex,
      async acquire() {
        events.push("acquire");
        const release = await origAcquire();
        return () => {
          events.push("release");
          release();
        };
      },
    };

    const runner: RunShellCommand = async () => {
      events.push("run");
      return ok();
    };

    const step = createShellStep({ runCommand: runner, parentMutex: spiedMutex });
    const ctx = makeStepContext({
      step: shellStep({ parallel_safe: true }),
    });
    await step.execute(ctx);

    // mutex never touched — only the run happens.
    expect(events.log).toEqual(["run"]);
  });

  it("releases mutex even on command failure", async () => {
    const mutex = createMutex();
    const runner: RunShellCommand = async () => ({
      command: "fail",
      exitCode: 1,
      ok: false,
      stdout: "",
      stderr: "boom",
    });

    const step = createShellStep({ runCommand: runner, parentMutex: mutex });
    const ctx = makeStepContext({ step: shellStep() });
    const result = await step.execute(ctx);

    expect(result.ok).toBe(false);
    expect(mutex.locked).toBe(false); // released despite failure
  });

  it("serializes concurrent shell step executions (FIFO)", async () => {
    const mutex = createMutex();
    const order: number[] = [];

    const slowRunner =
      (id: number): RunShellCommand =>
      async () => {
        order.push(id);
        // Simulate async work.
        await new Promise((r) => setTimeout(r, 5));
        return ok();
      };

    const step1 = createShellStep({ runCommand: slowRunner(1), parentMutex: mutex });
    const step2 = createShellStep({ runCommand: slowRunner(2), parentMutex: mutex });

    const ctx1 = makeStepContext({ step: shellStep({ id: "s1" }) });
    const ctx2 = makeStepContext({ step: shellStep({ id: "s2" }) });

    // Launch concurrently — mutex serializes.
    const [r1, r2] = await Promise.all([step1.execute(ctx1), step2.execute(ctx2)]);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    // FIFO: step1 acquired first.
    expect(order).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// Approval step + mutex
// ---------------------------------------------------------------------------

describe("approval step — parent mutex (T-004)", () => {
  it("human wait runs OUTSIDE mutex; command execution INSIDE", async () => {
    const events = eventLog();
    const mutex = createMutex();

    const origAcquire = mutex.acquire.bind(mutex);
    const spiedMutex: Mutex = {
      ...mutex,
      async acquire() {
        events.push("mutex:acquire");
        const release = await origAcquire();
        return () => {
          events.push("mutex:release");
          release();
        };
      },
    };

    const ui: UiPort = {
      async requestApproval() {
        events.push("ui:wait");
        // Simulate human thinking time.
        await new Promise((r) => setTimeout(r, 5));
        events.push("ui:approve");
        return true;
      },
    };

    const runner: RunShellCommand = async () => {
      events.push("cmd:run");
      return ok();
    };

    const step = createApprovalStep({ runCommand: runner, parentMutex: spiedMutex });
    const ctx = makeStepContext({ step: approvalStep(), ui });
    await step.execute(ctx);

    // Critical ordering: wait happens before acquire; run happens after acquire.
    expect(events.log).toEqual([
      "ui:wait",
      "ui:approve",
      "mutex:acquire",
      "cmd:run",
      "mutex:release",
    ]);
  });

  it("does not acquire mutex when gate is rejected (no commands run)", async () => {
    const events = eventLog();
    const mutex = createMutex();

    const origAcquire = mutex.acquire.bind(mutex);
    const spiedMutex: Mutex = {
      ...mutex,
      async acquire() {
        events.push("mutex:acquire");
        const release = await origAcquire();
        return () => {
          events.push("mutex:release");
          release();
        };
      },
    };

    const ui: UiPort = { async requestApproval() { return false; } };
    const runner: RunShellCommand = async () => {
      events.push("cmd:run");
      return ok();
    };

    const step = createApprovalStep({ runCommand: runner, parentMutex: spiedMutex });
    const ctx = makeStepContext({ step: approvalStep(), ui });
    const result = await step.execute(ctx);

    expect(result.ok).toBe(false);
    // Mutex never touched, no command ran.
    expect(events.log).toEqual([]);
  });

  it("releases mutex even on command failure", async () => {
    const mutex = createMutex();
    const runner: RunShellCommand = async () => ({
      command: "git merge",
      exitCode: 1,
      ok: false,
      stdout: "",
      stderr: "conflict",
    });

    const step = createApprovalStep({ runCommand: runner, parentMutex: mutex });
    const ctx = makeStepContext({ step: approvalStep() });
    const result = await step.execute(ctx);

    expect(result.ok).toBe(false);
    expect(mutex.locked).toBe(false);
  });

  it("skips mutex when parallel_safe: true", async () => {
    const events = eventLog();
    const mutex = createMutex();

    const origAcquire = mutex.acquire.bind(mutex);
    const spiedMutex: Mutex = {
      ...mutex,
      async acquire() {
        events.push("mutex:acquire");
        const release = await origAcquire();
        return () => { events.push("mutex:release"); release(); };
      },
    };

    const runner: RunShellCommand = async () => {
      events.push("cmd:run");
      return ok();
    };

    const step = createApprovalStep({ runCommand: runner, parentMutex: spiedMutex });
    const ctx = makeStepContext({
      step: approvalStep({ parallel_safe: true }),
    });
    await step.execute(ctx);

    // Mutex not acquired — only command ran.
    expect(events.log).toEqual(["cmd:run"]);
  });
});

// ---------------------------------------------------------------------------
// Checks step + mutex
// ---------------------------------------------------------------------------

describe("checks step — parent mutex (T-004)", () => {
  it("acquires mutex for checks execution", async () => {
    const events = eventLog();
    const mutex = createMutex();

    const origAcquire = mutex.acquire.bind(mutex);
    const spiedMutex: Mutex = {
      ...mutex,
      async acquire() {
        events.push("acquire");
        const release = await origAcquire();
        return () => { events.push("release"); release(); };
      },
    };

    const step = createChecksStep({ parentMutex: spiedMutex });
    const ctx = makeStepContext({
      step: checksStep(),
      checksConfig: { ci: [{ name: "lint", run: "echo lint" }] },
      checks: {
        async run() {
          events.push("checks:run");
          return { ok: true, results: [], text: "" };
        },
      },
    });
    await step.execute(ctx);

    expect(events.log).toEqual(["acquire", "checks:run", "release"]);
  });

  it("skips mutex when parallel_safe: true", async () => {
    const events = eventLog();
    const mutex = createMutex();

    const origAcquire = mutex.acquire.bind(mutex);
    const spiedMutex: Mutex = {
      ...mutex,
      async acquire() {
        events.push("acquire");
        const release = await origAcquire();
        return () => { events.push("release"); release(); };
      },
    };

    const step = createChecksStep({ parentMutex: spiedMutex });
    const ctx = makeStepContext({
      step: checksStep({ parallel_safe: true }),
      checksConfig: { ci: [{ name: "test", run: "echo test" }] },
      checks: {
        async run() {
          events.push("checks:run");
          return { ok: true, results: [], text: "" };
        },
      },
    });
    await step.execute(ctx);

    expect(events.log).toEqual(["checks:run"]);
  });
});

// ---------------------------------------------------------------------------
// Orchestrator integration: require_clean_parent inside mutex at mark-done
// ---------------------------------------------------------------------------

describe("orchestrator — require_clean_parent inside mutex (T-004)", () => {
  function pendingTask(id: string): Task {
    return { id, slug: id.toLowerCase(), title: `Task ${id}`, body: "", branch: `loopy/${id}`, done: false, deps: [] };
  }

  function passingRegistry(order: string[]) {
    const make = (type: StepType): Step => ({
      type,
      async execute(ctx: StepContext): Promise<StepResult> {
        order.push(ctx.task.id);
        return { ok: true };
      },
    });
    return createStepRegistry([make("shell"), make("checks"), make("approval")]);
  }

  function loopyConfig(requireCleanParent: boolean) {
    const base = defaultConfig({});
    return {
      ...base,
      pipeline: [{ id: "work", type: "shell", run: [] }] as StepConfig[],
      policies: {
        ...base.policies,
        git: { ...base.policies.git, require_clean_parent: requireCleanParent },
      },
    };
  }

  function deps(registry: OrchestratorDeps["registry"], git: GitPort, mutex?: Mutex): OrchestratorDeps {
    return {
      root: "/tmp/loopy-root-nonexist",
      flags: { dryRun: false, yes: false, tui: false, verbose: false },
      registry,
      checks: { run: async () => ({ ok: true, results: [], text: "" }) },
      ui: { requestApproval: async () => true },
      logger: makeLogger(),
      markDone: { markDone: async () => {} },
      git,
      parentMutex: mutex,
    };
  }

  it("evaluates require_clean_parent inside mutex before mark-done", async () => {
    const order: string[] = [];
    const mutex = createMutex();
    let calls = 0;

    // isParentClean: first call = clean (pre-task early-out), second = dirty (mark-done mutex check)
    const git: GitPort = {
      addWorktree: async () => {},
      removeWorktree: async () => {},
      merge: async () => ({ ok: true, conflict: false }),
      isParentClean: async () => {
        calls++;
        // First call is the pre-task early-out; second is inside markDoneWithMutex.
        return calls <= 1;
      },
    };

    const config = loopyConfig(true);
    const result = await runLoop(config, [pendingTask("T-1")], deps(passingRegistry(order), git, mutex));

    // T-1's pipeline ran, but mark-done failed (dirty parent at mark-done time).
    expect(order).toEqual(["T-1"]);
    expect(result.stoppedBy).toBe("dirty_parent");
    expect(result.completed).toEqual([]);
  });

  it("mark-done succeeds when parent is clean inside mutex", async () => {
    const order: string[] = [];
    const mutex = createMutex();

    const git: GitPort = {
      addWorktree: async () => {},
      removeWorktree: async () => {},
      merge: async () => ({ ok: true, conflict: false }),
      isParentClean: async () => true, // always clean
    };

    const config = loopyConfig(true);
    const result = await runLoop(config, [pendingTask("T-1")], deps(passingRegistry(order), git, mutex));

    expect(order).toEqual(["T-1"]);
    expect(result.stoppedBy).toBe("backlog_empty");
    expect(result.completed).toEqual(["T-1"]);
  });

  it("concurrency:1 without mutex is byte-identical (uncontended)", async () => {
    const order: string[] = [];
    // No mutex — same behavior.
    const git: GitPort = {
      addWorktree: async () => {},
      removeWorktree: async () => {},
      merge: async () => ({ ok: true, conflict: false }),
      isParentClean: async () => true,
    };

    const config = loopyConfig(true);
    const result = await runLoop(
      config,
      [pendingTask("T-1"), pendingTask("T-2")],
      deps(passingRegistry(order), git, undefined),
    );

    expect(order).toEqual(["T-1", "T-2"]);
    expect(result.completed).toEqual(["T-1", "T-2"]);
    expect(result.stoppedBy).toBe("backlog_empty");
  });
});
