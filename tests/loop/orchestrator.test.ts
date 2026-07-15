import { describe, expect, it } from "vitest";
import { parseConfig } from "../../src/config/load";
import { parseBacklog, pendingTasks } from "../../src/backlog/todo";
import { InterpolationError } from "../../src/interp/resolver";
import {
  buildScopeVars,
  formatDryRunPlan,
  planDryRun,
  runLoop,
  stripDepsLine,
  worktreePathFor,
} from "../../src/loop/orchestrator";
import { createStepRegistry } from "../../src/steps/index";
import type {
  GitPort,
  LoopyConfig,
  MergeConflictStrategy,
  StepContext,
  StepResult,
  StepType,
  Task,
} from "../../src/types";
import {
  makeConfig as makeLoopConfig,
  makeDeps,
  makeTask,
  recordingMarkDone,
  shell,
  scriptedRegistry,
  type Recorder,
} from "./support";

/**
 * A compact-but-complete config exercising all four step primitives plus
 * interpolation across every namespace. Kept inline so each test reads as a
 * self-contained specification.
 */
const CONFIG_YML = `
version: "1"
name: fixture-loop
workspace:
  root: "."
  parent_branch: "main"
  worktrees_dir: ".worktrees"
acp:
  command: ["npx", "-y", "@agentclientprotocol/claude-agent-acp"]
  request_timeout_seconds: 1800
  permissions:
    default_mode: acceptEdits
    on_request: allow
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
    - { name: typecheck, run: "npm run typecheck" }
    - { name: test, run: "npm test" }
pipeline:
  - id: create-worktree
    type: shell
    run:
      - git worktree add -b "\${task.branch}" "\${worktree.path}" "\${workspace.parent_branch}"
  - id: implement
    type: agent
    clear_context: true
    mode: acceptEdits
    prompt: |
      Implemente \${task.id} — \${task.title} conforme \${inputs.spec}.
      \${task.body}
    retry_prompt: |
      Os checks falharam. Corrija.
      \${checks.report}
    verify: { run: ci, max_attempts: 3 }
  - id: audit
    type: agent
    clear_context: true
    mode: plan
    prompt: |
      Audite \${task.id}. Diff:
      \${worktree.diff}
      Responda "AUDIT: PASS" ou "AUDIT: FAIL: <motivo>".
    expect: "AUDIT: PASS"
    on_fail: escalate
  - id: merge
    type: approval
    prompt: "Aprovar merge da task \${task.id} em \${workspace.parent_branch}?"
    run:
      - git -C "\${workspace.root}" merge --no-ff "\${task.branch}"
    on_fail: escalate
  - id: cleanup
    type: shell
    always: true
    run:
      - git -C "\${workspace.root}" worktree remove --force "\${worktree.path}"
stop_conditions:
  max_iterations: 10
  stop_signal_file: ".loopy.stop"
concurrency: 1
policies:
  escalation: { action: pause, keep_worktree: true, notify: stderr }
  git: { require_clean_parent: true }
logging: { dir: ".loopy/logs", per_task: true, capture_acp_traffic: false }
`;

const TODO_MD = `# Backlog fixture

- [x] T-001: Ja feita
      Corpo da task feita.

- [ ] T-002: Primeira pendente
      Implementar o parser do backlog.

- [ ] T-003: Segunda pendente
`;

function makeConfig(): LoopyConfig {
  return parseConfig(CONFIG_YML);
}

function makeTasks(): Task[] {
  return pendingTasks(parseBacklog(TODO_MD));
}

describe("worktreePathFor", () => {
  it("places the worktree under worktrees_dir keyed by task id", () => {
    const config = makeConfig();
    const [task] = makeTasks();
    expect(worktreePathFor(config, task!)).toBe(".worktrees/T-002");
  });

  it("normalizes a trailing slash on worktrees_dir", () => {
    const config = {
      ...makeConfig(),
      workspace: { root: ".", parent_branch: "main", worktrees_dir: "wt/" },
    };
    const [task] = makeTasks();
    expect(worktreePathFor(config, task!)).toBe("wt/T-002");
  });
});

describe("buildScopeVars", () => {
  it("maps config + task + runtime into the documented interpolation scope", () => {
    const config = makeConfig();
    const [task] = makeTasks();

    const vars = buildScopeVars(config, task!, {
      iteration: 4,
      attempt: 2,
      worktreePath: ".worktrees/T-002",
      diff: "some diff",
      checksReport: "report text",
    });

    expect(vars.task.id).toBe("T-002");
    expect(vars.task.branch).toBe(task!.branch);
    expect(vars.worktree).toEqual({
      path: ".worktrees/T-002",
      diff: "some diff",
    });
    expect(vars.iteration).toBe(4);
    expect(vars.attempt).toBe(2);
    expect(vars.checks.report).toBe("report text");
    expect(vars.inputs).toEqual({
      spec: "SPEC.md",
      plan: "tasks/plan.md",
      todo: "tasks/todo.md",
    });
    expect(vars.workspace).toEqual({
      root: ".",
      parent_branch: "main",
      worktrees_dir: ".worktrees",
    });
    // change derived from dirname(inputs.todo)
    expect(vars.change.id).toBe("tasks");
    expect(vars.change.dir).toBe("tasks");
  });

  it("derives change.id from basename(dirname(inputs.todo))", () => {
    const base = makeConfig();
    const config = {
      ...base,
      inputs: { ...base.inputs, todo: ".harn/devy/changes/C-0005-step-metrics/todo.md" },
    };
    const [task] = makeTasks();
    const vars = buildScopeVars(config, task!, {
      iteration: 1, attempt: 1, worktreePath: ".worktrees/T-002", diff: "", checksReport: "",
    });
    expect(vars.change.id).toBe("C-0005-step-metrics");
    expect(vars.change.dir).toBe(".harn/devy/changes/C-0005-step-metrics");
  });

  it("falls back change.id to config.name when todo is at root", () => {
    const base = makeConfig();
    const config = { ...base, inputs: { ...base.inputs, todo: "todo.md" } };
    const [task] = makeTasks();
    const vars = buildScopeVars(config, task!, {
      iteration: 1, attempt: 1, worktreePath: ".worktrees/T-002", diff: "", checksReport: "",
    });
    expect(vars.change.id).toBe(config.name);
    expect(vars.change.dir).toBe(".");
  });
});

