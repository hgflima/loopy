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

// Mock @tauri-apps/api/event — App defaults its launch-args source to Tauri
// only when isTauri(); tests inject a fake source instead.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockRejectedValue(new Error("not in tauri")),
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
      status: t.deps.length > 0 ? "blocked" : "ready",
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
    warnings: [],
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
import type { LaunchArgs, LaunchArgsSource } from "./state/launch-args";

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
      warnings: [],
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

  it("clicking Iniciar calls onStartRun with default flags", async () => {
    setMockDraftLoaded();
    const onStartRun = vi.fn();
    const { getByTestId } = render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={onStartRun} />,
    );
    await act(async () => {
      fireEvent.click(getByTestId("btn-iniciar"));
    });
    expect(onStartRun).toHaveBeenCalledWith("/sample", { yes: false, taskId: "", verbose: false });
  });

  it("keeps the tab bar visible even when the draft is not loaded (D20)", () => {
    resetMockDraft(); // draft = null, hasConfig = null
    const { getByTestId, container } = render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={vi.fn()} />,
    );
    // The tab bar (ViewSwitcher) is always present in idle now — never replaced.
    expect(getByTestId("view-switcher")).toBeTruthy();
    // The old full-screen "select a dir" fallback is gone.
    expect(container.querySelector(".app-idle-empty")).toBeNull();
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
    const tasks = [task("T-001", "running", "First task"), task("T-002", "ready", "Second task")];
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
// T-014 (D20) — the tab bar is always visible; the EmptyState no longer replaces
// the ViewSwitcher, it degrades the Config tab (tested against the real
// ViewSwitcher in ViewSwitcher.test.tsx). Here we assert App-level wiring.
// ---------------------------------------------------------------------------

describe("App — tab bar always visible (T-014/D20)", () => {
  beforeEach(() => {
    localStorage.clear();
    viewSwitcherProps = {};
    mockSeedFromTemplate.mockClear();
  });

  it("keeps the tab bar visible with no loopy.yml and forwards the empty draft (SC15)", () => {
    setMockDraftEmpty();
    const { getByTestId, container } = render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={vi.fn()} />,
    );
    // The bar is present — never swapped for a full-screen EmptyState.
    expect(getByTestId("view-switcher")).toBeTruthy();
    expect(container.querySelector(".app-idle-empty")).toBeNull();
    // The draft (hasConfig false) reaches the ViewSwitcher so the Config tab can
    // host the empty state and Specs can run an Interview.
    const draft = viewSwitcherProps.configDraft as { hasConfig: boolean };
    expect(draft.hasConfig).toBe(false);
  });

  it("shows todo hint when config loaded but 0 tasks", () => {
    setMockDraftLoaded([]);
    const { getByTestId } = render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={vi.fn()} />,
    );
    expect(getByTestId("todo-hint")).toBeTruthy();
  });

  it("does NOT show todo hint when there is no loaded config (hasConfig false)", () => {
    setMockDraftEmpty();
    const { queryByTestId } = render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={vi.fn()} />,
    );
    // No synthetic board → the todo hint (which is about a present-but-empty
    // backlog) must not appear; the empty Config tab owns that message.
    expect(queryByTestId("todo-hint")).toBeNull();
  });

  it("does NOT show todo hint when tasks exist", () => {
    setMockDraftLoaded();
    const { queryByTestId } = render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={vi.fn()} />,
    );
    expect(queryByTestId("todo-hint")).toBeNull();
  });

  it("shows the board (no full-screen empty state) when running even if hasConfig is false", () => {
    setMockDraftEmpty();
    const { getByTestId, container } = render(
      <App state={makeBridgeState({ runStatus: "running" })} onStartRun={vi.fn()} />,
    );
    expect(getByTestId("view-switcher")).toBeTruthy();
    expect(container.querySelector(".app-idle-empty")).toBeNull();
    // In a run the ViewSwitcher gets no configDraft (edits are idle-only).
    expect(viewSwitcherProps.configDraft).toBeUndefined();
  });

  it("forwards runActive=true to the ViewSwitcher while running (D22)", () => {
    setMockDraftLoaded();
    render(<App state={makeBridgeState({ runStatus: "running" })} onStartRun={vi.fn()} />);
    expect(viewSwitcherProps.runActive).toBe(true);
  });

  it("forwards runActive=false to the ViewSwitcher while idle", () => {
    setMockDraftLoaded();
    render(<App state={makeBridgeState({ runStatus: "idle" })} onStartRun={vi.fn()} />);
    expect(viewSwitcherProps.runActive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T-014 — Launch popover, auto-save, dirty guard
// ---------------------------------------------------------------------------

describe("App — launch popover + auto-save + dirty guard (T-014)", () => {
  beforeEach(() => {
    localStorage.clear();
    viewSwitcherProps = {};
  });

  it("shows the launch flags popover toggle button", () => {
    setMockDraftLoaded();
    const { getByTestId } = render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={vi.fn()} />,
    );
    expect(getByTestId("btn-launch-flags")).toBeTruthy();
  });

  it("clicking toggle opens the launch popover with flag controls", () => {
    setMockDraftLoaded();
    const { getByTestId, queryByTestId } = render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={vi.fn()} />,
    );
    // Popover not visible initially
    expect(queryByTestId("launch-popover")).toBeNull();
    // Open it
    fireEvent.click(getByTestId("btn-launch-flags"));
    expect(getByTestId("launch-popover")).toBeTruthy();
    expect(getByTestId("flag-yes")).toBeTruthy();
    expect(getByTestId("flag-verbose")).toBeTruthy();
    expect(getByTestId("flag-task-id")).toBeTruthy();
  });

  it("flags from popover reach onStartRun", async () => {
    setMockDraftLoaded();
    const onStartRun = vi.fn();
    const { getByTestId } = render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={onStartRun} />,
    );
    // Open popover and set flags
    fireEvent.click(getByTestId("btn-launch-flags"));
    fireEvent.click(getByTestId("flag-yes"));
    fireEvent.change(getByTestId("flag-task-id"), { target: { value: "T-003" } });
    // Click Iniciar
    await act(async () => {
      fireEvent.click(getByTestId("btn-iniciar"));
    });
    expect(onStartRun).toHaveBeenCalledWith("/sample", { yes: true, taskId: "T-003", verbose: false });
  });

  it("auto-saves dirty draft before calling onStartRun", async () => {
    setMockDraftLoaded();
    mockDraftState = { ...mockDraftState, dirty: true };
    const mockSave = vi.fn().mockResolvedValue(true);
    mockDraftState.save = mockSave;
    const onStartRun = vi.fn();
    const { getByTestId } = render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={onStartRun} />,
    );
    await act(async () => {
      fireEvent.click(getByTestId("btn-iniciar"));
    });
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(onStartRun).toHaveBeenCalled();
  });

  it("does NOT call onStartRun if save fails (fail-closed)", async () => {
    setMockDraftLoaded();
    mockDraftState = { ...mockDraftState, dirty: true };
    const mockSave = vi.fn().mockResolvedValue(false);
    mockDraftState.save = mockSave;
    const onStartRun = vi.fn();
    const { getByTestId } = render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={onStartRun} />,
    );
    await act(async () => {
      fireEvent.click(getByTestId("btn-iniciar"));
    });
    expect(mockSave).toHaveBeenCalled();
    expect(onStartRun).not.toHaveBeenCalled();
  });

  it("Iniciar is disabled when errors exist (fail-closed)", () => {
    setMockDraftLoaded();
    mockDraftState = { ...mockDraftState, errors: [{ path: "acp", message: "bad" }] };
    const { getByTestId } = render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={vi.fn()} />,
    );
    expect((getByTestId("btn-iniciar") as HTMLButtonElement).disabled).toBe(true);
  });

  it("changing dir with dirty draft shows confirm dialog", () => {
    setMockDraftLoaded();
    mockDraftState = { ...mockDraftState, dirty: true };
    const { getByLabelText, getByTestId, queryByTestId } = render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={vi.fn()} />,
    );
    expect(queryByTestId("dirty-confirm")).toBeNull();
    fireEvent.change(getByLabelText("Diretório-alvo"), { target: { value: "/other" } });
    expect(getByTestId("dirty-confirm")).toBeTruthy();
  });

  it("dirty confirm — Cancel keeps current dir", () => {
    setMockDraftLoaded();
    mockDraftState = { ...mockDraftState, dirty: true };
    const { getByLabelText, getByTestId, queryByTestId } = render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={vi.fn()} />,
    );
    fireEvent.change(getByLabelText("Diretório-alvo"), { target: { value: "/other" } });
    fireEvent.click(getByTestId("dirty-cancel"));
    expect(queryByTestId("dirty-confirm")).toBeNull();
    // Dir unchanged (still /sample from dev:web mount)
    expect(mockLoad).not.toHaveBeenCalledWith("/other");
  });

  it("dirty confirm — Discard proceeds to new dir without saving", () => {
    setMockDraftLoaded();
    mockDraftState = { ...mockDraftState, dirty: true };
    const { getByLabelText, getByTestId, queryByTestId } = render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={vi.fn()} />,
    );
    fireEvent.change(getByLabelText("Diretório-alvo"), { target: { value: "/other" } });
    fireEvent.click(getByTestId("dirty-discard"));
    expect(queryByTestId("dirty-confirm")).toBeNull();
    expect(mockLoad).toHaveBeenCalledWith("/other");
  });

  it("dirty confirm — Save saves then proceeds to new dir", async () => {
    setMockDraftLoaded();
    mockDraftState = { ...mockDraftState, dirty: true };
    const mockSave = vi.fn().mockResolvedValue(true);
    mockDraftState.save = mockSave;
    const { getByLabelText, getByTestId, queryByTestId } = render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={vi.fn()} />,
    );
    fireEvent.change(getByLabelText("Diretório-alvo"), { target: { value: "/other" } });
    await act(async () => {
      fireEvent.click(getByTestId("dirty-save"));
    });
    expect(mockSave).toHaveBeenCalled();
    expect(queryByTestId("dirty-confirm")).toBeNull();
    expect(mockLoad).toHaveBeenCalledWith("/other");
  });
});

