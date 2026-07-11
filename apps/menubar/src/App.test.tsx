/**
 * Tests for App — resize divider presence and behavior (T-011).
 *
 * Run: `npm test -w apps/menubar -- App`
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import type { BridgeState } from "./state/store-bridge";
import type { TaskState } from "loopy/tui/store";
import { STORAGE_KEY, DEFAULT_FRACTION } from "./panes/resize-helpers";

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
vi.mock("./panes/LaunchConfig", () => ({
  LaunchConfig: ({ onStart }: { onStart: (y: boolean) => void }) => (
    <button data-testid="launch" onClick={() => onStart(false)} />
  ),
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(cleanup);

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

  it("does not render the resize divider on idle (launch config shown)", () => {
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
