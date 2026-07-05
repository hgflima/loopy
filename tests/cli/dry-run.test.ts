import {
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { run } from "../../src/index";
import { loadConfig } from "../../src/config/load";
import {
  backlogOptionsFrom,
  loadBacklog,
  pendingTasks,
} from "../../src/backlog/todo";
import { formatDryRunPlan, planDryRun } from "../../src/loop/orchestrator";

/** The committed example target project (loopy.yml + tasks/todo.md). */
const PROJECT = fileURLToPath(new URL("../fixtures/project", import.meta.url));

/** Captures the injected stdout/stderr so tests can assert on CLI output. */
function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      out: (text: string) => out.push(text),
      err: (text: string) => err.push(text),
    },
    stdout: () => out.join(""),
    stderr: () => err.join(""),
  };
}

/** A snapshot of a file's bytes + mtime, to prove `--dry-run` never writes. */
function fingerprint(path: string): { content: string; mtimeMs: number } {
  return {
    content: readFileSync(path, "utf8"),
    mtimeMs: statSync(path).mtimeMs,
  };
}

describe("run — --dry-run", () => {
  it("prints the resolved pipeline for each pending task and exits 0", async () => {
    const cap = capture();
    const code = await run([PROJECT, "--dry-run"], cap.io);

    expect(code).toBe(0);
    const stdout = cap.stdout();
    // Pending tasks appear, resolved.
    expect(stdout).toContain("T-002");
    expect(stdout).toContain("T-003");
    expect(stdout).toContain(
      "Implemente T-002 — Primeira task pendente conforme SPEC.md.",
    );
    expect(stdout).toContain(
      "Implementar o parser do backlog conforme a spec.",
    );
    expect(stdout).toContain(
      'git worktree add -b "T-002-primeira-task-pendente" ".worktrees/T-002" "main"',
    );
    // The already-done task is skipped.
    expect(stdout).not.toContain("T-001");
    // Every ${...} is resolved — nothing leaks through.
    expect(stdout).not.toContain("${");
  });

  it("does not write, commit, or merge anything (Success Criterion #8)", async () => {
    const configFp = fingerprint(join(PROJECT, "loopy.yml"));
    const todoFp = fingerprint(join(PROJECT, "tasks/todo.md"));

    await run([PROJECT, "--dry-run"], capture().io);

    expect(fingerprint(join(PROJECT, "loopy.yml"))).toEqual(configFp);
    expect(fingerprint(join(PROJECT, "tasks/todo.md"))).toEqual(todoFp);
    // No runtime artifacts are created by a plan.
    expect(existsSync(join(PROJECT, ".worktrees"))).toBe(false);
    expect(existsSync(join(PROJECT, ".loopy"))).toBe(false);
    expect(existsSync(join(PROJECT, ".git"))).toBe(false);
  });

  it("reports pending task count in the header", async () => {
    const cap = capture();
    await run([PROJECT, "--dry-run"], cap.io);
    expect(cap.stdout()).toContain("tasks pendentes: 2");
  });

  it("honors --config pointing at an alternate file", async () => {
    const cap = capture();
    const code = await run(
      [PROJECT, "--dry-run", "--config", join(PROJECT, "loopy.yml")],
      cap.io,
    );
    expect(code).toBe(0);
    expect(cap.stdout()).toContain("T-002");
  });
});

describe("run — error handling", () => {
  it("aborts with exit 1 and a clear message on invalid config", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loopy-bad-"));
    writeFileSync(join(dir, "loopy.yml"), "version: 1\nname: nope\n", "utf8");

    const cap = capture();
    const code = await run([dir, "--dry-run"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr()).toContain("Config inválido");
  });

  it("aborts with exit 1 when the config file is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loopy-empty-"));
    const cap = capture();
    const code = await run([dir, "--dry-run"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr()).toMatch(/não foi possível ler o config/i);
  });

  it("aborts fail-fast on an unknown interpolation variable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loopy-interp-"));
    mkdirSync(join(dir, "tasks"), { recursive: true });
    const base = readFileSync(join(PROJECT, "loopy.yml"), "utf8");
    writeFileSync(
      join(dir, "loopy.yml"),
      base.replace("${task.id} — ${task.title}", "${task.nope}"),
      "utf8",
    );
    writeFileSync(
      join(dir, "tasks/todo.md"),
      "# t\n\n- [ ] T-009: quebra\n",
      "utf8",
    );

    const cap = capture();
    const code = await run([dir, "--dry-run"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr()).toContain("task.nope");
    // Fail-fast: no plan output leaked before the error.
    expect(cap.stdout()).not.toContain("T-009");
  });

  it("returns commander's non-zero code on an unknown flag without throwing", async () => {
    const cap = capture();
    const code = await run([PROJECT, "--nope"], cap.io);
    expect(code).not.toBe(0);
  });
});

