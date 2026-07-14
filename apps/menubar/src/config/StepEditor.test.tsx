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
 * T-010 additions:
 * - agent select lists exactly the registry keys (D26)
 * - mode/model/effort selects populated from probed capabilities (D30)
 * - efforts: [] → disabled + reason (OpenCode)
 * - probe failed → text field + reason visible (D31)
 * - unknown value preserved on save (not corrupted)
 *
 * Run: `npm test -w apps/menubar -- StepEditor`
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { ConfigDraftAPI, ConfigError } from "./useConfigDraft";

// Mock useAgentCapabilities BEFORE importing StepEditor (vitest hoists vi.mock).
// Default: idle (no probe) — existing tests keep working unchanged.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockUseAgentCapabilities = vi.fn<(...args: any[]) => any>(() => ({
  status: "idle",
  caps: undefined,
  reason: undefined,
  probe: vi.fn(),
}));
vi.mock("./useAgentCapabilities", () => ({
  // Repassa os argumentos: o 4º (o model sob o qual as capabilities são
  // descobertas) é contrato, não detalhe — há teste que o assere.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useAgentCapabilities: (...args: any[]) => mockUseAgentCapabilities(...args),
}));

import { StepEditor } from "./StepEditor";

// Also test the ⋯ button in KanbanBoard
import type { StoreState, TaskState } from "loopy/tui/store";
import { KanbanBoard } from "../kanban/KanbanBoard";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  mockUseAgentCapabilities.mockClear();
});

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

/** Draft with an agents registry (T-010). */
function makeDraftWithAgents(
  agentOverrides?: Record<string, { command: readonly string[]; model?: string; effort?: string }>,
  draftOverrides?: Record<string, unknown>,
): ConfigDraftAPI {
  const agents = agentOverrides ?? {
    claude: { command: ["npx", "-y", "@anthropic-ai/claude-code", "--agent"] },
    opencode: { command: ["opencode", "acp"] },
    codex: { command: ["npx", "-y", "@openai/codex", "--agent"] },
  };
  return makeDraft({
    draft: {
      workspace: { root: ".", parent_branch: "main", worktrees_dir: ".worktrees" },
      concurrency: 2,
      agents,
      pipeline: [
        { id: "build", type: "agent", prompt: "Build it", agent: "opencode" },
        { id: "test", type: "shell", run: ["npm test"] },
        { id: "review", type: "checks", run: "ci" },
        { id: "deploy", type: "approval", prompt: "Approve deploy?" },
      ],
      ...draftOverrides,
    } as ConfigDraftAPI["draft"],
  });
}

/** Shortcut: render a StepEditor for the first step of a draft-with-agents. */
function renderAgentStep(
  draft?: ConfigDraftAPI,
  extraProps?: Partial<React.ComponentProps<typeof StepEditor>>,
) {
  const d = draft ?? makeDraftWithAgents();
  return render(
    <StepEditor
      stepIndex={0}
      configDraft={d}
      stepIds={["build", "test"]}
      onClose={vi.fn()}
      dir="/project"
      {...extraProps}
    />,
  );
}