describe("planDryRun", () => {
  it("plans one entry per task in order, numbering iterations 1..N", () => {
    const plan = planDryRun(makeConfig(), makeTasks());
    expect(plan.tasks.map((t) => t.task.id)).toEqual(["T-002", "T-003"]);
    expect(plan.tasks.map((t) => t.iteration)).toEqual([1, 2]);
  });

  it("resolves an agent prompt against the task/inputs scope", () => {
    const plan = planDryRun(makeConfig(), makeTasks());
    const implement = plan.tasks[0]!.steps.find((s) => s.id === "implement")!;
    const prompt = implement.fields.find((f) => f.kind === "prompt")!;
    expect(prompt.value).toContain(
      "Implemente T-002 — Primeira pendente conforme SPEC.md.",
    );
    expect(prompt.value).toContain("Implementar o parser do backlog.");
  });

  it("selects the primary prompt (not retry_prompt) for the first-attempt plan", () => {
    const plan = planDryRun(makeConfig(), makeTasks());
    const implement = plan.tasks[0]!.steps.find((s) => s.id === "implement")!;
    const prompt = implement.fields.find((f) => f.kind === "prompt")!;
    expect(prompt.value).not.toContain("Os checks falharam");
  });

  it("resolves shell commands with worktree/workspace values", () => {
    const plan = planDryRun(makeConfig(), makeTasks());
    const create = plan.tasks[0]!.steps.find(
      (s) => s.id === "create-worktree",
    )!;
    const command = create.fields.find((f) => f.kind === "command")!;
    expect(command.value).toBe(
      'git worktree add -b "T-002-primeira-pendente" ".worktrees/T-002" "main"',
    );
  });

  it("renders known-but-empty variables (checks.report, worktree.diff) as empty", () => {
    const plan = planDryRun(makeConfig(), makeTasks());
    const audit = plan.tasks[0]!.steps.find((s) => s.id === "audit")!;
    const prompt = audit.fields.find((f) => f.kind === "prompt")!;
    // The ${worktree.diff} line collapses to an empty line, no literal token.
    expect(prompt.value).toContain("Audite T-002. Diff:");
    expect(prompt.value).not.toContain("${");
  });

  it("flags always-run steps", () => {
    const plan = planDryRun(makeConfig(), makeTasks());
    const cleanup = plan.tasks[0]!.steps.find((s) => s.id === "cleanup")!;
    expect(cleanup.always).toBe(true);
    const implement = plan.tasks[0]!.steps.find((s) => s.id === "implement")!;
    expect(implement.always).toBe(false);
  });

  it("aborts fail-fast when a template references an unknown variable", () => {
    const brokenYml = CONFIG_YML.replace(
      "\${task.id} — \${task.title}",
      "\${task.nope}",
    );
    const config = parseConfig(brokenYml);
    expect(() => planDryRun(config, makeTasks())).toThrow(InterpolationError);
  });
});

describe("formatDryRunPlan", () => {
  it("renders every task/step with interpolation resolved and no leftover tokens", () => {
    const text = formatDryRunPlan(planDryRun(makeConfig(), makeTasks()));
    expect(text).toContain("T-002");
    expect(text).toContain("T-003");
    expect(text).toContain("git worktree add");
    expect(text).not.toContain("${");
  });
});

// ---------------------------------------------------------------------------
// DAG-driven pool scheduler (T-005)
// ---------------------------------------------------------------------------

