import { describe, it, expect } from "vitest";
import type { StoreState, TaskState } from "loopy/tui/store";
import { groupByStep } from "./grouper";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function task(
  id: string,
  title: string,
  overrides: Partial<TaskState> = {},
): TaskState {
  return { id, title, status: "pending", steps: [], stream: "", ...overrides };
}

function store(
  tasks: TaskState[],
  pipeline: { id: string; type: string }[] = [],
): StoreState {
  return {
    tasks,
    edges: [],
    acpLog: [],
    activeAgents: new Set<string>(),
    pipeline: pipeline as StoreState["pipeline"],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("groupByStep", () => {
  it("returns Backlog + Fim when pipeline is empty", () => {
    const cols = groupByStep(store([task("T-001", "A")]));
    expect(cols.map((c) => c.id)).toEqual(["backlog", "fim"]);
    expect(cols[0]!.cards).toHaveLength(1);
  });

  it("creates one column per pipeline step in declared order", () => {
    const s = store([], [
      { id: "build", type: "shell" },
      { id: "test", type: "checks" },
      { id: "deploy", type: "approval" },
    ]);
    const cols = groupByStep(s);
    expect(cols.map((c) => c.id)).toEqual([
      "backlog",
      "build",
      "test",
      "deploy",
      "fim",
    ]);
  });

  it("places pending tasks in Backlog", () => {
    const s = store(
      [task("T-001", "A", { status: "pending" })],
      [{ id: "build", type: "shell" }],
    );
    const cols = groupByStep(s);
    expect(cols.find((c) => c.id === "backlog")!.cards).toHaveLength(1);
    expect(cols.find((c) => c.id === "build")!.cards).toHaveLength(0);
  });

  it("places blocked tasks in Backlog", () => {
    const s = store(
      [task("T-001", "A", { status: "blocked" })],
      [{ id: "build", type: "shell" }],
    );
    expect(
      groupByStep(s).find((c) => c.id === "backlog")!.cards,
    ).toHaveLength(1);
  });

  it("places running task with currentStepId in its step column", () => {
    const s = store(
      [task("T-001", "A", { status: "running", currentStepId: "build" })],
      [{ id: "build", type: "shell" }, { id: "test", type: "checks" }],
    );
    const cols = groupByStep(s);
    expect(cols.find((c) => c.id === "build")!.cards).toHaveLength(1);
    expect(cols.find((c) => c.id === "test")!.cards).toHaveLength(0);
  });

  it("places running task without currentStepId in Backlog", () => {
    const s = store(
      [task("T-001", "A", { status: "running" })],
      [{ id: "build", type: "shell" }],
    );
    expect(
      groupByStep(s).find((c) => c.id === "backlog")!.cards,
    ).toHaveLength(1);
  });

  it("places terminal tasks (done/escalated/skipped/paused) in Fim", () => {
    const s = store(
      [
        task("T-001", "A", { status: "done" }),
        task("T-002", "B", { status: "escalated" }),
        task("T-003", "C", { status: "skipped" }),
        task("T-004", "D", { status: "paused" }),
      ],
      [{ id: "build", type: "shell" }],
    );
    expect(groupByStep(s).find((c) => c.id === "fim")!.cards).toHaveLength(4);
  });

  it("escalated task carries failedAtStepId", () => {
    const s = store(
      [
        task("T-001", "A", {
          status: "escalated",
          steps: [
            { id: "build", status: "done", type: "shell", checks: [] },
            { id: "test", status: "failed", type: "checks", checks: [] },
          ] as unknown as TaskState["steps"],
        }),
      ],
      [{ id: "build", type: "shell" }, { id: "test", type: "checks" }],
    );
    const fimCards = groupByStep(s).find((c) => c.id === "fim")!.cards;
    expect(fimCards[0]!.failedAtStepId).toBe("test");
  });

  it("columns follow pipeline order when pipeline changes", () => {
    // Original order: build → test
    const s1 = store([], [
      { id: "build", type: "shell" },
      { id: "test", type: "checks" },
    ]);
    expect(groupByStep(s1).map((c) => c.id)).toEqual([
      "backlog", "build", "test", "fim",
    ]);

    // Reordered: test → build
    const s2 = store([], [
      { id: "test", type: "checks" },
      { id: "build", type: "shell" },
    ]);
    expect(groupByStep(s2).map((c) => c.id)).toEqual([
      "backlog", "test", "build", "fim",
    ]);
  });

  it("step removed from pipeline loses its column", () => {
    const s = store(
      [task("T-001", "A", { status: "running", currentStepId: "build" })],
      [{ id: "test", type: "checks" }], // "build" removed
    );
    const cols = groupByStep(s);
    expect(cols.find((c) => c.id === "build")).toBeUndefined();
    // Task with unknown currentStepId falls to Backlog
    expect(cols.find((c) => c.id === "backlog")!.cards).toHaveLength(1);
  });
});
