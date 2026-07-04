import { describe, expect, it } from "vitest";
import type {
  ChangeMetrics,
  RunMetrics,
  StepCost,
  TaskMetrics,
  TurnUsage,
} from "../../src/types";
import { renderRunReport } from "../../src/metrics/report";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkUsage(overrides: Partial<TurnUsage> = {}): TurnUsage {
  return {
    inputTokens: 12000,
    outputTokens: 3400,
    cachedReadTokens: 8000,
    cachedWriteTokens: 0,
    thoughtTokens: 500,
    totalTokens: 15400,
    available: true,
    ...overrides,
  };
}

function mkCost(overrides: Partial<StepCost> = {}): StepCost {
  return { amount: 0.42, currency: "USD", available: true, ...overrides };
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
        visits: 2,
        durationMs: 51230,
        usage: mkUsage(),
      },
    },
    cost: mkCost(),
    ...overrides,
  };
}

function mkRunMetrics(overrides: Partial<RunMetrics> = {}): RunMetrics {
  return {
    index: 1,
    startedAt: "2026-07-04T10:00:00.000Z",
    finishedAt: "2026-07-04T10:01:00.000Z",
    stoppedBy: "backlog_empty",
    tasks: { "T-001": mkTaskMetrics() },
    ...overrides,
  };
}

function mkChange(runs: RunMetrics[] = []): ChangeMetrics {
  return {
    version: 1,
    change: { id: "C-0005", dir: ".harn/devy/changes/C-0005" },
    runs,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("renderRunReport", () => {
  it("renders a single-task run with agent + shell steps", () => {
    const run = mkRunMetrics();
    const change = mkChange([run]);
    const lines = renderRunReport(run, change);
    const text = lines.join("\n");

    // Header and footer
    expect(lines[0]).toBe("── Run report ──");
    expect(lines[lines.length - 1]).toBe("── fim ──");

    // Task block
    expect(text).toContain("T-001:");

    // Step lines: shell step shows "n-a" for usage
    expect(text).toContain("create-worktree · shell · 1s · n-a");
    // Agent step shows token details
    expect(text).toContain("implement · agent ·");
    expect(text).toContain("in:12k");
    expect(text).toContain("out:3.4k");

    // Task subtotal with cost
    expect(text).toMatch(/Σ T-001/);
    expect(text).toContain("$0.42");

    // Run total
    expect(text).toContain("Total Run");

    // Change accumulated
    expect(text).toContain("Change até agora:");
    expect(text).toContain("1 Run(s)");
    expect(text).toContain("1 Task(s)");
  });

  it("renders n/d for usage when ACP did not report", () => {
    const run = mkRunMetrics({
      tasks: {
        "T-001": mkTaskMetrics({
          steps: {
            implement: {
              type: "agent",
              visits: 1,
              durationMs: 5000,
              usage: { ...mkUsage(), available: false },
            },
          },
          cost: null,
        }),
      },
    });
    const change = mkChange([run]);
    const lines = renderRunReport(run, change);
    const text = lines.join("\n");

    // Step line shows n/d
    expect(text).toContain("implement · agent · 5s · n/d");
    // Cost shows n/d
    expect(text).toMatch(/custo: n\/d/);
  });

  it("renders multi-task run", () => {
    const run = mkRunMetrics({
      tasks: {
        "T-001": mkTaskMetrics(),
        "T-002": mkTaskMetrics({ cost: mkCost({ amount: 0.35 }) }),
      },
    });
    const change = mkChange([run]);
    const lines = renderRunReport(run, change);
    const text = lines.join("\n");

    expect(text).toContain("T-001:");
    expect(text).toContain("T-002:");
    expect(text).toContain("2 Task(s)");
  });

  it("accumulates across multiple runs in Change line", () => {
    const run1 = mkRunMetrics({ index: 1 });
    const run2 = mkRunMetrics({
      index: 2,
      tasks: {
        "T-002": mkTaskMetrics({ cost: mkCost({ amount: 0.50 }) }),
      },
    });
    const change = mkChange([run1, run2]);
    // Report is for run2, but change shows totals of both runs
    const lines = renderRunReport(run2, change);
    const text = lines.join("\n");

    expect(text).toContain("2 Run(s)");
    expect(text).toContain("2 Task(s)");
  });

  it("handles empty run (no tasks)", () => {
    const run = mkRunMetrics({ tasks: {} });
    const change = mkChange([run]);
    const lines = renderRunReport(run, change);
    const text = lines.join("\n");

    expect(text).toContain("Total Run");
    expect(text).toContain("── fim ──");
  });
});
