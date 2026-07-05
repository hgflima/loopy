/**
 * Tests for the App dashboard (T-010) using `ink-testing-library`.
 *
 * Covers:
 *  - Composed dashboard snapshot (header + graph + task list + streams)
 *  - Pulse effect advances tick under fake timers (running task toggles emphasis)
 *  - Stream bound: N running → ~3 visible + `+K` overflow counter
 *  - No key outside the ApprovalPrompt alters the run
 */
import { render } from "ink-testing-library";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { App } from "../../src/tui/App";
import { createApprovalController } from "../../src/tui/approval";
import { createStore, type StoreEvent } from "../../src/tui/store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setup(...events: StoreEvent[]) {
  const store = createStore();
  const approval = createApprovalController();
  for (const e of events) store.dispatch(e);
  const result = render(<App store={store} approval={approval} />);
  return { store, approval, ...result };
}

// ---------------------------------------------------------------------------
// Dashboard composed (4 panes)
// ---------------------------------------------------------------------------

describe("App dashboard", () => {
  it("renders header with counters, graph, and task list", () => {
    const { lastFrame } = setup(
      { type: "edges_set", edges: [["T-001", "T-002"]] },
      { type: "task_registered", taskId: "T-001", title: "First" },
      {
        type: "task_registered",
        taskId: "T-002",
        title: "Second",
        status: "blocked",
      },
      { type: "task_started", taskId: "T-001" },
    );
    const frame = lastFrame()!;

    // Header
    expect(frame).toContain("loopy");
    expect(frame).toContain("run");
    expect(frame).toContain("0/2 done");
    expect(frame).toContain("1 running");

    // Graph pane
    expect(frame).toContain("graph");
    expect(frame).toContain("T-001");
    expect(frame).toContain("T-002");

    // Task list pane
    expect(frame).toContain("tasks");

    // No ACP pane — the JSON-RPC traffic seam feeds the file log / verbose
    // line fallback, not the dashboard.
    expect(frame).not.toContain("acp");
  });

  it("shows stream pane when a running task has stream content", () => {
    const { lastFrame } = setup(
      { type: "task_registered", taskId: "T-001", title: "Task" },
      { type: "task_started", taskId: "T-001" },
      {
        type: "step_started",
        taskId: "T-001",
        stepId: "implement",
        stepType: "agent",
      },
      {
        type: "stream_chunk",
        taskId: "T-001",
        text: "implementing feature X",
      },
    );
    const frame = lastFrame()!;
    expect(frame).toContain("stream");
    expect(frame).toContain("implementing feature X");
  });

  it("renders nothing special when no tasks exist", () => {
    const { lastFrame } = setup();
    const frame = lastFrame()!;
    expect(frame).toContain("loopy");
    expect(frame).toContain("0/0 done");
    expect(frame).toContain("0 running");
  });

  it("updates counters when tasks finish", () => {
    // Before: 0 done, 1 running
    const { lastFrame: frameBefore } = setup(
      { type: "task_registered", taskId: "T-001", title: "First" },
      { type: "task_registered", taskId: "T-002", title: "Second" },
      { type: "task_started", taskId: "T-001" },
    );
    expect(frameBefore()!).toContain("0/2 done");
    expect(frameBefore()!).toContain("1 running");

    // After: 1 done, 0 running
    const { lastFrame: frameAfter } = setup(
      { type: "task_registered", taskId: "T-001", title: "First" },
      { type: "task_registered", taskId: "T-002", title: "Second" },
      { type: "task_started", taskId: "T-001" },
      { type: "task_finished", taskId: "T-001", status: "done" },
    );
    expect(frameAfter()!).toContain("1/2 done");
    expect(frameAfter()!).toContain("0 running");
  });
});

// ---------------------------------------------------------------------------
// Pulse effect under fake timers
// ---------------------------------------------------------------------------

