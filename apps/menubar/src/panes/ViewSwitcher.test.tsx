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

let configPaneProps: Record<string, unknown> = {};
vi.mock("../config/ConfigPane", () => ({
  ConfigPane: (props: Record<string, unknown>) => {
    configPaneProps = props;
    return <div data-testid="config-pane" />;
  },
}));

let insightsPaneProps: Record<string, unknown> = {};
vi.mock("../insights/InsightsPane", () => ({
  InsightsPane: (props: Record<string, unknown>) => {
    insightsPaneProps = props;
    return <div data-testid="insights-pane" />;
  },
}));

// SpecsPane pulls in useAgentCapabilities/Interview (heavy, Tauri-bound) — mock it
// and only assert the forwarded props (T-014 wires it up; T-013 owns its behaviour).
let specsPaneProps: Record<string, unknown> = {};
vi.mock("../specs/SpecsPane", () => ({
  SpecsPane: (props: Record<string, unknown>) => {
    specsPaneProps = props;
    return <div data-testid="specs-pane" />;
  },
}));

const { ViewSwitcher } = await import("./ViewSwitcher");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  kanbanProps = {};
  depsFlowProps = {};
  configPaneProps = {};
  insightsPaneProps = {};
  specsPaneProps = {};
});

function makeStore(taskIds: string[] = ["T-001"]): StoreState {
  return {
    tasks: taskIds.map((id) => ({
      id,
      title: `Task ${id}`,
      status: "ready" as const,
      steps: [],
      stream: "",
    })),
    edges: [] as [string, string][],
    acpLog: [],
    activeAgents: new Set<string>(),
    pipeline: [],
    warnings: [],
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

describe("ViewSwitcher — Config tab (T-008)", () => {
  const fakeConfigDraft = {
    draft: { workspace: { root: ".", parent_branch: "main", worktrees_dir: ".worktrees" }, concurrency: 1 },
    errors: [],
    dirty: false,
    tasks: [],
    load: vi.fn(),
    patch: vi.fn(),
    save: vi.fn(),
  } as unknown as import("../config/useConfigDraft").ConfigDraftAPI;

  it("renders a Config segment that switches to the Config pane", () => {
    const { getByTestId, getByRole } = render(
      <ViewSwitcher store={makeStore()} tick={0} configDraft={fakeConfigDraft} />,
    );

    // Config segment exists
    const configButton = getByRole("radio", { name: "Config" });
    expect(configButton).toBeTruthy();

    // Click Config
    fireEvent.click(configButton);

    // ConfigPane is mounted
    expect(getByTestId("config-pane")).toBeTruthy();
    // ConfigPane received the draft
    expect(configPaneProps.configDraft).toBe(fakeConfigDraft);
  });

  it("all three panes stay mounted when switching to Config", () => {
    const { getByTestId, getByRole } = render(
      <ViewSwitcher store={makeStore()} tick={0} configDraft={fakeConfigDraft} />,
    );

    fireEvent.click(getByRole("radio", { name: "Config" }));

    expect(getByTestId("kanban-board")).toBeTruthy();
    expect(getByTestId("deps-flow")).toBeTruthy();
    expect(getByTestId("config-pane")).toBeTruthy();
  });

  it("does not render ConfigPane when configDraft is undefined", () => {
    const { queryByTestId } = render(
      <ViewSwitcher store={makeStore()} tick={0} />,
    );
    expect(queryByTestId("config-pane")).toBeNull();
  });

  /**
   * Regressão: o `dir` era declarado no `ConfigPane` mas nunca chegava nele —
   * ninguém repassava aqui. Sem `dir`, `useAgentCapabilities` devolve `idle` e
   * os selects sondados de model/effort degradam silenciosamente para texto
   * livre. Como a prop é opcional, o `tsc` não reclamava, e os testes do
   * `ConfigPane` renderizam o componente direto (com `dir`) — a ligação ficava
   * descoberta. É este teste que a cobre.
   */
  it("forwards dir to ConfigPane (senão a Sondagem nunca roda)", () => {
    render(
      <ViewSwitcher
        store={makeStore()}
        tick={0}
        configDraft={fakeConfigDraft}
        dir="/meu/projeto"
      />,
    );
    expect(configPaneProps.dir).toBe("/meu/projeto");
  });
});

describe("ViewSwitcher — Insights tab (T-011)", () => {
  it("renders an Insights segment that switches to the InsightsPane", () => {
    const { getByTestId, getByRole } = render(
      <ViewSwitcher store={makeStore()} tick={0} dir="/meu/projeto" />,
    );

    const insightsButton = getByRole("radio", { name: "Insights" });
    expect(insightsButton).toBeTruthy();

    fireEvent.click(insightsButton);

    expect(getByTestId("insights-pane")).toBeTruthy();
    // The pane needs `dir` to read the telemetry `.db` (SELECT-only via Rust).
    expect(insightsPaneProps.dir).toBe("/meu/projeto");
  });

  it("all four panes stay mounted when switching to Insights (state preserved)", () => {
    const { getByTestId, getByRole } = render(<ViewSwitcher store={makeStore()} tick={0} />);

    fireEvent.click(getByRole("radio", { name: "Insights" }));

    expect(getByTestId("kanban-board")).toBeTruthy();
    expect(getByTestId("deps-flow")).toBeTruthy();
    expect(getByTestId("insights-pane")).toBeTruthy();
  });

  it("Insights is available during a run too (no configDraft needed)", () => {
    // configDraft is undefined during a run — the pane must still mount (idle+run).
    const { getByTestId, getByRole } = render(<ViewSwitcher store={makeStore()} tick={0} />);
    fireEvent.click(getByRole("radio", { name: "Insights" }));
    expect(getByTestId("insights-pane")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Global save bar — Save is reachable from every tab, because edits also happen
// on the board (steps via ⋯, columns via add/remove/reorder), not only in Config.
// ---------------------------------------------------------------------------

describe("ViewSwitcher — global save bar", () => {
  function makeDraft(
    over: Partial<import("../config/useConfigDraft").ConfigDraftAPI> = {},
  ): import("../config/useConfigDraft").ConfigDraftAPI {
    return {
      draft: { workspace: { root: "." }, concurrency: 1 },
      errors: [],
      dirty: false,
      tasks: [],
      hasConfig: true,
      load: vi.fn(),
      patch: vi.fn(),
      save: vi.fn().mockResolvedValue(true),
      seedFromTemplate: vi.fn(),
      ...over,
    } as unknown as import("../config/useConfigDraft").ConfigDraftAPI;
  }

  it("hides the save bar when the draft is clean", () => {
    const { queryByTestId } = render(
      <ViewSwitcher store={makeStore()} tick={0} configDraft={makeDraft({ dirty: false })} />,
    );
    expect(queryByTestId("save-bar")).toBeNull();
    expect(queryByTestId("btn-save")).toBeNull();
  });

  it("hides the save bar when there is no configDraft (during a run)", () => {
    const { queryByTestId } = render(<ViewSwitcher store={makeStore()} tick={0} />);
    expect(queryByTestId("save-bar")).toBeNull();
  });

  it("shows dirty indicator + enabled Salvar when dirty and valid", () => {
    const draft = makeDraft({ dirty: true });
    const { getByTestId } = render(
      <ViewSwitcher store={makeStore()} tick={0} configDraft={draft} />,
    );

    expect(getByTestId("dirty-indicator")).toBeTruthy();
    const btn = getByTestId("btn-save") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);

    fireEvent.click(btn);
    expect(draft.save).toHaveBeenCalled();
  });

  it("is visible from the Kanban tab — not only from Config (the whole point)", () => {
    const { getByTestId, getByRole } = render(
      <ViewSwitcher store={makeStore()} tick={0} configDraft={makeDraft({ dirty: true })} />,
    );
    // Default view is Kanban — where steps/columns are edited.
    expect(getByRole("radio", { name: "Kanban" })).toBeTruthy();
    expect(getByTestId("btn-save")).toBeTruthy();
  });

  it("Salvar is disabled and an error hint shows when errors exist (fail-closed, C4)", () => {
    const draft = makeDraft({
      dirty: true,
      errors: [
        { path: "concurrency", message: "too low" },
        { path: "workspace.root", message: "Required" },
      ],
    });
    const { getByTestId, queryByTestId } = render(
      <ViewSwitcher store={makeStore()} tick={0} configDraft={draft} />,
    );

    expect((getByTestId("btn-save") as HTMLButtonElement).disabled).toBe(true);
    expect(getByTestId("save-error-hint").textContent).toContain("2 erros");
    // The plain dirty label is replaced by the actionable hint.
    expect(queryByTestId("dirty-indicator")).toBeNull();

    fireEvent.click(getByTestId("btn-save"));
    expect(draft.save).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Specs tab (T-014, D20) — the fifth segment, always mounted, reachable with or
// without a loopy.yml (authoring precedes the yml).
// ---------------------------------------------------------------------------

describe("ViewSwitcher — Specs tab (T-014, D20)", () => {
  function draftWith(
    over: Partial<import("../config/useConfigDraft").ConfigDraftAPI> = {},
  ): import("../config/useConfigDraft").ConfigDraftAPI {
    return {
      draft: { workspace: { root: "." }, concurrency: 1 },
      errors: [],
      dirty: false,
      tasks: [],
      hasConfig: true,
      load: vi.fn(),
      patch: vi.fn(),
      save: vi.fn(),
      seedFromTemplate: vi.fn(),
      ...over,
    } as unknown as import("../config/useConfigDraft").ConfigDraftAPI;
  }

  it("renders a Specs segment that switches to the SpecsPane", () => {
    const { getByTestId, getByRole } = render(
      <ViewSwitcher store={makeStore()} tick={0} dir="/meu/projeto" />,
    );

    const specsButton = getByRole("radio", { name: "Specs" });
    expect(specsButton).toBeTruthy();

    fireEvent.click(specsButton);

    expect(getByTestId("specs-pane")).toBeTruthy();
    // The pane needs `dir` (the header's single source of truth, D6) to list Changes.
    expect(specsPaneProps.dir).toBe("/meu/projeto");
  });

  it("all five panes stay mounted when switching to Specs (state preserved)", () => {
    const { getByTestId, getByRole } = render(
      <ViewSwitcher store={makeStore()} tick={0} configDraft={draftWith()} />,
    );

    fireEvent.click(getByRole("radio", { name: "Specs" }));

    expect(getByTestId("kanban-board")).toBeTruthy();
    expect(getByTestId("deps-flow")).toBeTruthy();
    expect(getByTestId("config-pane")).toBeTruthy();
    expect(getByTestId("insights-pane")).toBeTruthy();
    expect(getByTestId("specs-pane")).toBeTruthy();
  });

  it("Specs is reachable without a loopy.yml (SC15) — even with no configDraft", () => {
    // No configDraft (as during a run) must not hide Specs — it is always mounted.
    const { getByTestId, getByRole } = render(
      <ViewSwitcher store={makeStore()} tick={0} dir="/x" />,
    );
    fireEvent.click(getByRole("radio", { name: "Specs" }));
    expect(getByTestId("specs-pane")).toBeTruthy();
  });

  it("forwards runActive to SpecsPane (D22 warning is the pane's, the flag is ours)", () => {
    render(<ViewSwitcher store={makeStore()} tick={0} dir="/x" runActive />);
    expect(specsPaneProps.runActive).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Empty-state hosted in the Config tab (T-014, D20) — the EmptyState no longer
// replaces the whole ViewSwitcher; it degrades the Config tab instead, so the
// tab bar (and Specs) stays reachable in a project without a loopy.yml.
// ---------------------------------------------------------------------------

describe("ViewSwitcher — empty-state in the Config tab (T-014, D20)", () => {
  function draftNoConfig(): import("../config/useConfigDraft").ConfigDraftAPI {
    return {
      draft: null,
      errors: [],
      dirty: false,
      tasks: [],
      hasConfig: false,
      load: vi.fn(),
      patch: vi.fn(),
      save: vi.fn(),
      seedFromTemplate: vi.fn(),
    } as unknown as import("../config/useConfigDraft").ConfigDraftAPI;
  }

  it("shows EmptyState (not ConfigPane) in the Config tab when hasConfig is false", () => {
    const draft = draftNoConfig();
    const { getByTestId, queryByTestId, getByRole } = render(
      <ViewSwitcher store={makeStore()} tick={0} configDraft={draft} />,
    );

    fireEvent.click(getByRole("radio", { name: "Config" }));

    expect(getByTestId("empty-state")).toBeTruthy();
    expect(queryByTestId("config-pane")).toBeNull();
  });

  it("the whole tab bar stays visible with no loopy.yml (SC15)", () => {
    const draft = draftNoConfig();
    const { getByRole } = render(
      <ViewSwitcher store={makeStore()} tick={0} configDraft={draft} />,
    );
    for (const name of ["Kanban", "Deps", "Config", "Insights", "Specs"]) {
      expect(getByRole("radio", { name })).toBeTruthy();
    }
  });

  it("'Criar a partir do template' in the empty Config tab seeds the draft (D20)", () => {
    const draft = draftNoConfig();
    const { getByTestId, getByRole } = render(
      <ViewSwitcher store={makeStore()} tick={0} configDraft={draft} />,
    );

    fireEvent.click(getByRole("radio", { name: "Config" }));
    fireEvent.click(getByTestId("btn-create-from-template"));

    expect(draft.seedFromTemplate).toHaveBeenCalledTimes(1);
  });

  it("shows ConfigPane (not EmptyState) once hasConfig is true", () => {
    const draft = {
      ...draftNoConfig(),
      draft: { workspace: { root: "." }, concurrency: 1 },
      hasConfig: true,
    } as unknown as import("../config/useConfigDraft").ConfigDraftAPI;
    const { getByTestId, queryByTestId, getByRole } = render(
      <ViewSwitcher store={makeStore()} tick={0} configDraft={draft} />,
    );

    fireEvent.click(getByRole("radio", { name: "Config" }));

    expect(getByTestId("config-pane")).toBeTruthy();
    expect(queryByTestId("empty-state")).toBeNull();
  });
});
