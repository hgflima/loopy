/**
 * Tests for ConfigPane — the visual editor for top-level loopy.yml settings.
 *
 * Covers:
 * - T-008: workspace + concurrency fields (existing)
 * - T-009 SC4: all remaining top-level sections render and call patch
 * - T-009 SC5: selects only offer valid enum values
 * - metrics opt-in toggle enables/disables section
 * - error routing (R7) across all sections
 * - T-011: agent presets (Claude/Codex/OpenCode/Em branco), probe/refresh button,
 *   and probed model/effort selects in the registry
 *
 * Run: `npm test -w apps/menubar -- ConfigPane`
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, within } from "@testing-library/react";
import type { ConfigDraftAPI, ConfigError } from "./useConfigDraft";

// Mock useAgentCapabilities BEFORE importing ConfigPane (vitest hoists vi.mock).
// Default: idle (no probe) — existing tests keep working unchanged.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockUseAgentCapabilities = vi.fn<(...args: any[]) => any>(() => ({
  status: "idle",
  caps: undefined,
  reason: undefined,
  probe: vi.fn(),
}));
vi.mock("./useAgentCapabilities", () => ({
  // Repassa os argumentos: o 4º (model) e o 5º (env) são contrato da sondagem.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useAgentCapabilities: (...args: any[]) => mockUseAgentCapabilities(...args),
}));

import { ConfigPane } from "./ConfigPane";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  mockUseAgentCapabilities.mockClear();
});

/** Full draft with all sections populated for T-009. */
function makeDraft(overrides?: Partial<ConfigDraftAPI>): ConfigDraftAPI {
  return {
    draft: {
      workspace: { root: ".", parent_branch: "main", worktrees_dir: ".worktrees" },
      concurrency: 2,
      max_concurrency: 4,
      agents: {
        claude: {
          command: ["claude", "--agent"],
          env: { API_KEY: "sk-xxx" },
          model: "opus",
          effort: "high",
          display_name: "Claude Agent",
        },
      },
      acp: {
        command: undefined,
        default_agent: "claude",
        request_timeout_seconds: 300,
        permissions: { default_mode: "acceptEdits", on_request: "allow" as const },
      },
      inputs: {
        spec: "spec.md",
        plan: "plan.md",
        todo: "todo.md",
        backlog: {
          pending_marker: "- [ ]",
          done_marker: "- [x]",
          task_id_pattern: "T-\\d+",
          deps_pattern: "Deps:",
          body: "indented" as const,
          mark_done_on_success: true,
        },
      },
      checks: {
        ci: [
          { name: "typecheck", run: "npm run typecheck" },
          { name: "lint", run: "npm run lint" },
        ],
      },
      stop_conditions: {
        max_iterations: 10,
        max_step_visits: 10,
        stop_signal_file: ".loopy.stop",
      },
      policies: {
        escalation: { action: "pause" as const, keep_worktree: true, notify: "echo done" },
        git: { require_clean_parent: true, on_merge_conflict: "escalate" as const },
      },
      logging: { dir: ".loopy/logs", per_task: true, capture_acp_traffic: false },
      metrics: { report: { index: "index.md" } },
      // pipeline excluded from ConfigPane
      pipeline: [{ id: "code", type: "agent" as const, prompt: "do it", parallel_safe: false, clear_context: true }],
      version: "1",
      name: "test",
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

/** Draft with agents: undefined — used by preset tests. */
function noAgentsDraft(): ConfigDraftAPI {
  return makeDraft({
    draft: { ...makeDraft().draft!, agents: undefined } as ConfigDraftAPI["draft"],
  });
}

// ---------------------------------------------------------------------------
// T-008 — workspace + concurrency (preserved)
// ---------------------------------------------------------------------------

describe("ConfigPane — rendering and editing (T-008)", () => {
  it("renders workspace fields with current values", () => {
    const draft = makeDraft();
    const { getByLabelText } = render(<ConfigPane configDraft={draft} />);

    expect((getByLabelText("root") as HTMLInputElement).value).toBe(".");
    expect((getByLabelText("parent_branch") as HTMLInputElement).value).toBe("main");
    expect((getByLabelText("worktrees_dir") as HTMLInputElement).value).toBe(".worktrees");
  });

  it("renders concurrency field with current value", () => {
    const draft = makeDraft();
    const { getByLabelText } = render(<ConfigPane configDraft={draft} />);

    expect((getByLabelText("concurrency") as HTMLInputElement).value).toBe("2");
  });

  it("editing workspace.root calls patch", () => {
    const draft = makeDraft();
    const { getByLabelText } = render(<ConfigPane configDraft={draft} />);

    fireEvent.change(getByLabelText("root"), { target: { value: "/new/root" } });
    expect(draft.patch).toHaveBeenCalledWith("workspace.root", "/new/root");
  });

  it("editing concurrency calls patch with number", () => {
    const draft = makeDraft();
    const { getByLabelText } = render(<ConfigPane configDraft={draft} />);

    fireEvent.change(getByLabelText("concurrency"), { target: { value: "4" } });
    expect(draft.patch).toHaveBeenCalledWith("concurrency", 4);
  });

  it("shows empty state when draft is null", () => {
    const draft = makeDraft({ draft: null });
    const { getByTestId } = render(<ConfigPane configDraft={draft} />);
    expect(getByTestId("config-pane").textContent).toContain("Nenhuma configuração carregada");
  });
});

// ---------------------------------------------------------------------------
// T-003 — concurrency: auto toggle + max_concurrency
// ---------------------------------------------------------------------------

describe("ConfigPane — concurrency auto toggle (T-003)", () => {
  /** Shorthand: override concurrency + max_concurrency without the verbose spread. */
  function concDraft(
    concurrency: number | "auto",
    maxConc = 4,
    extra?: Partial<ConfigDraftAPI>,
  ): ConfigDraftAPI {
    return makeDraft({
      draft: {
        ...makeDraft().draft!,
        concurrency: concurrency as unknown as number,
        max_concurrency: maxConc,
      } as ConfigDraftAPI["draft"],
      ...extra,
    });
  }

  it("shows toggle ON and hides concurrency NumberField when concurrency is 'auto'", () => {
    const draft = concDraft("auto");
    const { getByLabelText, queryByLabelText } = render(<ConfigPane configDraft={draft} />);

    const toggle = getByLabelText(/^auto/) as HTMLInputElement;
    expect(toggle.type).toBe("checkbox");
    expect(toggle.checked).toBe(true);
    expect(queryByLabelText("concurrency")).toBeNull();

    const maxField = getByLabelText("max_concurrency") as HTMLInputElement;
    expect(maxField).toBeTruthy();
    expect(maxField.value).toBe("4");
  });

  it("shows toggle OFF and concurrency NumberField when concurrency is a number", () => {
    const draft = concDraft(3);
    const { getByLabelText, queryByLabelText } = render(<ConfigPane configDraft={draft} />);

    const toggle = getByLabelText(/^auto/) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect((getByLabelText("concurrency") as HTMLInputElement).value).toBe("3");
    expect(queryByLabelText("max_concurrency")).toBeNull();
  });

  it("toggling auto ON patches concurrency to 'auto' string", () => {
    const draft = concDraft(3);
    const { getByLabelText } = render(<ConfigPane configDraft={draft} />);

    fireEvent.click(getByLabelText(/^auto/));
    expect(draft.patch).toHaveBeenCalledWith("concurrency", "auto");
  });

  it("toggling auto OFF patches concurrency to 1 (default number)", () => {
    const draft = concDraft("auto");
    const { getByLabelText } = render(<ConfigPane configDraft={draft} />);

    fireEvent.click(getByLabelText(/^auto/));
    expect(draft.patch).toHaveBeenCalledWith("concurrency", 1);
  });

  it("preserves max_concurrency when toggling auto ON and OFF", () => {
    const draft = concDraft(3, 6);
    const { getByLabelText } = render(<ConfigPane configDraft={draft} />);

    fireEvent.click(getByLabelText(/^auto/));
    expect(draft.patch).toHaveBeenCalledWith("concurrency", "auto");
    expect(draft.patch).not.toHaveBeenCalledWith("max_concurrency", expect.anything());
  });

  it("editing concurrency with toggle OFF still passes number (regression)", () => {
    const draft = concDraft(3);
    const { getByLabelText } = render(<ConfigPane configDraft={draft} />);

    fireEvent.change(getByLabelText("concurrency"), { target: { value: "4" } });
    expect(draft.patch).toHaveBeenCalledWith("concurrency", 4);
  });

  it("editing max_concurrency calls patch with number", () => {
    const draft = concDraft("auto");
    const { getByLabelText } = render(<ConfigPane configDraft={draft} />);

    fireEvent.change(getByLabelText("max_concurrency"), { target: { value: "8" } });
    expect(draft.patch).toHaveBeenCalledWith("max_concurrency", 8);
  });

  it("max_concurrency error shows in concurrency section counter", () => {
    const draft = concDraft("auto", 0, {
      errors: [{ path: "max_concurrency", message: "Number must be greater than or equal to 1" }],
    });
    const { getByTestId } = render(<ConfigPane configDraft={draft} />);

    const counter = getByTestId("section-concurrency").querySelector(".config-pane__error-count");
    expect(counter).not.toBeNull();
    expect(counter!.textContent).toBe("1");
  });

  it("max_concurrency error shows inline when field is visible", () => {
    const draft = concDraft("auto", 0, {
      errors: [{ path: "max_concurrency", message: "Number must be greater than or equal to 1" }],
    });
    const { getByTestId } = render(<ConfigPane configDraft={draft} />);

    const errorEl = getByTestId("section-concurrency").querySelector(".field__error");
    expect(errorEl).not.toBeNull();
    expect(errorEl!.textContent).toContain("greater than or equal to 1");
  });

  it("max_concurrency error does NOT go to cross-field banner", () => {
    const draft = makeDraft({
      errors: [{ path: "max_concurrency", message: "too low" }],
    });
    const { queryByTestId } = render(<ConfigPane configDraft={draft} />);

    expect(queryByTestId("config-banner")).toBeNull();
  });
});

// Dirty indicator + Save button now live in the ViewSwitcher tab bar (the global
// save bar) — see ViewSwitcher.test.tsx. The pane itself no longer renders them,
// because edits also happen on the board (steps/columns).

describe("ConfigPane — error routing (T-008, R7)", () => {
  it("inline error on invalid concurrency + section counter", () => {
    const draft = makeDraft({
      errors: [{ path: "concurrency", message: "Must be ≥ 1" }],
    });
    const { getByTestId } = render(<ConfigPane configDraft={draft} />);

    // Section error counter in concurrency section header
    const section = getByTestId("section-concurrency");
    const counter = section.querySelector(".config-pane__error-count");
    expect(counter).not.toBeNull();
    expect(counter!.textContent).toBe("1");
  });

  it("workspace section shows error counter for child errors", () => {
    const draft = makeDraft({
      errors: [
        { path: "workspace.root", message: "Required" },
        { path: "workspace.parent_branch", message: "Required" },
      ],
    });
    const { getByTestId } = render(<ConfigPane configDraft={draft} />);

    const section = getByTestId("section-workspace");
    const counter = section.querySelector(".config-pane__error-count");
    expect(counter).not.toBeNull();
    expect(counter!.textContent).toBe("2");
  });

  it("cross-field error banner appears for errors outside visible sections", () => {
    const draft = makeDraft({
      errors: [
        { path: "", message: "agents and acp.command are mutually exclusive" },
      ],
    });
    const { getByTestId } = render(<ConfigPane configDraft={draft} />);

    const banner = getByTestId("config-banner");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("agents and acp.command are mutually exclusive");
  });

  it("no banner when all errors belong to visible sections", () => {
    const draft = makeDraft({
      errors: [{ path: "workspace.root", message: "Required" }],
    });
    const { queryByTestId } = render(<ConfigPane configDraft={draft} />);

    expect(queryByTestId("config-banner")).toBeNull();
  });

  it("no error counter when section has no errors", () => {
    const draft = makeDraft({ errors: [] });
    const { getByTestId } = render(<ConfigPane configDraft={draft} />);

    const wsSection = getByTestId("section-workspace");
    expect(wsSection.querySelector(".config-pane__error-count")).toBeNull();

    const concSection = getByTestId("section-concurrency");
    expect(concSection.querySelector(".config-pane__error-count")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T-009 — Agents section
// ---------------------------------------------------------------------------

describe("ConfigPane — Agents section (T-009, SC4)", () => {
  it("renders the agents section with existing agent entries", () => {
    const draft = makeDraft();
    const { getByTestId } = render(<ConfigPane configDraft={draft} />);

    expect(getByTestId("section-agents")).toBeTruthy();
    expect(getByTestId("agent-entry-claude")).toBeTruthy();
  });

  it("renders agent fields: command, env, model, effort, display_name", () => {
    const draft = makeDraft();
    const { getByTestId } = render(<ConfigPane configDraft={draft} />);

    const entry = getByTestId("agent-entry-claude");
    // Entry contains name (editable key) + command + other fields
    const labels = Array.from(entry.querySelectorAll(".field__label")).map((el) => el.textContent);
    expect(labels).toContain("name");
    expect(labels).toContain("command");
    // The entry should contain model/effort/display_name text inputs
    expect(entry.textContent).toContain("model");
    expect(entry.textContent).toContain("effort");
    expect(entry.textContent).toContain("display_name");
  });

  it("renders agents section with empty state when no agents", () => {
    const draft = makeDraft({
      draft: {
        ...makeDraft().draft!,
        agents: undefined,
      } as ConfigDraftAPI["draft"],
    });
    const { getByTestId, queryByTestId } = render(<ConfigPane configDraft={draft} />);

    expect(getByTestId("section-agents")).toBeTruthy();
    expect(queryByTestId("agent-entry-claude")).toBeNull();
  });

  it("shows agents section error counter", () => {
    const draft = makeDraft({
      errors: [{ path: "agents.claude.command", message: "Required" }],
    });
    const { getByTestId } = render(<ConfigPane configDraft={draft} />);

    const section = getByTestId("section-agents");
    const counter = section.querySelector(".config-pane__error-count");
    expect(counter).not.toBeNull();
    expect(counter!.textContent).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// T-009 — ACP section
// ---------------------------------------------------------------------------

describe("ConfigPane — ACP section (T-009, SC4)", () => {
  it("renders acp section with all fields", () => {
    const draft = makeDraft();
    const { getByTestId, getByLabelText } = render(<ConfigPane configDraft={draft} />);

    expect(getByTestId("section-acp")).toBeTruthy();
    expect((getByLabelText("default_agent") as HTMLInputElement).value).toBe("claude");
    expect((getByLabelText("request_timeout_seconds") as HTMLInputElement).value).toBe("300");
    expect((getByLabelText("default_mode") as HTMLInputElement).value).toBe("acceptEdits");
  });

  it("default_mode is a TextField (text, not enum)", () => {
    const draft = makeDraft();
    const { getByLabelText } = render(<ConfigPane configDraft={draft} />);

    const field = getByLabelText("default_mode") as HTMLInputElement;
    expect(field.tagName).toBe("INPUT");
    expect(field.type).toBe("text");
  });

  it("on_request is a SelectField with only allow|policy options (SC5)", () => {
    const draft = makeDraft();
    const { getByLabelText } = render(<ConfigPane configDraft={draft} />);

    const select = getByLabelText("on_request") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(["allow", "policy"]);
  });

  it("editing request_timeout_seconds calls patch with number", () => {
    const draft = makeDraft();
    const { getByLabelText } = render(<ConfigPane configDraft={draft} />);

    fireEvent.change(getByLabelText("request_timeout_seconds"), { target: { value: "600" } });
    expect(draft.patch).toHaveBeenCalledWith("acp.request_timeout_seconds", 600);
  });

  it("editing on_request calls patch", () => {
    const draft = makeDraft();
    const { getByLabelText } = render(<ConfigPane configDraft={draft} />);

    fireEvent.change(getByLabelText("on_request"), { target: { value: "policy" } });
    expect(draft.patch).toHaveBeenCalledWith("acp.permissions.on_request", "policy");
  });

  it("shows acp error counter", () => {
    const draft = makeDraft({
      errors: [{ path: "acp.request_timeout_seconds", message: "Required" }],
    });
    const { getByTestId } = render(<ConfigPane configDraft={draft} />);

    const section = getByTestId("section-acp");
    const counter = section.querySelector(".config-pane__error-count");
    expect(counter!.textContent).toBe("1");
  });

  // `acp.command` is the legacy single-agent path, mutually exclusive with the
  // `agents:` registry. Hide it when agents are configured (dead config), unless
  // a stale value is present (a conflict the user must be able to clear).

  it("hides the acp.command field when agents are configured", () => {
    // Default makeDraft has agents:{claude} and acp.command undefined.
    const draft = makeDraft();
    const { queryByPlaceholderText } = render(<ConfigPane configDraft={draft} />);
    expect(queryByPlaceholderText("acp command")).toBeNull();
  });

  it("shows the acp.command field in legacy mode (no agents)", () => {
    const draft = makeDraft();
    // Legacy: no registry, single agent via acp.command.
    (draft.draft as { agents?: unknown }).agents = undefined;
    (draft.draft!.acp as { command?: string[] }).command = ["legacy-acp"];
    const { getByPlaceholderText } = render(<ConfigPane configDraft={draft} />);
    expect(getByPlaceholderText("acp command")).toBeTruthy();
  });

  it("keeps a stale acp.command visible+removable even with agents (fixable conflict)", () => {
    const draft = makeDraft();
    // Conflicting config: both agents and a single leftover acp.command entry.
    (draft.draft!.acp as { command?: string[] }).command = ["stale-acp"];
    const { getByTestId } = render(<ConfigPane configDraft={draft} />);
    const acp = within(getByTestId("section-acp"));
    // Field is shown so the user can see and clear the conflict…
    expect(acp.getByPlaceholderText("acp command")).toBeTruthy();
    // …and removing the only row reaches an empty list → patch(undefined).
    fireEvent.click(acp.getByLabelText(/^Remove command/));
    expect(draft.patch).toHaveBeenCalledWith("acp.command", undefined);
  });
});

// ---------------------------------------------------------------------------
// T-009 — Inputs section
// ---------------------------------------------------------------------------

describe("ConfigPane — Inputs section (T-009, SC4)", () => {
  it("renders inputs section with text fields", () => {
    const draft = makeDraft();
    const { getByTestId, getByLabelText } = render(<ConfigPane configDraft={draft} />);

    expect(getByTestId("section-inputs")).toBeTruthy();
    expect((getByLabelText("spec") as HTMLInputElement).value).toBe("spec.md");
    expect((getByLabelText("plan") as HTMLInputElement).value).toBe("plan.md");
    expect((getByLabelText("todo") as HTMLInputElement).value).toBe("todo.md");
  });

  it("renders backlog fields", () => {
    const draft = makeDraft();
    const { getByLabelText } = render(<ConfigPane configDraft={draft} />);

    expect((getByLabelText("pending_marker") as HTMLInputElement).value).toBe("- [ ]");
    expect((getByLabelText("done_marker") as HTMLInputElement).value).toBe("- [x]");
    expect((getByLabelText("task_id_pattern") as HTMLInputElement).value).toBe("T-\\d+");
  });

  it("body is a SelectField with only 'indented' option (SC5)", () => {
    const draft = makeDraft();
    const { getByLabelText } = render(<ConfigPane configDraft={draft} />);

    const select = getByLabelText("body") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(["indented"]);
  });

  it("mark_done_on_success is a toggle", () => {
    const draft = makeDraft();
    const { getByLabelText } = render(<ConfigPane configDraft={draft} />);

    const toggle = getByLabelText(/^mark_done_on_success/) as HTMLInputElement;
    expect(toggle.type).toBe("checkbox");
    expect(toggle.checked).toBe(true);
  });

  it("editing spec calls patch", () => {
    const draft = makeDraft();
    const { getByLabelText } = render(<ConfigPane configDraft={draft} />);

    fireEvent.change(getByLabelText("spec"), { target: { value: "SPEC.md" } });
    expect(draft.patch).toHaveBeenCalledWith("inputs.spec", "SPEC.md");
  });

  it("toggling mark_done_on_success calls patch", () => {
    const draft = makeDraft();
    const { getByLabelText } = render(<ConfigPane configDraft={draft} />);

    fireEvent.click(getByLabelText(/^mark_done_on_success/));
    expect(draft.patch).toHaveBeenCalledWith("inputs.backlog.mark_done_on_success", false);
  });
});

// ---------------------------------------------------------------------------
// T-009 — Checks section
// ---------------------------------------------------------------------------

describe("ConfigPane — Checks section (T-009, SC4)", () => {
  it("renders checks section with existing check groups", () => {
    const draft = makeDraft();
    const { getByTestId } = render(<ConfigPane configDraft={draft} />);

    expect(getByTestId("section-checks")).toBeTruthy();
    expect(getByTestId("check-group-ci")).toBeTruthy();
  });

  it("renders check entries with name and run fields", () => {
    const draft = makeDraft();
    const { getByLabelText } = render(<ConfigPane configDraft={draft} />);

    expect((getByLabelText("ci check 1 name") as HTMLInputElement).value).toBe("typecheck");
    expect((getByLabelText("ci check 1 run") as HTMLInputElement).value).toBe("npm run typecheck");
    expect((getByLabelText("ci check 2 name") as HTMLInputElement).value).toBe("lint");
    expect((getByLabelText("ci check 2 run") as HTMLInputElement).value).toBe("npm run lint");
  });

  it("editing a check entry calls patch with updated array", () => {
    const draft = makeDraft();
    const { getByLabelText } = render(<ConfigPane configDraft={draft} />);

    fireEvent.change(getByLabelText("ci check 1 run"), { target: { value: "tsc --noEmit" } });
    expect(draft.patch).toHaveBeenCalledWith("checks.ci", [
      { name: "typecheck", run: "tsc --noEmit" },
      { name: "lint", run: "npm run lint" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// T-009 — Stop Conditions section
// ---------------------------------------------------------------------------

describe("ConfigPane — Stop Conditions section (T-009, SC4)", () => {
  it("renders stop_conditions fields", () => {
    const draft = makeDraft();
    const { getByTestId, getByLabelText } = render(<ConfigPane configDraft={draft} />);

    expect(getByTestId("section-stop_conditions")).toBeTruthy();
    expect((getByLabelText("max_iterations") as HTMLInputElement).value).toBe("10");
    expect((getByLabelText("max_step_visits") as HTMLInputElement).value).toBe("10");
    expect((getByLabelText("stop_signal_file") as HTMLInputElement).value).toBe(".loopy.stop");
  });

  it("editing max_iterations calls patch with number", () => {
    const draft = makeDraft();
    const { getByLabelText } = render(<ConfigPane configDraft={draft} />);

    fireEvent.change(getByLabelText("max_iterations"), { target: { value: "20" } });
    expect(draft.patch).toHaveBeenCalledWith("stop_conditions.max_iterations", 20);
  });

  it("editing stop_signal_file calls patch", () => {
    const draft = makeDraft();
    const { getByLabelText } = render(<ConfigPane configDraft={draft} />);

    fireEvent.change(getByLabelText("stop_signal_file"), { target: { value: ".stop" } });
    expect(draft.patch).toHaveBeenCalledWith("stop_conditions.stop_signal_file", ".stop");
  });
});

// ---------------------------------------------------------------------------
// T-009 — Policies section
// ---------------------------------------------------------------------------

describe("ConfigPane — Policies section (T-009, SC4)", () => {
  it("renders policies section with correct field types", () => {
    const draft = makeDraft();
    const { getByTestId, getByLabelText } = render(<ConfigPane configDraft={draft} />);

    expect(getByTestId("section-policies")).toBeTruthy();

    // action is a select
    const actionSelect = getByLabelText("action") as HTMLSelectElement;
    expect(actionSelect.tagName).toBe("SELECT");
    expect(actionSelect.value).toBe("pause");

    // keep_worktree is a toggle
    const keepWt = getByLabelText(/^keep_worktree/) as HTMLInputElement;
    expect(keepWt.type).toBe("checkbox");
    expect(keepWt.checked).toBe(true);

    // notify is text
    const notify = getByLabelText("notify") as HTMLInputElement;
    expect(notify.type).toBe("text");
    expect(notify.value).toBe("echo done");

    // require_clean_parent is a toggle
    const reqClean = getByLabelText(/^require_clean_parent/) as HTMLInputElement;
    expect(reqClean.type).toBe("checkbox");
    expect(reqClean.checked).toBe(true);

    // on_merge_conflict is a select
    const mergeSelect = getByLabelText("on_merge_conflict") as HTMLSelectElement;
    expect(mergeSelect.tagName).toBe("SELECT");
    expect(mergeSelect.value).toBe("escalate");
  });

  it("escalation.action select only offers pause|skip_task|abort_loop (SC5)", () => {
    const draft = makeDraft();
    const { getByLabelText } = render(<ConfigPane configDraft={draft} />);

    const select = getByLabelText("action") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(["pause", "skip_task", "abort_loop"]);
  });

  it("on_merge_conflict select only offers escalate|rebase (SC5)", () => {
    const draft = makeDraft();
    const { getByLabelText } = render(<ConfigPane configDraft={draft} />);

    const select = getByLabelText("on_merge_conflict") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(["escalate", "rebase"]);
  });

  it("editing escalation.action calls patch", () => {
    const draft = makeDraft();
    const { getByLabelText } = render(<ConfigPane configDraft={draft} />);

    fireEvent.change(getByLabelText("action"), { target: { value: "abort_loop" } });
    expect(draft.patch).toHaveBeenCalledWith("policies.escalation.action", "abort_loop");
  });

  it("toggling keep_worktree calls patch", () => {
    const draft = makeDraft();
    const { getByLabelText } = render(<ConfigPane configDraft={draft} />);

    fireEvent.click(getByLabelText(/^keep_worktree/));
    expect(draft.patch).toHaveBeenCalledWith("policies.escalation.keep_worktree", false);
  });
});

// ---------------------------------------------------------------------------
// T-009 — Logging section
// ---------------------------------------------------------------------------

describe("ConfigPane — Logging section (T-009, SC4)", () => {
  it("renders logging section with correct field types", () => {
    const draft = makeDraft();
    const { getByTestId, getByLabelText } = render(<ConfigPane configDraft={draft} />);

    expect(getByTestId("section-logging")).toBeTruthy();

    const dir = getByLabelText("dir") as HTMLInputElement;
    expect(dir.type).toBe("text");
    expect(dir.value).toBe(".loopy/logs");

    const perTask = getByLabelText(/^per_task/) as HTMLInputElement;
    expect(perTask.type).toBe("checkbox");
    expect(perTask.checked).toBe(true);

    const captureAcp = getByLabelText(/^capture_acp_traffic/) as HTMLInputElement;
    expect(captureAcp.type).toBe("checkbox");
    expect(captureAcp.checked).toBe(false);
  });

  it("editing dir calls patch", () => {
    const draft = makeDraft();
    const { getByLabelText } = render(<ConfigPane configDraft={draft} />);

    fireEvent.change(getByLabelText("dir"), { target: { value: "logs/" } });
    expect(draft.patch).toHaveBeenCalledWith("logging.dir", "logs/");
  });

  it("toggling capture_acp_traffic calls patch", () => {
    const draft = makeDraft();
    const { getByLabelText } = render(<ConfigPane configDraft={draft} />);

    fireEvent.click(getByLabelText(/^capture_acp_traffic/));
    expect(draft.patch).toHaveBeenCalledWith("logging.capture_acp_traffic", true);
  });
});

// ---------------------------------------------------------------------------
// T-009 — Metrics section (opt-in by presence)
// ---------------------------------------------------------------------------

describe("ConfigPane — Metrics section (T-009, SC4)", () => {
  it("renders metrics section with toggle enabled when metrics present", () => {
    const draft = makeDraft();
    const { getByTestId, getByLabelText } = render(<ConfigPane configDraft={draft} />);

    expect(getByTestId("section-metrics")).toBeTruthy();

    const toggle = getByLabelText(/^Habilitar métricas/) as HTMLInputElement;
    expect(toggle.type).toBe("checkbox");
    expect(toggle.checked).toBe(true);
  });

  it("shows report.index field when metrics enabled", () => {
    const draft = makeDraft();
    const { getByLabelText } = render(<ConfigPane configDraft={draft} />);

    const indexField = getByLabelText("report.index") as HTMLInputElement;
    expect(indexField.value).toBe("index.md");
  });

  it("hides report.index field when metrics disabled", () => {
    const draft = makeDraft({
      draft: {
        ...makeDraft().draft!,
        metrics: undefined,
      } as ConfigDraftAPI["draft"],
    });
    const { queryByLabelText } = render(<ConfigPane configDraft={draft} />);

    expect(queryByLabelText("report.index")).toBeNull();
  });

  it("toggling metrics off calls patch with undefined", () => {
    const draft = makeDraft();
    const { getByLabelText } = render(<ConfigPane configDraft={draft} />);

    fireEvent.click(getByLabelText(/^Habilitar métricas/));
    expect(draft.patch).toHaveBeenCalledWith("metrics", undefined);
  });

  it("toggling metrics on calls patch with empty object", () => {
    const draft = makeDraft({
      draft: {
        ...makeDraft().draft!,
        metrics: undefined,
      } as ConfigDraftAPI["draft"],
    });
    const { getByLabelText } = render(<ConfigPane configDraft={draft} />);

    fireEvent.click(getByLabelText(/^Habilitar métricas/));
    expect(draft.patch).toHaveBeenCalledWith("metrics", {});
  });

  it("shows metrics section error counter", () => {
    const draft = makeDraft({
      errors: [{ path: "metrics.report.index", message: "Required" }],
    });
    const { getByTestId } = render(<ConfigPane configDraft={draft} />);

    const section = getByTestId("section-metrics");
    const counter = section.querySelector(".config-pane__error-count");
    expect(counter!.textContent).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// T-009 — Cross-section error routing with new sections
// ---------------------------------------------------------------------------

describe("ConfigPane — error routing across all sections (T-009, R7)", () => {
  it("errors in acp section show counter, not banner", () => {
    const draft = makeDraft({
      errors: [{ path: "acp.request_timeout_seconds", message: "too low" }],
    });
    const { getByTestId, queryByTestId } = render(<ConfigPane configDraft={draft} />);

    const section = getByTestId("section-acp");
    expect(section.querySelector(".config-pane__error-count")!.textContent).toBe("1");
    expect(queryByTestId("config-banner")).toBeNull();
  });

  it("errors in stop_conditions section show counter", () => {
    const draft = makeDraft({
      errors: [{ path: "stop_conditions.max_iterations", message: "Required" }],
    });
    const { getByTestId } = render(<ConfigPane configDraft={draft} />);

    const section = getByTestId("section-stop_conditions");
    expect(section.querySelector(".config-pane__error-count")!.textContent).toBe("1");
  });

  it("errors in policies section show counter", () => {
    const draft = makeDraft({
      errors: [{ path: "policies.escalation.action", message: "Invalid" }],
    });
    const { getByTestId } = render(<ConfigPane configDraft={draft} />);

    const section = getByTestId("section-policies");
    expect(section.querySelector(".config-pane__error-count")!.textContent).toBe("1");
  });

  it("pipeline errors go to cross-field banner (pipeline not shown)", () => {
    const draft = makeDraft({
      errors: [{ path: "pipeline.0.id", message: "Duplicated" }],
    });
    const { getByTestId } = render(<ConfigPane configDraft={draft} />);

    expect(getByTestId("config-banner").textContent).toContain("Duplicated");
  });
});

// ---------------------------------------------------------------------------
// Catálogo de Agentes: o preset empresta o argv, o yml não guarda `command`
// ---------------------------------------------------------------------------

describe("ConfigPane — agentes por preset do Catálogo", () => {
  it("oferece um botão por adapter conhecido do Catálogo", () => {
    const draft = makeDraft();
    const { getByTestId } = render(<ConfigPane configDraft={draft} />);

    const section = getByTestId("section-agents");
    for (const label of ["Claude", "Codex", "OpenCode"]) {
      expect(within(section).getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it.each([
    { label: "Claude", name: "my-claude", preset: "claude" },
    { label: "Codex", name: "my-codex", preset: "codex" },
    { label: "OpenCode", name: "my-opencode", preset: "opencode" },
  ])(
    // O ponto da mudança inteira: o argv NÃO vai para o yml. Se este teste
    // voltar a esperar `command`, o operador voltou a ter que digitar `npx -y …`.
    "$label cria o agente por preset, sem argv no yml",
    ({ label, name, preset }) => {
      const draft = noAgentsDraft();
      const { getByTestId } = render(<ConfigPane configDraft={draft} />);

      const section = getByTestId("section-agents");
      fireEvent.change(within(section).getByLabelText("New agent name"), { target: { value: name } });
      fireEvent.click(within(section).getByRole("button", { name: label }));
      expect(draft.patch).toHaveBeenCalledWith("agents", { [name]: { preset } });
    },
  );

  it("sem nome digitado, o agente herda o id do preset", () => {
    const draft = noAgentsDraft();
    const { getByTestId } = render(<ConfigPane configDraft={draft} />);

    const section = getByTestId("section-agents");
    fireEvent.click(within(section).getByRole("button", { name: "Claude" }));
    expect(draft.patch).toHaveBeenCalledWith("agents", { claude: { preset: "claude" } });
  });

  it("nome colidindo ganha sufixo", () => {
    // "claude" já existe no draft default
    const draft = makeDraft();
    const { getByTestId } = render(<ConfigPane configDraft={draft} />);

    const section = getByTestId("section-agents");
    fireEvent.click(within(section).getByRole("button", { name: "Claude" }));
    expect(draft.patch).toHaveBeenCalledWith("agents", expect.objectContaining({
      claude: expect.anything(), // o que já existia
      "claude-2": { preset: "claude" },
    }));
  });

  it("'+ Add agent' segue criando um agente custom (argv na mão)", () => {
    const draft = noAgentsDraft();
    const { getByTestId } = render(<ConfigPane configDraft={draft} />);

    const section = getByTestId("section-agents");
    fireEvent.change(within(section).getByLabelText("New agent name"), { target: { value: "meu-adapter" } });
    fireEvent.click(within(section).getByText("+ Add agent"));
    expect(draft.patch).toHaveBeenCalledWith("agents", { "meu-adapter": { command: [""] } });
  });
});

// ---------------------------------------------------------------------------
// Alternar preset ↔ custom: os dois campos são XOR, então trocar remove o outro
// ---------------------------------------------------------------------------

describe("ConfigPane — select de preset do agente", () => {
  /** Draft com um único agente declarado por preset. */
  function presetAgentDraft() {
    const draft = makeDraft();
    draft.draft!.agents = { claude: { preset: "claude" } };
    return draft;
  }

  it("virar custom semeia o command com o argv que estava valendo", () => {
    const draft = presetAgentDraft();
    const { getByTestId } = render(<ConfigPane configDraft={draft} dir="/project" />);

    const entry = getByTestId("agent-entry-claude");
    fireEvent.change(within(entry).getByLabelText("preset"), {
      target: { value: "__custom__" },
    });

    // Sem `preset`, e com o argv do Catálogo já materializado para editar.
    expect(draft.patch).toHaveBeenCalledWith("agents", {
      claude: { command: ["npx", "-y", "@agentclientprotocol/claude-agent-acp@0.59.0"] },
    });
  });

  it("escolher um preset apaga o command literal", () => {
    const draft = makeDraft(); // claude tem `command` no draft default
    const { getByTestId } = render(<ConfigPane configDraft={draft} dir="/project" />);

    const entry = getByTestId("agent-entry-claude");
    fireEvent.change(within(entry).getByLabelText("preset"), {
      target: { value: "codex" },
    });

    const [, agents] = (draft.patch as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(agents.claude.preset).toBe("codex");
    expect(agents.claude).not.toHaveProperty("command");
  });

  // `model`/`effort` são Dialeto por-Agente: `gpt-5.6-terra` não existe no
  // OpenCode. Trocar o adapter e manter o valor antigo grava um yml que o motor
  // vai ignorar com warning — e mostra na tela um model que aquele agente não tem.
  it("trocar o preset descarta model/effort do adapter antigo", () => {
    const draft = makeDraft();
    draft.draft!.agents = {
      codex: { preset: "codex", model: "gpt-5.6-terra", effort: "xhigh" },
    };
    const { getByTestId } = render(<ConfigPane configDraft={draft} dir="/project" />);

    const entry = getByTestId("agent-entry-codex");
    fireEvent.change(within(entry).getByLabelText("preset"), {
      target: { value: "opencode" },
    });

    const [, agents] = (draft.patch as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(agents.codex.preset).toBe("opencode");
    expect(agents.codex).not.toHaveProperty("model");
    expect(agents.codex).not.toHaveProperty("effort");
  });

  it("sonda o novo argv (não o do yml salvo) ao trocar o preset", () => {
    const draft = makeDraft();
    draft.draft!.agents = { codex: { preset: "codex" } };
    const { getByTestId, rerender } = render(
      <ConfigPane configDraft={draft} dir="/project" />,
    );

    fireEvent.change(within(getByTestId("agent-entry-codex")).getByLabelText("preset"), {
      target: { value: "opencode" },
    });

    // O draft (fake) não se auto-atualiza: simula o re-render com o agente novo.
    draft.draft!.agents = { codex: { preset: "opencode" } };
    rerender(<ConfigPane configDraft={draft} dir="/project" />);

    // O argv sondado é o do OpenCode — o probe vai por argv, não pelo nome
    // ("codex"), que no yml salvo ainda aponta para o adapter antigo (D-0011).
    const [, command] = mockUseAgentCapabilities.mock.calls.at(-1)!;
    expect(command).toEqual(["opencode", "acp"]);
  });

  it("semeia model e effort com os defaults sondados do agente novo", () => {
    mockUseAgentCapabilities.mockReturnValue({
      status: "ok",
      caps: {
        modes: ["read-only", "agent"],
        models: ["gpt-5.5", "gpt-5.4"],
        efforts: ["low", "high", "xhigh"],
        defaultModel: "gpt-5.5",
        defaultEffort: "xhigh",
      },
      reason: undefined,
      probe: vi.fn(),
    });

    const draft = makeDraft();
    draft.draft!.agents = { a: { preset: "claude" } };
    const { getByTestId } = render(<ConfigPane configDraft={draft} dir="/project" />);

    fireEvent.change(within(getByTestId("agent-entry-a")).getByLabelText("preset"), {
      target: { value: "codex" },
    });

    // Um campo omitido não é "sem valor": o agente roda com o default dele. Ao
    // trocar o adapter, é esse default que a tela passa a mostrar.
    const patched = (draft.patch as ReturnType<typeof vi.fn>).mock.calls.map(
      ([path, value]) => [path, value],
    );
    expect(patched).toContainEqual(["agents.a.model", "gpt-5.5"]);
  });
});

// ---------------------------------------------------------------------------
// T-011 — Probe/refresh button per agent (D32)
// ---------------------------------------------------------------------------

describe("ConfigPane — probe/refresh button (T-011, D32)", () => {
  it("shows a probe button per agent entry", () => {
    const draft = makeDraft();
    const { getByTestId } = render(<ConfigPane configDraft={draft} dir="/project" />);

    const entry = getByTestId("agent-entry-claude");
    expect(within(entry).getByLabelText(/sondar|refresh/i)).toBeTruthy();
  });

  it("probe button calls useAgentCapabilities.probe (ignoring cache)", () => {
    const probeFn = vi.fn();
    mockUseAgentCapabilities.mockReturnValue({
      status: "idle",
      caps: undefined,
      reason: undefined,
      probe: probeFn,
    });
    const draft = makeDraft();
    const { getByTestId } = render(<ConfigPane configDraft={draft} dir="/project" />);

    const entry = getByTestId("agent-entry-claude");
    fireEvent.click(within(entry).getByLabelText(/sondar|refresh/i));
    expect(probeFn).toHaveBeenCalled();
  });

  it("shows probed result inline on success", () => {
    mockUseAgentCapabilities.mockReturnValue({
      status: "ok",
      caps: { modes: ["build", "plan"], models: ["openai/gpt-4o"], efforts: [] },
      reason: undefined,
      probe: vi.fn(),
    });
    const draft = makeDraft();
    const { getByTestId } = render(<ConfigPane configDraft={draft} dir="/project" />);

    const entry = getByTestId("agent-entry-claude");
    expect(entry.textContent).toContain("build");
    expect(entry.textContent).toContain("plan");
  });

  it("shows probe failure reason inline", () => {
    mockUseAgentCapabilities.mockReturnValue({
      status: "failed",
      caps: undefined,
      reason: "adapter not installed",
      probe: vi.fn(),
    });
    const draft = makeDraft();
    const { getByTestId } = render(<ConfigPane configDraft={draft} dir="/project" />);

    const entry = getByTestId("agent-entry-claude");
    expect(entry.textContent).toContain("adapter not installed");
  });

  it("failure does NOT clear existing form values", () => {
    mockUseAgentCapabilities.mockReturnValue({
      status: "failed",
      caps: undefined,
      reason: "timeout",
      probe: vi.fn(),
    });
    const draft = makeDraft();
    const { getByTestId } = render(<ConfigPane configDraft={draft} dir="/project" />);

    const entry = getByTestId("agent-entry-claude");
    // Model and effort fields should still show their values
    const modelInput = within(entry).getByLabelText("model") as HTMLInputElement;
    expect(modelInput.value).toBe("opus");
    const effortInput = within(entry).getByLabelText("effort") as HTMLInputElement;
    expect(effortInput.value).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// T-011 — Probed model/effort selects in AgentEntry (D30/D31)
// ---------------------------------------------------------------------------

describe("ConfigPane — probed model/effort selects (T-011, D30/D31)", () => {
  it("model field is a select when probe succeeds", () => {
    mockUseAgentCapabilities.mockReturnValue({
      status: "ok",
      caps: { modes: ["build", "plan"], models: ["opus", "sonnet", "haiku"], efforts: ["low", "high"] },
      reason: undefined,
      probe: vi.fn(),
    });
    const draft = makeDraft();
    const { getByTestId } = render(<ConfigPane configDraft={draft} dir="/project" />);

    const entry = getByTestId("agent-entry-claude");
    const modelField = within(entry).getByLabelText("model") as HTMLElement;
    expect(modelField.tagName).toBe("SELECT");
  });

  it("effort field is a select when probe succeeds", () => {
    mockUseAgentCapabilities.mockReturnValue({
      status: "ok",
      caps: { modes: ["build"], models: ["opus"], efforts: ["low", "high", "max"] },
      reason: undefined,
      probe: vi.fn(),
    });
    const draft = makeDraft();
    const { getByTestId } = render(<ConfigPane configDraft={draft} dir="/project" />);

    const entry = getByTestId("agent-entry-claude");
    const effortField = within(entry).getByLabelText("effort") as HTMLElement;
    expect(effortField.tagName).toBe("SELECT");
  });

  it("model/effort degrade to text fields when probe failed", () => {
    mockUseAgentCapabilities.mockReturnValue({
      status: "failed",
      caps: undefined,
      reason: "timeout",
      probe: vi.fn(),
    });
    const draft = makeDraft();
    const { getByTestId } = render(<ConfigPane configDraft={draft} dir="/project" />);

    const entry = getByTestId("agent-entry-claude");
    const modelField = within(entry).getByLabelText("model") as HTMLElement;
    expect(modelField.tagName).toBe("INPUT");
    const effortField = within(entry).getByLabelText("effort") as HTMLElement;
    expect(effortField.tagName).toBe("INPUT");
  });

  it("model/effort degrade to text fields when no dir is provided", () => {
    const draft = makeDraft();
    const { getByTestId } = render(<ConfigPane configDraft={draft} />);

    const entry = getByTestId("agent-entry-claude");
    const modelField = within(entry).getByLabelText("model") as HTMLElement;
    expect(modelField.tagName).toBe("INPUT");
  });

  it("effort field disabled when agent announces efforts: []", () => {
    mockUseAgentCapabilities.mockReturnValue({
      status: "ok",
      caps: { modes: ["build", "plan"], models: ["openai/gpt-4o"], efforts: [] },
      reason: undefined,
      probe: vi.fn(),
    });
    const draft = makeDraft();
    const { getByTestId } = render(<ConfigPane configDraft={draft} dir="/project" />);

    const entry = getByTestId("agent-entry-claude");
    const effortField = within(entry).getByLabelText("effort") as HTMLSelectElement;
    expect(effortField.disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sem placeholder e sem valor do adapter anterior nos selects sondados
// ---------------------------------------------------------------------------

/** Os `value`s oferecidos por um select do agent entry. */
function optionsOf(entry: HTMLElement, label: string): string[] {
  const select = within(entry).getByLabelText(label) as HTMLSelectElement;
  return Array.from(select.options).map((o) => o.value);
}

describe("ConfigPane — o que os selects sondados oferecem", () => {
  // Um agente no registry roda com *algum* model — o seed grava o default
  // sondado. "Vazio" não é uma escolha, é a ausência de resposta; oferecê-lo
  // como opção convida a gravar um yml que não diz nada.
  it("não oferece um vazio quando o campo tem valor", () => {
    mockUseAgentCapabilities.mockReturnValue({
      status: "ok",
      caps: {
        modes: ["acceptEdits"],
        models: ["opus", "sonnet"],
        efforts: ["high", "low"],
        defaultModel: "opus",
        defaultEffort: "high",
      },
      reason: undefined,
      probe: vi.fn(),
    });
    const draft = makeDraft(); // claude: model "opus", effort "high"
    const { getByTestId } = render(<ConfigPane configDraft={draft} dir="/project" />);

    const entry = getByTestId("agent-entry-claude");
    expect(optionsOf(entry, "model")).toEqual(["opus", "sonnet"]);
    expect(optionsOf(entry, "effort")).toEqual(["high", "low"]);
  });

  // O vazio sobrevive em exatamente um caso: o campo está mesmo vazio. Sem a
  // option, o <select> exibiria a primeira da lista — mentindo sobre o yml.
  it("oferece o vazio quando o campo está vazio", () => {
    mockUseAgentCapabilities.mockReturnValue({
      status: "ok",
      caps: { modes: ["acceptEdits"], models: ["opus", "sonnet"], efforts: ["high"] },
      reason: undefined,
      probe: vi.fn(),
    });
    const draft = makeDraft();
    draft.draft!.agents = { claude: { preset: "claude" } }; // sem model/effort
    const { getByTestId } = render(<ConfigPane configDraft={draft} dir="/project" />);

    const entry = getByTestId("agent-entry-claude");
    expect(optionsOf(entry, "model")).toEqual(["", "opus", "sonnet"]);
    expect(optionsOf(entry, "effort")).toEqual(["", "high"]);
  });

  // A sondagem do preset novo ainda não respondeu: semear agora usaria as
  // capabilities do adapter ANTERIOR (o hook já não as entrega — este teste
  // trava o lado do ConfigPane).
  it("não semeia model/effort enquanto a sondagem não responde", () => {
    mockUseAgentCapabilities.mockReturnValue({
      status: "probing",
      caps: undefined,
      reason: undefined,
      probe: vi.fn(),
    });
    const draft = makeDraft();
    draft.draft!.agents = { a: { preset: "claude", model: "opus" } };
    const { getByTestId } = render(<ConfigPane configDraft={draft} dir="/project" />);

    fireEvent.change(within(getByTestId("agent-entry-a")).getByLabelText("preset"), {
      target: { value: "codex" },
    });

    const patched = (draft.patch as ReturnType<typeof vi.fn>).mock.calls.map(([p]) => p);
    expect(patched).not.toContain("agents.a.model");
    expect(patched).not.toContain("agents.a.effort");
  });
});
