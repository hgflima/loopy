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
  it("without --dry-run, reports the live loop is not yet wired (exit 1)", async () => {
    const cap = capture();
    const code = await run([PROJECT], cap.io);
    expect(code).toBe(1);
    expect(cap.stderr()).toMatch(/ainda não implementad/i);
  });

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
      "=== T-002 — Primeira task pendente ===
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
            verify: run=ci max_attempts=3 on_fail=escalate
        [3] audit (agent)
            mode: plan
            clear_context: true
            prompt:
              Audite T-002 contra SPEC.md. NAO edite.
              Responda "AUDIT: PASS" ou "AUDIT: FAIL: <motivo>".
            expect: AUDIT: PASS
            on_expect_fail: escalate
        [4] merge (approval)
            prompt:
              Aprovar merge da task T-002 em main?
            $ git -C "." merge --no-ff "T-002-primeira-task-pendente"
            on_conflict: escalate
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
            verify: run=ci max_attempts=3 on_fail=escalate
        [3] audit (agent)
            mode: plan
            clear_context: true
            prompt:
              Audite T-003 contra SPEC.md. NAO edite.
              Responda "AUDIT: PASS" ou "AUDIT: FAIL: <motivo>".
            expect: AUDIT: PASS
            on_expect_fail: escalate
        [4] merge (approval)
            prompt:
              Aprovar merge da task T-003 em main?
            $ git -C "." merge --no-ff "T-003-segunda-task-pendente"
            on_conflict: escalate
        [5] cleanup (shell) [always]
            $ git -C "." worktree remove --force ".worktrees/T-003""
    `);
  });
});
