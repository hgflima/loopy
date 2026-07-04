import { describe, expect, it } from "vitest";
import type {
  ChangeMetrics,
  RunMetrics,
  Sample,
  StepCost,
  StepMetrics,
  TaskMetrics,
  TurnUsage,
} from "../../src/types";
import {
  addUsage,
  foldSamples,
  summarizeChange,
  summarizeRun,
  summarizeTask,
} from "../../src/metrics/folds";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkUsage(overrides: Partial<TurnUsage> = {}): TurnUsage {
  return {
    inputTokens: 100,
    outputTokens: 50,
    cachedReadTokens: 20,
    cachedWriteTokens: 0,
    thoughtTokens: 10,
    totalTokens: 180,
    available: true,
    ...overrides,
  };
}

function mkCost(overrides: Partial<StepCost> = {}): StepCost {
  return { amount: 0.42, currency: "USD", available: true, ...overrides };
}

function mkSample(overrides: Partial<Sample> = {}): Sample {
  return { durationMs: 1000, usage: null, cost: null, ...overrides };
}

function mkStepMetrics(overrides: Partial<StepMetrics> = {}): StepMetrics {
  return {
    type: "shell",
    visits: 1,
    durationMs: 500,
    usage: null,
    ...overrides,
  };
}

function mkTaskMetrics(overrides: Partial<TaskMetrics> = {}): TaskMetrics {
  return { steps: {}, cost: null, ...overrides };
}

