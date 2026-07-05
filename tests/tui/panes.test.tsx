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
  it("renders its titled frame (fixed presence) even with no tasks", () => {
    const state = buildState();
    const { lastFrame } = render(<GraphPane state={state} />);
    // Always present now — the empty graph still shows its frame/title.
    expect(lastFrame()).toContain("graph");
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
// TaskListPane
// ---------------------------------------------------------------------------

describe("TaskListPane", () => {
  it("renders its titled frame (fixed presence) when there are no tasks", () => {
    const state = buildState();
    const { lastFrame } = render(<TaskListPane state={state} />);
    const frame = lastFrame()!;
    expect(frame).toContain("tasks");
    expect(frame).toContain("sem tasks");
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
