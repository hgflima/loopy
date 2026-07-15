/**
 * CLI live-run wiring (T-018) — the path taken WITHOUT `--dry-run`: first-run
 * git setup (behind approval), `--task` selection + the OQ6 non-blocking warning,
 * flag threading (`--max-iterations`, `--verbose`, `--yes`), and the exit code.
 *
 * The real live executor spawns the ACP agent, so these tests inject the seams
 * (`isGitRepo` / `initGitRepo` / `approve` / `runLive`) to exercise ALL the CLI
 * logic deterministically without an agent (AD-6: real agent runs are manual/e2e).
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { run, type RunHooks, type RunLiveArgs } from "../../src/index";
import type { RunLoopResult } from "../../src/loop/orchestrator";
import { openDb } from "../../src/telemetry/db";
import { bootstrap } from "../../src/telemetry/schema";
import { insertChange } from "../../src/telemetry/write";

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

const OK_RESULT: RunLoopResult = {
  completed: [],
  escalated: [],
  paused: [],
  skipped: [],
  iterations: 0,
  stoppedBy: "backlog_empty",
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
        paused: [],
        skipped: [],
        iterations: 1,
        stoppedBy: "escalation_abort",
        startedAt: "1970-01-01T00:00:00.000Z",
        finishedAt: "1970-01-01T00:00:00.000Z",
      },
    });

    const code = await run([PROJECT], cap.io, hooks);
    expect(code).toBe(1);
  });
});

describe("run — --emit-events flag (T-006)", () => {
  it("threads emitEvents onto the live flags", async () => {
    const cap = capture();
    const { hooks, liveCalls } = recordingHooks();

    await run([PROJECT, "--emit-events"], cap.io, hooks);

    expect(liveCalls[0]!.flags.emitEvents).toBe(true);
  });

  it("emitEvents defaults to false", async () => {
    const cap = capture();
    const { hooks, liveCalls } = recordingHooks();

    await run([PROJECT], cap.io, hooks);

    expect(liveCalls[0]!.flags.emitEvents).toBe(false);
  });

  it("stdout receives NO text output (only stderr) when --emit-events is active", async () => {
    const cap = capture();
    const { hooks } = recordingHooks();

    await run([PROJECT, "--no-tui", "--emit-events"], cap.io, hooks);

    // All status messages (iniciando, fim) go to stderr, not stdout.
    expect(cap.stderr()).toMatch(/loopy: iniciando/);
    expect(cap.stderr()).toMatch(/loopy: fim/);
    // stdout should not contain status messages.
    expect(cap.stdout()).not.toMatch(/loopy: iniciando/);
    expect(cap.stdout()).not.toMatch(/loopy: fim/);
  });

  it("RunLoopResult is byte-identical with and without --emit-events (AD-1)", async () => {
    const results: RunLoopResult[] = [];
    const hooksWith = recordingHooks({
      runLive: async () => {
        const r = OK_RESULT;
        results.push(r);
        return r;
      },
    });
    const hooksWithout = recordingHooks({
      runLive: async () => {
        const r = OK_RESULT;
        results.push(r);
        return r;
      },
    });

    const capWith = capture();
    const capWithout = capture();
    const codeWith = await run([PROJECT, "--no-tui", "--emit-events"], capWith.io, hooksWith.hooks);
    const codeWithout = await run([PROJECT, "--no-tui"], capWithout.io, hooksWithout.hooks);

    expect(codeWith).toBe(codeWithout);
    // Both runs produced the same result object.
    expect(results).toHaveLength(2);
    expect(JSON.stringify(results[0])).toBe(JSON.stringify(results[1]));
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

// ---------------------------------------------------------------------------
// End-of-change merge gate (C-0017 / T-005): when `metrics:` is on and the
// backlog re-parses to zero pending, the change is marked `merged`. This is the
// same trigger that persisted the change report before T-003 removed it.
// ---------------------------------------------------------------------------
describe("run — end-of-change merge gate (C-0017 / T-005)", () => {
  const temps: string[] = [];
  const TODO_REL = ".harn/devy/changes/C-0017-x/todo.md";
  const CHANGE_ID = "C-0017";

  afterEach(() => {
    for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  /** A temp target project whose backlog lives under a `C-\d+` change dir. */
  function tempProject(opts: { metrics: boolean }): {
    dir: string;
    todoAbs: string;
    dbPath: string;
  } {
    const dir = mkdtempSync(join(tmpdir(), "loopy-mergegate-"));
    temps.push(dir);
    const yml =
      readFileSync(join(PROJECT, "loopy.yml"), "utf8").replace(
        'todo: "tasks/todo.md"',
        `todo: "${TODO_REL}"`,
      ) + (opts.metrics ? "\nmetrics: {}\n" : "\n");
    writeFileSync(join(dir, "loopy.yml"), yml);

    const todoAbs = join(dir, TODO_REL);
    mkdirSync(dirname(todoAbs), { recursive: true });
    writeFileSync(todoAbs, "# Backlog\n\n- [ ] T-001: Only task\n      Do it.\n");

    return { dir, todoAbs, dbPath: join(dir, ".db", "telemetry.db") };
  }

  /** Seed a `.db` with an open (in-progress) change row, as run start would. */
  async function seedOpenChange(dbPath: string): Promise<void> {
    mkdirSync(dirname(dbPath), { recursive: true });
    const db = await openDb(dbPath);
    await bootstrap(db);
    insertChange(db, {
      change_id: CHANGE_ID,
      name: "C-0017-x",
      repo: "acp-agentic-loop",
      base_sha: "abc",
      pipeline_version: "sha256:x",
      created_at: "2026-07-14T00:00:00.000Z",
    });
    db.close();
  }

  /** Read a change row's status/ended_at from a `.db`. */
  async function readChange(
    dbPath: string,
  ): Promise<{ status: string | null; ended_at: string | null } | undefined> {
    const db = await openDb(dbPath);
    const row = db
      .prepare("SELECT status, ended_at FROM change WHERE change_id = :id")
      .get<{ status: string | null; ended_at: string | null }>({
        id: CHANGE_ID,
      });
    db.close();
    return row;
  }

  it("marks the change merged once the backlog re-parses to zero pending", async () => {
    const { dir, dbPath } = tempProject({ metrics: true });
    const cap = capture();
    const { hooks } = recordingHooks({
      runLive: async (args) => {
        // Simulate the loop completing the backlog + populating the `.db`.
        writeFileSync(args.todoPath, "# Backlog\n\n- [x] T-001: Only task\n");
        await seedOpenChange(dbPath);
        return OK_RESULT;
      },
    });

    const code = await run([dir], cap.io, hooks);
    expect(code).toBe(0);

    const row = await readChange(dbPath);
    expect(row?.status).toBe("merged");
    expect(row?.ended_at).not.toBeNull();
  });

  it("leaves the change open when tasks remain pending after the run", async () => {
    const { dir, dbPath } = tempProject({ metrics: true });
    const cap = capture();
    const { hooks } = recordingHooks({
      runLive: async () => {
        // Backlog NOT completed (todo untouched → T-001 still pending).
        await seedOpenChange(dbPath);
        return OK_RESULT;
      },
    });

    await run([dir], cap.io, hooks);

    const row = await readChange(dbPath);
    expect(row?.status).toBeNull();
    expect(row?.ended_at).toBeNull();
  });

  it("does NOT touch the change when `metrics:` is absent (opt-in gate, AD-1)", async () => {
    const { dir, dbPath } = tempProject({ metrics: false });
    const cap = capture();
    const { hooks } = recordingHooks({
      runLive: async (args) => {
        writeFileSync(args.todoPath, "# Backlog\n\n- [x] T-001: Only task\n");
        await seedOpenChange(dbPath);
        return OK_RESULT;
      },
    });

    await run([dir], cap.io, hooks);

    // No `metrics:` → the gate never runs, so the change stays open.
    const row = await readChange(dbPath);
    expect(row?.status).toBeNull();
  });
});
