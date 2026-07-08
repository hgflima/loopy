/**
 * Tests for T-008: StreamPanel — visiblePanes (max 4 + overflow) and streamColumns.
 *
 * Covers:
 * - streamColumns: pure data extraction from StoreState
 * - visiblePanes: max 4 columns with overflow count
 *
 * Run: `npm test -w apps/menubar -- StreamPanel`
 */

import { describe, it, expect } from "vitest";
import type { StoreState, TaskState } from "loopy/tui/store";
import { streamColumns, visiblePanes } from "./StreamPanel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(
  id: string,
  status: TaskState["status"],
  stream = "",
  title = `Task ${id}`,
): TaskState {
  return {
    id,
    title,
    status,
    steps: [],
    stream,
    currentStepId: status === "running" ? "impl" : undefined,
  };
}

function makeStore(tasks: TaskState[]): StoreState {
  return {
    tasks,
    edges: [],
    acpLog: [],
    activeAgents: new Set(),
    pipeline: [],
  };
}

// ---------------------------------------------------------------------------
// streamColumns
// ---------------------------------------------------------------------------

describe("streamColumns", () => {
  it("returns empty array when no running tasks", () => {
    const store = makeStore([makeTask("T-001", "done")]);
    expect(streamColumns(store)).toEqual([]);
  });

  it("returns one column per running task", () => {
    const store = makeStore([
      makeTask("T-001", "running", "line1\nline2"),
      makeTask("T-002", "done"),
      makeTask("T-003", "running", "line3"),
    ]);
    const cols = streamColumns(store);
    expect(cols).toHaveLength(2);
    expect(cols[0]!.taskId).toBe("T-001");
    expect(cols[1]!.taskId).toBe("T-003");
  });

  it("respects maxLines", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line-${i}`).join("\n");
    const store = makeStore([makeTask("T-001", "running", lines)]);
    const cols = streamColumns(store, 5);
    expect(cols[0]!.lines).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// visiblePanes
// ---------------------------------------------------------------------------

describe("visiblePanes", () => {
  it("returns all columns when ≤4", () => {
    const cols = [
      { taskId: "T-001", title: "A", lines: [] },
      { taskId: "T-002", title: "B", lines: [] },
    ];
    const result = visiblePanes(cols);
    expect(result.visible).toHaveLength(2);
    expect(result.overflow).toBe(0);
  });

  it("returns exactly 4 when exactly 4 columns", () => {
    const cols = Array.from({ length: 4 }, (_, i) => ({
      taskId: `T-00${i + 1}`,
      title: `Task ${i + 1}`,
      lines: [],
    }));
    const result = visiblePanes(cols);
    expect(result.visible).toHaveLength(4);
    expect(result.overflow).toBe(0);
  });

  it("caps at 4 and reports overflow when >4", () => {
    const cols = Array.from({ length: 7 }, (_, i) => ({
      taskId: `T-00${i + 1}`,
      title: `Task ${i + 1}`,
      lines: [],
    }));
    const result = visiblePanes(cols);
    expect(result.visible).toHaveLength(4);
    expect(result.overflow).toBe(3);
  });

  it("returns empty visible and 0 overflow for empty input", () => {
    const result = visiblePanes([]);
    expect(result.visible).toHaveLength(0);
    expect(result.overflow).toBe(0);
  });

  it("single column fills the space (overflow 0)", () => {
    const cols = [{ taskId: "T-001", title: "Solo", lines: ["hello"] }];
    const result = visiblePanes(cols);
    expect(result.visible).toHaveLength(1);
    expect(result.overflow).toBe(0);
  });
});
