/**
 * Snapshot-style tests for the three new panes (T-009) using
 * `ink-testing-library`. Each test renders a component into a virtual stdout
 * via `render()` and asserts on `lastFrame()` — the last string written.
 *
 * Pure logic (colors, symbols, graph layout) is already tested in `view.test.ts`
 * and `store.test.ts`; these tests verify the wiring between store state and
 * the Ink component tree.
 */
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { createStore, type StoreEvent } from "../../src/tui/store";
import { AcpLogPane } from "../../src/tui/components/AcpLogPane";
import { GraphPane } from "../../src/tui/components/GraphPane";
import { TaskListPane } from "../../src/tui/components/TaskListPane";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a store state by folding events from an empty state. */
function buildState(...events: StoreEvent[]) {
  const store = createStore();
  for (const e of events) store.dispatch(e);
  return store.getState();
}

// ---------------------------------------------------------------------------
// GraphPane
// ---------------------------------------------------------------------------

describe("GraphPane", () => {
  it("renders nothing when there are no tasks", () => {
    const state = buildState();
    const { lastFrame } = render(<GraphPane state={state} />);
    expect(lastFrame()).toBe("");
  });

  it("renders a graph with task nodes colored by status", () => {
    const state = buildState(
      { type: "edges_set", edges: [["T-001", "T-002"]] },
      { type: "task_registered", taskId: "T-001", title: "First" },
      { type: "task_registered", taskId: "T-002", title: "Second", status: "blocked" },
      { type: "task_started", taskId: "T-001" },
    );
    const { lastFrame } = render(<GraphPane state={state} />);
    const frame = lastFrame()!;

    // Should contain the "graph" label
    expect(frame).toContain("graph");
    // Should contain task ids as part of node labels
    expect(frame).toContain("T-001");
    expect(frame).toContain("T-002");
  });

  it("renders done tasks with the done glyph", () => {
    const state = buildState(
      { type: "task_registered", taskId: "T-001", title: "Done task" },
      { type: "task_started", taskId: "T-001" },
      { type: "task_finished", taskId: "T-001", status: "done" },
    );
    const { lastFrame } = render(<GraphPane state={state} />);
    const frame = lastFrame()!;
    // Done glyph: ✔
    expect(frame).toContain("✔");
    expect(frame).toContain("T-001");
  });
});

// ---------------------------------------------------------------------------
// AcpLogPane
// ---------------------------------------------------------------------------

describe("AcpLogPane", () => {
  it("renders nothing when the ACP log is empty", () => {
    const state = buildState();
    const { lastFrame } = render(<AcpLogPane state={state} />);
    expect(lastFrame()).toBe("");
  });

  it("renders ACP traffic lines with direction glyphs", () => {
    const state = buildState(
      { type: "task_registered", taskId: "T-001", title: "Task" },
      { type: "task_started", taskId: "T-001" },
      {
        type: "acp_traffic",
        taskId: "T-001",
        direction: "send",
        method: "tools/call",
        summary: "read file.ts",
      },
      {
        type: "acp_traffic",
        taskId: "T-001",
        direction: "recv",
        summary: "file contents returned",
      },
    );
    const { lastFrame } = render(<AcpLogPane state={state} />);
    const frame = lastFrame()!;

    expect(frame).toContain("acp");
    // Send glyph
    expect(frame).toContain("▸");
    // Recv glyph
    expect(frame).toContain("◂");
    // Method shown for the first line
    expect(frame).toContain("tools/call");
    // Summaries
    expect(frame).toContain("read file.ts");
    expect(frame).toContain("file contents returned");
  });

  it("does NOT prefix taskId when only one task is running", () => {
    const state = buildState(
      { type: "task_registered", taskId: "T-001", title: "Solo" },
      { type: "task_started", taskId: "T-001" },
      {
        type: "acp_traffic",
        taskId: "T-001",
        direction: "send",
        summary: "hello",
      },
    );
    const { lastFrame } = render(<AcpLogPane state={state} />);
    const frame = lastFrame()!;

    // The line should contain the summary but NOT the taskId prefix
    // (taskId prefix only shows under concurrency > 1)
    const lines = frame.split("\n");
    const trafficLine = lines.find((l) => l.includes("hello"));
    expect(trafficLine).toBeDefined();
    // T-001 should NOT appear on the traffic line (only in the "acp" header or not at all)
    expect(trafficLine).not.toContain("T-001");
  });

  it("prefixes taskId when more than one task is running (concurrency)", () => {
    const state = buildState(
      { type: "task_registered", taskId: "T-001", title: "First" },
      { type: "task_registered", taskId: "T-002", title: "Second" },
      { type: "task_started", taskId: "T-001" },
      { type: "task_started", taskId: "T-002" },
      {
        type: "acp_traffic",
        taskId: "T-001",
        direction: "send",
        summary: "alpha",
      },
      {
        type: "acp_traffic",
        taskId: "T-002",
        direction: "recv",
        summary: "beta",
      },
    );
    const { lastFrame } = render(<AcpLogPane state={state} />);
    const frame = lastFrame()!;

    // Under concurrency, taskId prefix should appear on traffic lines
    const lines = frame.split("\n");
    const alphaLine = lines.find((l) => l.includes("alpha"));
    const betaLine = lines.find((l) => l.includes("beta"));
    expect(alphaLine).toContain("T-001");
    expect(betaLine).toContain("T-002");
  });

  it("respects maxLines and shows only the tail", () => {
    const events: StoreEvent[] = [
      { type: "task_registered", taskId: "T-001", title: "Task" },
      { type: "task_started", taskId: "T-001" },
    ];
    for (let i = 0; i < 10; i++) {
      events.push({
        type: "acp_traffic",
        taskId: "T-001",
        direction: "send",
        summary: `msg-${i}`,
      });
    }
    const state = buildState(...events);
    const { lastFrame } = render(<AcpLogPane state={state} maxLines={3} />);
    const frame = lastFrame()!;

    // Should show only the last 3 messages
    expect(frame).toContain("msg-7");
    expect(frame).toContain("msg-8");
    expect(frame).toContain("msg-9");
    expect(frame).not.toContain("msg-6");
  });
});

