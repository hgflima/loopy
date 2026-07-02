import { describe, expect, it } from "vitest";
import { createLineReporter } from "../../src/tui/line-reporter";
import type { StoreEvent } from "../../src/tui/store";

/** Run events through a reporter, capturing every printed line. */
function capture(...events: readonly StoreEvent[]): string[] {
  const lines: string[] = [];
  const reporter = createLineReporter({ print: (line) => lines.push(line) });
  for (const event of events) reporter.handle(event);
  return lines;
}

// ---------------------------------------------------------------------------
// The line fallback mirrors the store's transitions as ordered log lines.
// ---------------------------------------------------------------------------

describe("createLineReporter · lifecycle", () => {
  it("logs task registration, start, step, attempt and per-check status", () => {
    const lines = capture(
      { type: "task_registered", taskId: "T-001", title: "Scaffold" },
      { type: "task_started", taskId: "T-001" },
      {
        type: "step_started",
        taskId: "T-001",
        stepId: "implement",
        stepType: "agent",
      },
      {
        type: "attempt_started",
        taskId: "T-001",
        stepId: "implement",
        attempt: 1,
        maxAttempts: 4,
      },
      {
        type: "check_started",
        taskId: "T-001",
        stepId: "implement",
        name: "typecheck",
      },
      {
        type: "check_finished",
        taskId: "T-001",
        stepId: "implement",
        name: "typecheck",
        ok: true,
      },
      {
        type: "check_finished",
        taskId: "T-001",
        stepId: "implement",
        name: "test",
        ok: false,
      },
    );

    // Registration + start + step header.
    expect(lines[0]).toContain("T-001");
    expect(lines[0]).toContain("Scaffold");
    expect(lines.some((l) => l.includes("iniciada"))).toBe(true);
    expect(
      lines.some((l) => l.includes("implement") && l.includes("agent")),
    ).toBe(true);
    // try k/max surfaces as an attempt line.
    expect(lines.some((l) => l.includes("1/4"))).toBe(true);
    // Per-check status: only finished checks produce a line (no in-place update).
    expect(lines.some((l) => /typecheck/.test(l) && l.includes("✓"))).toBe(
      true,
    );
    expect(lines.some((l) => /test/.test(l) && l.includes("✗"))).toBe(true);
    expect(lines.some((l) => l.includes("typecheck") && l.includes("…"))).toBe(
      false,
    );
  });

  it("logs a task completion line for a done task", () => {
    const lines = capture(
      { type: "task_registered", taskId: "T-001", title: "t" },
      { type: "task_finished", taskId: "T-001", status: "done" },
    );
    expect(lines.at(-1)).toContain("concluída");
  });

  it("logs an escalation line with its reason", () => {
    const lines = capture(
      { type: "task_registered", taskId: "T-001", title: "t" },
      {
        type: "task_finished",
        taskId: "T-001",
        status: "escalated",
        reason: "checks falharam 4x",
      },
    );
    const last = lines.at(-1) ?? "";
    expect(last).toContain("escalada");
    expect(last).toContain("checks falharam 4x");
  });

  it("includes the failure reason on a failed step", () => {
    const lines = capture(
      { type: "task_registered", taskId: "T-001", title: "t" },
      {
        type: "step_started",
        taskId: "T-001",
        stepId: "audit",
        stepType: "agent",
      },
      {
        type: "step_finished",
        taskId: "T-001",
        stepId: "audit",
        ok: false,
        reason: "AUDIT: FAIL: faltam testes",
      },
    );
    expect(lines.some((l) => l.includes("AUDIT: FAIL: faltam testes"))).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Agent stream — surfaced line by line (the fallback's `stream do agente`).
// ---------------------------------------------------------------------------

describe("createLineReporter · agent stream", () => {
  it("emits one line per completed stream line, buffering partial text", () => {
    const lines = capture(
      { type: "task_registered", taskId: "T-001", title: "t" },
      { type: "stream_chunk", taskId: "T-001", text: "primeira\nseg" },
      { type: "stream_chunk", taskId: "T-001", text: "unda\n" },
    );
    const streamed = lines.filter((l) => l.includes("│"));
    expect(streamed.map((l) => l.trim())).toEqual(["│ primeira", "│ segunda"]);
  });

  it("flushes a partial (newline-less) stream line when the step finishes", () => {
    const lines = capture(
      { type: "task_registered", taskId: "T-001", title: "t" },
      {
        type: "step_started",
        taskId: "T-001",
        stepId: "implement",
        stepType: "agent",
      },
      { type: "stream_chunk", taskId: "T-001", text: "sem newline no fim" },
      {
        type: "step_finished",
        taskId: "T-001",
        stepId: "implement",
        ok: true,
      },
    );
    expect(lines.some((l) => l.includes("sem newline no fim"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// No-op mirroring — the reporter ignores what the store ignores.
// ---------------------------------------------------------------------------

describe("createLineReporter · no-op mirroring", () => {
  it("prints nothing for an event on an unregistered task", () => {
    expect(capture({ type: "task_started", taskId: "T-404" })).toEqual([]);
  });

  it("prints nothing for a step-scoped event before the step started", () => {
    const lines = capture(
      { type: "task_registered", taskId: "T-001", title: "t" },
      {
        type: "check_finished",
        taskId: "T-001",
        stepId: "implement",
        name: "test",
        ok: true,
      },
    );
    expect(lines.some((l) => l.includes("test"))).toBe(false);
  });

  it("logs a duplicate registration only once", () => {
    const lines = capture(
      { type: "task_registered", taskId: "T-001", title: "Primeira" },
      { type: "task_registered", taskId: "T-001", title: "Duplicada" },
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Primeira");
  });
});
