/**
 * Integration tests for streamColumns (T-009: transcript-based).
 *
 * Uses the real store reducer to build StoreState, then pairs it with a
 * Transcript to verify that streamColumns produces the expected columns.
 *
 * Run: `npm test -w apps/menubar -- streams`
 */

import { describe, it, expect } from "vitest";
import { streamColumns } from "../../src/panes/StreamPanel";
import { initialState, reduce } from "loopy/tui/store";
import type { StoreEvent, StoreState } from "loopy/tui/store";
import type {
  Transcript,
  TranscriptEntry,
} from "../../src/state/stream-history";
import type { StreamItem } from "loopy/tui/store";

// ── helpers ─────────────────────────────────────────────────────────────

/** A text timeline item. */
const ti = (t: string): StreamItem => ({ item: "text", text: t });

/** A transcript entry carrying a text item, tagged by step. */
const te = (stepId: string, t: string): TranscriptEntry => ({
  stepId,
  item: ti(t),
});

/** Apply a sequence of events to a fresh store. */
function feedEvents(events: StoreEvent[]): StoreState {
  let state = initialState();
  for (const e of events) state = reduce(state, e);
  return state;
}

/** Register + start a task (with a running step). */
function startTask(taskId: string, title: string): StoreEvent[] {
  return [
    { type: "task_registered", taskId, title },
    { type: "task_started", taskId },
    {
      type: "step_started",
      taskId,
      stepId: "implement",
      stepType: "agent",
    },
  ];
}

// ── tests ───────────────────────────────────────────────────────────────

describe("streamColumns (integration — real reducer)", () => {
  it("returns N columns for N running tasks", () => {
    const store = feedEvents([
      ...startTask("T-001", "Task A"),
      ...startTask("T-002", "Task B"),
      ...startTask("T-003", "Task C"),
    ]);
    const transcript: Transcript = {
      "T-001": [te("implement", "alpha")],
      "T-002": [te("implement", "beta")],
      "T-003": [te("implement", "gamma")],
    };
    const cols = streamColumns(store, transcript);

    expect(cols).toHaveLength(3);
    expect(cols.map((c) => c.taskId)).toEqual(["T-001", "T-002", "T-003"]);
  });

  it("excludes finished tasks from columns", () => {
    const store = feedEvents([
      ...startTask("T-001", "Done task"),
      { type: "task_finished", taskId: "T-001", status: "done" },
      ...startTask("T-002", "Running task"),
    ]);
    const transcript: Transcript = {
      "T-001": [te("implement", "done")],
      "T-002": [te("implement", "still going")],
    };
    const cols = streamColumns(store, transcript);

    expect(cols).toHaveLength(1);
    expect(cols[0]!.taskId).toBe("T-002");
  });

  it("produces cross-step segments from transcript", () => {
    const store = feedEvents(startTask("T-001", "Multi-step"));
    const transcript: Transcript = {
      "T-001": [
        te("implement", "code..."),
        te("implement", " more code"),
        te("simplify", "simplifying..."),
        te("audit", "AUDIT: PASS"),
      ],
    };
    const cols = streamColumns(store, transcript);

    expect(cols[0]!.segments).toEqual([
      {
        stepId: "implement",
        label: "implement",
        items: [ti("code..."), ti(" more code")],
      },
      { stepId: "simplify", label: "simplify", items: [ti("simplifying...")] },
      { stepId: "audit", label: "audit", items: [ti("AUDIT: PASS")] },
    ]);
  });

  it("fix-loop: same stepId reappearing produces separate segments", () => {
    const store = feedEvents(startTask("T-001", "Fix loop"));
    const transcript: Transcript = {
      "T-001": [
        te("implement", "first pass"),
        te("test", "fail"),
        te("implement", "fix"),
      ],
    };
    const cols = streamColumns(store, transcript);

    expect(cols[0]!.segments).toHaveLength(3);
    expect(cols[0]!.segments[0]!.stepId).toBe("implement");
    expect(cols[0]!.segments[1]!.stepId).toBe("test");
    expect(cols[0]!.segments[2]!.stepId).toBe("implement");
  });
});
