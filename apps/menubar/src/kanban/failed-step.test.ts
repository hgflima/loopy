import { describe, it, expect } from "vitest";
import type { StepState, TaskState } from "loopy/tui/store";
import { failedStepId } from "./failed-step";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function task(
  status: TaskState["status"],
  steps: Array<{ id: string; status: string }> = [],
): TaskState {
  return {
    id: "T-001",
    title: "test task",
    status,
    steps: steps.map((s) => ({
      id: s.id,
      type: "agent" as const,
      status: s.status as StepState["status"],
      checks: [],
    })),
    stream: "",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("failedStepId", () => {
  it("returns the last failed step id when task is escalated", () => {
    const t = task("escalated", [
      { id: "build", status: "done" },
      { id: "test", status: "failed" },
      { id: "lint", status: "done" },
      { id: "deploy", status: "failed" },
    ]);
    expect(failedStepId(t)).toBe("deploy");
  });

  it("returns undefined when task is escalated but no step failed", () => {
    const t = task("escalated", [
      { id: "build", status: "done" },
      { id: "test", status: "done" },
    ]);
    expect(failedStepId(t)).toBeUndefined();
  });

  it("returns undefined when task is NOT escalated even if a step failed", () => {
    const t = task("running", [
      { id: "build", status: "failed" },
    ]);
    expect(failedStepId(t)).toBeUndefined();
  });

  it("returns undefined for a pending task with no steps", () => {
    const t = task("ready");
    expect(failedStepId(t)).toBeUndefined();
  });

  it("returns the only failed step when there is exactly one", () => {
    const t = task("escalated", [
      { id: "build", status: "done" },
      { id: "test", status: "failed" },
    ]);
    expect(failedStepId(t)).toBe("test");
  });
});
