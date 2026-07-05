/**
 * Escalation-policy mechanics (T-018): `keep_worktree` preservation and the
 * `notify` sink, on top of the three actions already proven in
 * `tests/loop/run-loop.test.ts`.
 *
 * `keep_worktree` is the crux: the example pipeline tears the worktree down in a
 * `cleanup` step flagged `always: true`, which by itself runs even after a
 * failure. When escalation preserves the worktree (`keep_worktree: true`), the
 * engine must SUPPRESS those `always` teardown steps on a failed task so the
 * failed state survives for inspection (SPEC "preserva o worktree"). Flipping
 * the knob to `false` restores teardown — mechanics only, driven by config (AD-1).
 */
import { describe, expect, it } from "vitest";
import {
  CANCEL_TIMEOUT_MS,
  runLoop,
  type AbortPort,
  type OrchestratorDeps,
} from "../../src/loop/orchestrator";
import { createStepRegistry } from "../../src/steps/index";
import type {
  AgentSession,
  EscalationPolicy,
  RunFlags,
  Step,
  StepConfig,
  StepContext,
  StepResult,
  StepType,
  Task,
} from "../../src/types";
import { defaultConfig, makeLogger } from "../steps/support";

const FLAGS: RunFlags = {
  dryRun: false,
  yes: false,
  tui: false,
  verbose: false,
};

function makeTask(id: string): Task {
  return {
    id,
    slug: id.toLowerCase(),
    title: `Task ${id}`,
    body: "",
    branch: `loopy/${id}`,
    done: false,
    deps: [],
  };
}

/** A config whose pipeline is `steps`, with a chosen escalation policy. */
function makeConfig(steps: StepConfig[], escalation: EscalationPolicy) {
  const base = defaultConfig({});
  return {
    ...base,
    pipeline: steps,
    policies: { ...base.policies, escalation },
  };
}

/** Records `${task.id}:${step.id}` per run; a scripted step id fails. */
function scriptedRegistry(order: string[], failing: string) {
  const make = (type: StepType): Step => ({
    type,
    async execute(ctx: StepContext): Promise<StepResult> {
      order.push(`${ctx.task.id}:${ctx.step.id}`);
      return ctx.step.id === failing
        ? { ok: false, reason: "boom" }
        : { ok: true };
    },
  });
  return createStepRegistry([make("shell"), make("checks"), make("approval")]);
}

const shell = (id: string, over: Partial<StepConfig> = {}): StepConfig =>
  ({ id, type: "shell", run: [], ...over }) as StepConfig;

function baseDeps(
  registry: OrchestratorDeps["registry"],
  over: Partial<OrchestratorDeps> = {},
): OrchestratorDeps {
  return {
    root: "/tmp/loopy-root-does-not-exist",
    flags: FLAGS,
    registry,
    checks: { run: async () => ({ ok: true, results: [], text: "" }) },
    ui: { requestApproval: async () => true },
    logger: makeLogger(),
    markDone: { markDone: async () => {} },
    ...over,
  };
}

const pause = (keep: boolean): EscalationPolicy => ({
  action: "pause",
  keep_worktree: keep,
  notify: "stderr",
});

describe("escalation — keep_worktree preserves the failed task's worktree", () => {
  it("keep_worktree: true suppresses `always` teardown steps after a failure", async () => {
    const order: string[] = [];
    const registry = scriptedRegistry(order, "work");
    const config = makeConfig(
      [shell("work"), shell("cleanup", { always: true })],
      pause(true),
    );

    const result = await runLoop(config, [makeTask("T-1")], baseDeps(registry));

    // `work` fails; the `always` cleanup is SKIPPED — the worktree is preserved.
    expect(order).toEqual(["T-1:work"]);
    // `pause` → task goes to `paused` (checkpoint preserved, T-006).
    expect(result.paused).toEqual(["T-1"]);
    expect(result.escalated).toEqual([]);
    expect(result.completed).toEqual([]);
  });

  it("keep_worktree: false still runs `always` teardown steps after a failure", async () => {
    const order: string[] = [];
    const registry = scriptedRegistry(order, "work");
    const config = makeConfig(
      [shell("work"), shell("cleanup", { always: true })],
      pause(false),
    );

    const result = await runLoop(config, [makeTask("T-1")], baseDeps(registry));

    // `work` fails; the `always` cleanup runs anyway — the worktree is torn down.
    expect(order).toEqual(["T-1:work", "T-1:cleanup"]);
    // `pause` → paused (T-006).
    expect(result.paused).toEqual(["T-1"]);
    expect(result.escalated).toEqual([]);
  });

  it("keep_worktree never suppresses `always` steps on a SUCCESSFUL task", async () => {
    const order: string[] = [];
    const registry = scriptedRegistry(order, "none-fails");
    const config = makeConfig(
      [shell("work"), shell("cleanup", { always: true })],
      pause(true),
    );

    const result = await runLoop(config, [makeTask("T-1")], baseDeps(registry));

    // No failure → cleanup runs; the happy path is unaffected by keep_worktree.
    expect(order).toEqual(["T-1:work", "T-1:cleanup"]);
    expect(result.completed).toEqual(["T-1"]);
  });
});