// ---------------------------------------------------------------------------
// T-015 (D11) — "Abrir o board" repoints inputs.{spec,plan,todo} in the draft
// (SC8). The App owns the patch (it holds configDraft); the view switch to Kanban
// lives in the ViewSwitcher (mocked here). Patch, not disk — the save bar goes
// dirty and the yml only changes on Salvar.
// ---------------------------------------------------------------------------

describe("App — 'Abrir o board' patches inputs (T-015/D11)", () => {
  beforeEach(() => {
    localStorage.clear();
    viewSwitcherProps = {};
  });

  it("forwards an onOpenBoard handler to the ViewSwitcher", () => {
    setMockDraftLoaded();
    render(<App state={makeBridgeState({ runStatus: "idle" })} onStartRun={vi.fn()} />);
    expect(typeof viewSwitcherProps.onOpenBoard).toBe("function");
  });

  it("patches the three inputs.* to the new Change dir (patch, not disk)", () => {
    setMockDraftLoaded();
    const patch = vi.fn();
    mockDraftState = { ...mockDraftState, patch };
    render(<App state={makeBridgeState({ runStatus: "idle" })} onStartRun={vi.fn()} />);

    const onOpenBoard = viewSwitcherProps.onOpenBoard as (dir: string) => void;
    act(() => onOpenBoard(".harn/devy/changes/C-0018-x"));

    // Three individual patches — never a single `inputs` object, which would
    // clobber inputs.backlog. Patching inputs.todo re-reads the new backlog.
    expect(patch).toHaveBeenCalledWith("inputs.spec", ".harn/devy/changes/C-0018-x/spec.md");
    expect(patch).toHaveBeenCalledWith("inputs.plan", ".harn/devy/changes/C-0018-x/plan.md");
    expect(patch).toHaveBeenCalledWith("inputs.todo", ".harn/devy/changes/C-0018-x/todo.md");
    // Never the whole-object form (would drop inputs.backlog).
    expect(patch).not.toHaveBeenCalledWith("inputs", expect.anything());
  });

  it("strips a trailing slash from the Change dir before composing the paths", () => {
    setMockDraftLoaded();
    const patch = vi.fn();
    mockDraftState = { ...mockDraftState, patch };
    render(<App state={makeBridgeState({ runStatus: "idle" })} onStartRun={vi.fn()} />);

    const onOpenBoard = viewSwitcherProps.onOpenBoard as (dir: string) => void;
    act(() => onOpenBoard(".harn/devy/changes/C-0018-x/"));

    expect(patch).toHaveBeenCalledWith("inputs.todo", ".harn/devy/changes/C-0018-x/todo.md");
  });
});

