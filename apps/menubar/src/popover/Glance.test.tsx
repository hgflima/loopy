/**
 * Tests for T-006: Glance popover — off-brand → design system.
 *
 * Covers:
 * - Three visual states: idle / running / gate
 * - "Abrir" invokes `show_main_window`; "Parar" disabled when idle
 * - DS compliance: classes (btn--primary, status-dot--running), zero inline colors
 *
 * Run: `npm test -w apps/menubar -- Glance`
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { BridgeState } from "../state/store-bridge";
import type { TaskStatus } from "loopy/tui/store";

afterEach(cleanup);

// Mock Tauri invoke — hoisted before dynamic import
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const { Glance } = await import("./Glance");

// ---------------------------------------------------------------------------
// State builders
// ---------------------------------------------------------------------------

function makeTask(id: string, status: TaskStatus) {
  return { id, title: `Task ${id}`, status, steps: [] as never[], stream: "" };
}

function emptyStore(tasks: ReturnType<typeof makeTask>[] = []) {
  return {
    tasks,
    edges: [] as const,
    acpLog: [] as const,
    activeAgents: new Set<string>(),
    pipeline: [] as const,
  };
}

function idleState(): BridgeState {
  return {
    store: emptyStore(),
    ui: { runStatus: "idle", pendingApprovals: [], stderrTail: [] },
    transcript: {},
  };
}

function runningState(
  opts: {
    done?: number;
    running?: number;
    pending?: number;
    warnings?: number;
  } = {},
): BridgeState {
  const { done = 1, running = 2, pending = 0, warnings = 0 } = opts;
  const tasks = [
    ...Array.from({ length: done }, (_, i) => makeTask(`T-D${i}`, "done")),
    ...Array.from({ length: running }, (_, i) =>
      makeTask(`T-R${i}`, "running"),
    ),
    ...Array.from({ length: pending }, (_, i) =>
      makeTask(`T-P${i}`, "pending"),
    ),
  ];
  const pendingApprovals = Array.from({ length: warnings }, (_, i) => ({
    requestId: `req-${i}`,
    taskId: `T-R0`,
    stepId: "merge",
    summary: "Approve?",
  }));
  return {
    store: emptyStore(tasks),
    ui: { runStatus: "running", pendingApprovals, stderrTail: [] },
    transcript: {},
  };
}

// ---------------------------------------------------------------------------
// Idle state
// ---------------------------------------------------------------------------

describe("Glance — idle", () => {
  it("shows 'Nenhum run ativo'", () => {
    const { getByText } = render(
      <Glance state={idleState()} yesFlag={false} />,
    );
    expect(getByText("Nenhum run ativo")).toBeTruthy();
  });

  it("hides delegation info", () => {
    const { queryByText } = render(
      <Glance state={idleState()} yesFlag={false} />,
    );
    expect(queryByText(/delegação/)).toBeNull();
  });

  it("disables 'Parar'", () => {
    const { getByText } = render(
      <Glance state={idleState()} yesFlag={false} />,
    );
    expect((getByText("Parar") as HTMLButtonElement).disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Running state
// ---------------------------------------------------------------------------

describe("Glance — running", () => {
  it("shows done/total progress", () => {
    const { container } = render(
      <Glance
        state={runningState({ done: 2, running: 1, pending: 3 })}
        yesFlag={false}
      />,
    );
    expect(container.textContent).toContain("2/6");
  });

  it("shows running count with StatusDot", () => {
    const { container } = render(
      <Glance state={runningState({ running: 1 })} yesFlag={false} />,
    );
    expect(container.querySelector(".status-dot--running")).toBeTruthy();
    expect(container.textContent).toContain("1 running");
  });

  it("shows delegation --yes ON", () => {
    const { container } = render(
      <Glance state={runningState()} yesFlag={true} />,
    );
    expect(container.textContent).toContain("--yes ON");
  });

  it("shows delegation --yes OFF", () => {
    const { container } = render(
      <Glance state={runningState()} yesFlag={false} />,
    );
    expect(container.textContent).toContain("--yes OFF");
  });

  it("enables 'Parar'", () => {
    const { getByText } = render(
      <Glance state={runningState()} yesFlag={false} />,
    );
    expect((getByText("Parar") as HTMLButtonElement).disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Gate state (warnings > 0)
// ---------------------------------------------------------------------------

describe("Glance — gate", () => {
  it("shows gate count in accent Pill", () => {
    const { container } = render(
      <Glance state={runningState({ warnings: 2 })} yesFlag={false} />,
    );
    const pill = container.querySelector(".status-pill--accent");
    expect(pill).toBeTruthy();
    expect(pill!.textContent).toContain("2");
  });

  it("shows gate count in delegation line", () => {
    const { container } = render(
      <Glance state={runningState({ warnings: 3 })} yesFlag={false} />,
    );
    expect(container.textContent).toContain("3 gates");
  });

  it("singular 'gate' for 1 warning", () => {
    const { container } = render(
      <Glance state={runningState({ warnings: 1 })} yesFlag={false} />,
    );
    expect(container.textContent).toContain("1 gate");
    expect(container.textContent).not.toContain("1 gates");
  });
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

describe("Glance — actions", () => {
  beforeEach(() => mockInvoke.mockClear());

  it("'Abrir' invokes show_main_window", () => {
    const { getByText } = render(
      <Glance state={runningState()} yesFlag={false} />,
    );
    fireEvent.click(getByText("Abrir"));
    expect(mockInvoke).toHaveBeenCalledWith("show_main_window");
  });

  it("'Abrir' has btn--primary class", () => {
    const { getByText } = render(
      <Glance state={runningState()} yesFlag={false} />,
    );
    expect(getByText("Abrir").classList.contains("btn--primary")).toBe(true);
  });

  it("'Parar' has btn--secondary class", () => {
    const { getByText } = render(
      <Glance state={runningState()} yesFlag={false} />,
    );
    expect(getByText("Parar").classList.contains("btn--secondary")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DS compliance: zero inline color literals
// ---------------------------------------------------------------------------

describe("Glance — no color literals in DOM", () => {
  const COLOR_RE =
    /#[0-9a-fA-F]{3,8}\b|rgba?\(|oklch\(|cyan|orange|blue|red|green|magenta/;

  function collectStyles(container: Element): string {
    const parts: string[] = [];
    container
      .querySelectorAll("[style]")
      .forEach((el) => parts.push((el as HTMLElement).style.cssText));
    return parts.join(" ");
  }

  it("idle: no inline color styles", () => {
    const { container } = render(
      <Glance state={idleState()} yesFlag={false} />,
    );
    expect(collectStyles(container)).not.toMatch(COLOR_RE);
  });

  it("running + gate: no inline color styles", () => {
    const { container } = render(
      <Glance state={runningState({ warnings: 2 })} yesFlag={false} />,
    );
    expect(collectStyles(container)).not.toMatch(COLOR_RE);
  });
});