describe("run — flag parsing", () => {
  it("accepts every documented flag together in --dry-run", async () => {
    const cap = capture();
    const code = await run(
      [
        PROJECT,
        "--dry-run",
        "--task",
        "T-002",
        "--max-iterations",
        "5",
        "--yes",
        "--no-tui",
        "--verbose",
      ],
      cap.io,
    );
    expect(code).toBe(0);
  });

  it("rejects a non-numeric --max-iterations", async () => {
    const cap = capture();
    const code = await run(
      [PROJECT, "--dry-run", "--max-iterations", "x"],
      cap.io,
    );
    expect(code).not.toBe(0);
  });
});

describe("formatDryRunPlan — arestas de desvio por step (T-005)", () => {
  /** Render the dry-run plan for a given config against the fixture backlog. */
  function render(config: ReturnType<typeof loadConfig>) {
    const tasks = pendingTasks(
      loadBacklog(
        join(PROJECT, "tasks/todo.md"),
        backlogOptionsFrom(config.inputs.backlog),
      ),
    );
    return formatDryRunPlan(planDryRun(config, tasks));
  }

  /** Fixture config with on_success on implement and on_fail:{goto} on audit. */
  function configWithEdges() {
    const base = loadConfig(join(PROJECT, "loopy.yml"));
    const pipeline = base.pipeline.map((step) => {
      if (step.id === "implement")
        return { ...step, on_success: { goto: "audit" } };
      if (step.id === "audit")
        return { ...step, on_fail: { goto: "implement" } };
      return step;
    });
    return { ...base, pipeline };
  }

  it("prints on_success: goto <id> when present", () => {
    expect(render(configWithEdges())).toContain("on_success: goto audit");
  });

  it("prints on_fail: goto <id> for goto actions (never [object Object])", () => {
    const output = render(configWithEdges());
    expect(output).toContain("on_fail: goto implement");
    expect(output).not.toContain("[object Object]");
  });

  it("omits on_success when absent (regressão zero)", () => {
    expect(render(loadConfig(join(PROJECT, "loopy.yml")))).not.toContain(
      "on_success",
    );
  });
});

describe("formatDryRunPlan — resolved pipeline snapshot", () => {
  it("matches the committed fixture project", () => {
    const config = loadConfig(join(PROJECT, "loopy.yml"));
    const tasks = pendingTasks(
      loadBacklog(
        join(PROJECT, "tasks/todo.md"),
        backlogOptionsFrom(config.inputs.backlog),
      ),
    );
    expect(formatDryRunPlan(planDryRun(config, tasks))).toMatchInlineSnapshot(`
      "--- DAG ---
        concorrência efetiva: 1
        camadas topológicas:
          camada 1: T-002, T-003
        ordem de merge prevista: T-002 → T-003

      === T-002 — Primeira task pendente ===
        iteration: 1
        branch:    T-002-primeira-task-pendente
        worktree:  .worktrees/T-002

        [1] create-worktree (shell)
            $ git worktree add -b "T-002-primeira-task-pendente" ".worktrees/T-002" "main"
        [2] implement (agent)
            mode: acceptEdits
            clear_context: true
            prompt:
              Implemente T-002 — Primeira task pendente conforme SPEC.md.
              Implementar o parser do backlog conforme a spec.
            verify: run=ci max_attempts=3
        [3] audit (agent)
            mode: plan
            clear_context: true
            prompt:
              Audite T-002 contra SPEC.md. NAO edite.
              Responda "AUDIT: PASS" ou "AUDIT: FAIL: <motivo>".
            expect: AUDIT: PASS
            on_fail: escalate
        [4] merge (approval)
            prompt:
              Aprovar merge da task T-002 em main?
            $ git -C "." merge --no-ff "T-002-primeira-task-pendente"
            on_fail: escalate
        [5] cleanup (shell) [always]
            $ git -C "." worktree remove --force ".worktrees/T-002"

      === T-003 — Segunda task pendente ===
        iteration: 2
        branch:    T-003-segunda-task-pendente
        worktree:  .worktrees/T-003

        [1] create-worktree (shell)
            $ git worktree add -b "T-003-segunda-task-pendente" ".worktrees/T-003" "main"
        [2] implement (agent)
            mode: acceptEdits
            clear_context: true
            prompt:
              Implemente T-003 — Segunda task pendente conforme SPEC.md.
            verify: run=ci max_attempts=3
        [3] audit (agent)
            mode: plan
            clear_context: true
            prompt:
              Audite T-003 contra SPEC.md. NAO edite.
              Responda "AUDIT: PASS" ou "AUDIT: FAIL: <motivo>".
            expect: AUDIT: PASS
            on_fail: escalate
        [4] merge (approval)
            prompt:
              Aprovar merge da task T-003 em main?
            $ git -C "." merge --no-ff "T-003-segunda-task-pendente"
            on_fail: escalate
        [5] cleanup (shell) [always]
            $ git -C "." worktree remove --force ".worktrees/T-003""
    `);
  });
});

/** Create a temp project with a todo.md containing Deps: lines (shared DAG fixture). */
function dagFixture(todoLines: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "loopy-dag-"));
  mkdirSync(join(dir, "tasks"), { recursive: true });
  writeFileSync(
    join(dir, "loopy.yml"),
    readFileSync(join(PROJECT, "loopy.yml"), "utf8"),
    "utf8",
  );
  writeFileSync(join(dir, "tasks/todo.md"), todoLines.join("\n"), "utf8");
  return dir;
}