function mkRunMetrics(overrides: Partial<RunMetrics> = {}): RunMetrics {
  return {
    index: 1,
    startedAt: "2026-01-01T00:00:00Z",
    finishedAt: "2026-01-01T01:00:00Z",
    stoppedBy: "backlog_empty",
    tasks: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// addUsage
// ---------------------------------------------------------------------------

describe("addUsage", () => {
  it("null + null = null", () => {
    expect(addUsage(null, null)).toBeNull();
  });

  it("null + usage = usage (identity)", () => {
    const u = mkUsage();
    expect(addUsage(null, u)).toEqual(u);
  });

  it("usage + null = usage (identity)", () => {
    const u = mkUsage();
    expect(addUsage(u, null)).toEqual(u);
  });

  it("sums all token fields", () => {
    const a = mkUsage({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
    const b = mkUsage({ inputTokens: 200, outputTokens: 80, totalTokens: 280 });
    const result = addUsage(a, b)!;
    expect(result.inputTokens).toBe(300);
    expect(result.outputTokens).toBe(130);
    expect(result.totalTokens).toBe(430);
  });

  it("treats undefined optional fields as 0", () => {
    const a: TurnUsage = {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      available: true,
    };
    const b = mkUsage({ cachedReadTokens: 100, thoughtTokens: 50 });
    const result = addUsage(a, b)!;
    expect(result.cachedReadTokens).toBe(100);
    expect(result.thoughtTokens).toBe(50);
  });

  it("available = true if any side is available", () => {
    const a = mkUsage({ available: false });
    const b = mkUsage({ available: true });
    expect(addUsage(a, b)!.available).toBe(true);
    expect(addUsage(b, a)!.available).toBe(true);
  });

  it("available = false only when both sides are unavailable", () => {
    const a = mkUsage({ available: false });
    const b = mkUsage({ available: false });
    expect(addUsage(a, b)!.available).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// foldSamples
// ---------------------------------------------------------------------------

describe("foldSamples", () => {
  it("returns zero-visit StepMetrics for empty samples", () => {
    const result = foldSamples("shell", []);
    expect(result).toEqual({
      type: "shell",
      visits: 0,
      durationMs: 0,
      usage: null,
    });
  });

  it("single sample → visits=1, same values", () => {
    const usage = mkUsage();
    const result = foldSamples("agent", [mkSample({ durationMs: 5000, usage })]);
    expect(result.visits).toBe(1);
    expect(result.durationMs).toBe(5000);
    expect(result.usage).toEqual(usage);
  });

  it("multiple samples → visits summed, durations summed, usage summed", () => {
    const s1 = mkSample({
      durationMs: 1000,
      usage: mkUsage({ inputTokens: 100, outputTokens: 50, totalTokens: 150 }),
    });
    const s2 = mkSample({
      durationMs: 2000,
      usage: mkUsage({ inputTokens: 200, outputTokens: 80, totalTokens: 280 }),
    });
    const result = foldSamples("agent", [s1, s2]);
    expect(result.visits).toBe(2);
    expect(result.durationMs).toBe(3000);
    expect(result.usage!.inputTokens).toBe(300);
    expect(result.usage!.outputTokens).toBe(130);
    expect(result.usage!.totalTokens).toBe(430);
  });

  it("non-agent samples (null usage) → usage stays null", () => {
    const result = foldSamples("shell", [
      mkSample({ durationMs: 100 }),
      mkSample({ durationMs: 200 }),
    ]);
    expect(result.usage).toBeNull();
    expect(result.durationMs).toBe(300);
    expect(result.visits).toBe(2);
  });

  it("propagates available:false when ACP didn't report", () => {
    const unavailable = mkUsage({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      available: false,
    });
    const result = foldSamples("agent", [
      mkSample({ durationMs: 500, usage: unavailable }),
    ]);
    expect(result.usage!.available).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// summarizeTask
// ---------------------------------------------------------------------------

describe("summarizeTask", () => {
  it("empty steps → zero summary", () => {
    const result = summarizeTask(mkTaskMetrics());
    expect(result.durationMs).toBe(0);
    expect(result.usage).toBeNull();
    expect(result.visits).toBe(0);
    expect(result.cost).toBeNull();
    expect(result.taskCount).toBe(1);
  });

  it("sums steps' duration, usage, and visits", () => {
    const result = summarizeTask(
      mkTaskMetrics({
        steps: {
          "step-a": mkStepMetrics({
            type: "shell",
            visits: 1,
            durationMs: 1000,
          }),
          "step-b": mkStepMetrics({
            type: "agent",
            visits: 3,
            durationMs: 5000,
            usage: mkUsage({ inputTokens: 500, totalTokens: 600 }),
          }),
        },
        cost: mkCost({ amount: 0.55 }),
      }),
    );

    expect(result.durationMs).toBe(6000);
    expect(result.visits).toBe(4);
    expect(result.usage!.inputTokens).toBe(500);
    expect(result.cost!.amount).toBe(0.55);
  });

  it("carries task cost through", () => {
    const cost = mkCost({ amount: 1.23 });
    const result = summarizeTask(mkTaskMetrics({ cost }));
    expect(result.cost).toEqual(cost);
  });
});

// ---------------------------------------------------------------------------
// summarizeRun
// ---------------------------------------------------------------------------

describe("summarizeRun", () => {
  it("empty tasks → zero summary", () => {
    const result = summarizeRun(mkRunMetrics());
    expect(result.durationMs).toBe(0);
    expect(result.usage).toBeNull();
    expect(result.visits).toBe(0);
    expect(result.cost).toBeNull();
    expect(result.taskCount).toBe(0);
    expect(result.runCount).toBe(1);
  });

  it("sums across tasks", () => {
    const result = summarizeRun(
      mkRunMetrics({
        tasks: {
          "T-001": mkTaskMetrics({
            steps: {
              s1: mkStepMetrics({ durationMs: 1000, visits: 1 }),
              s2: mkStepMetrics({
                durationMs: 2000,
                visits: 2,
                usage: mkUsage({ inputTokens: 300, totalTokens: 400 }),
              }),
            },
            cost: mkCost({ amount: 0.50 }),
          }),
          "T-002": mkTaskMetrics({
            steps: {
              s1: mkStepMetrics({ durationMs: 500, visits: 1 }),
            },
            cost: mkCost({ amount: 0.80 }),
          }),
        },
      }),
    );

    expect(result.durationMs).toBe(3500);
    expect(result.visits).toBe(4);
    expect(result.taskCount).toBe(2);
    expect(result.usage!.inputTokens).toBe(300);
    // cost = last non-null (T-002's cost, since objects iterate insertion-order)
    expect(result.cost!.amount).toBe(0.80);
  });

  it("cost is last non-null across tasks", () => {
    const result = summarizeRun(
      mkRunMetrics({
        tasks: {
          "T-001": mkTaskMetrics({ cost: mkCost({ amount: 0.10 }) }),
          "T-002": mkTaskMetrics({ cost: null }),
          "T-003": mkTaskMetrics({ cost: mkCost({ amount: 0.99 }) }),
        },
      }),
    );
    expect(result.cost!.amount).toBe(0.99);
  });
});

// ---------------------------------------------------------------------------
// summarizeChange
// ---------------------------------------------------------------------------

describe("summarizeChange", () => {
  const emptyChange: ChangeMetrics = {
    version: 1,
    change: { id: "C-001", dir: "changes/C-001" },
    runs: [],
  };

  it("empty runs → zero summary", () => {
    const result = summarizeChange(emptyChange);
    expect(result.durationMs).toBe(0);
    expect(result.usage).toBeNull();
    expect(result.visits).toBe(0);
    expect(result.cost).toBeNull();
    expect(result.taskCount).toBe(0);
    expect(result.runCount).toBe(0);
  });

  it("sums across multiple runs", () => {
    const cm: ChangeMetrics = {
      version: 1,
      change: { id: "C-001", dir: "d" },
      runs: [
        mkRunMetrics({
          index: 1,
          tasks: {
            "T-001": mkTaskMetrics({
              steps: {
                s: mkStepMetrics({
                  durationMs: 1000,
                  visits: 1,
                  usage: mkUsage({ inputTokens: 100, totalTokens: 200 }),
                }),
              },
              cost: mkCost({ amount: 0.30 }),
            }),
          },
        }),
        mkRunMetrics({
          index: 2,
          tasks: {
            "T-002": mkTaskMetrics({
              steps: {
                s: mkStepMetrics({
                  durationMs: 2000,
                  visits: 2,
                  usage: mkUsage({ inputTokens: 400, totalTokens: 500 }),
                }),
              },
              cost: mkCost({ amount: 0.70 }),
            }),
          },
        }),
      ],
    };

    const result = summarizeChange(cm);
    expect(result.durationMs).toBe(3000);
    expect(result.visits).toBe(3);
    expect(result.usage!.inputTokens).toBe(500);
    expect(result.usage!.totalTokens).toBe(700);
    expect(result.cost!.amount).toBe(0.70);
    expect(result.taskCount).toBe(2);
    expect(result.runCount).toBe(2);
  });

  it("propagates n/d usage when all unavailable", () => {
    const unavailable = mkUsage({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      available: false,
    });
    const cm: ChangeMetrics = {
      version: 1,
      change: { id: "C-001", dir: "d" },
      runs: [
        mkRunMetrics({
          tasks: {
            "T-001": mkTaskMetrics({
              steps: {
                s: mkStepMetrics({ durationMs: 100, visits: 1, usage: unavailable }),
              },
            }),
          },
        }),
      ],
    };
    const result = summarizeChange(cm);
    expect(result.usage!.available).toBe(false);
  });
});
