import { describe, it, expect } from "vitest";
import { streamColumns } from "../../src/panes/StreamPanel";
import { initialState, reduce } from "loopy/tui/store";
import type { StoreEvent, StoreState } from "loopy/tui/store";

// ── helpers ─────────────────────────────────────────────────────────────

/** Apply a sequence of events to a fresh store. */
function feedEvents(events: StoreEvent[]): StoreState {
  let state = initialState();
  for (const e of events) state = reduce(state, e);
  return state;
}

/** Register + start a task with a stream chunk. */
function runningTaskWithStream(
  taskId: string,
  title: string,
  text: string,
  agent?: string,
): StoreEvent[] {
  return [
    { type: "task_registered", taskId, title },
    { type: "task_started", taskId },
    {
      type: "step_started",
      taskId,
      stepId: "implement",
      stepType: "agent",
    },
    { type: "stream_chunk", taskId, text, agent },
  ];
}

// ── tests ───────────────────────────────────────────────────────────────

describe("streamColumns", () => {
  it("returns empty array when no tasks are running", () => {
    const store = feedEvents([
      { type: "task_registered", taskId: "T-001", title: "Idle task" },
    ]);
    expect(streamColumns(store)).toEqual([]);
  });

  it("returns one column for one running task", () => {
    const store = feedEvents(
      runningTaskWithStream("T-001", "First task", "line one\nline two\n"),
    );
    const cols = streamColumns(store);

    expect(cols).toHaveLength(1);
    expect(cols[0]!.taskId).toBe("T-001");
    expect(cols[0]!.title).toBe("First task");
    expect(cols[0]!.lines).toEqual(["line one", "line two"]);
  });

  it("returns N columns for N running tasks", () => {
    const store = feedEvents([
      ...runningTaskWithStream("T-001", "Task A", "alpha\n"),
      ...runningTaskWithStream("T-002", "Task B", "beta\n"),
      ...runningTaskWithStream("T-003", "Task C", "gamma\n"),
    ]);
    const cols = streamColumns(store);

    expect(cols).toHaveLength(3);
    expect(cols.map((c) => c.taskId)).toEqual(["T-001", "T-002", "T-003"]);
  });

  it("excludes finished tasks from columns", () => {
    const store = feedEvents([
      ...runningTaskWithStream("T-001", "Done task", "done\n"),
      { type: "task_finished", taskId: "T-001", status: "done" },
      ...runningTaskWithStream("T-002", "Running task", "still going\n"),
    ]);
    const cols = streamColumns(store);

    expect(cols).toHaveLength(1);
    expect(cols[0]!.taskId).toBe("T-002");
  });

  it("applies streamTail — only last maxLines lines", () => {
    const text = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join(
      "\n",
    );
    const store = feedEvents(
      runningTaskWithStream("T-001", "Long stream", text),
    );
    const cols = streamColumns(store); // default maxLines = 8

    expect(cols[0]!.lines).toHaveLength(8);
    expect(cols[0]!.lines[0]).toBe("line 13");
    expect(cols[0]!.lines[7]).toBe("line 20");
  });

  it("respects custom maxLines", () => {
    const text = "a\nb\nc\nd\ne";
    const store = feedEvents(
      runningTaskWithStream("T-001", "Custom tail", text),
    );
    const cols = streamColumns(store, 3);

    expect(cols[0]!.lines).toEqual(["c", "d", "e"]);
  });

  describe("agent prefix", () => {
    it("single agent — no prefix", () => {
      const store = feedEvents(
        runningTaskWithStream("T-001", "Single", "output\n", "coder"),
      );
      const cols = streamColumns(store);

      // activeAgents.size === 1 → no prefix
      expect(cols[0]!.lines).toEqual(["output"]);
    });

    it("multi-agent — prefix with [agent]", () => {
      const store = feedEvents([
        ...runningTaskWithStream("T-001", "Task A", "output A\n", "coder"),
        ...runningTaskWithStream("T-002", "Task B", "output B\n", "reviewer"),
      ]);
      const cols = streamColumns(store);

      // activeAgents.size === 2 → prefix
      expect(cols[0]!.lines).toEqual(["[coder] output A"]);
      expect(cols[1]!.lines).toEqual(["[reviewer] output B"]);
    });

    it("multi-agent but task has no streamAgent — no prefix on that task", () => {
      const store = feedEvents([
        ...runningTaskWithStream("T-001", "Task A", "output A\n"),
        ...runningTaskWithStream("T-002", "Task B", "output B\n", "reviewer"),
        // Force a second agent into activeAgents
        { type: "stream_chunk", taskId: "T-001", text: "more\n", agent: "coder" },
      ]);
      const cols = streamColumns(store);

      // T-001 now has streamAgent "coder" (from second chunk)
      expect(cols).toHaveLength(2);
      // Both should have prefix since activeAgents.size > 1
      expect(cols[0]!.lines[0]).toMatch(/^\[coder\]/);
      expect(cols[1]!.lines[0]).toMatch(/^\[reviewer\]/);
    });
  });

  it("handles empty stream text gracefully", () => {
    const store = feedEvents([
      { type: "task_registered", taskId: "T-001", title: "Empty" },
      { type: "task_started", taskId: "T-001" },
      {
        type: "step_started",
        taskId: "T-001",
        stepId: "implement",
        stepType: "agent",
      },
      // No stream_chunk → stream is ""
    ]);
    const cols = streamColumns(store);

    expect(cols).toHaveLength(1);
    expect(cols[0]!.lines).toEqual([]);
  });
});