// ---------------------------------------------------------------------------
// TaskListPane
// ---------------------------------------------------------------------------

describe("TaskListPane", () => {
  it("renders nothing when there are no tasks", () => {
    const state = buildState();
    const { lastFrame } = render(<TaskListPane state={state} />);
    expect(lastFrame()).toBe("");
  });

  it("renders all tasks in backlog order with status glyphs", () => {
    const state = buildState(
      { type: "task_registered", taskId: "T-001", title: "First task" },
      { type: "task_registered", taskId: "T-002", title: "Second task" },
      { type: "task_registered", taskId: "T-003", title: "Third task" },
    );
    const { lastFrame } = render(<TaskListPane state={state} />);
    const frame = lastFrame()!;

    expect(frame).toContain("tasks");
    // Pending glyph for all
    expect(frame).toContain("•");
    // All task ids
    expect(frame).toContain("T-001");
    expect(frame).toContain("T-002");
    expect(frame).toContain("T-003");
    // Titles
    expect(frame).toContain("First task");
    expect(frame).toContain("Second task");
    expect(frame).toContain("Third task");

    // Verify order: T-001 appears before T-002 which appears before T-003
    const idx1 = frame.indexOf("T-001");
    const idx2 = frame.indexOf("T-002");
    const idx3 = frame.indexOf("T-003");
    expect(idx1).toBeLessThan(idx2);
    expect(idx2).toBeLessThan(idx3);
  });

  it("shows done glyph (✔) for completed tasks", () => {
    const state = buildState(
      { type: "task_registered", taskId: "T-001", title: "Done" },
      { type: "task_started", taskId: "T-001" },
      { type: "task_finished", taskId: "T-001", status: "done" },
    );
    const { lastFrame } = render(<TaskListPane state={state} />);
    expect(lastFrame()!).toContain("✔");
  });

  it("shows escalated glyph (✖) and reason for failed tasks", () => {
    const state = buildState(
      { type: "task_registered", taskId: "T-001", title: "Failed" },
      { type: "task_started", taskId: "T-001" },
      {
        type: "task_finished",
        taskId: "T-001",
        status: "escalated",
        reason: "check failed",
      },
    );
    const { lastFrame } = render(<TaskListPane state={state} />);
    const frame = lastFrame()!;
    expect(frame).toContain("✖");
    expect(frame).toContain("check failed");
  });

  it("shows current step, try k/max, and checks when running", () => {
    const state = buildState(
      { type: "task_registered", taskId: "T-001", title: "Running" },
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
        attempt: 2,
        maxAttempts: 5,
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
        type: "check_started",
        taskId: "T-001",
        stepId: "implement",
        name: "test",
      },
    );
    const { lastFrame } = render(<TaskListPane state={state} />);
    const frame = lastFrame()!;

    // Running glyph
    expect(frame).toContain("▶");
    // Current step id
    expect(frame).toContain("implement");
    // Attempt label
    expect(frame).toContain("try 2/5");
    // Checks
    expect(frame).toContain("typecheck");
    expect(frame).toContain("test");
  });
});
