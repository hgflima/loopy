/**
 * CLI metrics integration tests (T-005): verify that after `runLoop`:
 * - WITH `config.metrics`: `.loopy/metrics.json` is written with the right
 *   shape, and the Run report appears on stderr.
 * - WITHOUT `config.metrics`: no metrics artefact, byte-identical output
 *   (regression-zero).
 */
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { run, type RunHooks, type RunLiveArgs } from "../../src/index";
import type { RunLoopResult } from "../../src/loop/orchestrator";
import type { ChangeMetrics, RunMetrics, TaskMetrics } from "../../src/types";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Fixture WITHOUT metrics (pristine, regression-zero). */
const PROJECT_NO_METRICS = fileURLToPath(
  new URL("../fixtures/project", import.meta.url),
);

/** Fixture WITH metrics block. */
const PROJECT_WITH_METRICS = fileURLToPath(
  new URL("../fixtures/project-metrics", import.meta.url),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function mkTaskMetrics(overrides: Partial<TaskMetrics> = {}): TaskMetrics {
  return {
    steps: {
      "create-worktree": {
        type: "shell",
        visits: 1,
        durationMs: 1200,
        usage: null,
      },
      implement: {
        type: "agent",
        visits: 1,
        durationMs: 45000,
        usage: {
          inputTokens: 12000,
          outputTokens: 3400,
          cachedReadTokens: 8000,
          cachedWriteTokens: 0,
          thoughtTokens: 500,
          totalTokens: 15400,
          available: true,
        },
      },
    },
    cost: { amount: 0.42, currency: "USD", available: true },
    ...overrides,
  };
}

function mkRunMetrics(overrides: Partial<RunMetrics> = {}): RunMetrics {
  return {
    index: 0,
    startedAt: "2026-07-04T10:00:00.000Z",
    finishedAt: "2026-07-04T10:01:00.000Z",
    stoppedBy: "backlog_empty",
    tasks: { "T-002": mkTaskMetrics() },
    ...overrides,
  };
}

const METRICS_RESULT: RunLoopResult = {
  completed: ["T-002"],
  escalated: [],
  iterations: 1,
  stoppedBy: "backlog_empty",
  metrics: mkRunMetrics(),
  startedAt: "2026-07-04T10:00:00.000Z",
  finishedAt: "2026-07-04T10:01:00.000Z",
};

const EMPTY_METRICS: RunMetrics = {
  index: 0,
  startedAt: "1970-01-01T00:00:00.000Z",
  finishedAt: "1970-01-01T00:00:00.000Z",
  stoppedBy: "backlog_empty",
  tasks: {},
};

const NO_METRICS_RESULT: RunLoopResult = {
  completed: [],
  escalated: [],
  iterations: 0,
  stoppedBy: "backlog_empty",
  metrics: EMPTY_METRICS,
  startedAt: "1970-01-01T00:00:00.000Z",
  finishedAt: "1970-01-01T00:00:00.000Z",
};

function recordingHooks(result: RunLoopResult): {
  readonly hooks: RunHooks;
  readonly liveCalls: RunLiveArgs[];
} {
  const liveCalls: RunLiveArgs[] = [];
  const hooks: RunHooks = {
    isGitRepo: () => true,
    runLive: async (args) => {
      liveCalls.push(args);
      return result;
    },
  };
  return { hooks, liveCalls };
}

// ---------------------------------------------------------------------------
// Cleanup: remove any .loopy/ dir created in fixture during tests
// ---------------------------------------------------------------------------

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const p of cleanupPaths) rmSync(p, { recursive: true, force: true });
  cleanupPaths.length = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("run — metrics (with config.metrics)", () => {
  it("writes .loopy/metrics.json with the expected shape after runLoop", async () => {
    const cap = capture();
    const { hooks } = recordingHooks(METRICS_RESULT);

    const metricsJsonPath = join(PROJECT_WITH_METRICS, ".loopy/metrics.json");
    cleanupPaths.push(join(PROJECT_WITH_METRICS, ".loopy"));

    const code = await run([PROJECT_WITH_METRICS], cap.io, hooks);

    expect(code).toBe(0);
    expect(existsSync(metricsJsonPath)).toBe(true);

    const raw = JSON.parse(
      readFileSync(metricsJsonPath, "utf8"),
    ) as ChangeMetrics;
    expect(raw.version).toBe(1);
    expect(raw.change.id).toBe("tasks");
    expect(raw.runs).toHaveLength(1);
    expect(raw.runs[0]!.tasks["T-002"]).toBeDefined();
    expect(raw.runs[0]!.tasks["T-002"]!.steps["implement"]).toBeDefined();
    expect(raw.runs[0]!.tasks["T-002"]!.steps["implement"]!.usage).toBeDefined();
    expect(raw.runs[0]!.tasks["T-002"]!.cost).toEqual({
      amount: 0.42,
      currency: "USD",
      available: true,
    });
  });

  it("emits Run report on stderr", async () => {
    const cap = capture();
    const { hooks } = recordingHooks(METRICS_RESULT);
    cleanupPaths.push(join(PROJECT_WITH_METRICS, ".loopy"));

    await run([PROJECT_WITH_METRICS], cap.io, hooks);

    const stderr = cap.stderr();
    expect(stderr).toContain("── Run report ──");
    expect(stderr).toContain("── fim ──");
    expect(stderr).toContain("T-002:");
    expect(stderr).toContain("implement · agent");
    expect(stderr).toContain("create-worktree · shell");
    expect(stderr).toContain("Change até agora:");
    expect(stderr).toContain("$0.42");
  });

  it("handles null usage/cost gracefully (n/d in report)", async () => {
    const nullResult: RunLoopResult = {
      ...METRICS_RESULT,
      metrics: mkRunMetrics({
        tasks: {
          "T-002": mkTaskMetrics({
            steps: {
              implement: {
                type: "agent",
                visits: 1,
                durationMs: 5000,
                usage: {
                  inputTokens: 0,
                  outputTokens: 0,
                  totalTokens: 0,
                  available: false,
                },
              },
            },
            cost: null,
          }),
        },
      }),
    };
    const cap = capture();
    const { hooks } = recordingHooks(nullResult);
    cleanupPaths.push(join(PROJECT_WITH_METRICS, ".loopy"));

    const code = await run([PROJECT_WITH_METRICS], cap.io, hooks);

    expect(code).toBe(0);
    const stderr = cap.stderr();
    // Agent step with available:false → "n/d"
    expect(stderr).toContain("n/d");
    // Cost null → "n/d"
    expect(stderr).toMatch(/custo: n\/d/);
  });

  it("appends runs on subsequent executions (merge)", async () => {
    const cap1 = capture();
    const { hooks: hooks1 } = recordingHooks(METRICS_RESULT);
    cleanupPaths.push(join(PROJECT_WITH_METRICS, ".loopy"));

    await run([PROJECT_WITH_METRICS], cap1.io, hooks1);

    // Second run
    const cap2 = capture();
    const secondResult: RunLoopResult = {
      ...METRICS_RESULT,
      metrics: mkRunMetrics({
        tasks: {
          "T-003": mkTaskMetrics({ cost: { amount: 0.55, currency: "USD", available: true } }),
        },
      }),
    };
    const { hooks: hooks2 } = recordingHooks(secondResult);

    await run([PROJECT_WITH_METRICS], cap2.io, hooks2);

    const metricsJsonPath = join(PROJECT_WITH_METRICS, ".loopy/metrics.json");
    const raw = JSON.parse(
      readFileSync(metricsJsonPath, "utf8"),
    ) as ChangeMetrics;
    expect(raw.runs).toHaveLength(2);
    expect(raw.runs[0]!.tasks["T-002"]).toBeDefined();
    expect(raw.runs[1]!.tasks["T-003"]).toBeDefined();

    // Change accumulated line shows 2 runs
    expect(cap2.stderr()).toContain("2 Run(s)");
  });
});

