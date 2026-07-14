import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import type { StoreState, TaskState } from "loopy/tui/store";
import type { OrphanRef } from "../config/pipeline-edit";
import { KanbanBoard } from "./KanbanBoard";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function task(id: string, title: string, status: TaskState["status"] = "ready"): TaskState {
  return { id, title, status, steps: [], stream: "" };
}

function store(
  tasks: TaskState[],
  pipeline: { id: string; type: string }[] = [],
): StoreState {
  return {
    tasks,
    edges: [],
    acpLog: [],
    activeAgents: new Set<string>(),
    pipeline: pipeline as StoreState["pipeline"],
    warnings: [],
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

// ---------------------------------------------------------------------------
// Add step — "+ add step" ghost column (T-012 / SC7)
// ---------------------------------------------------------------------------

describe("KanbanBoard — add step column", () => {
  it("renders '+ add step' column when onAddStep is provided", () => {
    const s = store([], [{ id: "build", type: "shell" }]);
    const { getByTestId } = render(
      <KanbanBoard store={s} onAddStep={vi.fn()} />,
    );
    expect(getByTestId("add-step-column")).toBeTruthy();
  });

  it("does NOT render '+ add step' column when onAddStep is absent", () => {
    const s = store([], [{ id: "build", type: "shell" }]);
    const { queryByTestId } = render(<KanbanBoard store={s} />);
    expect(queryByTestId("add-step-column")).toBeNull();
  });

  it("calls onAddStep when the add button is clicked", () => {
    const onAdd = vi.fn();
    const s = store([], [{ id: "build", type: "shell" }]);
    const { getByTestId } = render(
      <KanbanBoard store={s} onAddStep={onAdd} />,
    );

    fireEvent.click(getByTestId("add-step-column").querySelector("button")!);
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it("'+ add step' column appears after all other columns", () => {
    const s = store([], [
      { id: "build", type: "shell" },
      { id: "test", type: "checks" },
    ]);
    const { container } = render(
      <KanbanBoard store={s} onAddStep={vi.fn()} />,
    );

    const sections = container.querySelectorAll("section.kanban-column");
    // Backlog + build + test + Fim + AddStep = 5
    expect(sections).toHaveLength(5);
    expect(sections[4]!.getAttribute("data-testid")).toBe("add-step-column");
  });
});

// ---------------------------------------------------------------------------
// Reorder — drag handles on pipeline columns (T-012 / SC7)
// ---------------------------------------------------------------------------

describe("KanbanBoard — reorder columns", () => {
  it("renders drag handles on pipeline columns when onReorderStep is provided", () => {
    const s = store([], [
      { id: "build", type: "shell" },
      { id: "test", type: "checks" },
    ]);
    const { getByTestId, queryByTestId } = render(
      <KanbanBoard store={s} onReorderStep={vi.fn()} />,
    );

    expect(getByTestId("drag-handle-build")).toBeTruthy();
    expect(getByTestId("drag-handle-test")).toBeTruthy();
    // Backlog and Fim should NOT have drag handles
    expect(queryByTestId("drag-handle-backlog")).toBeNull();
    expect(queryByTestId("drag-handle-fim")).toBeNull();
  });

  it("does NOT render drag handles when onReorderStep is absent", () => {
    const s = store([], [{ id: "build", type: "shell" }]);
    const { queryByTestId } = render(<KanbanBoard store={s} />);
    expect(queryByTestId("drag-handle-build")).toBeNull();
  });

  it("calls onReorderStep with correct indices on drop", () => {
    const onReorder = vi.fn();
    const s = store([], [
      { id: "build", type: "shell" },
      { id: "test", type: "checks" },
      { id: "deploy", type: "approval" },
    ]);
    const { container } = render(
      <KanbanBoard store={s} onReorderStep={onReorder} />,
    );

    const buildHandle = container.querySelector('[data-testid="drag-handle-build"]')!;
    const testCol = container.querySelector('[data-testid="drag-handle-test"]')!.closest("section")!;

    // jsdom has limited DataTransfer — create a minimal mock
    const dataTransfer = { effectAllowed: "move", dropEffect: "move", setData: vi.fn() };

    // Simulate drag-and-drop: build (index 0) → test (index 1)
    fireEvent.dragStart(buildHandle, { dataTransfer });
    fireEvent.dragOver(testCol, { dataTransfer });
    fireEvent.drop(testCol, { dataTransfer });

    expect(onReorder).toHaveBeenCalledWith(0, 1);
  });
});

// ---------------------------------------------------------------------------
// Remove step (T-012 / SC7)
// ---------------------------------------------------------------------------

describe("KanbanBoard — remove step", () => {
  it("renders remove button on pipeline columns when onRemoveStep is provided", () => {
    const s = store([], [{ id: "build", type: "shell" }]);
    const { getByTestId } = render(
      <KanbanBoard store={s} onRemoveStep={vi.fn()} />,
    );
    expect(getByTestId("remove-step-build")).toBeTruthy();
  });

  it("calls onRemoveStep with the step id on click", () => {
    const onRemove = vi.fn();
    const s = store([], [
      { id: "build", type: "shell" },
      { id: "test", type: "checks" },
    ]);
    const { getByTestId } = render(
      <KanbanBoard store={s} onRemoveStep={onRemove} />,
    );

    fireEvent.click(getByTestId("remove-step-test"));
    expect(onRemove).toHaveBeenCalledWith("test");
  });

  it("does NOT render remove button on Backlog or Fim columns", () => {
    const s = store([], [{ id: "build", type: "shell" }]);
    const { queryByTestId } = render(
      <KanbanBoard store={s} onRemoveStep={vi.fn()} />,
    );

    expect(queryByTestId("remove-step-backlog")).toBeNull();
    expect(queryByTestId("remove-step-fim")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Orphan refs — badges + banner (T-012 / SC7)
// ---------------------------------------------------------------------------

describe("KanbanBoard — orphan refs", () => {
  it("renders orphan banner when orphanRefs is non-empty", () => {
    const refs: OrphanRef[] = [
      { stepId: "build", field: "on_fail", target: "gone" },
    ];
    const s = store([], [{ id: "build", type: "shell" }]);
    const { getByTestId } = render(
      <KanbanBoard store={s} orphanRefs={refs} />,
    );

    expect(getByTestId("orphan-banner")).toBeTruthy();
    expect(getByTestId("orphan-banner").textContent).toContain("gone");
  });

  it("does NOT render orphan banner when orphanRefs is empty", () => {
    const s = store([], [{ id: "build", type: "shell" }]);
    const { queryByTestId } = render(
      <KanbanBoard store={s} orphanRefs={[]} />,
    );
    expect(queryByTestId("orphan-banner")).toBeNull();
  });

  it("renders orphan badge on the column whose step has the dangling ref", () => {
    const refs: OrphanRef[] = [
      { stepId: "build", field: "on_success", target: "deleted-step" },
    ];
    const s = store([], [
      { id: "build", type: "shell" },
      { id: "test", type: "checks" },
    ]);
    const { getByTestId, queryByTestId } = render(
      <KanbanBoard store={s} orphanRefs={refs} />,
    );

    expect(getByTestId("orphan-badge-build")).toBeTruthy();
    expect(queryByTestId("orphan-badge-test")).toBeNull();
  });

  it("removing a step referenced by goto signals orphan", () => {
    // Scenario: "test" step has on_success pointing to "deploy",
    // but "deploy" was removed from the pipeline
    const refs: OrphanRef[] = [
      { stepId: "test", field: "on_success", target: "deploy" },
    ];
    const s = store([], [
      { id: "build", type: "shell" },
      { id: "test", type: "checks" },
    ]);
    const { getByTestId } = render(
      <KanbanBoard store={s} orphanRefs={refs} />,
    );

    // The badge should be on the "test" column (source of the ref)
    expect(getByTestId("orphan-badge-test")).toBeTruthy();
    // The banner should mention the target
    expect(getByTestId("orphan-banner").textContent).toContain("deploy");
  });
});
