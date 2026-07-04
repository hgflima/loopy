/**
 * End-to-end pipeline test (T-015) — the whole example pipeline
 * (create-worktree → implement → simplify → audit → commit → merge → cleanup)
 * for ONE task, driven config-first from `loopy.yml`, against the scenario-driven
 * fake ACP agent (OQ5) over a REAL temporary git repo (AD-6: real git, not mocked).
 *
 * This is the "heart" slice closing: the `agent` step is now in the registry
 * (T-015) and the orchestrator supplies it a per-task ACP session via
 * `sessionProvider`, so a task drives real agent turns — the fake writes a file
 * during `implement` and returns an `AUDIT: PASS` verdict during `audit` — and is
 * marked `- [x]` only after green checks + PASS + an approved merge.
 *
 * Three acceptance criteria (T-015):
 *  - AC1 (SC #1/#3): a task walks the full pipeline and is marked done only with
 *    green checks + PASS + merge — one commit, one merge on the parent.
 *  - AC2 (SC #4): a task whose checks stay red for `max_attempts` is NOT marked,
 *    its worktree is preserved, and escalation is applied + logged.
 *  - AC3 (SC #2 / AD-1): behavior is config-driven — swapping the audit's verdict
 *    token in the yml changes what the engine gates on, with no engine edit.
 *
 * Marked *integration*: `npm test -- e2e-agent` runs just this file. It spawns a
 * subprocess (the fake agent under tsx) and shells out to git, so it is a medium/
 * large test, not a unit test.
 */
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
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openAgent, type AgentHandle } from "../../src/acp/agent";
import {
  createSessionPool,
  type AgentSessionPool,
} from "../../src/acp/session";
import {
  backlogOptionsFrom,
  parseBacklog,
  pendingTasks,
} from "../../src/backlog/todo";
import { runChecks } from "../../src/checks/runner";
import { parseConfig } from "../../src/config/load";
import { createGit } from "../../src/git/worktree";
import {
  createMarkDonePort,
  runLoop,
  type OrchestratorDeps,
} from "../../src/loop/orchestrator";
import { createFullRegistry } from "../../src/steps/index";
import type { ChecksRunnerPort, RunFlags } from "../../src/types";
import type { FakeScenario } from "../fixtures/fake-agent";
import { makeLogger, type CapturingLogger } from "../steps/support";

