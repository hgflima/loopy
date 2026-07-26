import { describe, expect, it, vi } from "vitest";
import {
  ACP_LOG_CAP,
  WARNINGS_CAP,
  blockedTasks,
  createStore,
  initialState,
  mergeToolCall,
  readyTasks,
  reduce,
  runningTasks,
  skippedTasks,
  toStoreEvent,
  type StoreEvent,
  type StoreState,
  type TaskState,
  type ToolCallDelta,
  type ToolCallState,
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
    expect(findTask(state, "T-001").status).toBe("ready");
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
    // Snapshot fields that round-trip through JSON; Set is checked separately.
    const snapshot = JSON.parse(JSON.stringify(before));
    const agentsBefore = new Set(before.activeAgents);

    const after = reduce(before, { type: "task_started", taskId: "T-001" });

    expect(after).not.toBe(before);
    // Structural fields unchanged.
    expect(JSON.parse(JSON.stringify(before))).toEqual(snapshot);
    // Set unchanged.
    expect(before.activeAgents).toEqual(agentsBefore);
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

  it("stores description and deps when provided (C-0010 T-003)", () => {
    const state = play({
      type: "task_registered",
      taskId: "T-001",
      title: "Com desc",
      description: "Files: foo.ts",
      deps: ["T-000"],
    });
    const task = findTask(state, "T-001");
    expect(task.description).toBe("Files: foo.ts");
    expect(task.deps).toEqual(["T-000"]);
  });

  it("omits description and deps when not provided (backward compat)", () => {
    const state = play({
      type: "task_registered",
      taskId: "T-001",
      title: "Sem desc",
    });
    const task = findTask(state, "T-001");
    expect(task.description).toBeUndefined();
    expect(task.deps).toBeUndefined();
  });

  it("duplicate registration preserves original description/deps", () => {
    const once = play({
      type: "task_registered",
      taskId: "T-001",
      title: "t",
      description: "body",
      deps: ["T-000"],
    });
    const twice = reduce(once, {
      type: "task_registered",
      taskId: "T-001",
      title: "t",
      description: "changed",
      deps: ["T-999"],
    });
    expect(twice).toBe(once);
    expect(findTask(twice, "T-001").description).toBe("body");
    expect(findTask(twice, "T-001").deps).toEqual(["T-000"]);
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

  it("carries agentName and model in step_started for agent steps", () => {
    const state = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
      {
        type: "step_started",
        taskId: "T-001",
        stepId: "implement",
        stepType: "agent",
        agentName: "Claude",
        model: "sonnet",
      },
    );
    const step = findStep(state, "T-001", "implement");
    expect(step.agentName).toBe("Claude");
    expect(step.model).toBe("sonnet");
  });

  it("omits agentName and model when absent in step_started (non-agent steps)", () => {
    const state = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
      {
        type: "step_started",
        taskId: "T-001",
        stepId: "run-checks",
        stepType: "checks",
      },
    );
    const step = findStep(state, "T-001", "run-checks");
    expect(step.agentName).toBeUndefined();
    expect(step.model).toBeUndefined();
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

  // `lastStepId` is the *entered* pointer: it outlives `step_finished` so a
  // consumer can still place a task that sits between two steps (the Kanban
  // grouper does). Not derivable from `steps` — that array is ordered by first
  // visit, so after a Desvio its tail is the step the goto left behind.
  it("remembers the last entered step across step_finished", () => {
    const state = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
      {
        type: "step_started",
        taskId: "T-001",
        stepId: "build",
        stepType: "shell",
      },
      { type: "step_finished", taskId: "T-001", stepId: "build", ok: true },
    );
    const task = findTask(state, "T-001");
    expect(task.currentStepId).toBeUndefined();
    expect(task.lastStepId).toBe("build");
  });

  it("moves lastStepId back to the goto target on a Desvio", () => {
    const state = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
      {
        type: "step_started",
        taskId: "T-001",
        stepId: "build",
        stepType: "shell",
      },
      { type: "step_finished", taskId: "T-001", stepId: "build", ok: true },
      {
        type: "step_started",
        taskId: "T-001",
        stepId: "test",
        stepType: "checks",
      },
      { type: "step_finished", taskId: "T-001", stepId: "test", ok: false },
      // Desvio back to an earlier step: it is a revisit, so `steps` still ends
      // at "test" while the task is really at "build".
      {
        type: "step_started",
        taskId: "T-001",
        stepId: "build",
        stepType: "shell",
      },
    );
    const task = findTask(state, "T-001");
    expect(task.lastStepId).toBe("build");
    expect(task.steps.map((s) => s.id)).toEqual(["build", "test"]);
  });

  it("is undefined before the first step starts", () => {
    const state = play({
      type: "task_registered",
      taskId: "T-001",
      title: "t",
    });
    expect(findTask(state, "T-001").lastStepId).toBeUndefined();
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

// ---------------------------------------------------------------------------
// reduce — edges_set
// ---------------------------------------------------------------------------

describe("reduce · edges_set", () => {
  it("sets edges on the state", () => {
    const state = reduce(initialState(), {
      type: "edges_set",
      edges: [["T-001", "T-002"]],
    });
    expect(state.edges).toEqual([["T-001", "T-002"]]);
  });

  it("replaces previous edges", () => {
    let state = reduce(initialState(), {
      type: "edges_set",
      edges: [["T-001", "T-002"]],
    });
    state = reduce(state, {
      type: "edges_set",
      edges: [
        ["T-001", "T-003"],
        ["T-002", "T-003"],
      ],
    });
    expect(state.edges).toEqual([
      ["T-001", "T-003"],
      ["T-002", "T-003"],
    ]);
  });

  it("preserves tasks when setting edges", () => {
    let state = play({
      type: "task_registered",
      taskId: "T-001",
      title: "t",
    });
    state = reduce(state, {
      type: "edges_set",
      edges: [["T-001", "T-002"]],
    });
    expect(state.tasks).toHaveLength(1);
    expect(findTask(state, "T-001").title).toBe("t");
  });
});

// ---------------------------------------------------------------------------
// reduce — new task statuses (blocked / skipped / paused)
// ---------------------------------------------------------------------------

describe("reduce · new task statuses", () => {
  it("registers a task as blocked when status is provided", () => {
    const state = play({
      type: "task_registered",
      taskId: "T-002",
      title: "depende de T-001",
      status: "blocked",
    });
    expect(findTask(state, "T-002").status).toBe("blocked");
  });

  it("defaults to pending when status is omitted", () => {
    const state = play({
      type: "task_registered",
      taskId: "T-001",
      title: "raiz",
    });
    expect(findTask(state, "T-001").status).toBe("ready");
  });

  it("marks a task as skipped via task_finished", () => {
    const state = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
      {
        type: "task_finished",
        taskId: "T-001",
        status: "skipped",
        reason: "ancestor T-000 failed",
      },
    );
    expect(findTask(state, "T-001").status).toBe("skipped");
    expect(findTask(state, "T-001").reason).toBe("ancestor T-000 failed");
  });

  it("marks a task as paused via task_finished", () => {
    const state = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
      { type: "task_started", taskId: "T-001" },
      {
        type: "task_finished",
        taskId: "T-001",
        status: "paused",
        reason: "escalation: pause",
      },
    );
    expect(findTask(state, "T-001").status).toBe("paused");
    expect(findTask(state, "T-001").reason).toBe("escalation: pause");
  });
});

// ---------------------------------------------------------------------------
// Derived selectors (AD-6 — pure functions)
// ---------------------------------------------------------------------------

describe("derived selectors", () => {
  function dagState(): StoreState {
    // DAG: T-001 → T-003, T-002 → T-003 (T-003 depends on both)
    let state = initialState();
    state = reduce(state, {
      type: "edges_set",
      edges: [
        ["T-001", "T-003"],
        ["T-002", "T-003"],
      ],
    });
    state = reduce(state, {
      type: "task_registered",
      taskId: "T-001",
      title: "raiz A",
    });
    state = reduce(state, {
      type: "task_registered",
      taskId: "T-002",
      title: "raiz B",
    });
    state = reduce(state, {
      type: "task_registered",
      taskId: "T-003",
      title: "depende de A e B",
      status: "blocked",
    });
    return state;
  }

  it("readyTasks returns pending tasks (roots without deps)", () => {
    const state = dagState();
    const ready = readyTasks(state);
    expect(ready.map((t) => t.id)).toEqual(["T-001", "T-002"]);
  });

  it("readyTasks excludes blocked tasks with unmet deps", () => {
    const state = dagState();
    const ready = readyTasks(state);
    expect(ready.find((t) => t.id === "T-003")).toBeUndefined();
  });

  it("readyTasks includes blocked task when all deps are done", () => {
    let state = dagState();
    state = reduce(state, { type: "task_started", taskId: "T-001" });
    state = reduce(state, {
      type: "task_finished",
      taskId: "T-001",
      status: "done",
    });
    state = reduce(state, { type: "task_started", taskId: "T-002" });
    state = reduce(state, {
      type: "task_finished",
      taskId: "T-002",
      status: "done",
    });
    const ready = readyTasks(state);
    expect(ready.map((t) => t.id)).toEqual(["T-003"]);
  });

  it("readyTasks excludes blocked task when only some deps are done", () => {
    let state = dagState();
    state = reduce(state, { type: "task_started", taskId: "T-001" });
    state = reduce(state, {
      type: "task_finished",
      taskId: "T-001",
      status: "done",
    });
    // T-002 still pending (not done)
    const ready = readyTasks(state);
    expect(ready.map((t) => t.id)).toContain("T-002");
    expect(ready.find((t) => t.id === "T-003")).toBeUndefined();
  });

  it("runningTasks returns only running tasks", () => {
    let state = dagState();
    state = reduce(state, { type: "task_started", taskId: "T-001" });
    expect(runningTasks(state).map((t) => t.id)).toEqual(["T-001"]);
  });

  it("blockedTasks returns only blocked tasks", () => {
    const state = dagState();
    expect(blockedTasks(state).map((t) => t.id)).toEqual(["T-003"]);
  });

  it("skippedTasks returns only skipped tasks", () => {
    let state = dagState();
    state = reduce(state, {
      type: "task_finished",
      taskId: "T-003",
      status: "skipped",
      reason: "ancestor failed",
    });
    expect(skippedTasks(state).map((t) => t.id)).toEqual(["T-003"]);
  });
});

// ---------------------------------------------------------------------------
// Concurrency safety — concurrent events do not corrupt the store
// ---------------------------------------------------------------------------

describe("concurrency safety", () => {
  it("interleaved events from parallel tasks do not corrupt state", () => {
    const store = createStore();

    // Set up DAG edges
    store.dispatch({
      type: "edges_set",
      edges: [["T-001", "T-003"]],
    });

    // Register 3 tasks, T-003 blocked on T-001
    store.dispatch({
      type: "task_registered",
      taskId: "T-001",
      title: "raiz",
    });
    store.dispatch({
      type: "task_registered",
      taskId: "T-002",
      title: "independente",
    });
    store.dispatch({
      type: "task_registered",
      taskId: "T-003",
      title: "dependente",
      status: "blocked",
    });

    // T-001 and T-002 start in parallel
    store.dispatch({ type: "task_started", taskId: "T-001" });
    store.dispatch({ type: "task_started", taskId: "T-002" });

    // Interleaved step events
    store.dispatch({
      type: "step_started",
      taskId: "T-001",
      stepId: "implement",
      stepType: "agent",
    });
    store.dispatch({
      type: "step_started",
      taskId: "T-002",
      stepId: "implement",
      stepType: "agent",
    });
    store.dispatch({
      type: "stream_chunk",
      taskId: "T-001",
      text: "código A",
    });
    store.dispatch({
      type: "stream_chunk",
      taskId: "T-002",
      text: "código B",
    });

    // Verify isolation
    const state = store.getState();
    expect(findTask(state, "T-001").stream).toBe("código A");
    expect(findTask(state, "T-002").stream).toBe("código B");
    expect(findTask(state, "T-003").status).toBe("blocked");

    // T-001 finishes → T-003 becomes ready
    store.dispatch({
      type: "step_finished",
      taskId: "T-001",
      stepId: "implement",
      ok: true,
    });
    store.dispatch({
      type: "task_finished",
      taskId: "T-001",
      status: "done",
    });

    const afterDone = store.getState();
    const ready = readyTasks(afterDone);
    expect(ready.map((t) => t.id)).toContain("T-003");

    // Edges are preserved throughout
    expect(afterDone.edges).toEqual([["T-001", "T-003"]]);
  });

  it("edges are preserved across all event types", () => {
    const edges: [string, string][] = [["T-001", "T-002"]];
    let state = reduce(initialState(), { type: "edges_set", edges });

    state = reduce(state, {
      type: "task_registered",
      taskId: "T-001",
      title: "a",
    });
    state = reduce(state, { type: "task_started", taskId: "T-001" });
    state = reduce(state, {
      type: "step_started",
      taskId: "T-001",
      stepId: "s",
      stepType: "shell",
    });
    state = reduce(state, {
      type: "stream_chunk",
      taskId: "T-001",
      text: "x",
    });
    state = reduce(state, {
      type: "step_finished",
      taskId: "T-001",
      stepId: "s",
      ok: true,
    });
    state = reduce(state, {
      type: "task_finished",
      taskId: "T-001",
      status: "done",
    });

    // edges survive through all mutations
    expect(state.edges).toEqual(edges);
  });
});

// ---------------------------------------------------------------------------
// reduce — acp_traffic (global ring bounded log)
// ---------------------------------------------------------------------------

describe("reduce · acp_traffic", () => {
  it("appends a line to acpLog with taskId, direction, method and summary", () => {
    const state = reduce(initialState(), {
      type: "acp_traffic",
      taskId: "T-001",
      direction: "send",
      method: "conversation/sendMessage",
      summary: "implementar feature X",
    });
    expect(state.acpLog).toHaveLength(1);
    expect(state.acpLog[0]).toEqual({
      taskId: "T-001",
      direction: "send",
      method: "conversation/sendMessage",
      summary: "implementar feature X",
    });
  });

  it("appends without method when omitted", () => {
    const state = reduce(initialState(), {
      type: "acp_traffic",
      taskId: "T-001",
      direction: "recv",
      summary: "resposta do agente",
    });
    expect(state.acpLog[0]?.method).toBeUndefined();
    expect(state.acpLog[0]?.direction).toBe("recv");
  });

  it("truncates to ACP_LOG_CAP when exceeding the bound", () => {
    let state = initialState();
    for (let i = 0; i < ACP_LOG_CAP + 50; i++) {
      state = reduce(state, {
        type: "acp_traffic",
        taskId: "T-001",
        direction: "send",
        summary: `msg-${i}`,
      });
    }
    expect(state.acpLog).toHaveLength(ACP_LOG_CAP);
    // Oldest entries were dropped; the first entry is msg-50.
    expect(state.acpLog[0]?.summary).toBe("msg-50");
    expect(state.acpLog[ACP_LOG_CAP - 1]?.summary).toBe(
      `msg-${ACP_LOG_CAP + 49}`,
    );
  });

  it("does not exceed the cap even at exactly cap+1", () => {
    let state = initialState();
    for (let i = 0; i <= ACP_LOG_CAP; i++) {
      state = reduce(state, {
        type: "acp_traffic",
        taskId: "T-001",
        direction: "recv",
        summary: `m-${i}`,
      });
    }
    expect(state.acpLog).toHaveLength(ACP_LOG_CAP);
    expect(state.acpLog[0]?.summary).toBe("m-1");
  });

  it("is global — does not require a registered task (bypasses updateTask)", () => {
    // No task_registered event; the log still accepts the entry.
    const state = reduce(initialState(), {
      type: "acp_traffic",
      taskId: "T-UNKNOWN",
      direction: "send",
      summary: "ping",
    });
    expect(state.acpLog).toHaveLength(1);
  });

  it("interleaves entries from concurrent tasks without corruption", () => {
    const state = play(
      {
        type: "acp_traffic",
        taskId: "T-001",
        direction: "send",
        summary: "A send",
      },
      {
        type: "acp_traffic",
        taskId: "T-002",
        direction: "recv",
        summary: "B recv",
      },
      {
        type: "acp_traffic",
        taskId: "T-001",
        direction: "recv",
        summary: "A recv",
      },
    );
    expect(state.acpLog).toHaveLength(3);
    expect(state.acpLog.map((l) => l.taskId)).toEqual([
      "T-001",
      "T-002",
      "T-001",
    ]);
  });

  it("does not affect tasks, edges, or other state fields", () => {
    let state = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
      { type: "edges_set", edges: [["T-001", "T-002"]] },
    );
    const tasksBefore = state.tasks;
    const edgesBefore = state.edges;
    state = reduce(state, {
      type: "acp_traffic",
      taskId: "T-001",
      direction: "send",
      summary: "x",
    });
    expect(state.tasks).toBe(tasksBefore);
    expect(state.edges).toBe(edgesBefore);
  });

  it("collapses consecutive identical entries into one line with a count", () => {
    const evt = {
      type: "acp_traffic" as const,
      taskId: "T-001",
      direction: "recv" as const,
      method: "session/update",
      summary: "agent_message_chunk",
    };
    const state = play(evt, evt, evt);
    // Three identical events → a single line carrying ×3, not three rows.
    expect(state.acpLog).toHaveLength(1);
    expect(state.acpLog[0]?.count).toBe(3);
    expect(state.acpLog[0]?.summary).toBe("agent_message_chunk");
  });

  it("does not collapse when any field differs (summary/method/direction/taskId)", () => {
    const base = {
      type: "acp_traffic" as const,
      taskId: "T-001",
      direction: "recv" as const,
      method: "session/update",
      summary: "agent_message_chunk",
    };
    const state = play(
      base,
      { ...base, summary: "tool_call" }, // different sub-kind → new line
      { ...base, summary: "tool_call" }, // identical to previous → collapses
    );
    expect(state.acpLog).toHaveLength(2);
    expect(state.acpLog[0]?.count).toBeUndefined();
    expect(state.acpLog[1]?.summary).toBe("tool_call");
    expect(state.acpLog[1]?.count).toBe(2);
  });

  it("leaves count unset for a lone entry (backward-compatible shape)", () => {
    const state = reduce(initialState(), {
      type: "acp_traffic",
      taskId: "T-001",
      direction: "send",
      summary: "solo",
    });
    expect(state.acpLog[0]?.count).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// reduce — agent tracking (T-008: prefixing by agent when >1)
// ---------------------------------------------------------------------------

describe("reduce · agent tracking (T-008)", () => {
  it("initialState has an empty activeAgents set", () => {
    const state = initialState();
    expect(state.activeAgents).toBeInstanceOf(Set);
    expect(state.activeAgents.size).toBe(0);
  });

  it("stream_chunk with agent populates activeAgents", () => {
    const state = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
      { type: "stream_chunk", taskId: "T-001", text: "hi", agent: "claude" },
    );
    expect(state.activeAgents.has("claude")).toBe(true);
    expect(state.activeAgents.size).toBe(1);
  });

  it("acp_traffic with agent populates activeAgents", () => {
    const state = play({
      type: "acp_traffic",
      taskId: "T-001",
      direction: "send",
      summary: "msg",
      agent: "codex",
    });
    expect(state.activeAgents.has("codex")).toBe(true);
  });

  it("tracks multiple distinct agents", () => {
    const state = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
      { type: "stream_chunk", taskId: "T-001", text: "a", agent: "claude" },
      { type: "stream_chunk", taskId: "T-001", text: "b", agent: "codex" },
    );
    expect(state.activeAgents.size).toBe(2);
    expect(state.activeAgents.has("claude")).toBe(true);
    expect(state.activeAgents.has("codex")).toBe(true);
  });

  it("does not grow activeAgents for duplicate agent names", () => {
    const state = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
      { type: "stream_chunk", taskId: "T-001", text: "a", agent: "claude" },
      { type: "stream_chunk", taskId: "T-001", text: "b", agent: "claude" },
    );
    expect(state.activeAgents.size).toBe(1);
  });

  it("stream_chunk without agent does not affect activeAgents (backward compat)", () => {
    const state = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
      { type: "stream_chunk", taskId: "T-001", text: "hi" },
    );
    expect(state.activeAgents.size).toBe(0);
  });

  it("stores streamAgent on TaskState from stream_chunk", () => {
    const state = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
      { type: "stream_chunk", taskId: "T-001", text: "x", agent: "codex" },
    );
    expect(findTask(state, "T-001").streamAgent).toBe("codex");
  });

  it("streamAgent is undefined when no agent in stream_chunk (backward compat)", () => {
    const state = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
      { type: "stream_chunk", taskId: "T-001", text: "x" },
    );
    expect(findTask(state, "T-001").streamAgent).toBeUndefined();
  });

  it("acp_traffic with agent stores agent on AcpLogLine", () => {
    const state = play({
      type: "acp_traffic",
      taskId: "T-001",
      direction: "send",
      summary: "msg",
      agent: "codex",
    });
    expect(state.acpLog[0]?.agent).toBe("codex");
  });

  it("acp_traffic without agent has no agent on AcpLogLine (backward compat)", () => {
    const state = play({
      type: "acp_traffic",
      taskId: "T-001",
      direction: "send",
      summary: "msg",
    });
    expect(state.acpLog[0]?.agent).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// reduce — usage_sample (T-007: live context-window occupancy)
// ---------------------------------------------------------------------------

describe("reduce · usage_sample", () => {
  it("stores used and size on the target step (last sample wins)", () => {
    const state = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
      {
        type: "step_started",
        taskId: "T-001",
        stepId: "implement",
        stepType: "agent",
      },
      {
        type: "usage_sample",
        taskId: "T-001",
        stepId: "implement",
        used: 50000,
        size: 200000,
      },
    );
    const step = findStep(state, "T-001", "implement");
    expect(step.used).toBe(50000);
    expect(step.size).toBe(200000);
  });

  it("overwrites previous sample (last sample, not peak or sum)", () => {
    const state = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
      {
        type: "step_started",
        taskId: "T-001",
        stepId: "implement",
        stepType: "agent",
      },
      {
        type: "usage_sample",
        taskId: "T-001",
        stepId: "implement",
        used: 50000,
        size: 200000,
      },
      {
        type: "usage_sample",
        taskId: "T-001",
        stepId: "implement",
        used: 80000,
        size: 200000,
      },
    );
    const step = findStep(state, "T-001", "implement");
    expect(step.used).toBe(80000);
    expect(step.size).toBe(200000);
  });

  it("is a no-op when the step has not been started yet", () => {
    const state = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
      {
        type: "usage_sample",
        taskId: "T-001",
        stepId: "implement",
        used: 50000,
        size: 200000,
      },
    );
    expect(findTask(state, "T-001").steps).toEqual([]);
  });

  it("is a no-op for an unregistered task", () => {
    const before = initialState();
    const after = reduce(before, {
      type: "usage_sample",
      taskId: "T-404",
      stepId: "implement",
      used: 50000,
      size: 200000,
    });
    expect(after).toBe(before);
  });

  it("does not affect other step fields", () => {
    const state = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
      {
        type: "step_started",
        taskId: "T-001",
        stepId: "implement",
        stepType: "agent",
        agentName: "Claude",
        model: "sonnet",
      },
      {
        type: "usage_sample",
        taskId: "T-001",
        stepId: "implement",
        used: 50000,
        size: 200000,
      },
    );
    const step = findStep(state, "T-001", "implement");
    expect(step.status).toBe("running");
    expect(step.agentName).toBe("Claude");
    expect(step.model).toBe("sonnet");
    expect(step.type).toBe("agent");
  });
});

