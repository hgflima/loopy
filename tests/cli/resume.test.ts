/**
 * CLI resume wiring (T-022) — auto-resume, `--task` resume, and `--clean`
 * teardown. Tests exercise the `execute()` path through the exported `run()`
 * function, injecting hooks to avoid spawning a real ACP agent.
 *
 * `--clean` tests use a temporary directory with a real config/backlog and
 * a programmatic `.loopy/state.json`, verifying teardown + exit behavior
 * (git operations fail gracefully — best-effort).
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { run, type RunHooks, type RunLiveArgs } from "../../src/index";
import type { RunLoopResult } from "../../src/loop/orchestrator";
import type { RunState } from "../../src/types";

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
  iterations: 0,
  stoppedBy: "backlog_empty",
};

function recordingHooks(
  over: Partial<RunHooks> & { result?: RunLoopResult } = {},
): {
  readonly hooks: RunHooks;
  readonly liveCalls: RunLiveArgs[];
} {
  const liveCalls: RunLiveArgs[] = [];
  const hooks: RunHooks = {
    isGitRepo: over.isGitRepo ?? (() => true),
    initGitRepo: over.initGitRepo ?? (async () => {}),
    approve: over.approve,
    runLive:
      over.runLive ??
      (async (args) => {
        liveCalls.push(args);
        return over.result ?? OK_RESULT;
      }),
  };
  return { hooks, liveCalls };
}

// ---------------------------------------------------------------------------
// Temporary project helpers for --clean tests
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempProject(state?: RunState): string {
  const dir = join(
    tmpdir(),
    `loopy-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  tempDirs.push(dir);
  mkdirSync(join(dir, "tasks"), { recursive: true });

  // Copy fixture config + backlog.
  writeFileSync(
    join(dir, "loopy.yml"),
    readFileSync(join(PROJECT, "loopy.yml")),
  );
  writeFileSync(
    join(dir, "tasks/todo.md"),
    readFileSync(join(PROJECT, "tasks/todo.md")),
  );

  if (state) {
    mkdirSync(join(dir, ".loopy"), { recursive: true });
    writeFileSync(
      join(dir, ".loopy/state.json"),
      JSON.stringify(state, null, 2),
    );
  }

  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  tempDirs.length = 0;
});

// ---------------------------------------------------------------------------
// Auto-resume: knownTaskIds is passed through to runLive
// ---------------------------------------------------------------------------

describe("run — auto-resume wiring", () => {
  it("passes knownTaskIds (all backlog ids) to runLive", async () => {
    const cap = capture();
    const { hooks, liveCalls } = recordingHooks();

    const code = await run([PROJECT], cap.io, hooks);

    expect(code).toBe(0);
    expect(liveCalls).toHaveLength(1);
    // The fixture has T-001 (done), T-002 (pending), T-003 (pending).
    expect(liveCalls[0]!.knownTaskIds).toEqual(["T-001", "T-002", "T-003"]);
  });

  it("passes knownTaskIds even with --task filter", async () => {
    const cap = capture();
    const { hooks, liveCalls } = recordingHooks();

    const code = await run([PROJECT, "--task", "T-002"], cap.io, hooks);

    expect(code).toBe(0);
    // tasks is filtered, but knownTaskIds includes ALL.
    expect(liveCalls[0]!.tasks.map((t) => t.id)).toEqual(["T-002"]);
    expect(liveCalls[0]!.knownTaskIds).toEqual(["T-001", "T-002", "T-003"]);
  });
});

// ---------------------------------------------------------------------------
// --clean: teardown worktree + branch + checkpoint and exit
// ---------------------------------------------------------------------------

describe("run — --clean", () => {
  it("with explicit id: clears checkpoint and exits 0 (no loop)", async () => {
    const state: RunState = {
      version: 1,
      tasks: {
        "T-002": {
          pipelineHash: "sha256:abc",
          completedSteps: ["create-worktree", "implement"],
          status: "paused",
        },
      },
    };
    const dir = makeTempProject(state);
    const cap = capture();
    // No hooks.runLive needed — --clean never reaches the loop.
    const code = await run([dir, "--clean", "T-002"], cap.io);

    expect(code).toBe(0);
    // Should print confirmation messages.
    const out = cap.stdout();
    expect(out).toMatch(/checkpoint limpo.*T-002/);
    // Worktree/branch removal is best-effort — git ops fail gracefully (no repo).
    expect(out).toMatch(/worktree/);
    expect(out).toMatch(/branch/);

    // Verify state.json was updated.
    const updated: RunState = JSON.parse(
      readFileSync(join(dir, ".loopy/state.json"), "utf8"),
    );
    expect(updated.tasks["T-002"]).toBeUndefined();
  });

  it("without id: picks the single paused/running entry", async () => {
    const state: RunState = {
      version: 1,
      tasks: {
        "T-003": {
          pipelineHash: "sha256:def",
          completedSteps: ["create-worktree"],
          status: "running",
        },
      },
    };
    const dir = makeTempProject(state);
    const cap = capture();

    const code = await run([dir, "--clean"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout()).toMatch(/checkpoint limpo.*T-003/);

    const updated: RunState = JSON.parse(
      readFileSync(join(dir, ".loopy/state.json"), "utf8"),
    );
    expect(updated.tasks["T-003"]).toBeUndefined();
  });

  it("without id and 0 checkpoints: errors with exit 1", async () => {
    const dir = makeTempProject({ version: 1, tasks: {} });
    const cap = capture();

    const code = await run([dir, "--clean"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr()).toMatch(/nenhum checkpoint/i);
  });

  it("without id and >1 checkpoints: errors with exit 1", async () => {
    const state: RunState = {
      version: 1,
      tasks: {
        "T-002": {
          pipelineHash: "sha256:a",
          completedSteps: [],
          status: "paused",
        },
        "T-003": {
          pipelineHash: "sha256:b",
          completedSteps: [],
          status: "running",
        },
      },
    };
    const dir = makeTempProject(state);
    const cap = capture();

    const code = await run([dir, "--clean"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr()).toMatch(/múltiplos/i);
    expect(cap.stderr()).toMatch(/T-002/);
    expect(cap.stderr()).toMatch(/T-003/);
  });

  it("--clean without id but -t <id> present: targets that task", async () => {
    // Two paused checkpoints would be ambiguous for a bare `--clean`, but the
    // `-t T-002` filter disambiguates — `-t T-002 --clean` == `--clean T-002`.
    const state: RunState = {
      version: 1,
      tasks: {
        "T-002": {
          pipelineHash: "sha256:a",
          completedSteps: [],
          status: "paused",
        },
        "T-003": {
          pipelineHash: "sha256:b",
          completedSteps: [],
          status: "paused",
        },
      },
    };
    const dir = makeTempProject(state);
    const cap = capture();

    const code = await run([dir, "-t", "T-002", "--clean"], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout()).toMatch(/checkpoint limpo.*T-002/);

    const updated: RunState = JSON.parse(
      readFileSync(join(dir, ".loopy/state.json"), "utf8"),
    );
    // Only the targeted checkpoint is cleared; T-003 is untouched.
    expect(updated.tasks["T-002"]).toBeUndefined();
    expect(updated.tasks["T-003"]).toBeDefined();
  });

  it("with unknown task id: errors with exit 1", async () => {
    const state: RunState = {
      version: 1,
      tasks: {
        "T-999": {
          pipelineHash: "sha256:x",
          completedSteps: [],
          status: "paused",
        },
      },
    };
    const dir = makeTempProject(state);
    const cap = capture();

    const code = await run([dir, "--clean", "T-999"], cap.io);

    expect(code).toBe(1);
    expect(cap.stderr()).toMatch(/T-999.*não encontrada/);
  });

  it("does NOT run the loop", async () => {
    const state: RunState = {
      version: 1,
      tasks: {
        "T-002": {
          pipelineHash: "sha256:abc",
          completedSteps: [],
          status: "paused",
        },
      },
    };
    const dir = makeTempProject(state);
    const cap = capture();
    const { hooks, liveCalls } = recordingHooks();

    const code = await run([dir, "--clean", "T-002"], cap.io, hooks);

    expect(code).toBe(0);
    expect(liveCalls).toHaveLength(0);
  });
});