describe("run — no metrics (regression-zero)", () => {
  it("does NOT write .loopy/metrics.json or emit Run report without config.metrics", async () => {
    const cap = capture();
    const { hooks } = recordingHooks(NO_METRICS_RESULT);

    const code = await run([PROJECT_NO_METRICS], cap.io, hooks);

    expect(code).toBe(0);
    const metricsJsonPath = join(PROJECT_NO_METRICS, ".loopy/metrics.json");
    expect(existsSync(metricsJsonPath)).toBe(false);
    expect(cap.stderr()).not.toContain("── Run report ──");
    expect(cap.stderr()).not.toContain("Change até agora:");
  });
});

// ---------------------------------------------------------------------------
// T-006: Change report — index.md persistence
// ---------------------------------------------------------------------------

describe("run — Change report (index.md)", () => {
  /** Copy fixture to temp dir; runLive marks all tasks as done, simulating a completing run. */
  function setupCompletingRun() {
    const tmpDir = mkdtempSync(join(tmpdir(), "loopy-test-"));
    cpSync(PROJECT_WITH_METRICS, tmpDir, { recursive: true });
    cleanupPaths.push(tmpDir);
    const todoPath = join(tmpDir, "tasks/todo.md");
    const hooks: RunHooks = {
      isGitRepo: () => true,
      runLive: async () => {
        const content = readFileSync(todoPath, "utf8");
        writeFileSync(todoPath, content.replace(/- \[ \]/g, "- [x]"), "utf8");
        return METRICS_RESULT;
      },
    };
    return { tmpDir, hooks };
  }

  it("persists index.md when backlog reaches 0 pending", async () => {
    const { tmpDir, hooks } = setupCompletingRun();
    const cap = capture();

    const code = await run([tmpDir], cap.io, hooks);

    expect(code).toBe(0);
    // report.index = "${change.dir}/../index.md", change.dir = "tasks" → "index.md"
    const indexPath = join(tmpDir, "index.md");
    expect(existsSync(indexPath)).toBe(true);

    const content = readFileSync(indexPath, "utf8");
    expect(content).toMatch(/^# /);
    expect(content).toContain("## tasks"); // change.id = basename("tasks")
    expect(content).toContain("| Task |");
    expect(content).toContain("T-002");
    expect(content).toContain("$0.42");
  });

  it("does NOT persist index.md when tasks are still pending", async () => {
    const cap = capture();
    const { hooks } = recordingHooks(METRICS_RESULT);
    cleanupPaths.push(join(PROJECT_WITH_METRICS, ".loopy"));

    await run([PROJECT_WITH_METRICS], cap.io, hooks);

    expect(existsSync(join(PROJECT_WITH_METRICS, "index.md"))).toBe(false);
  });

  it("re-persist updates only the change section (byte-preserving)", async () => {
    const { tmpDir, hooks } = setupCompletingRun();

    // Pre-create an index.md with an existing section
    const indexPath = join(tmpDir, "index.md");
    writeFileSync(indexPath, "# Changes\n\n## other-change\n\nOther content.\n\n", "utf8");

    const cap = capture();
    await run([tmpDir], cap.io, hooks);

    const content = readFileSync(indexPath, "utf8");
    expect(content).toContain("## other-change\n\nOther content.\n\n");
    expect(content).toContain("## tasks");
    expect(content).toContain("| Task |");
  });

  it("does NOT persist index.md when report.index is absent", async () => {
    const cap = capture();
    const { hooks } = recordingHooks(NO_METRICS_RESULT);

    await run([PROJECT_NO_METRICS], cap.io, hooks);

    expect(existsSync(join(PROJECT_NO_METRICS, "index.md"))).toBe(false);
  });
});
