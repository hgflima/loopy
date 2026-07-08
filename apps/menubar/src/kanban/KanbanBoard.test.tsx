import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { StoreState, TaskState } from "loopy/tui/store";
import { KanbanBoard } from "./KanbanBoard";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function task(id: string, title: string, status: TaskState["status"] = "pending"): TaskState {
  return { id, title, status, steps: [], stream: "" };
}

function store(tasks: TaskState[]): StoreState {
  return {
    tasks,
    edges: [],
    acpLog: [],
    activeAgents: new Set<string>(),
    pipeline: [],
  };
}

/** Return the first .kanban-card element. */
function firstCard(container: HTMLElement): HTMLElement {
  const card = container.querySelector(".kanban-card");
  if (!card) throw new Error("No .kanban-card found");
  return card as HTMLElement;
}

// ---------------------------------------------------------------------------
// Selection — click, Enter, Space, toggle
// ---------------------------------------------------------------------------

describe("KanbanBoard — card selection", () => {
  it("calls onSelectTask with taskId when a card is clicked", () => {
    const onSelect = vi.fn();
    const s = store([task("T-001", "First")]);
    const { container } = render(
      <KanbanBoard store={s} onSelectTask={onSelect} />,
    );

    fireEvent.click(firstCard(container));
    expect(onSelect).toHaveBeenCalledWith("T-001");
  });

  it("calls onSelectTask on Enter key", () => {
    const onSelect = vi.fn();
    const s = store([task("T-001", "First")]);
    const { container } = render(
      <KanbanBoard store={s} onSelectTask={onSelect} />,
    );

    fireEvent.keyDown(firstCard(container), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("T-001");
  });

  it("calls onSelectTask on Space key", () => {
    const onSelect = vi.fn();
    const s = store([task("T-001", "First")]);
    const { container } = render(
      <KanbanBoard store={s} onSelectTask={onSelect} />,
    );

    fireEvent.keyDown(firstCard(container), { key: " " });
    expect(onSelect).toHaveBeenCalledWith("T-001");
  });

  it("does not call onSelectTask on other keys", () => {
    const onSelect = vi.fn();
    const s = store([task("T-001", "First")]);
    const { container } = render(
      <KanbanBoard store={s} onSelectTask={onSelect} />,
    );

    fireEvent.keyDown(firstCard(container), { key: "Tab" });
    expect(onSelect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Selected state — visual class
// ---------------------------------------------------------------------------

describe("KanbanBoard — selected state", () => {
  it("adds kanban-card--selected class when selectedTaskId matches", () => {
    const s = store([task("T-001", "First")]);
    const { container } = render(
      <KanbanBoard store={s} selectedTaskId="T-001" />,
    );

    expect(firstCard(container).classList.contains("kanban-card--selected")).toBe(true);
  });

  it("does not add kanban-card--selected when selectedTaskId differs", () => {
    const s = store([task("T-001", "First")]);
    const { container } = render(
      <KanbanBoard store={s} selectedTaskId="T-999" />,
    );

    expect(firstCard(container).classList.contains("kanban-card--selected")).toBe(false);
  });

  it("cards have role=button and tabIndex=0 for accessibility", () => {
    const s = store([task("T-001", "First")]);
    const { container } = render(<KanbanBoard store={s} />);

    const card = firstCard(container);
    expect(card.getAttribute("role")).toBe("button");
    expect(card.getAttribute("tabindex")).toBe("0");
  });

  it("sets aria-pressed based on selection", () => {
    const s = store([task("T-001", "First"), task("T-002", "Second")]);
    const { container } = render(
      <KanbanBoard store={s} selectedTaskId="T-001" />,
    );

    const cards = container.querySelectorAll(".kanban-card");
    expect(cards[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(cards[1]?.getAttribute("aria-pressed")).toBe("false");
  });
});
