import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { COLORS, SYMBOLS, pulseFrame } from "loopy/tui/view";
import type { TaskStatus } from "loopy/tui/store";

afterEach(cleanup);

// Mock @xyflow/react — avoids the dual-React-copies issue in this monorepo
// (root = React 19 for Ink, menubar = React 18). We only need Handle to render
// as no-op; the component itself is plain JSX.
vi.mock("@xyflow/react", () => ({
  Handle: () => null,
  Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
}));

const { default: TaskNode } = await import("./TaskNode");

/** Render TaskNode with given status and tick, return the node element. */
function renderNode(id: string, status: TaskStatus, tick: number) {
  const props = {
    id,
    data: { status, tick },
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
// Color + glyph per status
// ---------------------------------------------------------------------------

const ALL_STATUSES: TaskStatus[] = [
  "pending",
  "blocked",
  "running",
  "done",
  "escalated",
  "skipped",
  "paused",
];

describe("TaskNode — COLORS[status] + glyph", () => {
  for (const status of ALL_STATUSES) {
    it(`renders ${status}: color=${COLORS.task[status]}, glyph=${SYMBOLS.task[status]}`, () => {
      const { getByTestId } = renderNode("T-001", status, 0);
      const node = getByTestId("task-node-T-001");
      expect(node.style.color).toBe(COLORS.task[status]);
      expect(node.textContent).toContain(SYMBOLS.task[status]);
    });
  }
});

// ---------------------------------------------------------------------------
// Pulse on running
// ---------------------------------------------------------------------------

describe("TaskNode — pulse on running", () => {
  it("tick=0 (on) → bold, opacity=1", () => {
    expect(pulseFrame(0)).toBe("on");
    const { getByTestId } = renderNode("T-001", "running", 0);
    const node = getByTestId("task-node-T-001");
    expect(node.style.fontWeight).toBe("bold");
    expect(node.style.opacity).toBe("1");
  });

  it("tick=1 (off) → no bold, opacity=0.5", () => {
    expect(pulseFrame(1)).toBe("off");
    const { getByTestId } = renderNode("T-001", "running", 1);
    const node = getByTestId("task-node-T-001");
    expect(node.style.fontWeight).not.toBe("bold");
    expect(node.style.opacity).toBe("0.5");
  });

  it("non-running status ignores pulse (always opacity=1)", () => {
    const { getByTestId } = renderNode("T-001", "done", 1);
    const node = getByTestId("task-node-T-001");
    expect(node.style.opacity).toBe("1");
  });
});
