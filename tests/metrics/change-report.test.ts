import { describe, expect, it } from "vitest";
import type {
  ChangeMetrics,
  RunMetrics,
  StepCost,
  TaskMetrics,
  TurnUsage,
} from "../../src/types";
import {
  renderChangeSection,
  upsertChangeSection,
} from "../../src/metrics/change-report";

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
// renderChangeSection
// ---------------------------------------------------------------------------

describe("renderChangeSection", () => {
  it("renders heading, totals paragraph, and task table", () => {
    const run = mkRunMetrics();
    const change = mkChange([run]);
    const section = renderChangeSection("C-0005", change);

    // Heading
    expect(section).toMatch(/^## C-0005\n/);
    // Totals
    expect(section).toContain("1 Run(s)");
    expect(section).toContain("1 Task(s)");
    expect(section).toContain("parada: backlog_empty");
    expect(section).toContain("custo: $0.42");
    // Token summary in totals
    expect(section).toContain("in:12k");
    expect(section).toContain("out:3.4k");
    // Table header
    expect(section).toContain("| Task | Δt | in | out | cached | tokens | visits | custo |");
    // Task row
    expect(section).toContain("| T-001 |");
    expect(section).toContain("$0.42");
    // Ends with double newline for clean separation
    expect(section).toMatch(/\n\n$/);
  });

  it("aggregates same task across multiple runs", () => {
    const run1 = mkRunMetrics({
      index: 1,
      tasks: { "T-001": mkTaskMetrics() },
    });
    const run2 = mkRunMetrics({
      index: 2,
      tasks: {
        "T-001": mkTaskMetrics({ cost: mkCost({ amount: 0.50 }) }),
      },
    });
    const change = mkChange([run1, run2]);
    const section = renderChangeSection("C-0005", change);

    expect(section).toContain("2 Run(s)");
    // One row for T-001 (aggregated, not two rows)
    const rows = section.split("\n").filter((l) => l.startsWith("| T-001"));
    expect(rows).toHaveLength(1);
    // Cost = last non-null ($0.50 from run2)
    expect(rows[0]).toContain("$0.50");
  });

  it("shows multiple tasks in the table", () => {
    const run = mkRunMetrics({
      tasks: {
        "T-001": mkTaskMetrics(),
        "T-002": mkTaskMetrics({ cost: mkCost({ amount: 0.35 }) }),
      },
    });
    const change = mkChange([run]);
    const section = renderChangeSection("C-0005", change);

    expect(section).toContain("2 Task(s)");
    expect(section).toContain("| T-001 |");
    expect(section).toContain("| T-002 |");
  });

  it("shows n-a for tasks with only non-agent steps", () => {
    const change = mkChange([
      mkRunMetrics({
        tasks: {
          "T-001": mkTaskMetrics({
            steps: {
              "create-worktree": {
                type: "shell",
                visits: 1,
                durationMs: 1200,
                usage: null,
              },
            },
            cost: null,
          }),
        },
      }),
    ]);
    const section = renderChangeSection("C-0005", change);
    const row = section.split("\n").find((l) => l.startsWith("| T-001"));

    expect(row).toBeDefined();
    expect(row).toContain("n-a");
    expect(row).toContain("n/d"); // cost is null
  });

  it("shows n/d for unavailable usage", () => {
    const change = mkChange([
      mkRunMetrics({
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
      }),
    ]);
    const section = renderChangeSection("C-0005", change);
    const row = section.split("\n").find((l) => l.startsWith("| T-001"));

    expect(row).toBeDefined();
    // All token columns show n/d
    const nds = row!.split("|").filter((c) => c.trim() === "n/d");
    expect(nds.length).toBeGreaterThanOrEqual(4); // in, out, cached, tokens (+ cost)
  });

  it("shows stoppedBy from the last run", () => {
    const run1 = mkRunMetrics({ index: 1, stoppedBy: "escalation" });
    const run2 = mkRunMetrics({ index: 2, stoppedBy: "backlog_empty" });
    const change = mkChange([run1, run2]);
    const section = renderChangeSection("C-0005", change);

    expect(section).toContain("parada: backlog_empty");
    expect(section).not.toContain("parada: escalation");
  });
});

// ---------------------------------------------------------------------------
// upsertChangeSection
// ---------------------------------------------------------------------------

describe("upsertChangeSection", () => {
  const NEW_SECTION = "## C-0005\n\nNew content.\n\n";

  it("appends new section to existing content", () => {
    const existing = "# Changes\n\n## C-0001\n\nOld content.\n\n";
    const result = upsertChangeSection(existing, "C-0005", NEW_SECTION);

    // C-0001 preserved byte-for-byte
    expect(result).toContain("## C-0001\n\nOld content.\n\n");
    // C-0005 appended
    expect(result).toContain(NEW_SECTION);
    // Order preserved
    expect(result.indexOf("## C-0001")).toBeLessThan(
      result.indexOf("## C-0005"),
    );
  });

  it("replaces existing section, preserving others byte-for-byte", () => {
    const existing =
      "# Changes\n\n## C-0001\n\nStays.\n\n## C-0005\n\nOld.\n\n## C-0009\n\nAlso stays.\n";
    const result = upsertChangeSection(existing, "C-0005", NEW_SECTION);

    // C-0001 preserved
    expect(result).toContain("## C-0001\n\nStays.\n\n");
    // C-0005 replaced
    expect(result).toContain("## C-0005\n\nNew content.\n\n");
    expect(result).not.toContain("Old.");
    // C-0009 preserved
    expect(result).toContain("## C-0009\n\nAlso stays.\n");

    // Before and after are byte-identical to original
    const before = result.slice(0, result.indexOf("## C-0005"));
    expect(before).toBe("# Changes\n\n## C-0001\n\nStays.\n\n");
    const after = result.slice(
      result.indexOf("## C-0009"),
    );
    expect(after).toBe("## C-0009\n\nAlso stays.\n");
  });

  it("handles section at end of file (no trailing h2)", () => {
    const existing = "# Changes\n\n## C-0005\n\nOld content at end.\n";
    const result = upsertChangeSection(existing, "C-0005", NEW_SECTION);

    expect(result).toBe("# Changes\n\n## C-0005\n\nNew content.\n\n");
    expect(result).not.toContain("Old content at end.");
  });

  it("preserves preamble before any section", () => {
    const existing = "# My Index\n\nSome preamble text.\n\n";
    const result = upsertChangeSection(existing, "C-0005", NEW_SECTION);

    expect(result).toMatch(/^# My Index\n\nSome preamble text\.\n\n/);
    expect(result).toContain(NEW_SECTION);
  });

  it("appends to empty content", () => {
    const result = upsertChangeSection("", "C-0005", NEW_SECTION);
    expect(result).toBe(NEW_SECTION);
  });

  it("handles heading with trailing whitespace", () => {
    const existing = "# Changes\n\n## C-0005  \n\nOld.\n\n";
    const result = upsertChangeSection(existing, "C-0005", NEW_SECTION);

    expect(result).toContain("## C-0005\n\nNew content.\n\n");
    expect(result).not.toContain("Old.");
  });

  it("does not match partial heading (C-0005-extended)", () => {
    const existing =
      "# Changes\n\n## C-0005-extended\n\nDifferent.\n\n";
    const result = upsertChangeSection(existing, "C-0005", NEW_SECTION);

    // C-0005-extended is NOT replaced (different id)
    expect(result).toContain("## C-0005-extended\n\nDifferent.\n\n");
    // C-0005 is appended
    expect(result).toContain(NEW_SECTION);
  });
});
