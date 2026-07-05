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
import { runLoop, type OrchestratorDeps } from "../../src/loop/orchestrator";
import { createStepRegistry } from "../../src/steps/index";
import type {
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