function task(id: string, title: string, status: TaskState["status"] = "ready"): TaskState {
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
    warnings: [],
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

  it("editing id calls patch with cascaded pipeline (renameStepId)", () => {
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
    // Cascade renames the step + all goto refs → patches entire pipeline
    expect(draft.patch).toHaveBeenCalledWith(
      "pipeline",
      expect.arrayContaining([expect.objectContaining({ id: "new-id" })]),
    );
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

// ---------------------------------------------------------------------------
// StepEditor — agent select with registry keys (T-010, D26)
// ---------------------------------------------------------------------------

describe("StepEditor — agent select (T-010, D26)", () => {
  it("renders a select with exactly the registry agent keys", () => {
    const { getByLabelText } = renderAgentStep();

    const select = getByLabelText("agent") as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    // "" = default, then the 3 registry keys
    expect(optionValues).toEqual(["", "claude", "opencode", "codex"]);
  });

  it("shows '(default: <name>)' label for the empty option", () => {
    const { getByLabelText } = renderAgentStep();

    const select = getByLabelText("agent") as HTMLSelectElement;
    const defaultOption = select.options[0]!;
    expect(defaultOption.value).toBe("");
    expect(defaultOption.textContent).toContain("(default:");
  });

  it("selected agent value matches step.agent", () => {
    const { getByLabelText } = renderAgentStep();

    const select = getByLabelText("agent") as HTMLSelectElement;
    expect(select.value).toBe("opencode");
  });

  it("falls back to text field when no agents in registry", () => {
    const draft = makeDraft(); // no agents
    const { getByLabelText } = render(
      <StepEditor
        stepIndex={0}
        configDraft={draft}
        stepIds={["build", "test"]}
        onClose={vi.fn()}
      />,
    );

    // Should be an input (text field), not a select
    const agentField = getByLabelText("agent") as HTMLElement;
    expect(agentField.tagName).toBe("INPUT");
  });

  // D29: the yml holds the agent's literal dialect and the engine never
  // translates it, so mode/model/effort picked for the old agent must not
  // survive the switch — they'd linger as "(desconhecido)" in the selects.
  it("clears mode/model/effort when the agent changes", () => {
    const draft = makeDraftWithAgents(undefined, {
      pipeline: [
        {
          id: "build",
          type: "agent",
          prompt: "Build it",
          agent: "claude",
          mode: "acceptEdits",
          model: "opus[1m]",
          effort: "xhigh",
        },
        { id: "test", type: "shell", run: ["npm test"] },
      ],
    });
    const { getByLabelText } = renderAgentStep(draft);

    fireEvent.change(getByLabelText("agent"), { target: { value: "codex" } });

    expect(draft.patch).toHaveBeenCalledWith("pipeline.0.agent", "codex");
    expect(draft.patch).toHaveBeenCalledWith("pipeline.0.mode", undefined);
    expect(draft.patch).toHaveBeenCalledWith("pipeline.0.model", undefined);
    expect(draft.patch).toHaveBeenCalledWith("pipeline.0.effort", undefined);
  });

  it("clears the overrides when switching back to the default agent", () => {
    const draft = makeDraftWithAgents(undefined, {
      pipeline: [
        { id: "build", type: "agent", prompt: "Build it", agent: "codex", model: "gpt-5-codex" },
        { id: "test", type: "shell", run: ["npm test"] },
      ],
    });
    const { getByLabelText } = renderAgentStep(draft);

    fireEvent.change(getByLabelText("agent"), { target: { value: "" } });

    expect(draft.patch).toHaveBeenCalledWith("pipeline.0.agent", undefined);
    expect(draft.patch).toHaveBeenCalledWith("pipeline.0.model", undefined);
  });

  it("does not touch mode/model/effort when re-selecting the same agent", () => {
    const draft = makeDraftWithAgents(undefined, {
      pipeline: [
        { id: "build", type: "agent", prompt: "Build it", agent: "opencode", mode: "build" },
        { id: "test", type: "shell", run: ["npm test"] },
      ],
    });
    const { getByLabelText } = renderAgentStep(draft);

    fireEvent.change(getByLabelText("agent"), { target: { value: "opencode" } });

    expect(draft.patch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// StepEditor — probed mode/model/effort selects (T-010, D30/D31)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// A step with no mode/model/effort override is not "empty" — it runs with the
// agent's own default. The select therefore *sits on that value*: no separate
// placeholder option, which would list the same outcome twice ("default do
// agente: xhigh" next to "xhigh") and leave the reader guessing which is live.
// ---------------------------------------------------------------------------

describe("StepEditor — inherited defaults are selected, not placeheld", () => {
  const codexCaps = {
    modes: ["read-only", "agent", "agent-full-access"],
    models: ["gpt-5.5", "gpt-5-codex"],
    efforts: ["low", "medium", "high", "xhigh"],
    defaultMode: "agent",
    defaultModel: "gpt-5.5",
    defaultEffort: "xhigh",
  };

  function values(select: HTMLSelectElement): string[] {
    return Array.from(select.options).map((o) => o.value);
  }

  function codexDraft(
    agents?: Record<string, { command: string[]; model?: string; effort?: string }>,
  ) {
    return makeDraftWithAgents(
      agents ?? { codex: { command: ["npx", "-y", "@openai/codex", "--agent"] } },
      {
        pipeline: [
          { id: "build", type: "agent", prompt: "Build it", agent: "codex" },
          { id: "test", type: "shell", run: ["npm test"] },
        ],
      },
    );
  }

  it("selects the agent's own default and offers no empty option", () => {
    mockUseAgentCapabilities.mockReturnValue({
      status: "ok",
      caps: codexCaps,
      reason: undefined,
      probe: vi.fn(),
    });

    const { getByLabelText } = renderAgentStep(codexDraft());

    const mode = getByLabelText("mode") as HTMLSelectElement;
    const model = getByLabelText("model") as HTMLSelectElement;
    const effort = getByLabelText("effort") as HTMLSelectElement;

    expect(mode.value).toBe("agent");
    expect(model.value).toBe("gpt-5.5");
    expect(effort.value).toBe("xhigh");

    expect(values(mode)).toEqual(codexCaps.modes);
    expect(values(model)).toEqual(codexCaps.models);
    expect(values(effort)).toEqual(codexCaps.efforts);
    // No duplicate entry for the default: "xhigh" appears exactly once.
    expect(values(effort).filter((v) => v === "xhigh")).toHaveLength(1);
  });

  it("prefers the registry's model/effort over the agent's own default", () => {
    mockUseAgentCapabilities.mockReturnValue({
      status: "ok",
      caps: codexCaps,
      reason: undefined,
      probe: vi.fn(),
    });

    // The engine resolves `step.model ?? registry[agent].model` — so when the
    // registry declares one, *that* is what an empty step field inherits.
    const { getByLabelText } = renderAgentStep(
      codexDraft({
        codex: {
          command: ["npx", "-y", "@openai/codex", "--agent"],
          model: "gpt-5-codex",
          effort: "low",
        },
      }),
    );

    expect((getByLabelText("model") as HTMLSelectElement).value).toBe("gpt-5-codex");
    expect((getByLabelText("effort") as HTMLSelectElement).value).toBe("low");
    // mode has no registry level — still the agent's own default.
    expect((getByLabelText("mode") as HTMLSelectElement).value).toBe("agent");
  });

  it("writes no redundant override when the inherited value is re-selected", () => {
    mockUseAgentCapabilities.mockReturnValue({
      status: "ok",
      caps: codexCaps,
      reason: undefined,
      probe: vi.fn(),
    });

    const draft = makeDraftWithAgents(
      { codex: { command: ["npx", "-y", "@openai/codex", "--agent"] } },
      {
        pipeline: [
          { id: "build", type: "agent", prompt: "Build it", agent: "codex", effort: "low" },
          { id: "test", type: "shell", run: ["npm test"] },
        ],
      },
    );
    const { getByLabelText } = renderAgentStep(draft);

    // Back to the agent's default (xhigh) — the key is dropped, not rewritten.
    fireEvent.change(getByLabelText("effort"), { target: { value: "xhigh" } });
    expect(draft.patch).toHaveBeenCalledWith("pipeline.0.effort", undefined);

    // Any other value is a real override.
    fireEvent.change(getByLabelText("effort"), { target: { value: "medium" } });
    expect(draft.patch).toHaveBeenCalledWith("pipeline.0.effort", "medium");
  });

  it("keeps an empty option when the probe can't name the default", () => {
    mockUseAgentCapabilities.mockReturnValue({
      status: "ok",
      caps: { modes: ["build", "plan"], models: [], efforts: [] },
      reason: undefined,
      probe: vi.fn(),
    });

    const { getByLabelText } = renderAgentStep();

    const mode = getByLabelText("mode") as HTMLSelectElement;
    expect(mode.value).toBe("");
    expect(Array.from(mode.options).find((o) => o.value === "")!.textContent)
      .toBe("default do agente");
  });
});

describe("StepEditor — probed selects (T-010, D30)", () => {
  const opencodeCaps = {
    modes: ["build", "plan"],
    models: ["openai/gpt-4o", "anthropic/claude-3.5-sonnet", "deepseek/deepseek-chat"],
    efforts: [] as string[],
  };

  const claudeCaps = {
    modes: ["auto", "default", "acceptEdits", "plan", "dontAsk", "bypassPermissions"],
    models: ["opus", "sonnet", "haiku"],
    efforts: ["low", "medium", "high", "ultra", "max"],
  };

  it("populates mode select with exactly the probed modes (opencode)", () => {
    mockUseAgentCapabilities.mockReturnValue({
      status: "ok",
      caps: opencodeCaps,
      reason: undefined,
      probe: vi.fn(),
    });

    const { getByLabelText } = renderAgentStep();

    const modeSelect = getByLabelText("mode") as HTMLSelectElement;
    const modeValues = Array.from(modeSelect.options)
      .map((o) => o.value)
      .filter((v) => v !== ""); // skip the "(nenhum)" placeholder
    expect(modeValues).toEqual(["build", "plan"]);
  });

  it("populates model select with the probed models", () => {
    mockUseAgentCapabilities.mockReturnValue({
      status: "ok",
      caps: opencodeCaps,
      reason: undefined,
      probe: vi.fn(),
    });

    const { getByLabelText } = renderAgentStep();

    const modelSelect = getByLabelText("model") as HTMLSelectElement;
    const modelValues = Array.from(modelSelect.options)
      .map((o) => o.value)
      .filter((v) => v !== "");
    // Should contain exactly the probed models — no hardcoded table
    expect(modelValues).toEqual(opencodeCaps.models);
  });

  it("disables effort select when efforts: [] (opencode)", () => {
    mockUseAgentCapabilities.mockReturnValue({
      status: "ok",
      caps: opencodeCaps,
      reason: undefined,
      probe: vi.fn(),
    });

    const { getByLabelText, container } = renderAgentStep();

    const effortSelect = getByLabelText("effort") as HTMLSelectElement;
    expect(effortSelect.disabled).toBe(true);
    // Sem model escolhido, o motivo é ESSE — e não "o agente não anuncia effort".
    // No OpenCode o effort são as variants do model corrente: dizer que o agente
    // não tem effort era falso e escondia um ajuste que funciona.
    const disabledHint = container.querySelector(".field__hint--disabled");
    expect(disabledHint).toBeTruthy();
    expect(disabledHint!.textContent).toContain("effort depende dele");
  });

  it("blames the model (not the agent) when the chosen model has no efforts", () => {
    mockUseAgentCapabilities.mockReturnValue({
      status: "ok",
      caps: opencodeCaps,
      reason: undefined,
      probe: vi.fn(),
    });

    const draft = makeDraftWithAgents({
      opencode: { command: ["opencode", "acp"], model: "opencode/big-pickle" },
    });
    const { container } = renderAgentStep(draft);

    const disabledHint = container.querySelector(".field__hint--disabled");
    expect(disabledHint!.textContent).toContain("opencode/big-pickle");
  });

  it("probes with the step's effective model (step.model ?? registry model)", () => {
    mockUseAgentCapabilities.mockReturnValue({
      status: "ok",
      caps: opencodeCaps,
      reason: undefined,
      probe: vi.fn(),
    });

    const draft = makeDraftWithAgents({
      opencode: { command: ["opencode", "acp"], model: "opencode/big-pickle" },
    });
    renderAgentStep(draft);

    // 4º argumento do hook = o model sob o qual as capabilities são descobertas.
    // Sem ele, o probe do OpenCode roda no model default do adapter e responde
    // "sem effort" mesmo para um agente cujo model tem variants.
    expect(mockUseAgentCapabilities).toHaveBeenCalledWith(
      "opencode",
      ["opencode", "acp"],
      "/project",
      "opencode/big-pickle",
      undefined, // env do agente (ausente neste fixture)
    );
  });

  it("populates effort select with probed efforts (claude)", () => {
    mockUseAgentCapabilities.mockReturnValue({
      status: "ok",
      caps: claudeCaps,
      reason: undefined,
      probe: vi.fn(),
    });

    const draft = makeDraftWithAgents(undefined, {
      pipeline: [
        { id: "build", type: "agent", prompt: "Build it", agent: "claude" },
        { id: "test", type: "shell", run: ["npm test"] },
        { id: "review", type: "checks", run: "ci" },
        { id: "deploy", type: "approval", prompt: "Approve deploy?" },
      ],
    });
    const { getByLabelText } = renderAgentStep(draft);

    const effortSelect = getByLabelText("effort") as HTMLSelectElement;
    expect(effortSelect.disabled).toBe(false);
    const effortValues = Array.from(effortSelect.options)
      .map((o) => o.value)
      .filter((v) => v !== "");
    expect(effortValues).toEqual(claudeCaps.efforts);
  });
});

// ---------------------------------------------------------------------------
// StepEditor — probe failure degrades to text field (T-010, D31)
// ---------------------------------------------------------------------------

describe("StepEditor — probe failure fallback (T-010, D31)", () => {
  it("falls back to text fields when probe fails", () => {
    mockUseAgentCapabilities.mockReturnValue({
      status: "failed",
      caps: undefined,
      reason: "adapter not installed",
      probe: vi.fn(),
    });

    const { getByLabelText } = renderAgentStep();

    // mode/model/effort should be text inputs (not selects)
    expect((getByLabelText("mode") as HTMLElement).tagName).toBe("INPUT");
    expect((getByLabelText("model") as HTMLElement).tagName).toBe("INPUT");
    expect((getByLabelText("effort") as HTMLElement).tagName).toBe("INPUT");
  });

  it("shows probe failure reason", () => {
    mockUseAgentCapabilities.mockReturnValue({
      status: "failed",
      caps: undefined,
      reason: "adapter not installed",
      probe: vi.fn(),
    });

    const { getByTestId } = renderAgentStep();

    const failedMsg = getByTestId("probe-failed");
    expect(failedMsg).toBeTruthy();
    expect(failedMsg.textContent).toContain("adapter not installed");
  });

  it("shows retry button on failure", () => {
    const probeFn = vi.fn();
    mockUseAgentCapabilities.mockReturnValue({
      status: "failed",
      caps: undefined,
      reason: "timeout",
      probe: probeFn,
    });

    const { getByTestId } = renderAgentStep();

    const retryBtn = getByTestId("probe-failed").querySelector("button");
    expect(retryBtn).toBeTruthy();
    fireEvent.click(retryBtn!);
    expect(probeFn).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// StepEditor — unknown values preserved (T-010, D31)
// ---------------------------------------------------------------------------

describe("StepEditor — unknown values preserved (T-010)", () => {
  it("preserves a mode value outside the probed list", () => {
    mockUseAgentCapabilities.mockReturnValue({
      status: "ok",
      caps: {
        modes: ["build", "plan"],
        models: ["openai/gpt-4o"],
        efforts: [],
      },
      reason: undefined,
      probe: vi.fn(),
    });

    // Step has mode: "acceptEdits" which is NOT in opencode's modes
    const draft = makeDraftWithAgents(undefined, {
      pipeline: [
        { id: "build", type: "agent", prompt: "Build it", agent: "opencode", mode: "acceptEdits" },
        { id: "test", type: "shell", run: ["npm test"] },
        { id: "review", type: "checks", run: "ci" },
        { id: "deploy", type: "approval", prompt: "Approve deploy?" },
      ],
    });

    const { getByLabelText } = renderAgentStep(draft);

    const modeSelect = getByLabelText("mode") as HTMLSelectElement;
    // The current value must be in the options (not lost)
    expect(modeSelect.value).toBe("acceptEdits");
    // It should be present as an option (prepended, marked unknown)
    const optionValues = Array.from(modeSelect.options).map((o) => o.value);
    expect(optionValues).toContain("acceptEdits");
    // And marked as unknown in the display text
    const unknownOption = Array.from(modeSelect.options).find((o) => o.value === "acceptEdits");
    expect(unknownOption!.textContent).toContain("desconhecido");
  });

  it("preserves a model value outside the probed list", () => {
    mockUseAgentCapabilities.mockReturnValue({
      status: "ok",
      caps: {
        modes: ["build", "plan"],
        models: ["openai/gpt-4o"],
        efforts: [],
      },
      reason: undefined,
      probe: vi.fn(),
    });

    const draft = makeDraftWithAgents(undefined, {
      pipeline: [
        { id: "build", type: "agent", prompt: "Build it", agent: "opencode", model: "custom-model" },
        { id: "test", type: "shell", run: ["npm test"] },
        { id: "review", type: "checks", run: "ci" },
        { id: "deploy", type: "approval", prompt: "Approve deploy?" },
      ],
    });

    const { getByLabelText } = renderAgentStep(draft);

    const modelSelect = getByLabelText("model") as HTMLSelectElement;
    expect(modelSelect.value).toBe("custom-model");
    const optionValues = Array.from(modelSelect.options).map((o) => o.value);
    expect(optionValues).toContain("custom-model");
  });
});