const FAKE_AGENT = fileURLToPath(
  new URL("../fixtures/fake-agent.ts", import.meta.url),
);
const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Run the fake agent under tsx with a JSON scenario (the run's single agent). */
function fakeCommand(scenario: FakeScenario): string[] {
  return [
    process.execPath,
    "--import",
    "tsx",
    FAKE_AGENT,
    JSON.stringify(scenario),
  ];
}

const DEFAULT_FLAGS: RunFlags = {
  dryRun: false,
  yes: false,
  tui: false,
  verbose: false,
};

const TASK_ID = "T-100";

const TODO_MD = `# Backlog

- [ ] ${TASK_ID}: Primeira task
      Corpo da primeira task.
`;

/**
 * Build the example-shaped `loopy.yml`, exposing the few knobs the three tests
 * vary. Everything the engine does comes from THIS string (AD-1): reordering,
 * prompts, modes, verdict token and commands all live here, not in the engine.
 */
function ymlFor(
  opts: {
    readonly auditExpect?: string;
    readonly checkCmd?: string;
    readonly cleanupAlways?: boolean;
  } = {},
): string {
  const auditExpect = opts.auditExpect ?? "AUDIT: PASS";
  const checkCmd = opts.checkCmd ?? "true";
  const cleanupAlways = opts.cleanupAlways ?? true;
  return `
version: "1"
name: e2e-agent
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
    - { name: noop, run: "${checkCmd}" }
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
      Implemente \${task.id} — \${task.title} conforme \${inputs.spec} e \${inputs.plan}.
      \${task.body}
    retry_prompt: |
      Os checks falharam. Corrija.
      \${checks.report}
    verify: { run: ci, max_attempts: 2 }
  - id: simplify
    type: agent
    clear_context: true
    mode: acceptEdits
    prompt: |
      Simplifique sem alterar comportamento. Diff:
      \${worktree.diff}
    verify: { run: ci, max_attempts: 2 }
  - id: audit
    type: agent
    clear_context: true
    mode: plan
    prompt: |
      Audite \${task.id}. Diff:
      \${worktree.diff}
      Responda "${auditExpect}" ou FALHA.
    expect: "${auditExpect}"
    on_fail: escalate
  - id: commit
    type: shell
    run:
      - git -C "\${worktree.path}" add -A
      - 'git -C "\${worktree.path}" commit -m "feat(\${task.id}): \${task.title}"'
  - id: merge
    type: approval
    prompt: "Aprovar merge de \${task.id} em \${workspace.parent_branch}?"
    run:
      - 'git -C "\${workspace.root}" merge --no-ff "\${task.branch}" -m "merge(\${task.id}): \${task.title}"'
    on_conflict: escalate
  - id: cleanup
    type: shell
    always: ${cleanupAlways}
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
}

describe("e2e-agent — full pipeline against the fake agent + real repo", () => {
  let root: string;
  let handle: AgentHandle | undefined;
  let pool: AgentSessionPool | undefined;

  /** Git in the temp repo, with global/system config neutralized (hermetic). */
  async function git(
    args: readonly string[],
  ): Promise<{ readonly stdout: string }> {
    const res = await execa("git", [...args], {
      cwd: root,
      env: { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
    });
    return { stdout: typeof res.stdout === "string" ? res.stdout : "" };
  }

  beforeEach(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "loopy-e2e-agent-")));
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

  afterEach(async () => {
    pool?.closeAll();
    pool = undefined;
    if (handle) {
      await handle.shutdown();
      handle = undefined;
    }
    rmSync(root, { recursive: true, force: true });
  });

  /** Absolute path of the file the fake agent "implements" in the worktree. */
  function featurePath(): string {
    return join(root, ".worktrees", TASK_ID, "feature.txt");
  }

  /**
   * Spawn the fake agent, wire the FULL registry + real git + real checks +
   * a session pool, and run the outer loop over the one pending task. The checks
   * runner resolves the (relative) worktree cwd against the temp `root` — in a
   * real `loopy .` run `process.cwd()` IS the workspace root, so this mirrors
   * production without touching global cwd.
   */
  async function runPipeline(
    yml: string,
    scenario: FakeScenario,
  ): Promise<{
    readonly result: Awaited<ReturnType<typeof runLoop>>;
    readonly logger: CapturingLogger;
    readonly todoPath: string;
    readonly branch: string;
    readonly isParentClean: () => Promise<boolean>;
  }> {
    handle = await openAgent({
      command: fakeCommand(scenario),
      cwd: PROJECT_ROOT,
      permissions: { on_request: "allow" },
    });
    pool = createSessionPool({ ctx: handle.ctx, text: handle.text });

    const config = parseConfig(yml);
    const todoPath = join(root, "tasks", "todo.md");
    const backlogOptions = backlogOptionsFrom(config.inputs.backlog);
    const tasks = pendingTasks(
      parseBacklog(readFileSync(todoPath, "utf8"), backlogOptions),
    );
    const g = createGit({ root });
    const logger = makeLogger();

    const checks: ChecksRunnerPort = {
      run: (list, opts) => runChecks(list, { cwd: resolve(root, opts.cwd) }),
    };

    const deps: OrchestratorDeps = {
      root,
      flags: { ...DEFAULT_FLAGS, yes: true },
      registry: createFullRegistry(),
      checks,
      ui: {
        requestApproval: async () => {
          throw new Error("under --yes the human gate must not be consulted");
        },
      },
      logger,
      markDone: createMarkDonePort({
        todoPath,
        commit: g.commitPaths,
        backlogOptions,
      }),
      sessionProvider: (cwd) => pool!.session(cwd),
    };

    const result = await runLoop(config, tasks, deps);
    return {
      result,
      logger,
      todoPath,
      branch: tasks[0]!.branch,
      isParentClean: () => g.isParentClean(),
    };
  }

  // -------------------------------------------------------------------------
  // AC1 — happy path: full pipeline → marked done (SC #1, #3)
  // -------------------------------------------------------------------------

  it("walks the whole pipeline and marks the task done (green checks + AUDIT: PASS + merge)", async () => {
    const scenario: FakeScenario = {
      turns: [
        // implement: writes the feature file, then the checks (`true`) pass.
        {
          text: ["Implementando a feature.\n"],
          write: { path: featurePath(), content: `${TASK_ID}\n` },
          stopReason: "end_turn",
        },
        // simplify: no edits; checks stay green.
        {
          text: ["Simplifiquei sem mudar comportamento.\n"],
          stopReason: "end_turn",
        },
        // audit (mode plan, read-only): emits the PASS verdict on the last line.
        { text: ["Revisei o diff.\nAUDIT: PASS"], stopReason: "end_turn" },
      ],
    };

    const { result, todoPath, branch, isParentClean } = await runPipeline(
      ymlFor(),
      scenario,
    );

    // The task completed and was marked; nothing escalated.
    expect(result.completed).toEqual([TASK_ID]);
    expect(result.escalated).toEqual([]);
    expect(result.stoppedBy).toBe("backlog_empty");

    // The agent's file was committed on the branch and merged into the parent.
    expect(readFileSync(join(root, "feature.txt"), "utf8")).toBe(
      `${TASK_ID}\n`,
    );

    // Worktree + branch cleaned up.
    expect(existsSync(join(root, ".worktrees", TASK_ID))).toBe(false);
    const branches = await git(["branch", "--list", branch]);
    expect(branches.stdout.trim()).toBe("");

    // Backlog marked done, and that mark committed on the parent (stays clean).
    expect(readFileSync(todoPath, "utf8")).toContain(`- [x] ${TASK_ID}:`);
    const log = await git(["log", "--oneline"]);
    expect(log.stdout).toContain(`conclui ${TASK_ID}`);
    // The merge commit (one merge on the parent, SC #3).
    expect(log.stdout).toContain(`merge(${TASK_ID})`);
    expect(await isParentClean()).toBe(true);
  }, 30_000);

  // -------------------------------------------------------------------------
  // AC2 — persistent check failure → not marked, worktree preserved (SC #4)
  // -------------------------------------------------------------------------

  it("does not mark a task whose checks stay red; preserves the worktree and escalates", async () => {
    // Every implement attempt "ends" cleanly but the checks (`false`) stay red,
    // so `verify` exhausts max_attempts and the step escalates. `cleanup` is a
    // plain (non-always) step here, so a failure preserves the worktree.
    const scenario: FakeScenario = {
      defaultTurn: { text: ["Tentando implementar."], stopReason: "end_turn" },
    };

    const { result, logger, todoPath } = await runPipeline(
      ymlFor({ checkCmd: "false", cleanupAlways: false }),
      scenario,
    );

    // Not completed — escalated (default action `pause` halts the loop).
    expect(result.completed).toEqual([]);
    expect(result.escalated).toEqual([TASK_ID]);
    expect(result.stoppedBy).toBe("escalation_pause");

    // The backlog was NOT marked done.
    const todo = readFileSync(todoPath, "utf8");
    expect(todo).toContain(`- [ ] ${TASK_ID}:`);
    expect(todo).not.toContain(`- [x] ${TASK_ID}:`);

    // The worktree is preserved for inspection (keep_worktree).
    expect(existsSync(join(root, ".worktrees", TASK_ID))).toBe(true);

    // Escalation was applied AND logged, naming keep_worktree.
    expect(
      logger.errors.some(
        (line) =>
          line.includes("escalonamento") && line.includes("keep_worktree"),
      ),
    ).toBe(true);
  }, 30_000);

  // -------------------------------------------------------------------------
  // AC3 — config-driven behavior (AD-1 / SC #2): the verdict token comes from
  // the yml, not the engine. A custom `expect` marker is honored end-to-end.
  // -------------------------------------------------------------------------

  it("honors a config-defined verdict token without any engine change (AD-1)", async () => {
    const scenario: FakeScenario = {
      turns: [
        {
          text: ["Implementando.\n"],
          write: { path: featurePath(), content: `${TASK_ID}\n` },
          stopReason: "end_turn",
        },
        { text: ["Simplifiquei.\n"], stopReason: "end_turn" },
        // The audit answers with the CUSTOM token the yml expects, not "AUDIT".
        { text: ["Revisado.\nREVIEW: PASS"], stopReason: "end_turn" },
      ],
    };

    const { result, todoPath } = await runPipeline(
      ymlFor({ auditExpect: "REVIEW: PASS" }),
      scenario,
    );

    // The engine gated on the yml's token ("REVIEW"), so the task completed —
    // proof the marker is config-driven (a hardcoded "AUDIT" would have failed).
    expect(result.completed).toEqual([TASK_ID]);
    expect(result.escalated).toEqual([]);
    expect(readFileSync(todoPath, "utf8")).toContain(`- [x] ${TASK_ID}:`);
    expect(readFileSync(join(root, "feature.txt"), "utf8")).toBe(
      `${TASK_ID}\n`,
    );
  }, 30_000);
});