/** The canonical DAG: T-001 (done), T-002 (no deps), T-003 (deps: T-002). */
const DAG_TODO = [
  "# DAG fixture",
  "",
  "- [x] T-001: Concluida",
  "",
  "- [ ] T-002: Raiz independente",
  "      Corpo da T-002.",
  "",
  "- [ ] T-003: Depende de T-002",
  "      Deps: T-002",
  "      Corpo da T-003.",
  "",
];

/** A no-op RunLoopResult stub for hooks that short-circuit the live flow. */
const EMPTY_RESULT = {
  completed: [],
  escalated: [],
  paused: [],
  skipped: [],
  iterations: 0,
  stoppedBy: "backlog_empty" as const,
  metrics: { index: 0, startedAt: "", finishedAt: "", stoppedBy: "backlog_empty" as const, tasks: {} },
  startedAt: "",
  finishedAt: "",
};

describe("dry-run DAG output (T-011)", () => {
  it("shows topological layers with deps in dry-run", async () => {
    const cap = capture();
    const code = await run([dagFixture(DAG_TODO), "--dry-run"], cap.io);

    expect(code).toBe(0);
    const out = cap.stdout();
    expect(out).toContain("--- DAG ---");
    expect(out).toContain("camadas topológicas:");
    expect(out).toContain("camada 1: T-002");
    expect(out).toContain("camada 2: T-003");
    expect(out).toContain("ordem de merge prevista: T-002 → T-003");
  });

  it("shows effective concurrency from config", async () => {
    const cap = capture();
    await run([dagFixture(DAG_TODO), "--dry-run"], cap.io);
    expect(cap.stdout()).toContain("concorrência efetiva: 1");
  });

  it("--concurrency overrides effective concurrency in dry-run", async () => {
    const cap = capture();
    await run([dagFixture(DAG_TODO), "--dry-run", "--concurrency", "4"], cap.io);
    expect(cap.stdout()).toContain("concorrência efetiva: 4");
  });

  it("${iteration} is stable backlog index (identical dry-run × run, AD-4)", () => {
    const config = loadConfig(join(PROJECT, "loopy.yml"));
    const backlog = loadBacklog(
      join(PROJECT, "tasks/todo.md"),
      backlogOptionsFrom(config.inputs.backlog),
    );
    const pending = pendingTasks(backlog);
    const knownTaskIds = backlog.map((t) => t.id);

    const plan = planDryRun(config, pending, { knownTaskIds });
    expect(plan.tasks[0]!.iteration).toBe(1);
    expect(plan.tasks[0]!.task.id).toBe("T-002");
    expect(plan.tasks[1]!.iteration).toBe(2);
    expect(plan.tasks[1]!.task.id).toBe("T-003");
  });

  it("strips already-done deps from the graph (T-001 done → not an edge)", async () => {
    const dir = dagFixture([
      "# DAG fixture",
      "",
      "- [x] T-001: Concluida",
      "",
      "- [ ] T-002: Raiz com dep done",
      "      Deps: T-001",
      "      Corpo da T-002.",
      "",
      "- [ ] T-003: Depende de T-002",
      "      Deps: T-002",
      "",
    ]);
    const cap = capture();
    const code = await run([dir, "--dry-run"], cap.io);

    expect(code).toBe(0);
    const out = cap.stdout();
    expect(out).toContain("camada 1: T-002");
    expect(out).toContain("camada 2: T-003");
  });
});

describe("--task warns non-done deps (T-011)", () => {
  it("warns about non-done deps when --task selects a dependent task", async () => {
    const cap = capture();
    const code = await run([dagFixture(DAG_TODO), "--task", "T-003"], cap.io, {
      isGitRepo: () => true,
      runLive: async () => EMPTY_RESULT,
    });

    expect(code).toBe(0);
    expect(cap.stderr()).toContain("depende de T-002");
    expect(cap.stderr()).toContain("não concluídas");
    expect(cap.stderr()).toContain("concurrency=1");
  });

  it("does not warn when --task selects a task with no deps", async () => {
    const cap = capture();
    const code = await run([dagFixture(DAG_TODO), "--task", "T-002"], cap.io, {
      isGitRepo: () => true,
      runLive: async () => EMPTY_RESULT,
    });

    expect(code).toBe(0);
    expect(cap.stderr()).not.toContain("depende de");
  });

  it("--task forces concurrency=1 in the flags passed to runLive", async () => {
    let capturedConcurrency: number | undefined;
    const cap = capture();
    await run([dagFixture(DAG_TODO), "--task", "T-003", "--concurrency", "4"], cap.io, {
      isGitRepo: () => true,
      runLive: async (args) => {
        capturedConcurrency = args.flags.concurrency;
        return EMPTY_RESULT;
      },
    });

    expect(capturedConcurrency).toBe(1);
  });
});
