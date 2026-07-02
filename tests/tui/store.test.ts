import { describe, expect, it, vi } from "vitest";
import {
  createStore,
  initialState,
  reduce,
  type StoreEvent,
  type StoreState,
  type TaskState,
} from "../../src/tui/store";

// ---------------------------------------------------------------------------
// Helpers — `noUncheckedIndexedAccess` makes bare indexing unsafe; look tasks
// and steps up by id and fail loudly when absent so each test reads as a spec.
// ---------------------------------------------------------------------------

function findTask(state: StoreState, id: string): TaskState {
  const task = state.tasks.find((t) => t.id === id);
  if (!task) throw new Error(`task ${id} não encontrada no store`);
  return task;
}

function findStep(state: StoreState, taskId: string, stepId: string) {
  const step = findTask(state, taskId).steps.find((s) => s.id === stepId);
  if (!step) throw new Error(`step ${stepId} não encontrado em ${taskId}`);
  return step;
}

/** Fold a sequence of events through the pure reducer from an empty state. */
function play(...events: readonly StoreEvent[]): StoreState {
  return events.reduce(reduce, initialState());
}

// ---------------------------------------------------------------------------
// reduce — task registration
// ---------------------------------------------------------------------------

describe("reduce · task registration", () => {
  it("appends a registered task in pending status, preserving order", () => {
    const state = play(
      { type: "task_registered", taskId: "T-001", title: "Primeira" },
      { type: "task_registered", taskId: "T-002", title: "Segunda" },
    );

    expect(state.tasks.map((t) => t.id)).toEqual(["T-001", "T-002"]);
    expect(findTask(state, "T-001").status).toBe("pending");
    expect(findTask(state, "T-001").title).toBe("Primeira");
    expect(findTask(state, "T-001").steps).toEqual([]);
    expect(findTask(state, "T-001").stream).toBe("");
  });

  it("is a no-op when the same task id is registered twice", () => {
    const once = play({
      type: "task_registered",
      taskId: "T-001",
      title: "Primeira",
    });
    const twice = reduce(once, {
      type: "task_registered",
      taskId: "T-001",
      title: "Duplicada",
    });

    expect(twice).toBe(once);
    expect(twice.tasks).toHaveLength(1);
    expect(findTask(twice, "T-001").title).toBe("Primeira");
  });

  it("does not mutate the input state (pure reducer)", () => {
    const before = play({
      type: "task_registered",
      taskId: "T-001",
      title: "Primeira",
    });
    const snapshot = JSON.parse(JSON.stringify(before));

    const after = reduce(before, { type: "task_started", taskId: "T-001" });

    expect(after).not.toBe(before);
    expect(before).toEqual(snapshot);
  });

  it("ignores events referencing an unregistered task", () => {
    const state = play({
      type: "task_registered",
      taskId: "T-001",
      title: "Primeira",
    });
    const next = reduce(state, { type: "task_started", taskId: "T-404" });

    expect(next).toBe(state);
  });
});

// ---------------------------------------------------------------------------
// reduce — task + step lifecycle
// ---------------------------------------------------------------------------

describe("reduce · task and step lifecycle", () => {
  it("marks a task running", () => {
    const state = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
      { type: "task_started", taskId: "T-001" },
    );
    expect(findTask(state, "T-001").status).toBe("running");
  });

  it("tracks the current step and adds it in running status", () => {
    const state = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
      {
        type: "step_started",
        taskId: "T-001",
        stepId: "implement",
        stepType: "agent",
      },
    );
    expect(findTask(state, "T-001").currentStepId).toBe("implement");
    expect(findStep(state, "T-001", "implement").status).toBe("running");
    expect(findStep(state, "T-001", "implement").type).toBe("agent");
  });

  it("records the current attempt as try k/max", () => {
    const state = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
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
        maxAttempts: 4,
      },
    );
    const step = findStep(state, "T-001", "implement");
    expect(step.attempt).toBe(2);
    expect(step.maxAttempts).toBe(4);
  });

  it("resets the previous attempt's checks when a new attempt starts", () => {
    const state = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
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
        attempt: 1,
        maxAttempts: 4,
      },
      {
        type: "check_finished",
        taskId: "T-001",
        stepId: "implement",
        name: "test",
        ok: false,
      },
      {
        type: "attempt_started",
        taskId: "T-001",
        stepId: "implement",
        attempt: 2,
        maxAttempts: 4,
      },
    );
    expect(findStep(state, "T-001", "implement").checks).toEqual([]);
    expect(findStep(state, "T-001", "implement").attempt).toBe(2);
  });

  it("ignores step-scoped events before the step is started", () => {
    const state = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
      {
        type: "check_finished",
        taskId: "T-001",
        stepId: "implement",
        name: "test",
        ok: true,
      },
    );
    expect(findTask(state, "T-001").steps).toEqual([]);
  });

  it("sets step status and reason on step_finished and clears currentStepId", () => {
    const state = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
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
        reason: "AUDIT: FAIL: faltam testes",
      },
    );
    const step = findStep(state, "T-001", "audit");
    expect(step.status).toBe("failed");
    expect(step.reason).toBe("AUDIT: FAIL: faltam testes");
    expect(findTask(state, "T-001").currentStepId).toBeUndefined();
  });

  it("marks a task done / escalated with an optional reason", () => {
    const done = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
      { type: "task_finished", taskId: "T-001", status: "done" },
    );
    expect(findTask(done, "T-001").status).toBe("done");

    const escalated = play(
      { type: "task_registered", taskId: "T-002", title: "t" },
      {
        type: "task_finished",
        taskId: "T-002",
        status: "escalated",
        reason: "checks falharam 4x",
      },
    );
    expect(findTask(escalated, "T-002").status).toBe("escalated");
    expect(findTask(escalated, "T-002").reason).toBe("checks falharam 4x");
  });
});