// ---------------------------------------------------------------------------
// reduce — pipeline_declared
// ---------------------------------------------------------------------------

describe("reduce · pipeline_declared", () => {
  it("stores the pipeline steps in declaration order", () => {
    const steps = [
      { id: "implement", type: "agent" as const },
      { id: "lint", type: "checks" as const },
      { id: "deploy", type: "shell" as const },
    ];
    const state = play({ type: "pipeline_declared", steps });
    expect(state.pipeline).toEqual(steps);
  });

  it("is idempotent — emitting the same pipeline twice yields the same list", () => {
    const steps = [
      { id: "implement", type: "agent" as const },
      { id: "ci", type: "checks" as const },
    ];
    const once = play({ type: "pipeline_declared", steps });
    const twice = reduce(once, { type: "pipeline_declared", steps });
    expect(twice.pipeline).toEqual(steps);
  });

  it("does not affect tasks, edges, or acpLog", () => {
    let state = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
      { type: "edges_set", edges: [["T-001", "T-002"]] },
    );
    const tasksBefore = state.tasks;
    const edgesBefore = state.edges;
    const acpLogBefore = state.acpLog;
    state = reduce(state, {
      type: "pipeline_declared",
      steps: [{ id: "s", type: "shell" as const }],
    });
    expect(state.tasks).toBe(tasksBefore);
    expect(state.edges).toBe(edgesBefore);
    expect(state.acpLog).toBe(acpLogBefore);
  });
});

