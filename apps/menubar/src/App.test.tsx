/**
 * Tests for App — T-006 (idle board), T-011 (resize), T-007 (graph selection).
 *
 * Run: `npm test -w apps/menubar -- App`
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import type { BridgeState } from "./state/store-bridge";
import type { TaskState } from "loopy/tui/store";
import { STORAGE_KEY, DEFAULT_FRACTION } from "./panes/resize-helpers";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock @tauri-apps/api/core (must be before App import)
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn().mockRejectedValue(new Error("not in tauri")),
}));

// Mock useConfigDraft — returns a controllable draft state
const mockLoad = vi.fn();
const mockSeedFromTemplate = vi.fn();
let mockDraftState = {
  draft: null as unknown,
  errors: [] as unknown[],
  dirty: false,
  tasks: [] as unknown[],
  hasConfig: null as boolean | null,
  load: mockLoad,
  patch: vi.fn(),
  save: vi.fn(),
  seedFromTemplate: mockSeedFromTemplate,
};

vi.mock("./config/useConfigDraft", () => ({
  useConfigDraft: () => mockDraftState,
}));

// Mock configToStore — returns a predictable store
vi.mock("./config/configToStore", () => ({
  configToStore: (_config: unknown, tasks: unknown[]) => ({
    tasks: (tasks as Array<{ id: string; title: string; deps: string[] }>).map((t) => ({
      id: t.id,
      title: t.title,
      status: t.deps.length > 0 ? "blocked" : "pending",
      steps: [],
      stream: "",
      deps: t.deps,
    })),
    edges: [],
    acpLog: [],
    activeAgents: new Set(),
    pipeline: [
      { id: "impl", type: "agent" },
      { id: "checks", type: "checks" },
    ],
  }),
}));

// Mock heavy child components to avoid @xyflow/react zustand issues in jsdom.
let viewSwitcherProps: Record<string, unknown> = {};
vi.mock("./panes/ViewSwitcher", () => ({
  ViewSwitcher: (props: Record<string, unknown>) => {
    viewSwitcherProps = props;
    return <div data-testid="view-switcher" />;
  },
}));
vi.mock("./panes/StreamPanel", () => ({
  StreamPanel: () => <div data-testid="stream-panel" />,
}));
vi.mock("./panes/Banner", () => ({
  Banner: () => null,
}));
let cardDetailProps: Record<string, unknown> = {};
vi.mock("./kanban/CardDetail", () => ({
  CardDetail: (props: Record<string, unknown>) => {
    cardDetailProps = props;
    return <div data-testid="card-detail" />;
  },
}));

import App from "./App";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function task(
  id: string,
  status: TaskState["status"] = "running",
  title = `Task ${id}`,
): TaskState {
  return { id, title, status, steps: [], stream: "", currentStepId: status === "running" ? "impl" : undefined };
}

function makeBridgeState(overrides?: {
  runStatus?: "idle" | "running" | "finished";
  tasks?: TaskState[];
  pendingApprovals?: BridgeState["ui"]["pendingApprovals"];
}): BridgeState {
  return {
    store: {
      tasks: overrides?.tasks ?? [task("T-001")],
      edges: [],
      acpLog: [],
      activeAgents: new Set(),
      pipeline: [],
    },
    ui: {
      runStatus: overrides?.runStatus ?? "running",
      pendingApprovals: overrides?.pendingApprovals ?? [],
      stderrTail: [],
    },
    transcript: {},
  };
}

/** Set the mock draft to simulate a loaded config. */
function setMockDraftLoaded(tasks: Array<{ id: string; title: string; deps: string[] }> = [
  { id: "T-001", title: "Sample task", deps: [] },
]) {
  mockDraftState = {
    ...mockDraftState,
    draft: { pipeline: [{ id: "impl", type: "agent" }, { id: "checks", type: "checks" }] },
    errors: [],
    tasks,
    hasConfig: true,
  };
}

/** Set the mock draft to simulate empty dir (no loopy.yml). */
function setMockDraftEmpty() {
  mockDraftState = {
    ...mockDraftState,
    draft: null,
    errors: [],
    dirty: false,
    tasks: [],
    hasConfig: false,
  };
}

/** Reset mock draft to unloaded state. */
function resetMockDraft() {
  mockDraftState = {
    draft: null,
    errors: [],
    dirty: false,
    tasks: [],
    hasConfig: null,
    load: mockLoad,
    patch: vi.fn(),
    save: vi.fn(),
    seedFromTemplate: mockSeedFromTemplate,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  resetMockDraft();
});

// ---------------------------------------------------------------------------
// T-006 — idle shows board + header (dir picker + Iniciar)
// ---------------------------------------------------------------------------