// ---------------------------------------------------------------------------
// C-0020 T-013 — the GUI applies the launch argv (E2/E3)
// ---------------------------------------------------------------------------

describe("App — launch argv (C-0020 T-013)", () => {
  function launchArgs(over: Partial<LaunchArgs> = {}): LaunchArgs {
    return { dir: null, task: null, yes: false, verbose: false, run: false, ...over };
  }

  /** A fake source: `initial` is pulled once; `push` emits a later instance. */
  function fakeSource(initial: LaunchArgs | null) {
    let listener: ((a: LaunchArgs) => void) | null = null;
    const unlisten = vi.fn();
    const source: LaunchArgsSource = {
      take: vi.fn().mockResolvedValue(initial),
      subscribe: vi.fn(async (cb: (a: LaunchArgs) => void) => {
        listener = cb;
        return unlisten;
      }),
    };
    return {
      source,
      unlisten,
      push: (a: LaunchArgs) => listener?.(a),
    };
  }

  /** Make `load` hang until released, to observe the order load → start. */
  function deferLoad() {
    let release!: () => void;
    const loaded = new Promise<void>((r) => {
      release = r;
    });
    mockLoad.mockImplementation(() => loaded);
    return async () => {
      await act(async () => {
        release();
        await loaded;
      });
    };
  }

  /** Let the mount-time persisted → take chain settle. */
  async function flush() {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  beforeEach(() => {
    mockLoad.mockReset();
    setMockDraftLoaded();
  });

  it("switches dir and prefills the flags from the initial argv", async () => {
    const { source } = fakeSource(launchArgs({ dir: "/proj/b", task: "T-003", yes: true }));
    const onStartRun = vi.fn();
    const { getByLabelText, getByTestId } = render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={onStartRun} launchArgsSource={source} />,
    );
    await flush();
    expect(source.take).toHaveBeenCalledTimes(1);
    expect(mockLoad).toHaveBeenCalledWith("/proj/b");
    expect((getByLabelText("Diretório-alvo") as HTMLInputElement).value).toBe("/proj/b");
    fireEvent.click(getByTestId("btn-launch-flags"));
    expect((getByTestId("flag-yes") as HTMLInputElement).checked).toBe(true);
    expect((getByTestId("flag-task-id") as HTMLInputElement).value).toBe("T-003");
    expect(onStartRun).not.toHaveBeenCalled();
  });

  it("--run starts only after the new dir's loopy.yml has loaded", async () => {
    const release = deferLoad();
    const { source } = fakeSource(launchArgs({ dir: "/proj/b", run: true, yes: true }));
    const onStartRun = vi.fn();
    render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={onStartRun} launchArgsSource={source} />,
    );
    await flush();
    expect(mockLoad).toHaveBeenCalledWith("/proj/b");
    expect(onStartRun).not.toHaveBeenCalled();
    await release();
    await flush();
    expect(onStartRun).toHaveBeenCalledTimes(1);
    expect(onStartRun).toHaveBeenCalledWith("/proj/b", { yes: true, taskId: "", verbose: false });
  });

  it("--run does not start when the loaded config cannot start (errors)", async () => {
    const release = deferLoad();
    mockDraftState = { ...mockDraftState, errors: [{ path: "acp", message: "bad" }] };
    const { source } = fakeSource(launchArgs({ dir: "/proj/b", run: true }));
    const onStartRun = vi.fn();
    render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={onStartRun} launchArgsSource={source} />,
    );
    await flush();
    await release();
    await flush();
    expect(onStartRun).not.toHaveBeenCalled();
  });

  it("without --run it never starts", async () => {
    const { source } = fakeSource(launchArgs({ dir: "/proj/b", yes: true }));
    const onStartRun = vi.fn();
    render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={onStartRun} launchArgsSource={source} />,
    );
    await flush();
    await flush();
    expect(mockLoad).toHaveBeenCalledWith("/proj/b");
    expect(onStartRun).not.toHaveBeenCalled();
  });

  it("a dirty config opens the dirty guard instead of switching", async () => {
    mockDraftState = { ...mockDraftState, dirty: true };
    const { source } = fakeSource(launchArgs({ dir: "/proj/b", run: true }));
    const onStartRun = vi.fn();
    const { getByTestId } = render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={onStartRun} launchArgsSource={source} />,
    );
    await flush();
    expect(getByTestId("dirty-confirm")).toBeTruthy();
    expect(mockLoad).not.toHaveBeenCalledWith("/proj/b");
    expect(onStartRun).not.toHaveBeenCalled();
  });

  it("Discard in the dirty guard switches, then the pending --run starts", async () => {
    mockDraftState = { ...mockDraftState, dirty: true };
    const { source } = fakeSource(launchArgs({ dir: "/proj/b", run: true }));
    const onStartRun = vi.fn();
    const { getByTestId } = render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={onStartRun} launchArgsSource={source} />,
    );
    await flush();
    // Loading the new dir replaces the draft: it is clean afterwards.
    mockLoad.mockImplementation(async () => {
      mockDraftState = { ...mockDraftState, dirty: false };
    });
    await act(async () => {
      fireEvent.click(getByTestId("dirty-discard"));
    });
    await flush();
    expect(mockLoad).toHaveBeenCalledWith("/proj/b");
    expect(onStartRun).toHaveBeenCalledTimes(1);
    expect(onStartRun.mock.calls[0][0]).toBe("/proj/b");
  });

  it("Cancel in the dirty guard discards the pending --run", async () => {
    mockDraftState = { ...mockDraftState, dirty: true };
    const { source } = fakeSource(launchArgs({ dir: "/proj/b", run: true }));
    const onStartRun = vi.fn();
    const { getByTestId, getByLabelText } = render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={onStartRun} launchArgsSource={source} />,
    );
    await flush();
    fireEvent.click(getByTestId("dirty-cancel"));
    await flush();
    expect(mockLoad).not.toHaveBeenCalledWith("/proj/b");
    expect((getByLabelText("Diretório-alvo") as HTMLInputElement).value).toBe("/sample");
    expect(onStartRun).not.toHaveBeenCalled();
  });

  it("applies argv forwarded by a later instance (launch-args event)", async () => {
    const { source, push, unlisten } = fakeSource(null);
    const onStartRun = vi.fn();
    const { unmount } = render(
      <App state={makeBridgeState({ runStatus: "idle" })} onStartRun={onStartRun} launchArgsSource={source} />,
    );
    await flush();
    expect(mockLoad).not.toHaveBeenCalled();
    await act(async () => {
      push(launchArgs({ dir: "/proj/c" }));
    });
    expect(mockLoad).toHaveBeenCalledWith("/proj/c");
    expect(onStartRun).not.toHaveBeenCalled();
    unmount();
    expect(unlisten).toHaveBeenCalled();
  });

  it("with a Run active: warns, does not switch or start, applies the dir when it ends", async () => {
    const { source, push } = fakeSource(null);
    const onStartRun = vi.fn();
    const { getByTestId, queryByTestId, rerender } = render(
      <App state={makeBridgeState({ runStatus: "running" })} onStartRun={onStartRun} launchArgsSource={source} />,
    );
    await flush();
    await act(async () => {
      push(launchArgs({ dir: "/proj/b", run: true }));
    });
    expect(getByTestId("launch-warning").textContent).toContain("/proj/b");
    expect(getByTestId("launch-warning").textContent).toContain("--run");
    expect(mockLoad).not.toHaveBeenCalledWith("/proj/b");

    mockLoad.mockResolvedValue(undefined);
    rerender(
      <App state={makeBridgeState({ runStatus: "finished" })} onStartRun={onStartRun} launchArgsSource={source} />,
    );
    await flush();
    expect(mockLoad).toHaveBeenCalledWith("/proj/b");
    expect(queryByTestId("launch-warning")).toBeNull();
    // The deferred argv never carries --run: no second Run is invented.
    expect(onStartRun).not.toHaveBeenCalled();
  });
});
