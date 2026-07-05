/**
 * Stop-condition + `require_clean_parent` mechanics (T-018), on top of the
 * `max_iterations` / `stop_signal_file` / `backlog_empty` exits already covered
 * in `tests/loop/run-loop.test.ts`.
 *
 * Adds:
 *  - `--max-iterations` (flags) OVERRIDES `config.stop_conditions.max_iterations`.
 *  - `require_clean_parent`: before each task, if the policy is on AND a git
 *    handle is wired, a dirty parent working tree halts the loop
 *    (`stoppedBy: "dirty_parent"`) so the engine never proceeds onto a dirty
 *    parent (SPEC "Never: prosseguir ... se o parent_branch estiver sujo").
 */
import { describe, expect, it } from "vitest";
import { runLoop, type OrchestratorDeps } from "../../src/loop/orchestrator";
import { createStepRegistry } from "../../src/steps/index";
import type {
  GitPort,
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

/** A single-`shell`-step config with optional stop/git-policy overrides. */
function makeConfig(
  over: {
    readonly maxIterations?: number;
    readonly requireCleanParent?: boolean;
  } = {},
) {
  const base = defaultConfig({});
  return {
    ...base,
    pipeline: [{ id: "work", type: "shell", run: [] }] as StepConfig[],
    stop_conditions: {
      ...base.stop_conditions,
      max_iterations: over.maxIterations ?? base.stop_conditions.max_iterations,
    },
    policies: {
      ...base.policies,
      git: {
        require_clean_parent:
          over.requireCleanParent ?? base.policies.git.require_clean_parent,
      },
    },
  };
}

function recordingRegistry(order: string[]) {
  const make = (type: StepType): Step => ({
    type,
    async execute(ctx: StepContext): Promise<StepResult> {
      order.push(ctx.task.id);
      return { ok: true };
    },
  });
  return createStepRegistry([make("shell"), make("checks"), make("approval")]);
}

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

/** A GitPort whose `isParentClean` is scripted; every other op throws if reached. */
function gitWithParentClean(clean: () => boolean | Promise<boolean>): GitPort {
  const nope = (): never => {
    throw new Error("unexpected git op in a require_clean_parent test");
  };
  return {
    addWorktree: nope,
    removeWorktree: nope,
    merge: nope,
    isParentClean: async () => clean(),
  };
}

describe("stop conditions — --max-iterations override", () => {
  it("flags.maxIterations overrides the (higher) config ceiling", async () => {
    const order: string[] = [];
    const config = makeConfig({ maxIterations: 25 });

    const result = await runLoop(
      config,
      [makeTask("T-1"), makeTask("T-2"), makeTask("T-3")],
      baseDeps(recordingRegistry(order), {
        flags: { ...FLAGS, maxIterations: 1 },
      }),
    );

    expect(result.iterations).toBe(1);
    expect(result.stoppedBy).toBe("max_iterations");
    expect(order).toEqual(["T-1"]);
  });

  it("without the flag, the config ceiling still applies", async () => {
    const order: string[] = [];
    const config = makeConfig({ maxIterations: 2 });

    const result = await runLoop(
      config,
      [makeTask("T-1"), makeTask("T-2"), makeTask("T-3")],
      baseDeps(recordingRegistry(order)),
    );

    expect(result.iterations).toBe(2);
    expect(result.stoppedBy).toBe("max_iterations");
    expect(order).toEqual(["T-1", "T-2"]);
  });
});

describe("require_clean_parent", () => {
  it("halts before the first task when the parent is dirty (git wired)", async () => {
    const order: string[] = [];
    const notified: string[] = [];
    const config = makeConfig({ requireCleanParent: true });

    const result = await runLoop(
      config,
      [makeTask("T-1"), makeTask("T-2")],
      baseDeps(recordingRegistry(order), {
        git: gitWithParentClean(() => false),
        notify: (m) => notified.push(m),
      }),
    );

    // The dirty parent stops the loop before any task runs.
    expect(order).toEqual([]);
    expect(result.iterations).toBe(0);
    expect(result.stoppedBy).toBe("dirty_parent");
    expect(notified.join("")).toMatch(/parent|sujo/i);
  });

  it("proceeds normally when the parent is clean", async () => {
    const order: string[] = [];
    const config = makeConfig({ requireCleanParent: true });

    const result = await runLoop(
      config,
      [makeTask("T-1")],
      baseDeps(recordingRegistry(order), {
        git: gitWithParentClean(() => true),
      }),
    );

    expect(order).toEqual(["T-1"]);
    expect(result.stoppedBy).toBe("backlog_empty");
  });

  it("re-checks before EACH task — a parent dirtied after task 1 halts before task 2", async () => {
    const order: string[] = [];
    let cleanCount = 0;
    const config = makeConfig({ requireCleanParent: true });

    const result = await runLoop(
      config,
      [makeTask("T-1"), makeTask("T-2")],
      baseDeps(recordingRegistry(order), {
        // Clean before T-1, dirty before T-2.
        git: gitWithParentClean(() => (cleanCount++ === 0 ? true : false)),
      }),
    );

    expect(order).toEqual(["T-1"]);
    expect(result.iterations).toBe(1);
    expect(result.stoppedBy).toBe("dirty_parent");
  });

  it("is skipped entirely when the policy is off (git never consulted)", async () => {
    const order: string[] = [];
    const config = makeConfig({ requireCleanParent: false });

    const result = await runLoop(
      config,
      [makeTask("T-1")],
      baseDeps(recordingRegistry(order), {
        git: gitWithParentClean(() => {
          throw new Error(
            "isParentClean must not be called when policy is off",
          );
        }),
      }),
    );

    expect(order).toEqual(["T-1"]);
    expect(result.stoppedBy).toBe("backlog_empty");
  });

  it("is skipped when no git handle is wired (unit-spine safety)", async () => {
    const order: string[] = [];
    const config = makeConfig({ requireCleanParent: true });

    // No `git` in deps → the check cannot run and must be a no-op, not a throw.
    const result = await runLoop(
      config,
      [makeTask("T-1")],
      baseDeps(recordingRegistry(order)),
    );

    expect(order).toEqual(["T-1"]);
    expect(result.stoppedBy).toBe("backlog_empty");
  });
});