describe("App — idle shows board (T-006)", () => {
  beforeEach(() => {
    localStorage.clear();
    viewSwitcherProps = {};
  });

  it("renders the board (ViewSwitcher) in idle when draft is loaded", () => {
    setMockDraftLoaded();
    const { getByTestId, queryByTestId } = render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={vi.fn()} />,
    );
    // Board visible
    expect(getByTestId("view-switcher")).toBeTruthy();
    // No resize divider in idle (stream panel hidden)
    expect(queryByTestId("resize-divider")).toBeNull();
  });

  it("shows dir picker and Iniciar button in idle header", () => {
    setMockDraftLoaded();
    const { getByTestId, getByLabelText } = render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={vi.fn()} />,
    );
    expect(getByTestId("dir-picker")).toBeTruthy();
    expect(getByLabelText("Diretório-alvo")).toBeTruthy();
    expect(getByTestId("btn-iniciar")).toBeTruthy();
  });

  it("does NOT render dir picker when running", () => {
    const { queryByTestId } = render(
      <App state={makeBridgeState({ runStatus: "running" })} onStartRun={vi.fn()} />,
    );
    expect(queryByTestId("dir-picker")).toBeNull();
  });

  it("does NOT start run automatically — Iniciar is a manual action", () => {
    setMockDraftLoaded();
    const onStartRun = vi.fn();
    render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={onStartRun} />,
    );
    expect(onStartRun).not.toHaveBeenCalled();
  });

  it("clicking Iniciar calls onStartRun", () => {
    setMockDraftLoaded();
    const onStartRun = vi.fn();
    const { getByTestId } = render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={onStartRun} />,
    );
    fireEvent.click(getByTestId("btn-iniciar"));
    expect(onStartRun).toHaveBeenCalledWith(false);
  });

  it("shows empty state when draft is not loaded", () => {
    resetMockDraft(); // draft = null
    const { queryByTestId, container } = render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={vi.fn()} />,
    );
    expect(queryByTestId("view-switcher")).toBeNull();
    expect(container.querySelector(".app-idle-empty")).toBeTruthy();
  });

  it("feeds the board with tasks from configToStore", () => {
    setMockDraftLoaded([
      { id: "T-001", title: "First", deps: [] },
      { id: "T-002", title: "Second", deps: ["T-001"] },
    ]);
    render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={vi.fn()} />,
    );
    // ViewSwitcher receives the idle store
    const storeArg = viewSwitcherProps.store as { tasks: Array<{ id: string }> };
    expect(storeArg.tasks).toHaveLength(2);
    expect(storeArg.tasks[0].id).toBe("T-001");
    expect(storeArg.tasks[1].id).toBe("T-002");
  });

  it("changing dir triggers configDraft.load", () => {
    setMockDraftLoaded();
    const { getByLabelText } = render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={vi.fn()} />,
    );
    const input = getByLabelText("Diretório-alvo");
    fireEvent.change(input, { target: { value: "/new/project" } });
    expect(mockLoad).toHaveBeenCalledWith("/new/project");
  });
});

// ---------------------------------------------------------------------------
// T-011 — resize divider (running state)
// ---------------------------------------------------------------------------

describe("App — resize divider (T-011)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the resize divider when running", () => {
    const { getByTestId } = render(
      <App state={makeBridgeState()} onStartRun={vi.fn()} />,
    );
    const divider = getByTestId("resize-divider");
    expect(divider).toBeTruthy();
    expect(divider.getAttribute("role")).toBe("separator");
  });

  it("does not render the resize divider on idle", () => {
    setMockDraftLoaded();
    const { queryByTestId } = render(
      <App
        state={makeBridgeState({ runStatus: "idle" })}
        onStartRun={vi.fn()}
      />,
    );
    expect(queryByTestId("resize-divider")).toBeNull();
  });

  it("applies --stream-h from localStorage", () => {
    localStorage.setItem(STORAGE_KEY, "0.6");
    const { container } = render(
      <App state={makeBridgeState()} onStartRun={vi.fn()} />,
    );
    const left = container.querySelector(".app-body__left") as HTMLElement;
    expect(left.style.getPropertyValue("--stream-h")).toBe("60%");
  });

  it("double-click resets to default fraction", () => {
    localStorage.setItem(STORAGE_KEY, "0.3");
    const { getByTestId, container } = render(
      <App state={makeBridgeState()} onStartRun={vi.fn()} />,
    );
    const divider = getByTestId("resize-divider");
    fireEvent.doubleClick(divider);
    const left = container.querySelector(".app-body__left") as HTMLElement;
    expect(left.style.getPropertyValue("--stream-h")).toBe(
      `${Math.round(DEFAULT_FRACTION * 100)}%`,
    );
    expect(localStorage.getItem(STORAGE_KEY)).toBe(String(DEFAULT_FRACTION));
  });

  it("uses default fraction when localStorage is empty", () => {
    const { container } = render(
      <App state={makeBridgeState()} onStartRun={vi.fn()} />,
    );
    const left = container.querySelector(".app-body__left") as HTMLElement;
    expect(left.style.getPropertyValue("--stream-h")).toBe("45%");
  });
});