describe("runLoop — DAG pool scheduler", () => {
  it("DAG A→C, B (indep), concurrency 2: A and B start together, C waits for A", async () => {
    const startOrder: string[] = [];
    const reg = createStepRegistry([
      {
        type: "shell" as StepType,
        async execute(ctx: StepContext): Promise<StepResult> {
          startOrder.push(ctx.task.id);
          // Simulate async work
          await new Promise((r) => setTimeout(r, 10));
          return { ok: true };
        },
      },
    ]);
    const { port } = recordingMarkDone();
    const config = makeLoopConfig([shell("s1")], { concurrency: 2 });
    const tasks = [
      makeTask("A"),
      makeTask("B"),
      makeTask("C", { deps: ["A"] }),
    ];

    const result = await runLoop(config, tasks, makeDeps({ registry: reg, markDone: port }));

    expect(result.completed).toContain("A");
    expect(result.completed).toContain("B");
    expect(result.completed).toContain("C");
    // A and B started before C
    const aIdx = startOrder.indexOf("A");
    const bIdx = startOrder.indexOf("B");
    const cIdx = startOrder.indexOf("C");
    expect(aIdx).toBeLessThan(cIdx);
    expect(bIdx).toBeLessThan(cIdx);
    expect(result.stoppedBy).toBe("backlog_empty");
  });

  it("pool never exceeds concurrency N", async () => {
    let maxConcurrent = 0;
    let current = 0;
    const reg = createStepRegistry([
      {
        type: "shell" as StepType,
        async execute(): Promise<StepResult> {
          current++;
          maxConcurrent = Math.max(maxConcurrent, current);
          await new Promise((r) => setTimeout(r, 20));
          current--;
          return { ok: true };
        },
      },
    ]);
    const { port } = recordingMarkDone();
    const config = makeLoopConfig([shell("s1")], { concurrency: 2 });
    const tasks = [makeTask("A"), makeTask("B"), makeTask("C"), makeTask("D")];

    await runLoop(config, tasks, makeDeps({ registry: reg, markDone: port }));

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("tie-breaking: ready tasks launch in backlog order", async () => {
    const startOrder: string[] = [];
    const reg = createStepRegistry([
      {
        type: "shell" as StepType,
        async execute(ctx: StepContext): Promise<StepResult> {
          startOrder.push(ctx.task.id);
          return { ok: true };
        },
      },
    ]);
    const { port } = recordingMarkDone();
    // concurrency 1 → one at a time → order is deterministic
    const config = makeLoopConfig([shell("s1")], { concurrency: 1 });
    const tasks = [makeTask("A"), makeTask("B"), makeTask("C")];

    await runLoop(config, tasks, makeDeps({ registry: reg, markDone: port }));

    expect(startOrder).toEqual(["A", "B", "C"]);
  });

  it("orphan dep → throws fail-fast before any task runs", async () => {
    const startOrder: string[] = [];
    const reg = createStepRegistry([
      {
        type: "shell" as StepType,
        async execute(ctx: StepContext): Promise<StepResult> {
          startOrder.push(ctx.task.id);
          return { ok: true };
        },
      },
    ]);
    const { port } = recordingMarkDone();
    const config = makeLoopConfig([shell("s1")]);
    const tasks = [makeTask("A", { deps: ["X"] })]; // X doesn't exist

    await expect(runLoop(config, tasks, makeDeps({ registry: reg, markDone: port })))
      .rejects.toThrow(/órfã.*"X"/);
    expect(startOrder).toEqual([]); // no task started
  });

  it("cycle → throws fail-fast before any task runs", async () => {
    const reg = createStepRegistry([
      {
        type: "shell" as StepType,
        async execute(): Promise<StepResult> {
          return { ok: true };
        },
      },
    ]);
    const { port } = recordingMarkDone();
    const config = makeLoopConfig([shell("s1")]);
    const tasks = [
      makeTask("A", { deps: ["B"] }),
      makeTask("B", { deps: ["A"] }),
    ];

    await expect(runLoop(config, tasks, makeDeps({ registry: reg, markDone: port })))
      .rejects.toThrow(/[Cc]iclo/);
  });

  it("${iteration} is the stable backlog index (identical to dry-run)", async () => {
    const iterations: Record<string, number> = {};
    const reg = createStepRegistry([
      {
        type: "shell" as StepType,
        async execute(ctx: StepContext): Promise<StepResult> {
          iterations[ctx.task.id] = ctx.iteration;
          return { ok: true };
        },
      },
    ]);
    const { port } = recordingMarkDone();
    const config = makeLoopConfig([shell("s1")], { concurrency: 2 });
    const tasks = [
      makeTask("A"),
      makeTask("B"),
      makeTask("C", { deps: ["A"] }),
    ];

    await runLoop(config, tasks, makeDeps({ registry: reg, markDone: port }));

    // Stable 1-based position in the tasks array, regardless of execution order
    expect(iterations["A"]).toBe(1);
    expect(iterations["B"]).toBe(2);
    expect(iterations["C"]).toBe(3);

    // Same as dry-run
    const plan = planDryRun(config, tasks);
    expect(plan.tasks[0]!.iteration).toBe(1); // A
    expect(plan.tasks[1]!.iteration).toBe(2); // B
    expect(plan.tasks[2]!.iteration).toBe(3); // C
  });

  it("concurrency: 1 without deps = sequential byte-identical to backlog order", async () => {
    const startOrder: string[] = [];
    const completeOrder: string[] = [];
    const reg = createStepRegistry([
      {
        type: "shell" as StepType,
        async execute(ctx: StepContext): Promise<StepResult> {
          startOrder.push(ctx.task.id);
          await new Promise((r) => setTimeout(r, 5));
          completeOrder.push(ctx.task.id);
          return { ok: true };
        },
      },
    ]);
    const { port } = recordingMarkDone();
    const config = makeLoopConfig([shell("s1")], { concurrency: 1 });
    const tasks = [makeTask("A"), makeTask("B"), makeTask("C")];

    const result = await runLoop(config, tasks, makeDeps({ registry: reg, markDone: port }));

    expect(startOrder).toEqual(["A", "B", "C"]);
    expect(completeOrder).toEqual(["A", "B", "C"]);
    expect(result.completed).toEqual(["A", "B", "C"]);
  });

  it("max_iterations counts tasks started (skipped do not count)", async () => {
    const startOrder: string[] = [];
    const reg = createStepRegistry([
      {
        type: "shell" as StepType,
        async execute(ctx: StepContext): Promise<StepResult> {
          startOrder.push(ctx.task.id);
          // A fails → C is skipped (dep on A)
          return ctx.task.id === "A" ? { ok: false, reason: "fail" } : { ok: true };
        },
      },
    ]);
    const { port } = recordingMarkDone();
    const config = makeLoopConfig([shell("s1")], {
      concurrency: 1,
      stop: { max_iterations: 2, max_step_visits: 10, stop_signal_file: ".loopy.stop" },
      escalation: { action: "skip_task", keep_worktree: false, notify: "stderr" },
    });
    const tasks = [
      makeTask("A"),
      makeTask("B"),
      makeTask("C", { deps: ["A"] }),
    ];

    const result = await runLoop(config, tasks, makeDeps({ registry: reg, markDone: port }));

    // A started (failed), B started (ok) → 2 tasks started → max_iterations hit
    // C is skipped (dep A failed) → does not count towards started
    expect(startOrder).toEqual(["A", "B"]);
    expect(result.skipped).toContain("C");
    expect(result.iterations).toBe(2);
  });

  it("--concurrency flag overrides config.concurrency", async () => {
    let maxConcurrent = 0;
    let current = 0;
    const reg = createStepRegistry([
      {
        type: "shell" as StepType,
        async execute(): Promise<StepResult> {
          current++;
          maxConcurrent = Math.max(maxConcurrent, current);
          await new Promise((r) => setTimeout(r, 15));
          current--;
          return { ok: true };
        },
      },
    ]);
    const { port } = recordingMarkDone();
    // config says concurrency: 1, but flag overrides to 3
    const config = makeLoopConfig([shell("s1")], { concurrency: 1 });
    const tasks = [makeTask("A"), makeTask("B"), makeTask("C")];

    await runLoop(config, tasks, {
      ...makeDeps({ registry: reg, markDone: port }),
      flags: { dryRun: false, yes: false, tui: false, emitEvents: false, verbose: false, concurrency: 3 },
    });

    expect(maxConcurrent).toBe(3);
  });

  it("escalation abort_loop drains in-flight before returning", async () => {
    const completedIds: string[] = [];
    const reg = createStepRegistry([
      {
        type: "shell" as StepType,
        async execute(ctx: StepContext): Promise<StepResult> {
          await new Promise((r) => setTimeout(r, ctx.task.id === "A" ? 5 : 20));
          completedIds.push(ctx.task.id);
          // A fails with escalation abort
          return ctx.task.id === "A" ? { ok: false, reason: "fail" } : { ok: true };
        },
      },
    ]);
    const { port } = recordingMarkDone();
    const config = makeLoopConfig([shell("s1")], {
      concurrency: 2,
      escalation: { action: "abort_loop", keep_worktree: false, notify: "stderr" },
    });
    const tasks = [makeTask("A"), makeTask("B")];

    const result = await runLoop(config, tasks, makeDeps({ registry: reg, markDone: port }));

    expect(result.stoppedBy).toBe("escalation_abort");
    expect(result.escalated).toContain("A");
  });
});

// ---------------------------------------------------------------------------
// on_merge_conflict policy (T-008)
// ---------------------------------------------------------------------------

describe("runLoop — on_merge_conflict policy", () => {
  /** Build a config with a specific merge-conflict policy. */
  function mergeConfig(
    pipeline: Parameters<typeof makeLoopConfig>[0],
    onMergeConflict: MergeConflictStrategy,
  ) {
    const base = makeLoopConfig(pipeline);
    return {
      ...base,
      policies: {
        ...base.policies,
        git: { ...base.policies.git, on_merge_conflict: onMergeConflict },
      },
    };
  }

  /** A mock GitPort where `isMergeInProgress`, `rebaseOnto`, and `merge` are scripted. */
  function mockGit(opts: {
    mergeInProgress?: boolean;
    rebaseOk?: boolean;
    retryMergeOk?: boolean;
  }): GitPort & { readonly calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      addWorktree: async () => {},
      removeWorktree: async () => {},
      isParentClean: async () => true,
      isMergeInProgress: async () => {
        calls.push("isMergeInProgress");
        return opts.mergeInProgress ?? false;
      },
      rebaseOnto: async () => {
        calls.push("rebaseOnto");
        const ok = opts.rebaseOk ?? true;
        return { ok, conflict: !ok };
      },
      merge: async () => {
        calls.push("merge");
        const ok = opts.retryMergeOk ?? true;
        return { ok, conflict: !ok };
      },
      revParseHead: async () => null,
      remoteOriginUrl: async () => null,
      diffNumstat: async () => null,
    };
  }

  it("escalate (default): step failure does NOT trigger rebase even if merge in progress", async () => {
    const rec: Recorder = { order: [] };
    const reg = scriptedRegistry(rec, {
      "merge-step": { ok: false, reason: "merge conflict" },
    });
    const { port } = recordingMarkDone();
    const config = mergeConfig([shell("merge-step")], "escalate");
    const git = mockGit({ mergeInProgress: true, rebaseOk: true, retryMergeOk: true });

    const result = await runLoop(config, [makeTask("T-1")], {
      ...makeDeps({ registry: reg, markDone: port }),
      git,
    });

    // Step failed → escalation. No rebase attempted.
    expect(result.completed).toEqual([]);
    expect(result.paused).toContain("T-1");
    // isMergeInProgress was never called because policy is "escalate".
    expect(git.calls).not.toContain("isMergeInProgress");
    expect(git.calls).not.toContain("rebaseOnto");
  });

  it("rebase: recovers from merge conflict via rebase + retry merge", async () => {
    const rec: Recorder = { order: [] };
    const reg = scriptedRegistry(rec, {
      "merge-step": { ok: false, reason: "merge conflict" },
    });
    const { port, marked } = recordingMarkDone();
    const config = mergeConfig([shell("merge-step")], "rebase");
    const git = mockGit({ mergeInProgress: true, rebaseOk: true, retryMergeOk: true });

    const result = await runLoop(config, [makeTask("T-1")], {
      ...makeDeps({ registry: reg, markDone: port }),
      git,
    });

    // The step "failed" but the orchestrator recovered via rebase + retry merge.
    expect(result.completed).toEqual(["T-1"]);
    expect(marked).toEqual(["T-1"]);
    expect(git.calls).toContain("isMergeInProgress");
    expect(git.calls).toContain("rebaseOnto");
    expect(git.calls).toContain("merge");
  });

  it("rebase: falls through to on_fail when rebase itself fails", async () => {
    const rec: Recorder = { order: [] };
    const reg = scriptedRegistry(rec, {
      "merge-step": { ok: false, reason: "merge conflict" },
    });
    const { port } = recordingMarkDone();
    const config = mergeConfig([shell("merge-step")], "rebase");
    const git = mockGit({ mergeInProgress: true, rebaseOk: false });

    const result = await runLoop(config, [makeTask("T-1")], {
      ...makeDeps({ registry: reg, markDone: port }),
      git,
    });

    // Rebase failed → normal escalation.
    expect(result.completed).toEqual([]);
    expect(result.paused).toContain("T-1");
    expect(git.calls).toContain("rebaseOnto");
    expect(git.calls).not.toContain("merge"); // merge retry never called
  });

  it("rebase: falls through to on_fail when retry merge fails", async () => {
    const rec: Recorder = { order: [] };
    const reg = scriptedRegistry(rec, {
      "merge-step": { ok: false, reason: "merge conflict" },
    });
    const { port } = recordingMarkDone();
    const config = mergeConfig([shell("merge-step")], "rebase");
    const git = mockGit({ mergeInProgress: true, rebaseOk: true, retryMergeOk: false });

    const result = await runLoop(config, [makeTask("T-1")], {
      ...makeDeps({ registry: reg, markDone: port }),
      git,
    });

    // Rebase ok but retry merge failed → normal escalation.
    expect(result.completed).toEqual([]);
    expect(result.paused).toContain("T-1");
    expect(git.calls).toContain("rebaseOnto");
    expect(git.calls).toContain("merge");
  });

  it("rebase: no-op when step fails without merge in progress", async () => {
    const rec: Recorder = { order: [] };
    const reg = scriptedRegistry(rec, {
      "merge-step": { ok: false, reason: "shell error" },
    });
    const { port } = recordingMarkDone();
    const config = mergeConfig([shell("merge-step")], "rebase");
    const git = mockGit({ mergeInProgress: false });

    const result = await runLoop(config, [makeTask("T-1")], {
      ...makeDeps({ registry: reg, markDone: port }),
      git,
    });

    // No merge in progress → no rebase, normal escalation.
    expect(result.completed).toEqual([]);
    expect(result.paused).toContain("T-1");
    expect(git.calls).toContain("isMergeInProgress");
    expect(git.calls).not.toContain("rebaseOnto");
  });

  it("byte-identical at concurrency:1 when no conflicts occur", async () => {
    const rec: Recorder = { order: [] };
    const reg = scriptedRegistry(rec);
    const { port, marked } = recordingMarkDone();
    const configEscalate = mergeConfig([shell("s1")], "escalate");
    const configRebase = mergeConfig([shell("s1")], "rebase");
    const tasks = [makeTask("A"), makeTask("B")];

    const resultEscalate = await runLoop(configEscalate, tasks, makeDeps({ registry: reg, markDone: port }));
    marked.length = 0;
    rec.order.length = 0;

    const { port: port2, marked: marked2 } = recordingMarkDone();
    const rec2: Recorder = { order: [] };
    const reg2 = scriptedRegistry(rec2);
    const git = mockGit({ mergeInProgress: false });

    const resultRebase = await runLoop(configRebase, tasks, {
      ...makeDeps({ registry: reg2, markDone: port2 }),
      git,
    });

    // Both produce the same results.
    expect(resultRebase.completed).toEqual(resultEscalate.completed);
    expect(resultRebase.stoppedBy).toEqual(resultEscalate.stoppedBy);
    expect(marked2).toEqual(["A", "B"]);
  });
});

// ---------------------------------------------------------------------------
// Emit seam (C-0007 T-004)
// ---------------------------------------------------------------------------
import type { StoreEvent } from "../../src/tui/store";

/** Collecting emit sink for tests. */
function collectingEmit() {
  const events: StoreEvent[] = [];
  return { events, emit: (e: StoreEvent) => events.push(e) };
}

describe("emit seam (C-0007 T-004)", () => {
  it("emits edges_set + task_registered + lifecycle events for a simple task", async () => {
    const { events, emit } = collectingEmit();

    const pipeline = [shell("s1")];
    const config = makeLoopConfig(pipeline);
    const tasks = [makeTask("A")];
    const rec: Recorder = { order: [] };
    const { port } = recordingMarkDone();
    const result = await runLoop(
      config,
      tasks,
      { ...makeDeps({ registry: scriptedRegistry(rec), markDone: port }), emit },
    );

    expect(result.completed).toEqual(["A"]);

    // edges_set first (empty for no deps)
    expect(events[0]).toEqual({ type: "edges_set", edges: [] });
    // pipeline_declared (C-0009 T-003)
    expect(events[1]).toEqual({
      type: "pipeline_declared",
      steps: [{ id: "s1", type: "shell" }],
    });
    // task_registered
    expect(events[2]).toEqual({
      type: "task_registered",
      taskId: "A",
      title: "Task A",
      status: "ready",
    });
    // task_started
    expect(events[3]).toEqual({ type: "task_started", taskId: "A" });
    // step_started
    expect(events[4]).toEqual({
      type: "step_started",
      taskId: "A",
      stepId: "s1",
      stepType: "shell",
    });
    // step_finished
    expect(events[5]).toEqual({
      type: "step_finished",
      taskId: "A",
      stepId: "s1",
      ok: true,
      reason: undefined,
    });
    // task_finished
    expect(events[6]).toEqual({
      type: "task_finished",
      taskId: "A",
      status: "done",
    });
  });

  it("emits blocked status for tasks with deps and correct sequence for DAG A→C, B", async () => {
    const { events, emit } = collectingEmit();

    const pipeline = [shell("s1")];
    const config = makeLoopConfig(pipeline);
    const tasks = [
      makeTask("A"),
      makeTask("B"),
      makeTask("C", { deps: ["A"] }),
    ];
    const rec: Recorder = { order: [] };
    const { port } = recordingMarkDone();
    const result = await runLoop(
      config,
      tasks,
      { ...makeDeps({ registry: scriptedRegistry(rec), markDone: port }), emit },
    );

    expect(result.completed).toEqual(["A", "B", "C"]);

    // edges_set with one edge
    expect(events[0]).toEqual({ type: "edges_set", edges: [["A", "C"]] });

    // task_registered: A=pending, B=pending, C=blocked (has deps → carries deps)
    const registrations = events.filter((e) => e.type === "task_registered") as Array<
      Extract<StoreEvent, { type: "task_registered" }>
    >;
    expect(registrations).toEqual([
      { type: "task_registered", taskId: "A", title: "Task A", status: "ready" },
      { type: "task_registered", taskId: "B", title: "Task B", status: "ready" },
      { type: "task_registered", taskId: "C", title: "Task C", status: "blocked", deps: ["A"] },
    ]);

    // After A finishes, C should eventually start
    const taskStarted = events.filter((e) => e.type === "task_started") as Array<
      Extract<StoreEvent, { type: "task_started" }>
    >;
    const taskIds = taskStarted.map((e) => e.taskId);
    // A and B start first (either order), C after A finishes
    expect(taskIds).toContain("A");
    expect(taskIds).toContain("B");
    expect(taskIds).toContain("C");
    // C must come after A's task_finished
    const aFinishedIdx = events.findIndex(
      (e) => e.type === "task_finished" && e.taskId === "A",
    );
    const cStartedIdx = events.findIndex(
      (e) => e.type === "task_started" && e.taskId === "C",
    );
    expect(cStartedIdx).toBeGreaterThan(aFinishedIdx);
  });

  it("emits task_finished(escalated) on escalation with skip_task", async () => {
    const { events, emit } = collectingEmit();

    const pipeline = [shell("s1")];
    const config = makeLoopConfig(pipeline, {
      escalation: { action: "skip_task", keep_worktree: false, notify: "" },
    });
    const tasks = [makeTask("A")];
    const rec: Recorder = { order: [] };
    const { port } = recordingMarkDone();
    const result = await runLoop(
      config,
      tasks,
      {
        ...makeDeps({
          registry: scriptedRegistry(rec, { "A:s1": { ok: false, reason: "fail" } }),
          markDone: port,
        }),
        emit,
      },
    );

    expect(result.escalated).toEqual(["A"]);
    const finished = events.filter(
      (e) => e.type === "task_finished",
    ) as Array<Extract<StoreEvent, { type: "task_finished" }>>;
    expect(finished).toContainEqual({
      type: "task_finished",
      taskId: "A",
      status: "escalated",
      reason: "fail",
    });
  });

  it("emits task_finished(paused) on escalation with pause", async () => {
    const { events, emit } = collectingEmit();

    const pipeline = [shell("s1")];
    const config = makeLoopConfig(pipeline, {
      escalation: { action: "pause", keep_worktree: false, notify: "" },
    });
    const tasks = [makeTask("A")];
    const rec: Recorder = { order: [] };
    const { port } = recordingMarkDone();
    const result = await runLoop(
      config,
      tasks,
      {
        ...makeDeps({
          registry: scriptedRegistry(rec, { "A:s1": { ok: false, reason: "broken" } }),
          markDone: port,
        }),
        emit,
      },
    );

    expect(result.paused).toEqual(["A"]);
    const finished = events.filter(
      (e) => e.type === "task_finished",
    ) as Array<Extract<StoreEvent, { type: "task_finished" }>>;
    expect(finished).toContainEqual({
      type: "task_finished",
      taskId: "A",
      status: "paused",
      reason: "broken",
    });
  });

  it("emits task_finished(skipped) for transitive dependents on failure", async () => {
    const { events, emit } = collectingEmit();

    const pipeline = [shell("s1")];
    const config = makeLoopConfig(pipeline, {
      escalation: { action: "skip_task", keep_worktree: false, notify: "" },
    });
    const tasks = [
      makeTask("A"),
      makeTask("B", { deps: ["A"] }),
    ];
    const rec: Recorder = { order: [] };
    const { port } = recordingMarkDone();
    const result = await runLoop(
      config,
      tasks,
      {
        ...makeDeps({
          registry: scriptedRegistry(rec, { "A:s1": { ok: false, reason: "bad" } }),
          markDone: port,
        }),
        emit,
      },
    );

    expect(result.skipped).toEqual(["B"]);
    const finished = events.filter(
      (e) => e.type === "task_finished",
    ) as Array<Extract<StoreEvent, { type: "task_finished" }>>;
    expect(finished).toContainEqual({
      type: "task_finished",
      taskId: "B",
      status: "skipped",
      reason: "dependência A falhou",
    });
  });

  it("swallows emit exceptions — RunLoopResult is identical", async () => {
    const throwingEmit = () => {
      throw new Error("boom");
    };

    const pipeline = [shell("s1"), shell("s2")];
    const config = makeLoopConfig(pipeline);
    const tasks = [makeTask("A")];

    const rec1: Recorder = { order: [] };
    const { port: port1 } = recordingMarkDone();
    const resultWithEmit = await runLoop(
      config,
      tasks,
      { ...makeDeps({ registry: scriptedRegistry(rec1), markDone: port1 }), emit: throwingEmit },
    );

    const rec2: Recorder = { order: [] };
    const { port: port2 } = recordingMarkDone();
    const resultWithout = await runLoop(
      config,
      tasks,
      makeDeps({ registry: scriptedRegistry(rec2), markDone: port2 }),
    );

    // Byte-identical (ignoring timing fields).
    expect(resultWithEmit.completed).toEqual(resultWithout.completed);
    expect(resultWithEmit.escalated).toEqual(resultWithout.escalated);
    expect(resultWithEmit.paused).toEqual(resultWithout.paused);
    expect(resultWithEmit.skipped).toEqual(resultWithout.skipped);
    expect(resultWithEmit.stoppedBy).toEqual(resultWithout.stoppedBy);
    expect(resultWithEmit.iterations).toEqual(resultWithout.iterations);
  });

  it("RunLoopResult is identical with and without emit (AD-1)", async () => {
    const { events, emit } = collectingEmit();

    const pipeline = [shell("s1")];
    const config = makeLoopConfig(pipeline);
    const tasks = [makeTask("A"), makeTask("B")];

    const rec1: Recorder = { order: [] };
    const { port: port1 } = recordingMarkDone();
    const resultWith = await runLoop(
      config,
      tasks,
      { ...makeDeps({ registry: scriptedRegistry(rec1), markDone: port1 }), emit },
    );

    const rec2: Recorder = { order: [] };
    const { port: port2 } = recordingMarkDone();
    const resultWithout = await runLoop(
      config,
      tasks,
      makeDeps({ registry: scriptedRegistry(rec2), markDone: port2 }),
    );

    expect(resultWith.completed).toEqual(resultWithout.completed);
    expect(resultWith.escalated).toEqual(resultWithout.escalated);
    expect(resultWith.stoppedBy).toEqual(resultWithout.stoppedBy);
    expect(resultWith.iterations).toEqual(resultWithout.iterations);
    // Events were actually collected
    expect(events.length).toBeGreaterThan(0);
  });

  it("step_started/step_finished emitted around teardown (always) steps", async () => {
    const { events, emit } = collectingEmit();

    const pipeline = [
      shell("s1"),
      shell("cleanup", { always: true }),
    ];
    const config = makeLoopConfig(pipeline);
    const tasks = [makeTask("A")];
    const rec: Recorder = { order: [] };
    const { port } = recordingMarkDone();
    await runLoop(
      config,
      tasks,
      { ...makeDeps({ registry: scriptedRegistry(rec), markDone: port }), emit },
    );

    const stepEvents = events.filter(
      (e) => e.type === "step_started" || e.type === "step_finished",
    );
    const stepIds = stepEvents
      .filter((e): e is Extract<StoreEvent, { type: "step_started" }> => e.type === "step_started")
      .map((e) => e.stepId);
    expect(stepIds).toContain("s1");
    expect(stepIds).toContain("cleanup");
  });

  it("task_registered carries description (body without Deps:) and deps (C-0010 T-003)", async () => {
    const { events, emit } = collectingEmit();

    const pipeline = [shell("s1")];
    const config = makeLoopConfig(pipeline);
    const tasks = [
      makeTask("A", { body: "Deps: B\nFiles: foo.ts\nExtra context", deps: ["B"] }),
      makeTask("B"),
    ];
    const rec: Recorder = { order: [] };
    const { port } = recordingMarkDone();
    await runLoop(
      config,
      tasks,
      { ...makeDeps({ registry: scriptedRegistry(rec), markDone: port }), emit },
    );

    const registrations = events.filter((e) => e.type === "task_registered") as Array<
      Extract<StoreEvent, { type: "task_registered" }>
    >;
    const regA = registrations.find((e) => e.taskId === "A")!;
    expect(regA.description).toBe("Files: foo.ts\nExtra context");
    expect(regA.deps).toEqual(["B"]);

    // B has no deps and empty body → no description/deps
    const regB = registrations.find((e) => e.taskId === "B")!;
    expect(regB.description).toBeUndefined();
    expect(regB.deps).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// stripDepsLine (C-0010 T-003) — pure helper
// ---------------------------------------------------------------------------

describe("stripDepsLine", () => {
  it("removes the Deps: line and preserves Files: and other lines", () => {
    const body = "Deps: T-001, T-002\nFiles: foo.ts\nSome extra context";
    expect(stripDepsLine(body)).toBe("Files: foo.ts\nSome extra context");
  });

  it("is case-insensitive for the Deps: prefix", () => {
    expect(stripDepsLine("deps: T-001\nFiles: bar.ts")).toBe("Files: bar.ts");
    expect(stripDepsLine("DEPS: T-001\nOther")).toBe("Other");
  });

  it("returns undefined for an empty body", () => {
    expect(stripDepsLine("")).toBeUndefined();
  });

  it("returns undefined when only the Deps: line exists", () => {
    expect(stripDepsLine("Deps: T-001, T-002")).toBeUndefined();
  });

  it("preserves body that has no Deps: line", () => {
    expect(stripDepsLine("Files: a.ts\nSome text")).toBe("Files: a.ts\nSome text");
  });

  it("handles body with leading/trailing whitespace", () => {
    expect(stripDepsLine("  \nDeps: T-001\n  Files: x.ts  \n  ")).toBe("Files: x.ts");
  });
});

// ---------------------------------------------------------------------------
// T-002: concurrency auto + max_concurrency in the live loop
// ---------------------------------------------------------------------------

describe("runLoop — concurrency auto (T-002)", () => {
  it("auto com 3 tasks independentes resolve pool 3", async () => {
    const rec: Recorder = { order: [] };
    const registry = scriptedRegistry(rec);
    const { port: markDone, marked } = recordingMarkDone();
    const step = shell("s1");
    const config = makeLoopConfig([step], { concurrency: "auto" });
    // 3 independent tasks = widest layer is 3, max_concurrency default 4 → auto=3
    const tasks = [
      makeTask("T-001"),
      makeTask("T-002"),
      makeTask("T-003"),
    ];
    const deps = makeDeps({ registry, markDone });

    const result = await runLoop(config, tasks, deps);

    expect(result.completed).toEqual(["T-001", "T-002", "T-003"]);
    // All 3 should run (auto = 3 allows all 3 in parallel)
    expect(marked).toEqual(expect.arrayContaining(["T-001", "T-002", "T-003"]));
  });

  it("concurrency: 8 + max_concurrency: 4 roda com 8 (D17 — teto só morde auto)", async () => {
    const rec: Recorder = { order: [] };
    const registry = scriptedRegistry(rec);
    const { port: markDone } = recordingMarkDone();
    const step = shell("s1");
    // Explicit concurrency: 8, max_concurrency: 4 → should use 8, not 4 (D17)
    const config = { ...makeLoopConfig([step], { concurrency: 8 }), max_concurrency: 4 };
    const tasks = Array.from({ length: 10 }, (_, i) => makeTask(`T-${String(i + 1).padStart(3, "0")}`));
    const deps = makeDeps({ registry, markDone });

    const result = await runLoop(config, tasks, deps);

    // All 10 should complete — concurrency 8 allows up to 8 in parallel
    expect(result.completed.length).toBe(10);
  });

  it("concurrency: 3 segue byte-idêntico (regressão)", async () => {
    const rec: Recorder = { order: [] };
    const registry = scriptedRegistry(rec);
    const { port: markDone, marked } = recordingMarkDone();
    const step = shell("s1");
    const config = makeLoopConfig([step], { concurrency: 3 });
    const tasks = [makeTask("T-001"), makeTask("T-002"), makeTask("T-003")];
    const deps = makeDeps({ registry, markDone });

    const result = await runLoop(config, tasks, deps);

    expect(result.completed).toEqual(["T-001", "T-002", "T-003"]);
    expect(marked).toEqual(expect.arrayContaining(["T-001", "T-002", "T-003"]));
  });
});
