import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { pulseFrame } from "loopy/tui/view";
import type { TaskStatus } from "loopy/tui/store";

afterEach(cleanup);

// Mock @xyflow/react — avoids the dual-React-copies issue in this monorepo
// (root = React 19 for Ink, menubar = React 18). We only need Handle to render
// as no-op; the component itself is plain JSX.
vi.mock("@xyflow/react", () => ({
  Handle: () => null,
  Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
}));

// Mock StatusIndicator CSS import
vi.mock("../ui/StatusIndicator.css", () => ({}));

const { default: TaskNode } = await import("./TaskNode");

/** Render TaskNode with given data, return the node element. */
function renderNode(
  id: string,
  overrides: Partial<{
    status: TaskStatus;
    title: string;
    tick: number;
    selected: boolean;
    isRunning: boolean;
    failedAtStepId: string;
    reducedMotion: boolean;
    onSelect: (id: string) => void;
  }> = {},
) {
  const data = {
    status: "pending" as TaskStatus,
    title: "Some task title",
    tick: 0,
    selected: false,
    isRunning: false,
    reducedMotion: false,
    onSelect: vi.fn(),
    ...overrides,
  };
  const props = {
    id,
    data,
    type: "task" as const,
    selected: false,
    isConnectable: false,
    dragging: false,
    draggable: false,
    selectable: false,
    deletable: false,
    zIndex: 0,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return render(<TaskNode {...(props as any)} />);
}

// ---------------------------------------------------------------------------
// Card content: dot + ID + title + @step
// ---------------------------------------------------------------------------

describe("TaskNode — card content", () => {
  it("renders status dot, ID, and title", () => {
    const { getByTestId, container } = renderNode("T-001", {
      status: "running",
      title: "Implement feature X",
    });
    const node = getByTestId("task-node-T-001");

    // Status dot present (without pulse class — D7)
    const dot = container.querySelector(".status-dot");
    expect(dot).toBeTruthy();
    expect(dot!.classList.contains("status-dot--running")).toBe(true);
    expect(dot!.classList.contains("status-dot--pulse")).toBe(false);

    // ID in mono class
    const idSpan = node.querySelector(".deps-node__id");
    expect(idSpan).toBeTruthy();
    expect(idSpan!.textContent).toBe("T-001");

    // Title in sans class
    const titleSpan = node.querySelector(".deps-node__title");
    expect(titleSpan).toBeTruthy();
    expect(titleSpan!.textContent).toBe("Implement feature X");
  });

  it("renders @step when failedAtStepId is present", () => {
    const { getByTestId } = renderNode("T-002", {
      status: "escalated",
      failedAtStepId: "lint",
    });
    const node = getByTestId("task-node-T-002");
    const failed = node.querySelector(".deps-node__failed");
    expect(failed).toBeTruthy();
    expect(failed!.textContent).toBe("@lint");
  });

  it("does NOT render @step when failedAtStepId is absent", () => {
    const { getByTestId } = renderNode("T-003", { status: "done" });
    const node = getByTestId("task-node-T-003");
    const failed = node.querySelector(".deps-node__failed");
    expect(failed).toBeNull();
  });

  it("title is NOT monospace (Machine-Voice Rule: mono only on ID/step)", () => {
    const { getByTestId } = renderNode("T-004", { title: "A body text" });
    const node = getByTestId("task-node-T-004");
    const titleSpan = node.querySelector(".deps-node__title");
    expect(titleSpan!.classList.contains("t-body")).toBe(true);
    // font-family should NOT be monospace — confirmed by CSS class, not inline
    expect((titleSpan as HTMLElement).style.fontFamily).toBe("");
  });
});

// ---------------------------------------------------------------------------
// aria-pressed reflects selected
// ---------------------------------------------------------------------------

describe("TaskNode — selection (aria-pressed)", () => {
  it("aria-pressed=true when selected", () => {
    const { getByTestId } = renderNode("T-001", { selected: true });
    expect(getByTestId("task-node-T-001").getAttribute("aria-pressed")).toBe("true");
  });

  it("aria-pressed=false when not selected", () => {
    const { getByTestId } = renderNode("T-001", { selected: false });
    expect(getByTestId("task-node-T-001").getAttribute("aria-pressed")).toBe("false");
  });

  it("selected applies deps-node--selected class", () => {
    const { getByTestId } = renderNode("T-001", { selected: true });
    expect(getByTestId("task-node-T-001").classList.contains("deps-node--selected")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Running: pulse on border, dot stays static
// ---------------------------------------------------------------------------

describe("TaskNode — running pulse on border (D7)", () => {
  it("running applies deps-node--running class", () => {
    const { getByTestId } = renderNode("T-001", {
      status: "running",
      isRunning: true,
    });
    expect(getByTestId("task-node-T-001").classList.contains("deps-node--running")).toBe(true);
  });

  it("tick=0 (on) — border shadow from CSS class (no inline override)", () => {
    expect(pulseFrame(0)).toBe("on");
    const { getByTestId } = renderNode("T-001", {
      status: "running",
      isRunning: true,
      tick: 0,
    });
    const node = getByTestId("task-node-T-001");
    // On phase: CSS class provides the shadow, no inline override
    expect(node.style.boxShadow).toBe("");
  });

  it("tick=1 (off) — border fades via pulse-off CSS class (no inline style)", () => {
    expect(pulseFrame(1)).toBe("off");
    const { getByTestId } = renderNode("T-001", {
      status: "running",
      isRunning: true,
      tick: 1,
    });
    const node = getByTestId("task-node-T-001");
    expect(node.classList.contains("deps-node--pulse-off")).toBe(true);
    // No inline boxShadow — CSS class handles the "off" phase
    expect(node.style.boxShadow).toBe("");
  });

  it("dot does NOT have pulse class when running (D7 — dot is static)", () => {
    const { container } = renderNode("T-001", {
      status: "running",
      isRunning: true,
    });
    const dot = container.querySelector(".status-dot");
    expect(dot!.classList.contains("status-dot--pulse")).toBe(false);
  });

  it("reducedMotion=true freezes border (no inline pulse style)", () => {
    const { getByTestId } = renderNode("T-001", {
      status: "running",
      isRunning: true,
      tick: 1,
      reducedMotion: true,
    });
    const node = getByTestId("task-node-T-001");
    // With reduced motion, no inline boxShadow override
    expect(node.style.boxShadow).toBe("");
  });

  it("non-running status has no running class", () => {
    const { getByTestId } = renderNode("T-001", {
      status: "done",
      isRunning: false,
    });
    expect(getByTestId("task-node-T-001").classList.contains("deps-node--running")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Keyboard interaction: Enter/Space → onSelect
// ---------------------------------------------------------------------------

describe("TaskNode — keyboard interaction", () => {
  it("Enter calls onSelect with task id", () => {
    const onSelect = vi.fn();
    const { getByTestId } = renderNode("T-007", { onSelect });
    fireEvent.keyDown(getByTestId("task-node-T-007"), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("T-007");
  });

  it("Space calls onSelect with task id", () => {
    const onSelect = vi.fn();
    const { getByTestId } = renderNode("T-007", { onSelect });
    fireEvent.keyDown(getByTestId("task-node-T-007"), { key: " " });
    expect(onSelect).toHaveBeenCalledWith("T-007");
  });

  it("click calls onSelect with task id", () => {
    const onSelect = vi.fn();
    const { getByTestId } = renderNode("T-007", { onSelect });
    fireEvent.click(getByTestId("task-node-T-007"));
    expect(onSelect).toHaveBeenCalledWith("T-007");
  });

  it("other keys do not call onSelect", () => {
    const onSelect = vi.fn();
    const { getByTestId } = renderNode("T-007", { onSelect });
    fireEvent.keyDown(getByTestId("task-node-T-007"), { key: "Tab" });
    expect(onSelect).not.toHaveBeenCalled();
  });
});