// ---------------------------------------------------------------------------
// T-007 — graph selection opens CardDetail (integration)
// ---------------------------------------------------------------------------

describe("App — graph selection opens CardDetail (T-007)", () => {
  beforeEach(() => {
    localStorage.clear();
    viewSwitcherProps = {};
    cardDetailProps = {};
  });

  it("selecting a task via onSelectTask opens CardDetail with the correct task", () => {
    const tasks = [task("T-001", "running", "First task"), task("T-002", "pending", "Second task")];
    const { queryByTestId, rerender } = render(
      <App state={makeBridgeState({ tasks })} onStartRun={vi.fn()} />,
    );

    // CardDetail not shown initially
    expect(queryByTestId("card-detail")).toBeNull();

    // Simulate selecting T-002 via ViewSwitcher's onSelectTask (same callback used by graph)
    const onSelectTask = viewSwitcherProps.onSelectTask as (id: string) => void;
    expect(onSelectTask).toBeDefined();

    act(() => onSelectTask("T-002"));

    // Re-render triggers update — but React may batch, so we need rerender
    rerender(<App state={makeBridgeState({ tasks })} onStartRun={vi.fn()} />);

    expect(queryByTestId("card-detail")).toBeTruthy();
    expect(cardDetailProps.taskId).toBe("T-002");
    expect(cardDetailProps.title).toBe("Second task");
  });

  it("re-clicking the same task closes CardDetail (toggle)", () => {
    const tasks = [task("T-001", "running", "First task")];
    const { queryByTestId, rerender } = render(
      <App state={makeBridgeState({ tasks })} onStartRun={vi.fn()} />,
    );

    const onSelectTask = viewSwitcherProps.onSelectTask as (id: string) => void;

    // Open
    act(() => onSelectTask("T-001"));
    rerender(<App state={makeBridgeState({ tasks })} onStartRun={vi.fn()} />);
    expect(queryByTestId("card-detail")).toBeTruthy();

    // Toggle — same id again
    act(() => onSelectTask("T-001"));
    rerender(<App state={makeBridgeState({ tasks })} onStartRun={vi.fn()} />);
    expect(queryByTestId("card-detail")).toBeNull();
  });

  it("pending approval forces CardDetail to the approval task (D6/C-0011)", () => {
    const tasks = [task("T-001", "running"), task("T-002", "running")];
    const stateWithApproval = makeBridgeState({
      tasks,
      pendingApprovals: [
        { requestId: "req-1", taskId: "T-002", stepId: "merge", summary: "Approve merge?" },
      ],
    });

    const { queryByTestId } = render(
      <App state={stateWithApproval} onStartRun={vi.fn()} />,
    );

    // CardDetail shown for approval task even without explicit selection
    expect(queryByTestId("card-detail")).toBeTruthy();
    expect(cardDetailProps.taskId).toBe("T-002");
  });
});

// ---------------------------------------------------------------------------
// T-015 — Empty-state + template + todo hint
// ---------------------------------------------------------------------------

describe("App — empty-state (T-015)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockSeedFromTemplate.mockClear();
  });

  it("shows EmptyState when hasConfig is false (dir without loopy.yml)", () => {
    setMockDraftEmpty();
    const { getByTestId, queryByTestId } = render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={vi.fn()} />,
    );
    expect(getByTestId("empty-state")).toBeTruthy();
    expect(getByTestId("btn-create-from-template")).toBeTruthy();
    expect(queryByTestId("view-switcher")).toBeNull();
  });

  it("clicking 'Criar a partir do template' calls seedFromTemplate", () => {
    setMockDraftEmpty();
    const { getByTestId } = render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={vi.fn()} />,
    );
    fireEvent.click(getByTestId("btn-create-from-template"));
    expect(mockSeedFromTemplate).toHaveBeenCalledTimes(1);
  });

  it("shows todo hint when config loaded but 0 tasks", () => {
    setMockDraftLoaded([]);
    const { getByTestId } = render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={vi.fn()} />,
    );
    expect(getByTestId("todo-hint")).toBeTruthy();
  });

  it("does NOT show todo hint when tasks exist", () => {
    setMockDraftLoaded();
    const { queryByTestId } = render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={vi.fn()} />,
    );
    expect(queryByTestId("todo-hint")).toBeNull();
  });

  it("does NOT show EmptyState when running (even if hasConfig is false)", () => {
    setMockDraftEmpty();
    const { queryByTestId } = render(
      <App state={makeBridgeState({ runStatus: "running" })} onStartRun={vi.fn()} />,
    );
    expect(queryByTestId("empty-state")).toBeNull();
  });
});