describe("escalation — notify sink", () => {
  it("invokes the notify sink with an escalation message naming the task, step and action", async () => {
    const notified: string[] = [];
    const registry = scriptedRegistry([], "work");
    const config = makeConfig([shell("work")], pause(true));

    await runLoop(
      config,
      [makeTask("T-9")],
      baseDeps(registry, { notify: (m) => notified.push(m) }),
    );

    expect(notified).toHaveLength(1);
    expect(notified[0]).toContain("T-9");
    expect(notified[0]).toContain("work");
    expect(notified[0]).toContain("pause");
  });

  it("does not notify when a task succeeds", async () => {
    const notified: string[] = [];
    const registry = scriptedRegistry([], "none-fails");
    const config = makeConfig([shell("work")], pause(true));

    await runLoop(
      config,
      [makeTask("T-9")],
      baseDeps(registry, { notify: (m) => notified.push(m) }),
    );

    expect(notified).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T-007 — abort_loop hard stop + session cancellation
// ---------------------------------------------------------------------------

const abortPolicy = (keep: boolean): EscalationPolicy => ({
  action: "abort_loop",
  keep_worktree: keep,
  notify: "stderr",
});

/** A fake AbortPort recording cancel and kill calls. */
function fakeAbortPort(): {
  readonly port: AbortPort;
  readonly cancelledCwds: string[];
  readonly killed: boolean[];
} {
  const cancelledCwds: string[] = [];
  const killed: boolean[] = [];
  return {
    cancelledCwds,
    killed,
    port: {
      async cancelSession(cwd) { cancelledCwds.push(cwd); },
      killAgent() { killed.push(true); },
    },
  };
}

/**
 * Registry where specific `task:step` keys fail or block. Unmatched steps
 * succeed immediately. Used for abort_loop tests with concurrent tasks.
 *
 * `script` maps `"task:step"` or just `"step"` to a function returning a
 * StepResult (may be async / block). Default: `{ ok: true }`.
 */
function concurrentScriptedRegistry(
  order: string[],
  script: Record<string, (ctx: StepContext) => Promise<StepResult> | StepResult> = {},
): ReturnType<typeof createStepRegistry> {
  const make = (type: StepType): Step => ({
    type,
    async execute(ctx: StepContext): Promise<StepResult> {
      const key = `${ctx.task.id}:${ctx.step.id}`;
      order.push(key);
      const handler = script[key] ?? script[ctx.step.id];
      if (handler) return handler(ctx);
      return { ok: true };
    },
  });
  return createStepRegistry([make("shell"), make("checks"), make("approval"), make("agent")]);
}

describe("escalation — abort_loop hard stop (T-007)", () => {
  /**
   * Build a cancellable session provider backed by a shared latch. Prompts
   * block until the latch opens; `cancel()` opens it (cooperative). The
   * latch survives timing races: even if `cancel()` is called before the
   * prompt reaches its `await`, the resolved promise is still picked up.
   */
  function cancellableSessionProvider(opts?: {
    /** When true, cancel does NOT unblock prompts (uncooperative agent). */
    uncooperative?: boolean;
  }): {
    readonly provider: (cwd: string) => Promise<AgentSession>;
    readonly cancelledIds: string[];
    /** Force-resolve all blocked prompts (simulates killAgent / process death). */
    forceUnblock(): void;
  } {
    const cancelledIds: string[] = [];
    // Shared latch: once resolved, every `await latch` passes immediately.
    let latchResolver: (() => void) | undefined;
    const latch = new Promise<void>((r) => { latchResolver = r; });
    const open = () => latchResolver?.();

    return {
      cancelledIds,
      forceUnblock: open,
      provider: async (cwd: string): Promise<AgentSession> => ({
        sessionId: `sess:${cwd}`,
        setMode: async () => {},
        clear: async () => {},
        prompt: async () => {
          await latch;
          return "cancelled";
        },
        readText: () => "",
        cancel: async () => {
          cancelledIds.push(cwd);
          if (!opts?.uncooperative) open();
        },
        drainUsage: () => null,
        readCost: () => null,
      }),
    };
  }

  /** Step handler that blocks on a session prompt until cancelled. */
  const blockOnSession = async (ctx: StepContext): Promise<StepResult> => {
    await ctx.session.setMode("acceptEdits");
    const stop = await ctx.session.prompt("do work");
    return stop === "cancelled"
      ? { ok: false, reason: "cancelled" }
      : { ok: true };
  };

  /** T-A fails immediately, T-B blocks on a session prompt. */
  function abortTestScript(order: string[]) {
    return concurrentScriptedRegistry(order, {
      "T-A:work": () => ({ ok: false, reason: "boom" }),
      "T-B:work": blockOnSession,
    });
  }

  /** Config with a single "work" step, abort_loop policy, concurrency 2. */
  function abortTestConfig() {
    const config = makeConfig([shell("work")], abortPolicy(true));
    config.concurrency = 2;
    return config;
  }

  it("abort_loop cancels in-flight sibling sessions via session.cancel()", async () => {
    const order: string[] = [];
    const sessions = cancellableSessionProvider();

    const cancelledCwds: string[] = [];
    const killed: boolean[] = [];
    const abortPort: AbortPort = {
      async cancelSession(cwd) {
        cancelledCwds.push(cwd);
        const s = await sessions.provider(cwd);
        await s.cancel();
      },
      killAgent() { killed.push(true); },
    };

    const result = await runLoop(
      abortTestConfig(),
      [makeTask("T-A"), makeTask("T-B")],
      {
        ...baseDeps(abortTestScript(order), { notify: () => {} }),
        sessionProvider: sessions.provider,
        abort: abortPort,
      },
    );

    expect(result.escalated).toContain("T-A");
    expect(result.stoppedBy).toBe("escalation_abort");
    expect(cancelledCwds.length).toBeGreaterThan(0);
    expect(killed).toEqual([]);
  });

  it("timeout on cooperative cancel triggers killAgent()", async () => {
    const order: string[] = [];
    const sessions = cancellableSessionProvider({ uncooperative: true });

    const cancelledCwds: string[] = [];
    const killed: boolean[] = [];
    const abortPort: AbortPort = {
      async cancelSession(cwd) { cancelledCwds.push(cwd); },
      killAgent() {
        killed.push(true);
        sessions.forceUnblock();
      },
    };

    const result = await runLoop(
      abortTestConfig(),
      [makeTask("T-A"), makeTask("T-B")],
      {
        ...baseDeps(abortTestScript(order), { notify: () => {} }),
        sessionProvider: sessions.provider,
        abort: abortPort,
      },
    );

    expect(result.stoppedBy).toBe("escalation_abort");
    expect(cancelledCwds.length).toBeGreaterThan(0);
    expect(killed).toEqual([true]);
  }, CANCEL_TIMEOUT_MS + 5_000);

  it("cancelled tasks have checkpoint preserved (resumable, OQ13)", async () => {
    const order: string[] = [];
    const sessions = cancellableSessionProvider();

    const abortPort: AbortPort = {
      async cancelSession(cwd) {
        const s = await sessions.provider(cwd);
        await s.cancel();
      },
      killAgent() {},
    };

    const cpCalls: string[] = [];
    const checkpoint = {
      read: () => ({ version: 1 as const, tasks: {} }),
      saveProgress(taskId: string, pc: string) { cpCalls.push(`saveProgress:${taskId}:${pc}`); },
      setStatus(taskId: string, status: string) { cpCalls.push(`setStatus:${taskId}:${status}`); },
      clearTask(taskId: string) { cpCalls.push(`clearTask:${taskId}`); },
      pruneOrphans() {},
    };

    await runLoop(
      abortTestConfig(),
      [makeTask("T-A"), makeTask("T-B")],
      {
        ...baseDeps(abortTestScript(order), { notify: () => {} }),
        sessionProvider: sessions.provider,
        abort: abortPort,
        checkpoint,
      },
    );

    expect(cpCalls).toContain("setStatus:T-A:aborted");
    expect(cpCalls.filter((c) => c === "setStatus:T-B:aborted")).toEqual([]);
    expect(cpCalls.filter((c) => c === "clearTask:T-B")).toEqual([]);
  });

  it("killAgent() is never called for aborting a single task (no siblings)", async () => {
    const order: string[] = [];
    const registry = scriptedRegistry(order, "work");
    const abort = fakeAbortPort();

    // Only one task, fails with abort_loop — no siblings to cancel.
    const config = makeConfig([shell("work")], abortPolicy(false));

    const result = await runLoop(config, [makeTask("T-1")], {
      ...baseDeps(registry, { notify: () => {} }),
      abort: abort.port,
    });

    expect(result.stoppedBy).toBe("escalation_abort");
    expect(result.escalated).toEqual(["T-1"]);
    // No siblings → no cancel, no kill.
    expect(abort.cancelledCwds).toEqual([]);
    expect(abort.killed).toEqual([]);
  });
});