// ---------------------------------------------------------------------------
// reduce — per-check status
// ---------------------------------------------------------------------------

describe("reduce · per-check status", () => {
  it("tracks each check independently as running → passed / failed", () => {
    const state = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
      {
        type: "step_started",
        taskId: "T-001",
        stepId: "implement",
        stepType: "agent",
      },
      {
        type: "check_started",
        taskId: "T-001",
        stepId: "implement",
        name: "typecheck",
      },
      {
        type: "check_started",
        taskId: "T-001",
        stepId: "implement",
        name: "test",
      },
      {
        type: "check_finished",
        taskId: "T-001",
        stepId: "implement",
        name: "typecheck",
        ok: true,
      },
      {
        type: "check_finished",
        taskId: "T-001",
        stepId: "implement",
        name: "test",
        ok: false,
      },
    );
    const checks = findStep(state, "T-001", "implement").checks;
    expect(checks).toEqual([
      { name: "typecheck", status: "passed" },
      { name: "test", status: "failed" },
    ]);
  });

  it("upserts a check reported without a prior check_started", () => {
    const state = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
      {
        type: "step_started",
        taskId: "T-001",
        stepId: "checks",
        stepType: "checks",
      },
      {
        type: "check_finished",
        taskId: "T-001",
        stepId: "checks",
        name: "lint",
        ok: true,
      },
    );
    expect(findStep(state, "T-001", "checks").checks).toEqual([
      { name: "lint", status: "passed" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// reduce — stream chunks
// ---------------------------------------------------------------------------

describe("reduce · agent stream", () => {
  it("accumulates stream chunks per task", () => {
    const state = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
      { type: "stream_chunk", taskId: "T-001", text: "Hello " },
      { type: "stream_chunk", taskId: "T-001", text: "world" },
    );
    expect(findTask(state, "T-001").stream).toBe("Hello world");
  });

  it("resets the stream when a new attempt starts (a fresh turn)", () => {
    const state = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
      {
        type: "step_started",
        taskId: "T-001",
        stepId: "implement",
        stepType: "agent",
      },
      { type: "stream_chunk", taskId: "T-001", text: "primeira tentativa" },
      {
        type: "attempt_started",
        taskId: "T-001",
        stepId: "implement",
        attempt: 2,
        maxAttempts: 4,
      },
      { type: "stream_chunk", taskId: "T-001", text: "segunda" },
    );
    expect(findTask(state, "T-001").stream).toBe("segunda");
  });
});

// ---------------------------------------------------------------------------
// Parallel-ready — no singleton "current task"
// ---------------------------------------------------------------------------

describe("reduce · parallel-ready (no singleton current task)", () => {
  it("advances two tasks independently and keyed by id", () => {
    const state = play(
      { type: "task_registered", taskId: "T-001", title: "um" },
      { type: "task_registered", taskId: "T-002", title: "dois" },
      { type: "task_started", taskId: "T-001" },
      { type: "task_started", taskId: "T-002" },
      {
        type: "step_started",
        taskId: "T-001",
        stepId: "implement",
        stepType: "agent",
      },
      {
        type: "step_started",
        taskId: "T-002",
        stepId: "audit",
        stepType: "agent",
      },
      { type: "stream_chunk", taskId: "T-001", text: "código" },
      { type: "stream_chunk", taskId: "T-002", text: "revisão" },
    );

    expect(findTask(state, "T-001").currentStepId).toBe("implement");
    expect(findTask(state, "T-002").currentStepId).toBe("audit");
    expect(findTask(state, "T-001").stream).toBe("código");
    expect(findTask(state, "T-002").stream).toBe("revisão");
  });
});

// ---------------------------------------------------------------------------
// createStore — observable wrapper
// ---------------------------------------------------------------------------

describe("createStore", () => {
  it("exposes an empty initial state", () => {
    expect(createStore().getState().tasks).toEqual([]);
  });

  it("notifies subscribers with the new state on a changing dispatch", () => {
    const store = createStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.dispatch({ type: "task_registered", taskId: "T-001", title: "t" });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toBe(store.getState());
    expect(store.getState().tasks).toHaveLength(1);
  });

  it("does not notify when a dispatch leaves the state unchanged", () => {
    const store = createStore();
    const listener = vi.fn();
    store.subscribe(listener);

    // No task registered → step-scoped event is a no-op.
    store.dispatch({ type: "task_started", taskId: "T-404" });

    expect(listener).not.toHaveBeenCalled();
  });

  it("stops notifying after unsubscribe", () => {
    const store = createStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.dispatch({ type: "task_registered", taskId: "T-001", title: "t" });
    unsubscribe();
    store.dispatch({ type: "task_registered", taskId: "T-002", title: "t" });

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
