import { describe, it, expect } from "vitest";
import type { StoreState, TaskState } from "loopy/tui/store";
import { groupByStep } from "./grouper";
import { detectGotoCards } from "./goto-detect";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function task(
  id: string,
  title: string,
  overrides: Partial<TaskState> = {},
): TaskState {
  return { id, title, status: "ready", steps: [], stream: "", ...overrides };
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
    warnings: [],
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
      [task("T-001", "A", { status: "ready" })],
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

  it("places a task that entered no step yet in Backlog", () => {
    const s = store(
      [task("T-001", "A", { status: "running" })],
      [{ id: "build", type: "shell" }],
    );
    expect(
      groupByStep(s).find((c) => c.id === "backlog")!.cards,
    ).toHaveLength(1);
  });

  // `step_finished` clears `currentStepId`, so a running task is momentarily
  // position-less between two steps. It must hold its column: dipping into
  // Backlog would both misread the column (Backlog is tasks yet to start) and
  // read as a backward move to `detectGotoCards`.
  it("keeps a running task in its last entered step between two steps", () => {
    const s = store(
      [task("T-001", "A", { status: "running", lastStepId: "build" })],
      [
        { id: "build", type: "shell" },
        { id: "test", type: "checks" },
      ],
    );
    const cols = groupByStep(s);
    expect(cols.find((c) => c.id === "backlog")!.cards).toHaveLength(0);
    expect(cols.find((c) => c.id === "build")!.cards).toHaveLength(1);
  });

  it("prefers currentStepId over lastStepId once the next step starts", () => {
    const s = store(
      [
        task("T-001", "A", {
          status: "running",
          currentStepId: "test",
          lastStepId: "test",
        }),
      ],
      [
        { id: "build", type: "shell" },
        { id: "test", type: "checks" },
      ],
    );
    const cols = groupByStep(s);
    expect(cols.find((c) => c.id === "build")!.cards).toHaveLength(0);
    expect(cols.find((c) => c.id === "test")!.cards).toHaveLength(1);
  });

  // After a Desvio the `steps` array still ends at the step the goto left
  // behind (it is ordered by first visit), so the column must come from
  // `lastStepId` — not from the tail of `steps`.
  it("sits in the goto target after a Desvio, not in the step left behind", () => {
    const s = store(
      [
        task("T-001", "A", {
          status: "running",
          lastStepId: "build",
          steps: [
            { id: "build", type: "shell", status: "running", checks: [] },
            { id: "test", type: "checks", status: "failed", checks: [] },
          ] as TaskState["steps"],
        }),
      ],
      [
        { id: "build", type: "shell" },
        { id: "test", type: "checks" },
      ],
    );
    const cols = groupByStep(s);
    expect(cols.find((c) => c.id === "build")!.cards).toHaveLength(1);
    expect(cols.find((c) => c.id === "test")!.cards).toHaveLength(0);
  });

  it("falls back to Backlog when the remembered step left the pipeline", () => {
    const s = store(
      [task("T-001", "A", { status: "running", lastStepId: "removed" })],
      [{ id: "build", type: "shell" }],
    );
    expect(groupByStep(s).find((c) => c.id === "backlog")!.cards).toHaveLength(
      1,
    );
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

  it("splits Fim into outcome sections, done first and skipped apart from it", () => {
    const s = store(
      [
        task("T-001", "A", { status: "escalated" }),
        task("T-002", "B", { status: "skipped" }),
        task("T-003", "C", { status: "done" }),
        task("T-004", "D", { status: "skipped" }),
      ],
      [{ id: "build", type: "shell" }],
    );
    const fim = groupByStep(s).find((c) => c.id === "fim")!;

    expect(fim.sections?.map((sec) => [sec.status, sec.cards.length])).toEqual([
      ["done", 1],
      ["skipped", 2],
      ["escalated", 1],
    ]);
    // `cards` stays flat but follows the section order (header count + goto
    // detection read it and know nothing about sections).
    expect(fim.cards.map((c) => c.taskId)).toEqual([
      "T-003",
      "T-002",
      "T-004",
      "T-001",
    ]);
  });

  it("omits sections when Fim holds a single outcome", () => {
    const s = store(
      [
        task("T-001", "A", { status: "done" }),
        task("T-002", "B", { status: "done" }),
      ],
      [{ id: "build", type: "shell" }],
    );
    const fim = groupByStep(s).find((c) => c.id === "fim")!;
    expect(fim.sections).toBeUndefined();
    expect(fim.cards).toHaveLength(2);
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

  it("warned card when a step has warned=true", () => {
    const s = store(
      [
        task("T-001", "A", {
          status: "running",
          currentStepId: "build",
          steps: [
            { id: "build", status: "running", type: "agent", checks: [], warned: true },
          ] as unknown as TaskState["steps"],
        }),
      ],
      [{ id: "build", type: "agent" }],
    );
    const card = groupByStep(s)
      .find((c) => c.id === "build")!
      .cards[0]!;
    expect(card.warned).toBe(true);
  });

  it("no warned flag when no steps have warned", () => {
    const s = store(
      [
        task("T-001", "A", {
          status: "running",
          currentStepId: "build",
          steps: [
            { id: "build", status: "running", type: "agent", checks: [] },
          ] as unknown as TaskState["steps"],
        }),
      ],
      [{ id: "build", type: "agent" }],
    );
    const card = groupByStep(s)
      .find((c) => c.id === "build")!
      .cards[0]!;
    expect(card.warned).toBeUndefined();
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

// ---------------------------------------------------------------------------
// Regression: the goto pulse must fire on a Desvio and *only* on a Desvio.
// `detectGotoCards` reads column indices, so it is only as correct as the
// grouper's placement — the two are tested together on purpose.
// ---------------------------------------------------------------------------

describe("groupByStep + detectGotoCards", () => {
  const PIPELINE = [
    { id: "build", type: "shell" },
    { id: "test", type: "checks" },
  ];

  it("does not read a step completion as a Desvio", () => {
    // running "build"  →  build finished, next step not started yet
    const during = groupByStep(
      store(
        [
          task("T-001", "A", {
            status: "running",
            currentStepId: "build",
            lastStepId: "build",
          }),
        ],
        PIPELINE,
      ),
    );
    const between = groupByStep(
      store(
        [task("T-001", "A", { status: "running", lastStepId: "build" })],
        PIPELINE,
      ),
    );
    expect(detectGotoCards(during, between).size).toBe(0);
  });

  it("still detects a real Desvio (test → build)", () => {
    const atTest = groupByStep(
      store(
        [
          task("T-001", "A", {
            status: "running",
            currentStepId: "test",
            lastStepId: "test",
          }),
        ],
        PIPELINE,
      ),
    );
    const backAtBuild = groupByStep(
      store(
        [
          task("T-001", "A", {
            status: "running",
            currentStepId: "build",
            lastStepId: "build",
          }),
        ],
        PIPELINE,
      ),
    );
    expect(detectGotoCards(atTest, backAtBuild)).toEqual(new Set(["T-001"]));
  });
});