// ---------------------------------------------------------------------------
// initialState includes edges, acpLog, and pipeline
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// reduce — warning (14th event type, T-007)
// ---------------------------------------------------------------------------

describe("reduce · warning", () => {
  it("accumulates warnings in state.warnings", () => {
    const state = play({ type: "warning", message: "capability not supported" });
    expect(state.warnings).toHaveLength(1);
    expect(state.warnings[0]).toEqual({ message: "capability not supported" });
  });

  it("carries optional taskId, stepId and agentName", () => {
    const state = play({
      type: "warning",
      taskId: "T-001",
      stepId: "implement",
      agentName: "Claude",
      message: "effort not supported",
    });
    expect(state.warnings[0]).toEqual({
      taskId: "T-001",
      stepId: "implement",
      agentName: "Claude",
      message: "effort not supported",
    });
  });

  it("deduplicates consecutive identical messages", () => {
    const state = play(
      { type: "warning", message: "same warning" },
      { type: "warning", message: "same warning" },
    );
    expect(state.warnings).toHaveLength(1);
  });

  it("does not dedup non-consecutive identical messages", () => {
    const state = play(
      { type: "warning", message: "first" },
      { type: "warning", message: "different" },
      { type: "warning", message: "first" },
    );
    expect(state.warnings).toHaveLength(3);
  });

  it("caps at WARNINGS_CAP entries", () => {
    const events: StoreEvent[] = Array.from(
      { length: WARNINGS_CAP + 10 },
      (_, i) => ({ type: "warning" as const, message: `w-${i}` }),
    );
    const state = play(...events);
    expect(state.warnings).toHaveLength(WARNINGS_CAP);
    expect(state.warnings[0]?.message).toBe("w-10");
    expect(state.warnings[WARNINGS_CAP - 1]?.message).toBe(
      `w-${WARNINGS_CAP + 9}`,
    );
  });

  it("marks step.warned when taskId and stepId target a known step", () => {
    const state = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
      {
        type: "step_started",
        taskId: "T-001",
        stepId: "implement",
        stepType: "agent",
      },
      {
        type: "warning",
        taskId: "T-001",
        stepId: "implement",
        message: "effort not supported",
      },
    );
    expect(findStep(state, "T-001", "implement").warned).toBe(true);
  });

  it("does not break without taskId (pre-task global warning)", () => {
    const state = play({ type: "warning", message: "global warning" });
    expect(state.warnings).toHaveLength(1);
    expect(state.warnings[0]?.message).toBe("global warning");
  });

  it("does not affect other state fields", () => {
    let state = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
      { type: "edges_set", edges: [["T-001", "T-002"]] },
    );
    const tasksBefore = state.tasks;
    const edgesBefore = state.edges;
    state = reduce(state, { type: "warning", message: "test" });
    expect(state.tasks).toBe(tasksBefore);
    expect(state.edges).toBe(edgesBefore);
  });
});

