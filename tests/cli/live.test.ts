/**
 * CLI live-run wiring (T-018) — the path taken WITHOUT `--dry-run`: first-run
 * git setup (behind approval), `--task` selection + the OQ6 non-blocking warning,
 * flag threading (`--max-iterations`, `--verbose`, `--yes`), and the exit code.
 *
 * The real live executor spawns the ACP agent, so these tests inject the seams
 * (`isGitRepo` / `initGitRepo` / `approve` / `runLive`) to exercise ALL the CLI
 * logic deterministically without an agent (AD-6: real agent runs are manual/e2e).
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { run, type RunHooks, type RunLiveArgs } from "../../src/index";
import type { RunLoopResult } from "../../src/loop/orchestrator";

/** The committed example target project (loopy.yml + tasks/todo.md: T-002/T-003 pending). */
const PROJECT = fileURLToPath(new URL("../fixtures/project", import.meta.url));

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      out: (t: string) => out.push(t),
      err: (t: string) => err.push(t),
    },
    stdout: () => out.join(""),
    stderr: () => err.join(""),
  };
}

const EMPTY_METRICS = {
  index: 0,
  startedAt: "1970-01-01T00:00:00.000Z",
  finishedAt: "1970-01-01T00:00:00.000Z",
  stoppedBy: "backlog_empty",
  tasks: {},
} as const;

const OK_RESULT: RunLoopResult = {
  completed: [],
  escalated: [],
  iterations: 0,
  stoppedBy: "backlog_empty",
  metrics: EMPTY_METRICS,
  startedAt: "1970-01-01T00:00:00.000Z",
  finishedAt: "1970-01-01T00:00:00.000Z",
};

/** A hooks bundle that records the `runLive` args and returns a scripted result. */
function recordingHooks(
  over: Partial<RunHooks> & { result?: RunLoopResult } = {},
): {
  readonly hooks: RunHooks;
  readonly liveCalls: RunLiveArgs[];
  readonly initCalls: unknown[];
} {
  const liveCalls: RunLiveArgs[] = [];
  const initCalls: unknown[] = [];
  const hooks: RunHooks = {
    isGitRepo: over.isGitRepo ?? (() => true),
    initGitRepo:
      over.initGitRepo ??
      (async (opts) => {
        initCalls.push(opts);
      }),
    approve: over.approve,
    runLive:
      over.runLive ??
      (async (args) => {
        liveCalls.push(args);
        return over.result ?? OK_RESULT;
      }),
  };
  return { hooks, liveCalls, initCalls };
}

describe("run — live loop (git repo already present)", () => {
  it("runs the pending tasks and exits 0", async () => {
    const cap = capture();
    const { hooks, liveCalls } = recordingHooks();

    const code = await run([PROJECT], cap.io, hooks);

    expect(code).toBe(0);
    expect(liveCalls).toHaveLength(1);
    expect(liveCalls[0]!.tasks.map((t) => t.id)).toEqual(["T-002", "T-003"]);
    expect(liveCalls[0]!.flags.dryRun).toBe(false);
  });

  it("--task runs only that task and WARNS (non-blocking) about earlier pending tasks", async () => {
    const cap = capture();
    const { hooks, liveCalls } = recordingHooks();

    const code = await run([PROJECT, "--task", "T-003"], cap.io, hooks);

    expect(code).toBe(0);
    expect(liveCalls[0]!.tasks.map((t) => t.id)).toEqual(["T-003"]);
    // A warning names the earlier pending task, but does not block the run.
    expect(cap.stderr()).toMatch(/T-002/);
    expect(cap.stderr().toLowerCase()).toMatch(/pendente|aviso|warn/);
  });

  it("--task on the first pending task runs it with no earlier-pending warning", async () => {
    const cap = capture();
    const { hooks, liveCalls } = recordingHooks();

    const code = await run([PROJECT, "--task", "T-002"], cap.io, hooks);

    expect(code).toBe(0);
    expect(liveCalls[0]!.tasks.map((t) => t.id)).toEqual(["T-002"]);
    expect(cap.stderr()).not.toMatch(/T-003/);
  });

  it("--task with an unknown id aborts (exit 1) and never runs the loop", async () => {
    const cap = capture();
    const { hooks, liveCalls } = recordingHooks();

    const code = await run([PROJECT, "--task", "T-999"], cap.io, hooks);

    expect(code).toBe(1);
    expect(liveCalls).toHaveLength(0);
    expect(cap.stderr()).toMatch(/T-999/);
  });

  it("threads --max-iterations and --verbose onto the live flags", async () => {
    const cap = capture();
    const { hooks, liveCalls } = recordingHooks();

    await run([PROJECT, "--max-iterations", "5", "--verbose"], cap.io, hooks);

    expect(liveCalls[0]!.flags.maxIterations).toBe(5);
    expect(liveCalls[0]!.flags.verbose).toBe(true);
  });

  it("exits 1 when the run escalated a task", async () => {
    const cap = capture();
    const { hooks } = recordingHooks({
      result: {
        completed: [],
        escalated: ["T-002"],
        iterations: 1,
        stoppedBy: "escalation_pause",
        metrics: { ...EMPTY_METRICS, stoppedBy: "escalation_pause" },
        startedAt: "1970-01-01T00:00:00.000Z",
        finishedAt: "1970-01-01T00:00:00.000Z",
      },
    });

    const code = await run([PROJECT], cap.io, hooks);
    expect(code).toBe(1);
  });
});

describe("run — first-run git setup (not a repo)", () => {
  it("with --yes, initializes the repo (no prompt) then runs", async () => {
    const cap = capture();
    const { hooks, liveCalls, initCalls } = recordingHooks({
      isGitRepo: () => false,
    });

    const code = await run([PROJECT, "--yes"], cap.io, hooks);

    expect(code).toBe(0);
    expect(initCalls).toHaveLength(1);
    const opts = initCalls[0] as {
      defaultBranch: string;
      ignore: readonly string[];
    };
    expect(opts.defaultBranch).toBe("main");
    expect(opts.ignore).toContain(".worktrees/");
    expect(liveCalls).toHaveLength(1);
  });

  it("prompts for approval and ABORTS (exit 1) when the operator declines", async () => {
    const cap = capture();
    const { hooks, liveCalls, initCalls } = recordingHooks({
      isGitRepo: () => false,
      approve: async () => false,
    });

    const code = await run([PROJECT], cap.io, hooks);

    expect(code).toBe(1);
    expect(initCalls).toHaveLength(0);
    expect(liveCalls).toHaveLength(0);
    expect(cap.stderr().toLowerCase()).toMatch(/git|repo/);
  });

  it("initializes when the operator approves the prompt", async () => {
    const cap = capture();
    const { hooks, liveCalls, initCalls } = recordingHooks({
      isGitRepo: () => false,
      approve: async () => true,
    });

    const code = await run([PROJECT], cap.io, hooks);

    expect(code).toBe(0);
    expect(initCalls).toHaveLength(1);
    expect(liveCalls).toHaveLength(1);
  });
});
