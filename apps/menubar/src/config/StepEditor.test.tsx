/**
 * Tests for StepEditor — drawer to edit a pipeline step (T-011).
 *
 * Covers:
 * - ⋯ button opens the drawer with fields for the step type
 * - Editing prompt ⇒ draft/dirty (patch called)
 * - Changing type shows confirm, preserves id+base, discards specifics, revalidates
 * - Escape closes the drawer
 * - Error counter in header
 *
 * Run: `npm test -w apps/menubar -- StepEditor`
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { ConfigDraftAPI, ConfigError } from "./useConfigDraft";
import { StepEditor } from "./StepEditor";

// Also test the ⋯ button in KanbanBoard
import type { StoreState, TaskState } from "loopy/tui/store";
import { KanbanBoard } from "../kanban/KanbanBoard";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(cleanup);

function makeDraft(overrides?: Partial<ConfigDraftAPI>): ConfigDraftAPI {
  return {
    draft: {
      workspace: { root: ".", parent_branch: "main", worktrees_dir: ".worktrees" },
      concurrency: 2,
      pipeline: [
        { id: "build", type: "agent", prompt: "Build it" },
        { id: "test", type: "shell", run: ["npm test"] },
        { id: "review", type: "checks", run: "ci" },
        { id: "deploy", type: "approval", prompt: "Approve deploy?" },
      ],
    } as ConfigDraftAPI["draft"],
    errors: [] as ConfigError[],
    dirty: false,
    tasks: [],
    hasConfig: true,
    load: vi.fn(),
    patch: vi.fn(),
    save: vi.fn().mockResolvedValue(true),
    seedFromTemplate: vi.fn(),
    ...overrides,
  };
}

function task(id: string, title: string, status: TaskState["status"] = "pending"): TaskState {
  return { id, title, status, steps: [], stream: "" };
}

function store(tasks: TaskState[]): StoreState {
  return {
    tasks,
    edges: [],
    acpLog: [],
    activeAgents: new Set<string>(),
    pipeline: [
      { id: "build", type: "agent" },
      { id: "test", type: "shell" },
    ],
  };
}

// ---------------------------------------------------------------------------
// KanbanBoard — ⋯ button (SC2)
// ---------------------------------------------------------------------------

describe("KanbanBoard — ⋯ edit step button (T-011)", () => {
  it("renders ⋯ button in column header when onEditStep is provided", () => {
    const onEditStep = vi.fn();
    const s = store([task("T-001", "First")]);
    const { container } = render(
      <KanbanBoard store={s} onEditStep={onEditStep} />,
    );

    const buttons = container.querySelectorAll(".kanban-column-edit");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("does NOT render ⋯ button when onEditStep is not provided", () => {
    const s = store([task("T-001", "First")]);
    const { container } = render(<KanbanBoard store={s} />);

    const buttons = container.querySelectorAll(".kanban-column-edit");
    expect(buttons.length).toBe(0);
  });

  it("calls onEditStep with the column step id on click", () => {
    const onEditStep = vi.fn();
    const s = store([task("T-001", "First")]);
    const { container } = render(
      <KanbanBoard store={s} onEditStep={onEditStep} />,
    );

    // Columns: Backlog, build, test, Fim — find the one labelled "Edit step build"
    const btn = container.querySelector('[aria-label="Edit step build"]')!;
    fireEvent.click(btn);
    expect(onEditStep).toHaveBeenCalledWith("build");
  });
});

// ---------------------------------------------------------------------------
// StepEditor — rendering and fields
// ---------------------------------------------------------------------------

describe("StepEditor — drawer rendering (T-011)", () => {
  it("renders the drawer with step id and type in header", () => {
    const draft = makeDraft();
    const { getByTestId } = render(
      <StepEditor
        stepIndex={0}
        configDraft={draft}
        stepIds={["build", "test", "review", "deploy"]}
        onClose={vi.fn()}
      />,
    );

    expect(getByTestId("step-editor")).toBeTruthy();
    // id in header
    const header = getByTestId("step-editor").querySelector(".step-editor__header")!;
    expect(header.querySelector(".step-editor__id")!.textContent).toBe("build");
    expect(header.querySelector(".step-editor__type")!.textContent).toBe("agent");
  });

  it("renders agent-specific fields for agent step", () => {
    const draft = makeDraft();
    const { getByLabelText } = render(
      <StepEditor
        stepIndex={0}
        configDraft={draft}
        stepIds={["build", "test", "review", "deploy"]}
        onClose={vi.fn()}
      />,
    );

    expect((getByLabelText("prompt") as HTMLInputElement).value).toBe("Build it");
  });

  it("renders shell-specific fields for shell step", () => {
    const draft = makeDraft();
    const { container } = render(
      <StepEditor
        stepIndex={1}
        configDraft={draft}
        stepIds={["build", "test", "review", "deploy"]}
        onClose={vi.fn()}
      />,
    );

    // Shell step has CommandListEditor for "run"
    const cmdInputs = container.querySelectorAll(".field__cmd-input");
    expect(cmdInputs.length).toBeGreaterThan(0);
    expect((cmdInputs[0] as HTMLInputElement).value).toBe("npm test");
  });

  it("renders checks-specific fields for checks step", () => {
    const draft = makeDraft();
    render(
      <StepEditor
        stepIndex={2}
        configDraft={draft}
        stepIds={["build", "test", "review", "deploy"]}
        onClose={vi.fn()}
      />,
    );

    // The "run" field for checks shows the list name
    const runInputs = document.querySelectorAll('input[id*="run"]');
    // There should be a text input with value "ci"
    const found = Array.from(runInputs).find(
      (el) => (el as HTMLInputElement).value === "ci",
    );
    expect(found).toBeTruthy();
  });

  it("renders approval-specific fields for approval step", () => {
    const draft = makeDraft();
    const { getByLabelText } = render(
      <StepEditor
        stepIndex={3}
        configDraft={draft}
        stepIds={["build", "test", "review", "deploy"]}
        onClose={vi.fn()}
      />,
    );

    expect((getByLabelText("prompt") as HTMLInputElement).value).toBe("Approve deploy?");
  });

  it("Escape closes the drawer", () => {
    const onClose = vi.fn();
    const draft = makeDraft();
    render(
      <StepEditor
        stepIndex={0}
        configDraft={draft}
        stepIds={["build", "test"]}
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// StepEditor — editing calls patch (dirty)
// ---------------------------------------------------------------------------

describe("StepEditor — editing calls patch (T-011)", () => {
  it("editing prompt calls patch with correct path", () => {
    const draft = makeDraft();
    const { getByLabelText } = render(
      <StepEditor
        stepIndex={0}
        configDraft={draft}
        stepIds={["build", "test"]}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(getByLabelText("prompt"), { target: { value: "New prompt" } });
    expect(draft.patch).toHaveBeenCalledWith("pipeline.0.prompt", "New prompt");
  });

  it("editing id calls patch with correct path", () => {
    const draft = makeDraft();
    const { getByLabelText } = render(
      <StepEditor
        stepIndex={0}
        configDraft={draft}
        stepIds={["build", "test"]}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(getByLabelText("id"), { target: { value: "new-id" } });
    expect(draft.patch).toHaveBeenCalledWith("pipeline.0.id", "new-id");
  });
});

// ---------------------------------------------------------------------------
// StepEditor — type migration with confirm (SC10)
// ---------------------------------------------------------------------------

describe("StepEditor — type migration (T-011, SC10)", () => {
  it("selecting a new type shows confirm dialog", () => {
    const draft = makeDraft();
    const { getByLabelText, getByTestId, queryByTestId } = render(
      <StepEditor
        stepIndex={0}
        configDraft={draft}
        stepIds={["build", "test"]}
        onClose={vi.fn()}
      />,
    );

    // No confirm initially
    expect(queryByTestId("type-confirm")).toBeNull();

    // Change type
    fireEvent.change(getByLabelText("type"), { target: { value: "shell" } });
    expect(getByTestId("type-confirm")).toBeTruthy();
  });

  it("confirming type change calls patch with migrated step", () => {
    const draft = makeDraft();
    const { getByLabelText, getByTestId } = render(
      <StepEditor
        stepIndex={0}
        configDraft={draft}
        stepIds={["build", "test"]}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(getByLabelText("type"), { target: { value: "shell" } });
    fireEvent.click(getByTestId("type-confirm-ok"));

    // Should patch the entire step at pipeline.0
    expect(draft.patch).toHaveBeenCalledWith(
      "pipeline.0",
      expect.objectContaining({ type: "shell", id: "build", run: [] }),
    );
    // Should NOT contain agent-specific fields
    const patchCall = (draft.patch as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === "pipeline.0",
    );
    expect(patchCall?.[1]).not.toHaveProperty("prompt");
  });

  it("cancelling type change dismisses confirm without patching", () => {
    const draft = makeDraft();
    const { getByLabelText, getByText, queryByTestId } = render(
      <StepEditor
        stepIndex={0}
        configDraft={draft}
        stepIds={["build", "test"]}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(getByLabelText("type"), { target: { value: "shell" } });
    fireEvent.click(getByText("Cancelar"));

    expect(queryByTestId("type-confirm")).toBeNull();
    // patch should NOT have been called for pipeline.0
    const patchCalls = (draft.patch as ReturnType<typeof vi.fn>).mock.calls;
    const fullStepPatch = patchCalls.find((c) => c[0] === "pipeline.0");
    expect(fullStepPatch).toBeUndefined();
  });

  it("same-type selection does NOT show confirm", () => {
    const draft = makeDraft();
    const { getByLabelText, queryByTestId } = render(
      <StepEditor
        stepIndex={0}
        configDraft={draft}
        stepIds={["build", "test"]}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(getByLabelText("type"), { target: { value: "agent" } });
    expect(queryByTestId("type-confirm")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// StepEditor — error counter in header
// ---------------------------------------------------------------------------

describe("StepEditor — error counter (T-011, R3)", () => {
  it("shows error count badge when step has errors", () => {
    const draft = makeDraft({
      errors: [
        { path: "pipeline.0.prompt", message: "Required" },
        { path: "pipeline.0.on_fail", message: "Requires verify or expect" },
      ],
    });
    const { getByTestId } = render(
      <StepEditor
        stepIndex={0}
        configDraft={draft}
        stepIds={["build", "test"]}
        onClose={vi.fn()}
      />,
    );

    const badge = getByTestId("step-error-count");
    expect(badge.textContent).toBe("2");
  });

  it("hides error count badge when step has no errors", () => {
    const draft = makeDraft({ errors: [] });
    const { queryByTestId } = render(
      <StepEditor
        stepIndex={0}
        configDraft={draft}
        stepIds={["build", "test"]}
        onClose={vi.fn()}
      />,
    );

    expect(queryByTestId("step-error-count")).toBeNull();
  });

  it("only counts errors for the current step", () => {
    const draft = makeDraft({
      errors: [
        { path: "pipeline.0.prompt", message: "Required" },
        { path: "pipeline.1.run", message: "Empty" },
        { path: "concurrency", message: "Too low" },
      ],
    });
    const { getByTestId } = render(
      <StepEditor
        stepIndex={0}
        configDraft={draft}
        stepIds={["build", "test"]}
        onClose={vi.fn()}
      />,
    );

    expect(getByTestId("step-error-count").textContent).toBe("1");
  });
});
