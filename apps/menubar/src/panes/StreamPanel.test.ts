/**
 * Tests for StreamPanel — streamColumns (T-009: transcript-based) and
 * visiblePanes (T-008: max 4 + overflow).
 *
 * Covers:
 * - streamColumns: pure projection of running tasks + transcript → StreamColumn[]
 * - visiblePanes: max 4 columns with overflow count
 *
 * Run: `npm test -w apps/menubar -- StreamPanel`
 */

import { describe, it, expect } from "vitest";
import type { StoreState, TaskState } from "loopy/tui/store";
import type { Transcript } from "../state/stream-history";
import { streamColumns, visiblePanes } from "./StreamPanel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(
  id: string,
  status: TaskState["status"],
  title = `Task ${id}`,
): TaskState {
  return {
    id,
    title,
    status,
    steps: [],
    stream: "",
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
// streamColumns (T-009 — transcript-based)
// ---------------------------------------------------------------------------

describe("streamColumns", () => {
  it("returns empty array when no running tasks", () => {
    const store = makeStore([makeTask("T-001", "done")]);
    expect(streamColumns(store, {})).toEqual([]);
  });

  it("returns one column per running task with segments from transcript", () => {
    const store = makeStore([
      makeTask("T-001", "running"),
      makeTask("T-002", "done"),
      makeTask("T-003", "running"),
    ]);
    const transcript: Transcript = {
      "T-001": [
        { stepId: "impl", text: "hello " },
        { stepId: "impl", text: "world" },
      ],
      "T-003": [{ stepId: "audit", text: "checking..." }],
    };
    const cols = streamColumns(store, transcript);
    expect(cols).toHaveLength(2);
    expect(cols[0]!.taskId).toBe("T-001");
    expect(cols[0]!.segments).toEqual([
      { stepId: "impl", label: "impl", text: "hello world" },
    ]);
    expect(cols[1]!.taskId).toBe("T-003");
    expect(cols[1]!.segments).toEqual([
      { stepId: "audit", label: "audit", text: "checking..." },
    ]);
  });

  it("returns empty segments when task has no transcript entries", () => {
    const store = makeStore([makeTask("T-001", "running")]);
    const cols = streamColumns(store, {});
    expect(cols).toHaveLength(1);
    expect(cols[0]!.segments).toEqual([]);
  });

  it("produces multiple segments for cross-step transcript", () => {
    const store = makeStore([makeTask("T-001", "running")]);
    const transcript: Transcript = {
      "T-001": [
        { stepId: "impl", text: "code..." },
        { stepId: "simplify", text: "simplifying..." },
        { stepId: "audit", text: "AUDIT: PASS" },
      ],
    };
    const cols = streamColumns(store, transcript);
    expect(cols[0]!.segments).toHaveLength(3);
    expect(cols[0]!.segments[0]!.stepId).toBe("impl");
    expect(cols[0]!.segments[1]!.stepId).toBe("simplify");
    expect(cols[0]!.segments[2]!.stepId).toBe("audit");
  });
});

// ---------------------------------------------------------------------------
// visiblePanes
// ---------------------------------------------------------------------------

describe("visiblePanes", () => {
  it("returns all columns when ≤4", () => {
    const cols = [
      { taskId: "T-001", title: "A", segments: [] },
      { taskId: "T-002", title: "B", segments: [] },
    ];
    const result = visiblePanes(cols);
    expect(result.visible).toHaveLength(2);
    expect(result.overflow).toBe(0);
  });

  it("returns exactly 4 when exactly 4 columns", () => {
    const cols = Array.from({ length: 4 }, (_, i) => ({
      taskId: `T-00${i + 1}`,
      title: `Task ${i + 1}`,
      segments: [],
    }));
    const result = visiblePanes(cols);
    expect(result.visible).toHaveLength(4);
    expect(result.overflow).toBe(0);
  });

  it("caps at 4 and reports overflow when >4", () => {
    const cols = Array.from({ length: 7 }, (_, i) => ({
      taskId: `T-00${i + 1}`,
      title: `Task ${i + 1}`,
      segments: [],
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
    const cols = [{ taskId: "T-001", title: "Solo", segments: [] }];
    const result = visiblePanes(cols);
    expect(result.visible).toHaveLength(1);
    expect(result.overflow).toBe(0);
  });
});
