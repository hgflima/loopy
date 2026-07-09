/**
 * Tests for App — resize divider presence and behavior (T-011).
 *
 * Run: `npm test -w apps/menubar -- App`
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { BridgeState } from "./state/store-bridge";
import type { TaskState } from "loopy/tui/store";
import { STORAGE_KEY, DEFAULT_FRACTION } from "./panes/resize-helpers";

// Mock heavy child components to avoid @xyflow/react zustand issues in jsdom.
vi.mock("./panes/ViewSwitcher", () => ({
  ViewSwitcher: () => <div data-testid="view-switcher" />,
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
vi.mock("./kanban/CardDetail", () => ({
  CardDetail: () => <div data-testid="card-detail" />,
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
      pendingApprovals: [],
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
