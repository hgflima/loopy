/**
 * Tests for ViewSwitcher — DepsFlow receives selectedTaskId + onSelectTask,
 * and both views stay mounted (state preserved on switch).
 *
 * Run: `npm test -w apps/menubar -- ViewSwitcher`
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { StoreState } from "loopy/tui/store";

// ---------------------------------------------------------------------------
// Mocks — capture props forwarded to each child
// ---------------------------------------------------------------------------

let kanbanProps: Record<string, unknown> = {};
let depsFlowProps: Record<string, unknown> = {};

vi.mock("../kanban/KanbanBoard", () => ({
  KanbanBoard: (props: Record<string, unknown>) => {
    kanbanProps = props;
    return <div data-testid="kanban-board" />;
  },
}));

vi.mock("../graph/DepsFlow", () => ({
  DepsFlow: (props: Record<string, unknown>) => {
    depsFlowProps = props;
    return <div data-testid="deps-flow" />;
  },
}));

vi.mock("@xyflow/react", () => ({
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const { ViewSwitcher } = await import("./ViewSwitcher");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  kanbanProps = {};
  depsFlowProps = {};
});

function makeStore(taskIds: string[] = ["T-001"]): StoreState {
  return {
    tasks: taskIds.map((id) => ({
      id,
      title: `Task ${id}`,
      status: "pending" as const,
      steps: [],
      stream: "",
    })),
    edges: [] as [string, string][],
    acpLog: [],
    activeAgents: new Set<string>(),
    pipeline: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ViewSwitcher — DepsFlow receives selection props (T-007)", () => {
  it("passes selectedTaskId to DepsFlow", () => {
    render(
      <ViewSwitcher store={makeStore()} tick={0} selectedTaskId="T-001" onSelectTask={vi.fn()} />,
    );
    expect(depsFlowProps.selectedTaskId).toBe("T-001");
  });

  it("passes onSelectTask to DepsFlow", () => {
    const handler = vi.fn();
    render(
      <ViewSwitcher store={makeStore()} tick={0} selectedTaskId={null} onSelectTask={handler} />,
    );
    expect(depsFlowProps.onSelectTask).toBe(handler);
  });

  it("DepsFlow onSelectTask calls the parent handler", () => {
    const handler = vi.fn();
    render(
      <ViewSwitcher store={makeStore()} tick={0} selectedTaskId={null} onSelectTask={handler} />,
    );
    const onSelect = depsFlowProps.onSelectTask as (id: string) => void;
    onSelect("T-001");
    expect(handler).toHaveBeenCalledWith("T-001");
  });

  it("KanbanBoard also receives selectedTaskId and onSelectTask", () => {
    const handler = vi.fn();
    render(
      <ViewSwitcher store={makeStore()} tick={0} selectedTaskId="T-001" onSelectTask={handler} />,
    );
    expect(kanbanProps.selectedTaskId).toBe("T-001");
    expect(kanbanProps.onSelectTask).toBe(handler);
  });
});

describe("ViewSwitcher — both views stay mounted (T-007)", () => {
  it("both KanbanBoard and DepsFlow are in the DOM regardless of active view", () => {
    const { getByTestId, getByRole } = render(
      <ViewSwitcher store={makeStore()} tick={0} />,
    );

    // Default view is Kanban
    expect(getByTestId("kanban-board")).toBeTruthy();
    expect(getByTestId("deps-flow")).toBeTruthy();

    // Switch to Deps
    const depsButton = getByRole("radio", { name: "Deps" });
    fireEvent.click(depsButton);

    // Both still in DOM
    expect(getByTestId("kanban-board")).toBeTruthy();
    expect(getByTestId("deps-flow")).toBeTruthy();
  });
});
