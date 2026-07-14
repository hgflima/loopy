/**
 * Tests for T-007: Glance popover — status header → native NSMenu (C-0012).
 *
 * Covers the acceptance criteria:
 *  - layout: status header → separator → Abrir/Parar → separator → Sobre/Sair,
 *    each item with a monochrome icon;
 *  - the "delegação: --yes …" sub-line is gone;
 *  - Parar is `aria-disabled` when idle, enabled when a run is running;
 *  - each item invokes the right Tauri command (mock `@tauri-apps/api/core`);
 *  - keyboard: ↑/↓ rove focus, Enter activates, Esc closes the popover;
 *  - every activation (Parar included) closes the popover like a native menu;
 *  - the height re-measure (ResizeObserver → resize_popover) is preserved;
 *  - zero color literals in the DOM or the stylesheet.
 *
 * Run: `npm test -w apps/menubar -- Glance`
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { BridgeState } from "../state/store-bridge";
import type { TaskStatus } from "loopy/tui/store";

afterEach(cleanup);

// Mock Tauri `invoke` + `isTauri`. `invoke` returns a resolved promise so the
// component can `.catch` it; `isTauri` is a controllable spy — false by default
// (Tauri-only window plumbing stays inert under jsdom), flipped to true for the
// tests that exercise the popover-close / re-measure paths. The popover-close
// path is `invoke("hide_popover")` (the native `hide_popover_panel`/order_out
// route in panel.rs), so it's observable through `mockInvoke`.
const mockInvoke = vi.fn();
const mockIsTauri = vi.fn(() => false);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => {
    mockInvoke(...args);
    return Promise.resolve();
  },
  isTauri: () => mockIsTauri(),
}));

// jsdom has no ResizeObserver; the re-measure effect needs one when isTauri=true.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

const { Glance } = await import("./Glance");

beforeEach(() => {
  mockInvoke.mockClear();
  mockIsTauri.mockReturnValue(false);
});

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
      makeTask(`T-P${i}`, "ready"),
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
// Status header (the glanceable altitude above the menu)
// ---------------------------------------------------------------------------

describe("Glance — status header", () => {
  it("shows 'Nenhum run ativo' when idle", () => {
    render(<Glance state={idleState()} />);
    expect(screen.getByText("Nenhum run ativo")).toBeTruthy();
  });

  it("shows done/total progress when running", () => {
    const { container } = render(
      <Glance state={runningState({ done: 2, running: 1, pending: 3 })} />,
    );
    expect(container.textContent).toContain("2/6");
  });

  it("shows the running count with a StatusDot", () => {
    const { container } = render(
      <Glance state={runningState({ running: 1 })} />,
    );
    expect(container.querySelector(".status-dot--running")).toBeTruthy();
    expect(container.textContent).toContain("1 running");
  });

  it("shows the gate count in an accent Pill", () => {
    const { container } = render(
      <Glance state={runningState({ warnings: 2 })} />,
    );
    const pill = container.querySelector(".status-pill--accent");
    expect(pill).toBeTruthy();
    expect(pill!.textContent).toContain("2");
  });

  it("drops the '--yes' delegation sub-line", () => {
    const idle = render(<Glance state={idleState()} />);
    expect(idle.queryByText(/delegação/)).toBeNull();
    cleanup();
    const running = render(<Glance state={runningState()} />);
    expect(running.queryByText(/delegação/)).toBeNull();
    expect(running.container.textContent).not.toContain("--yes");
  });
});

// ---------------------------------------------------------------------------
// Menu layout: header → sep → Abrir/Parar → sep → Sobre/Sair, each with an icon
// ---------------------------------------------------------------------------

const ITEMS = ["Abrir", "Parar", "Sobre", "Sair"] as const;

describe("Glance — menu layout", () => {
  it("renders a role=menu with the four items in order", () => {
    render(<Glance state={runningState()} />);
    expect(screen.getByRole("menu")).toBeTruthy();
    const labels = screen
      .getAllByRole("menuitem")
      .map((el) => el.textContent?.trim());
    expect(labels).toEqual([...ITEMS]);
  });

  it("gives every item a monochrome icon", () => {
    render(<Glance state={runningState()} />);
    for (const name of ITEMS) {
      const item = screen.getByRole("menuitem", { name });
      const svg = item.querySelector("svg");
      expect(svg).toBeTruthy();
      // Decorative: the icon is hidden from the a11y tree.
      expect(svg!.closest("[aria-hidden]")?.getAttribute("aria-hidden")).toBe(
        "true",
      );
    }
  });

  it("places two separators between the groups", () => {
    render(<Glance state={runningState()} />);
    expect(screen.getAllByRole("separator")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Parar enable/disable
// ---------------------------------------------------------------------------

describe("Glance — Parar enable state", () => {
  it("is aria-disabled when idle", () => {
    render(<Glance state={idleState()} />);
    const parar = screen.getByRole("menuitem", { name: "Parar" });
    expect(parar.getAttribute("aria-disabled")).toBe("true");
  });

  it("is enabled when a run is running", () => {
    render(<Glance state={runningState()} />);
    const parar = screen.getByRole("menuitem", { name: "Parar" });
    expect(parar.getAttribute("aria-disabled")).toBeNull();
  });

  it("does not invoke stop_sidecar when clicked while idle", () => {
    render(<Glance state={idleState()} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "Parar" }));
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Each item invokes the right command
// ---------------------------------------------------------------------------

describe("Glance — item commands", () => {
  const CASES: Array<[(typeof ITEMS)[number], string]> = [
    ["Abrir", "show_main_window"],
    ["Parar", "stop_sidecar"],
    ["Sobre", "show_about_window"],
    ["Sair", "quit_app"],
  ];

  for (const [name, command] of CASES) {
    it(`'${name}' invokes ${command}`, () => {
      render(<Glance state={runningState()} />);
      fireEvent.click(screen.getByRole("menuitem", { name }));
      expect(mockInvoke).toHaveBeenCalledWith(command);
    });
  }
});

// ---------------------------------------------------------------------------
// Keyboard: ↑/↓ rove, Enter activates, Esc closes
// ---------------------------------------------------------------------------

describe("Glance — keyboard", () => {
  it("↓ moves focus onto the first enabled item", () => {
    render(<Glance state={idleState()} />);
    // Idle → Parar is disabled, so the first enabled row is Abrir.
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Abrir" }),
    );
  });

  it("Enter on a focused item activates it", () => {
    render(<Glance state={runningState()} />);
    const abrir = screen.getByRole("menuitem", { name: "Abrir" });
    abrir.focus();
    fireEvent.keyDown(abrir, { key: "Enter" });
    expect(mockInvoke).toHaveBeenCalledWith("show_main_window");
  });

  it("Esc closes the popover", () => {
    mockIsTauri.mockReturnValue(true);
    render(<Glance state={idleState()} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(mockInvoke).toHaveBeenCalledWith("hide_popover");
  });
});

// ---------------------------------------------------------------------------
// Native menu semantics: every activation closes the popover
// ---------------------------------------------------------------------------

describe("Glance — activation closes the popover", () => {
  it("Parar stops the sidecar AND closes the popover", () => {
    mockIsTauri.mockReturnValue(true);
    render(<Glance state={runningState()} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "Parar" }));
    expect(mockInvoke).toHaveBeenCalledWith("stop_sidecar");
    expect(mockInvoke).toHaveBeenCalledWith("hide_popover");
  });

  it("Abrir closes the popover", () => {
    mockIsTauri.mockReturnValue(true);
    render(<Glance state={runningState()} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "Abrir" }));
    expect(mockInvoke).toHaveBeenCalledWith("show_main_window");
    expect(mockInvoke).toHaveBeenCalledWith("hide_popover");
  });
});

// ---------------------------------------------------------------------------
// Height re-measure (ResizeObserver → resize_popover) preserved
// ---------------------------------------------------------------------------

describe("Glance — height re-measure", () => {
  it("reports the measured content height via resize_popover on mount", () => {
    mockIsTauri.mockReturnValue(true);
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ height: 120 } as DOMRect);
    render(<Glance state={runningState()} />);
    expect(mockInvoke).toHaveBeenCalledWith("resize_popover", { height: 120 });
    rectSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// DS compliance: zero color literals
// ---------------------------------------------------------------------------

describe("Glance — no color literals", () => {
  const COLOR_RE =
    /#[0-9a-fA-F]{3,8}\b|rgba?\(|oklch\(|cyan|orange|blue|red|green|magenta/;

  function collectInlineStyles(container: Element): string {
    return Array.from(container.querySelectorAll<HTMLElement>("[style]"))
      .map((el) => el.style.cssText)
      .join(" ");
  }

  it("has no inline color styles (idle)", () => {
    const { container } = render(<Glance state={idleState()} />);
    expect(collectInlineStyles(container)).not.toMatch(COLOR_RE);
  });

  it("has no inline color styles (running + gate)", () => {
    const { container } = render(
      <Glance state={runningState({ warnings: 2 })} />,
    );
    expect(collectInlineStyles(container)).not.toMatch(COLOR_RE);
  });

  it("uses only design tokens — no color literals in Glance.css", () => {
    const css = readFileSync(resolve(import.meta.dirname, "Glance.css"), "utf8");
    const colorLiteral =
      /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\s*\(/;
    expect(colorLiteral.test(css)).toBe(false);
  });
});
