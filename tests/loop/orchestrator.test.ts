import { describe, expect, it } from "vitest";
import { parseConfig } from "../../src/config/load";
import { parseBacklog, pendingTasks } from "../../src/backlog/todo";
import { InterpolationError } from "../../src/interp/resolver";
import {
  buildScopeVars,
  formatDryRunPlan,
  planDryRun,
  worktreePathFor,
} from "../../src/loop/orchestrator";
import type { LoopyConfig, Task } from "../../src/types";

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
