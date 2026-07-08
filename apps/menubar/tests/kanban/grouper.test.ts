import { describe, it, expect } from "vitest";
import { groupByStep } from "../../src/kanban/grouper";
import { initialState, reduce } from "loopy/tui/store";
import type { StoreEvent, StoreState } from "loopy/tui/store";

// ── helpers ─────────────────────────────────────────────────────────────

/** Apply a sequence of events to the initial state. */
function buildState(events: StoreEvent[]): StoreState {
  let state = initialState();
  for (const e of events) state = reduce(state, e);
  return state;
}

const PIPELINE: StoreEvent = {
  type: "pipeline_declared",
  steps: [
    { id: "implement", type: "agent" },
    { id: "simplify", type: "agent" },
    { id: "audit", type: "agent" },
    { id: "commit", type: "shell" },
    { id: "merge", type: "approval" },
  ],
};

// ── tests ───────────────────────────────────────────────────────────────

describe("groupByStep (kanban grouper)", () => {
  describe("column structure", () => {
    it("no pipeline → only Backlog + Fim", () => {
      const state = buildState([
        { type: "task_registered", taskId: "T-001", title: "A" },
      ]);
      const cols = groupByStep(state);

      expect(cols).toHaveLength(2);
      expect(cols[0]!.id).toBe("backlog");
      expect(cols[0]!.title).toBe("Backlog");
      expect(cols[1]!.id).toBe("fim");
      expect(cols[1]!.title).toBe("Fim");
    });

    it("with pipeline → Backlog + one per step + Fim", () => {
      const state = buildState([PIPELINE]);
      const cols = groupByStep(state);

      expect(cols.map((c) => c.id)).toEqual([
        "backlog",
        "implement",
        "simplify",
        "audit",
        "commit",
        "merge",
        "fim",
      ]);
    });

    it("columns are deterministic on repeated calls", () => {
      const state = buildState([
        PIPELINE,
        { type: "task_registered", taskId: "T-001", title: "A" },
      ]);
      const a = groupByStep(state);
      const b = groupByStep(state);
      expect(a).toEqual(b);
    });
  });

  describe("card placement", () => {
    it("pending task → Backlog", () => {
      const state = buildState([
        PIPELINE,
        { type: "task_registered", taskId: "T-001", title: "Setup" },
      ]);
      const cols = groupByStep(state);
      const backlog = cols.find((c) => c.id === "backlog")!;

      expect(backlog.cards).toHaveLength(1);
      expect(backlog.cards[0]!.taskId).toBe("T-001");
      expect(backlog.cards[0]!.status).toBe("pending");
    });

    it("blocked task → Backlog", () => {
      const state = buildState([
        PIPELINE,
        {
          type: "task_registered",
          taskId: "T-001",
          title: "Blocked one",
          status: "blocked",
        },
      ]);
      const cols = groupByStep(state);
      const backlog = cols.find((c) => c.id === "backlog")!;

      expect(backlog.cards).toHaveLength(1);
      expect(backlog.cards[0]!.status).toBe("blocked");
    });

    it("running task → column of currentStepId", () => {
      const state = buildState([
        PIPELINE,
        { type: "task_registered", taskId: "T-001", title: "Impl" },
        { type: "task_started", taskId: "T-001" },
        {
          type: "step_started",
          taskId: "T-001",
          stepId: "simplify",
          stepType: "agent",
        },
      ]);
      const cols = groupByStep(state);
      const simplify = cols.find((c) => c.id === "simplify")!;

      expect(simplify.cards).toHaveLength(1);
      expect(simplify.cards[0]!.taskId).toBe("T-001");
      expect(simplify.cards[0]!.status).toBe("running");
    });

    it("running task without currentStepId → Backlog", () => {
      // Between task_started and step_started, currentStepId is undefined
      const state = buildState([
        PIPELINE,
        { type: "task_registered", taskId: "T-001", title: "Impl" },
        { type: "task_started", taskId: "T-001" },
      ]);
      const cols = groupByStep(state);
      const backlog = cols.find((c) => c.id === "backlog")!;

      expect(backlog.cards).toHaveLength(1);
      expect(backlog.cards[0]!.status).toBe("running");
    });

    it("done task → Fim", () => {
      const state = buildState([
        PIPELINE,
        { type: "task_registered", taskId: "T-001", title: "Done" },
        { type: "task_started", taskId: "T-001" },
        { type: "task_finished", taskId: "T-001", status: "done" },
      ]);
      const cols = groupByStep(state);
      const fim = cols.find((c) => c.id === "fim")!;

      expect(fim.cards).toHaveLength(1);
      expect(fim.cards[0]!.status).toBe("done");
    });

    it("skipped task → Fim", () => {
      const state = buildState([
        PIPELINE,
        { type: "task_registered", taskId: "T-001", title: "Skipped" },
        { type: "task_finished", taskId: "T-001", status: "skipped" },
      ]);
      const fim = groupByStep(state).find((c) => c.id === "fim")!;

      expect(fim.cards).toHaveLength(1);
      expect(fim.cards[0]!.status).toBe("skipped");
    });

    it("paused task → Fim", () => {
      const state = buildState([
        PIPELINE,
        { type: "task_registered", taskId: "T-001", title: "Paused" },
        { type: "task_finished", taskId: "T-001", status: "paused" },
      ]);
      const fim = groupByStep(state).find((c) => c.id === "fim")!;

      expect(fim.cards).toHaveLength(1);
      expect(fim.cards[0]!.status).toBe("paused");
    });
  });

  describe("escalated — reports the step where it failed", () => {
    it("escalated task → Fim with failedAtStepId", () => {
      const state = buildState([
        PIPELINE,
        { type: "task_registered", taskId: "T-001", title: "Broke" },
        { type: "task_started", taskId: "T-001" },
        {
          type: "step_started",
          taskId: "T-001",
          stepId: "implement",
          stepType: "agent",
        },
        {
          type: "step_finished",
          taskId: "T-001",
          stepId: "implement",
          ok: true,
        },
        {
          type: "step_started",
          taskId: "T-001",
          stepId: "audit",
          stepType: "agent",
        },
        {
          type: "step_finished",
          taskId: "T-001",
          stepId: "audit",
          ok: false,
          reason: "AUDIT: FAIL",
        },
        {
          type: "task_finished",
          taskId: "T-001",
          status: "escalated",
          reason: "audit failed",
        },
      ]);
      const fim = groupByStep(state).find((c) => c.id === "fim")!;

      expect(fim.cards).toHaveLength(1);
      expect(fim.cards[0]!.failedAtStepId).toBe("audit");
    });

    it("escalated without any failed step → no failedAtStepId", () => {
      const state = buildState([
        PIPELINE,
        { type: "task_registered", taskId: "T-001", title: "Weird" },
        { type: "task_finished", taskId: "T-001", status: "escalated" },
      ]);
      const fim = groupByStep(state).find((c) => c.id === "fim")!;

      expect(fim.cards[0]!.failedAtStepId).toBeUndefined();
    });
  });

  describe("goto — card appears in an earlier column", () => {
    it("task that went back via goto sits in the earlier step column", () => {
      // Simulate: implement → audit → goto implement (fix loop)
      const state = buildState([
        PIPELINE,
        { type: "task_registered", taskId: "T-001", title: "Fix loop" },
        { type: "task_started", taskId: "T-001" },
        {
          type: "step_started",
          taskId: "T-001",
          stepId: "implement",
          stepType: "agent",
        },
        {
          type: "step_finished",
          taskId: "T-001",
          stepId: "implement",
          ok: true,
        },
        {
          type: "step_started",
          taskId: "T-001",
          stepId: "audit",
          stepType: "agent",
        },
        {
          type: "step_finished",
          taskId: "T-001",
          stepId: "audit",
          ok: false,
        },
        // goto: back to implement
        {
          type: "step_started",
          taskId: "T-001",
          stepId: "implement",
          stepType: "agent",
        },
      ]);
      const cols = groupByStep(state);
      const implement = cols.find((c) => c.id === "implement")!;
      const audit = cols.find((c) => c.id === "audit")!;

      expect(implement.cards).toHaveLength(1);
      expect(implement.cards[0]!.taskId).toBe("T-001");
      // audit should be empty — the card moved back
      expect(audit.cards).toHaveLength(0);
    });
  });

  describe("multiple tasks", () => {
    it("distributes tasks across columns correctly", () => {
      const state = buildState([
        PIPELINE,
        { type: "task_registered", taskId: "T-001", title: "Done one" },
        {
          type: "task_registered",
          taskId: "T-002",
          title: "Blocked",
          status: "blocked",
        },
        { type: "task_registered", taskId: "T-003", title: "Running" },
        { type: "task_registered", taskId: "T-004", title: "Pending" },
        { type: "task_started", taskId: "T-001" },
        { type: "task_finished", taskId: "T-001", status: "done" },
        { type: "task_started", taskId: "T-003" },
        {
          type: "step_started",
          taskId: "T-003",
          stepId: "commit",
          stepType: "shell",
        },
      ]);
      const cols = groupByStep(state);

      expect(
        cols.find((c) => c.id === "backlog")!.cards.map((c) => c.taskId),
      ).toEqual(["T-002", "T-004"]);
      expect(
        cols.find((c) => c.id === "commit")!.cards.map((c) => c.taskId),
      ).toEqual(["T-003"]);
      expect(
        cols.find((c) => c.id === "fim")!.cards.map((c) => c.taskId),
      ).toEqual(["T-001"]);
    });

    it("preserves backlog order within each column", () => {
      const state = buildState([
        PIPELINE,
        { type: "task_registered", taskId: "T-001", title: "First" },
        { type: "task_registered", taskId: "T-002", title: "Second" },
        { type: "task_registered", taskId: "T-003", title: "Third" },
      ]);
      const backlog = groupByStep(state).find((c) => c.id === "backlog")!;

      expect(backlog.cards.map((c) => c.taskId)).toEqual([
        "T-001",
        "T-002",
        "T-003",
      ]);
    });
  });

  describe("edge case — currentStepId not in pipeline", () => {
    it("running task with unknown step → Backlog fallback", () => {
      const state = buildState([
        PIPELINE,
        { type: "task_registered", taskId: "T-001", title: "Odd" },
        { type: "task_started", taskId: "T-001" },
        {
          type: "step_started",
          taskId: "T-001",
          stepId: "unknown-step",
          stepType: "shell",
        },
      ]);
      const backlog = groupByStep(state).find((c) => c.id === "backlog")!;

      expect(backlog.cards).toHaveLength(1);
      expect(backlog.cards[0]!.taskId).toBe("T-001");
    });
  });
});