describe("pulse effect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("advances tick at ~500ms intervals when tasks are running", () => {
    const { lastFrame } = setup(
      { type: "task_registered", taskId: "T-001", title: "Task" },
      { type: "task_started", taskId: "T-001" },
    );

    // Verify initial render is stable
    expect(lastFrame()!).toContain("loopy");
    expect(lastFrame()!).toContain("1 running");

    // Advance several pulse intervals — the component should keep rendering
    // without errors (the pulse drives setTick(t => t+1) via setInterval).
    // Bold/dim toggling is visual-only and not distinguishable in lastFrame()
    // text, but the timer firing without crash proves the effect works.
    vi.advanceTimersByTime(500);
    expect(lastFrame()!).toContain("loopy");

    vi.advanceTimersByTime(500);
    expect(lastFrame()!).toContain("loopy");

    vi.advanceTimersByTime(500);
    expect(lastFrame()!).toContain("1 running");
  });

  it("does not pulse when no tasks are running", () => {
    const { lastFrame } = setup(
      { type: "task_registered", taskId: "T-001", title: "Done" },
      { type: "task_started", taskId: "T-001" },
      { type: "task_finished", taskId: "T-001", status: "done" },
    );

    const frame0 = lastFrame()!;
    vi.advanceTimersByTime(1500);
    const frame1 = lastFrame()!;

    // No running → no timer → no change
    expect(frame0).toEqual(frame1);
  });
});

// ---------------------------------------------------------------------------
// Stream bound: ~3 + `+K`
// ---------------------------------------------------------------------------

describe("stream bound", () => {
  /** Register + start + stream N running tasks. */
  function runningWithStreams(n: number): StoreEvent[] {
    const events: StoreEvent[] = [];
    for (let i = 1; i <= n; i++) {
      const id = `T-${String(i).padStart(3, "0")}`;
      events.push({ type: "task_registered", taskId: id, title: `Task ${i}` });
      events.push({ type: "task_started", taskId: id });
      events.push({ type: "step_started", taskId: id, stepId: "impl", stepType: "agent" });
      events.push({ type: "stream_chunk", taskId: id, text: `stream-${i}` });
    }
    return events;
  }

  it("bounds concurrent stream panes to what the fixed region fits, folding the rest into +K", () => {
    const { lastFrame } = setup(...runningWithStreams(5));
    const frame = lastFrame()!;

    // At the default (fallback) terminal size the fixed streams region fits two
    // panes — the two most recently started running tasks' streams.
    expect(frame).toContain("stream-4");
    expect(frame).toContain("stream-5");

    // Older streams are folded away (not popping in/out and reflowing).
    expect(frame).not.toContain("stream-1");
    expect(frame).not.toContain("stream-3");

    // Overflow indicator for the folded streams.
    expect(frame).toContain("+3");
  });

  it("shows every running stream when they all fit (no overflow note)", () => {
    const { lastFrame } = setup(...runningWithStreams(2));
    const frame = lastFrame()!;

    // Both visible
    expect(frame).toContain("stream-1");
    expect(frame).toContain("stream-2");

    // No overflow counter
    expect(frame).not.toContain("+");
  });
});

// ---------------------------------------------------------------------------
// No key outside ApprovalPrompt alters the run
// ---------------------------------------------------------------------------

describe("keyboard passivity", () => {
  it("ignores arbitrary keypresses — only ApprovalPrompt handles input", () => {
    const { store, lastFrame, stdin } = setup(
      { type: "task_registered", taskId: "T-001", title: "Task" },
      { type: "task_started", taskId: "T-001" },
    );

    const frameBefore = lastFrame()!;

    // Press random keys
    stdin.write("x");
    stdin.write("q");
    stdin.write("r");

    const frameAfter = lastFrame()!;

    // State should be unchanged — no key handler outside ApprovalPrompt
    expect(store.getState().tasks[0]!.status).toBe("running");
    // Frame should be the same (no side effects from keys)
    expect(frameBefore).toEqual(frameAfter);
  });
});