// ---------------------------------------------------------------------------
// initialState includes edges, acpLog, pipeline, and warnings
// ---------------------------------------------------------------------------

describe("initialState", () => {
  it("includes an empty edges array", () => {
    expect(initialState().edges).toEqual([]);
  });

  it("includes an empty acpLog array", () => {
    expect(initialState().acpLog).toEqual([]);
  });

  it("includes an empty pipeline array", () => {
    expect(initialState().pipeline).toEqual([]);
  });

  it("includes an empty warnings array", () => {
    expect(initialState().warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// mergeToolCall — the pure shared merge (C-0019 R2)
// ---------------------------------------------------------------------------

describe("mergeToolCall (R2 — pure shared merge)", () => {
  const card: ToolCallState = {
    toolCallId: "tc-1",
    title: "Ler src/index.ts",
    kind: "read",
    status: "in_progress",
    locations: [{ path: "src/index.ts", line: 42 }],
    content: [{ kind: "text", text: "conteúdo" }],
  };

  it("builds a default card when current is undefined", () => {
    const call = mergeToolCall(undefined, { toolCallId: "tc-1" });
    expect(call).toEqual({
      toolCallId: "tc-1",
      title: "tc-1",
      kind: "other",
      status: "pending",
      locations: [],
      content: [],
    });
  });

  it("uses delta.title for the default card title when present", () => {
    const call = mergeToolCall(undefined, {
      toolCallId: "tc-1",
      title: "Buscar",
    });
    expect(call.title).toBe("Buscar");
  });

  it("preserves the prior value for a field absent (undefined) in the delta", () => {
    const merged = mergeToolCall(card, {
      toolCallId: "tc-1",
      status: "completed",
    });
    expect(merged.title).toBe("Ler src/index.ts");
    expect(merged.kind).toBe("read");
    expect(merged.status).toBe("completed");
    expect(merged.locations).toEqual([{ path: "src/index.ts", line: 42 }]);
    expect(merged.content).toEqual([{ kind: "text", text: "conteúdo" }]);
  });

  it("treats null in the delta as 'do not touch' — never erases", () => {
    // The wire (translated from the SDK's optional-nullable ToolCallUpdate) can
    // carry explicit null; it must mean "unchanged", not "clear".
    const merged = mergeToolCall(card, {
      toolCallId: "tc-1",
      title: null,
      kind: null,
      status: null,
      locations: null,
      content: null,
    });
    expect(merged.title).toBe("Ler src/index.ts");
    expect(merged.kind).toBe("read");
    expect(merged.status).toBe("in_progress");
    expect(merged.locations).toEqual([{ path: "src/index.ts", line: 42 }]);
    expect(merged.content).toEqual([{ kind: "text", text: "conteúdo" }]);
  });

  it("replaces content and locations (does not concatenate) when present", () => {
    const merged = mergeToolCall(card, {
      toolCallId: "tc-1",
      locations: [{ path: "novo.ts" }],
      content: [{ kind: "diff", path: "novo.ts", oldText: "a", newText: "b" }],
    });
    expect(merged.locations).toEqual([{ path: "novo.ts" }]);
    expect(merged.content).toEqual([
      { kind: "diff", path: "novo.ts", oldText: "a", newText: "b" },
    ]);
  });

  it("adopts a kind that only arrives in a later update", () => {
    const opened = mergeToolCall(undefined, { toolCallId: "tc-1" });
    expect(opened.kind).toBe("other");
    const merged = mergeToolCall(opened, {
      toolCallId: "tc-1",
      kind: "execute",
    });
    expect(merged.kind).toBe("execute");
  });

  it("carries rawInput/rawOutput and preserves each when the other updates", () => {
    const withInput = mergeToolCall(undefined, {
      toolCallId: "tc-1",
      rawInput: { path: "a.ts" },
    });
    expect(withInput.rawInput).toEqual({ path: "a.ts" });
    expect("rawOutput" in withInput).toBe(false);

    const withOutput = mergeToolCall(withInput, {
      toolCallId: "tc-1",
      rawOutput: "done",
    });
    expect(withOutput.rawInput).toEqual({ path: "a.ts" });
    expect(withOutput.rawOutput).toBe("done");
  });

  it("is pure — deterministic output and never mutates current", () => {
    const snapshot = JSON.parse(JSON.stringify(card));
    const delta: ToolCallDelta = { toolCallId: "tc-1", status: "completed" };
    const a = mergeToolCall(card, delta);
    const b = mergeToolCall(card, delta);
    expect(a).toEqual(b);
    expect(a).not.toBe(card);
    // current untouched.
    expect(JSON.parse(JSON.stringify(card))).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// toStoreEvent — the pure StreamUpdate → StoreEvent stamp (C-0019)
// ---------------------------------------------------------------------------

describe("toStoreEvent (pure onUpdate stamp)", () => {
  const ctxWithStep = { taskId: "T-001", stepId: "implement", agent: "claude" };
  const ctxWithoutStep = { taskId: "T-001", agent: "claude" };

  it("text → stream_chunk carrying stepId, messageId and agent (R3)", () => {
    const ev = toStoreEvent(
      { kind: "text", text: "olá", messageId: "m1" },
      ctxWithStep,
    );
    expect(ev).toEqual({
      type: "stream_chunk",
      taskId: "T-001",
      text: "olá",
      agent: "claude",
      stepId: "implement",
      messageId: "m1",
    });
  });

  it("thought → thought_chunk with messageId and agent, never stepId", () => {
    // A Step-bearing context (the normal Run scope) must NOT leak stepId onto a
    // variant whose StoreEvent contract does not declare it (R7a).
    const ev = toStoreEvent(
      { kind: "thought", text: "hmm", messageId: "m2" },
      ctxWithStep,
    );
    expect(ev).toEqual({
      type: "thought_chunk",
      taskId: "T-001",
      text: "hmm",
      agent: "claude",
      messageId: "m2",
    });
    expect(ev).not.toHaveProperty("stepId");
  });

  it("tool_call → tool_call event carrying the Step (R7a)", () => {
    const call: ToolCallState = {
      toolCallId: "tc-1",
      title: "t",
      kind: "read",
      status: "pending",
      locations: [],
      content: [],
    };
    const ev = toStoreEvent({ kind: "tool_call", call }, ctxWithStep);
    expect(ev).toEqual({
      type: "tool_call",
      taskId: "T-001",
      stepId: "implement",
      agent: "claude",
      call,
    });
  });

  it("tool_delta → tool_call_update event carrying the Step", () => {
    const delta: ToolCallDelta = { toolCallId: "tc-1", status: "completed" };
    const ev = toStoreEvent({ kind: "tool_delta", delta }, ctxWithStep);
    expect(ev).toEqual({
      type: "tool_call_update",
      taskId: "T-001",
      stepId: "implement",
      agent: "claude",
      delta,
    });
  });

  it("plan → plan event, never stepId even from a Step-bearing context", () => {
    const entries = [
      { content: "passo", priority: "high", status: "pending" },
    ] as const;
    const ev = toStoreEvent({ kind: "plan", entries }, ctxWithStep);
    expect(ev).toEqual({
      type: "plan",
      taskId: "T-001",
      agent: "claude",
      entries,
    });
    expect(ev).not.toHaveProperty("stepId");
  });

  it("mode → mode_changed event, never stepId even from a Step-bearing context", () => {
    const ev = toStoreEvent({ kind: "mode", modeId: "acceptEdits" }, ctxWithStep);
    expect(ev).toEqual({
      type: "mode_changed",
      taskId: "T-001",
      agent: "claude",
      modeId: "acceptEdits",
    });
    expect(ev).not.toHaveProperty("stepId");
  });

  it("raw → agent_update catch-all preserving updateKind and payload (C2/D3)", () => {
    const ev = toStoreEvent(
      {
        kind: "raw",
        updateKind: "available_commands_update",
        payload: { a: 1 },
      },
      ctxWithStep,
    );
    expect(ev).toEqual({
      type: "agent_update",
      taskId: "T-001",
      agent: "claude",
      updateKind: "available_commands_update",
      payload: { a: 1 },
    });
    expect(ev).not.toHaveProperty("stepId");
  });

  it("a Step-bearing event omits stepId when the context has none", () => {
    // stepId is optional and additive on tool events too: a context without a
    // Step must not fabricate one.
    const call: ToolCallState = {
      toolCallId: "tc-1",
      title: "t",
      kind: "read",
      status: "pending",
      locations: [],
      content: [],
    };
    const ev = toStoreEvent({ kind: "tool_call", call }, ctxWithoutStep);
    expect(ev).toEqual({
      type: "tool_call",
      taskId: "T-001",
      agent: "claude",
      call,
    });
    expect(ev).not.toHaveProperty("stepId");
  });

  it("omits stepId/agent/messageId when absent from the context", () => {
    const ev = toStoreEvent({ kind: "text", text: "hi" }, { taskId: "T-001" });
    expect(ev).toEqual({ type: "stream_chunk", taskId: "T-001", text: "hi" });
    // No undefined keys leak onto the wire.
    expect(Object.keys(ev).sort()).toEqual(["taskId", "text", "type"]);
  });
});

// ---------------------------------------------------------------------------
// reduce — the six rich stream events are an explicit no-op in the engine (R4)
// ---------------------------------------------------------------------------

describe("reduce · rich stream events are no-op (R4, structural sharing)", () => {
  // The timeline accumulates in the GUI, not in StoreState — which keeps
  // describing only the current turn. reduce must return the SAME reference so
  // the store skips notifying and line-reporter's `next === state` guard filters
  // them, leaving the Ink renderer byte-identical (D1).
  const base = play(
    { type: "task_registered", taskId: "T-001", title: "t" },
    {
      type: "step_started",
      taskId: "T-001",
      stepId: "implement",
      stepType: "agent",
    },
  );

  const call: ToolCallState = {
    toolCallId: "tc-1",
    title: "t",
    kind: "read",
    status: "pending",
    locations: [],
    content: [],
  };

  const richEvents: readonly StoreEvent[] = [
    { type: "tool_call", taskId: "T-001", stepId: "implement", call },
    {
      type: "tool_call_update",
      taskId: "T-001",
      stepId: "implement",
      delta: { toolCallId: "tc-1", status: "completed" },
    },
    { type: "thought_chunk", taskId: "T-001", text: "pensando" },
    {
      type: "plan",
      taskId: "T-001",
      entries: [{ content: "p", priority: "low", status: "pending" }],
    },
    { type: "mode_changed", taskId: "T-001", modeId: "plan" },
    {
      type: "agent_update",
      taskId: "T-001",
      updateKind: "session_info_update",
      payload: {},
    },
  ];

  for (const ev of richEvents) {
    it(`${ev.type} returns the same state reference`, () => {
      expect(reduce(base, ev)).toBe(base);
    });
  }

  it("a rich event never notifies the observable store", () => {
    const store = createStore();
    store.dispatch({ type: "task_registered", taskId: "T-001", title: "t" });
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispatch({ type: "mode_changed", taskId: "T-001", modeId: "plan" });
    expect(listener).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// reduce — stream_chunk's new optional fields are additive (C-0019 R3)
// ---------------------------------------------------------------------------

describe("reduce · stream_chunk additive stepId/messageId (R3)", () => {
  it("still accumulates text when stepId/messageId are present", () => {
    const state = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
      {
        type: "stream_chunk",
        taskId: "T-001",
        text: "a",
        stepId: "impl",
        messageId: "m1",
      },
      {
        type: "stream_chunk",
        taskId: "T-001",
        text: "b",
        stepId: "impl",
        messageId: "m1",
      },
    );
    expect(findTask(state, "T-001").stream).toBe("ab");
  });

  it("reduces identically with or without the new fields (turn state unchanged)", () => {
    const withNew = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
      {
        type: "stream_chunk",
        taskId: "T-001",
        text: "hi",
        agent: "claude",
        stepId: "impl",
        messageId: "m1",
      },
    );
    const withoutNew = play(
      { type: "task_registered", taskId: "T-001", title: "t" },
      { type: "stream_chunk", taskId: "T-001", text: "hi", agent: "claude" },
    );
    expect(findTask(withNew, "T-001").stream).toBe(
      findTask(withoutNew, "T-001").stream,
    );
    expect(findTask(withNew, "T-001").streamAgent).toBe(
      findTask(withoutNew, "T-001").streamAgent,
    );
  });
});
