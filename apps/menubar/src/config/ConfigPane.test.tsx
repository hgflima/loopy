/**
 * Tests for ConfigPane — the visual editor for top-level loopy.yml settings.
 *
 * Covers:
 * - T-008: workspace + concurrency fields (existing)
 * - T-009 SC4: all remaining top-level sections render and call patch
 * - T-009 SC5: selects only offer valid enum values
 * - metrics opt-in toggle enables/disables section
 * - error routing (R7) across all sections
 *
 * Run: `npm test -w apps/menubar -- ConfigPane`
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { ConfigDraftAPI, ConfigError } from "./useConfigDraft";
import { ConfigPane } from "./ConfigPane";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(cleanup);

/** Full draft with all sections populated for T-009. */
function makeDraft(overrides?: Partial<ConfigDraftAPI>): ConfigDraftAPI {
  return {
    draft: {
      workspace: { root: ".", parent_branch: "main", worktrees_dir: ".worktrees" },
      concurrency: 2,
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

describe("ConfigPane — dirty + Save (T-008)", () => {
  it("shows dirty indicator when dirty is true", () => {
    const draft = makeDraft({ dirty: true });
    const { getByTestId } = render(<ConfigPane configDraft={draft} />);

    expect(getByTestId("dirty-indicator")).toBeTruthy();
  });

  it("hides dirty indicator when dirty is false", () => {
    const draft = makeDraft({ dirty: false });
    const { queryByTestId } = render(<ConfigPane configDraft={draft} />);

    expect(queryByTestId("dirty-indicator")).toBeNull();
  });

  it("Save button calls save() when dirty and no errors", () => {
    const draft = makeDraft({ dirty: true });
    const { getByTestId } = render(<ConfigPane configDraft={draft} />);

    const saveBtn = getByTestId("btn-save");
    expect((saveBtn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(saveBtn);
    expect(draft.save).toHaveBeenCalled();
  });

  it("Save button disabled when not dirty", () => {
    const draft = makeDraft({ dirty: false });
    const { getByTestId } = render(<ConfigPane configDraft={draft} />);

    expect((getByTestId("btn-save") as HTMLButtonElement).disabled).toBe(true);
  });
});

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

  it("Save disabled when errors exist (fail-closed, C4)", () => {
    const draft = makeDraft({
      dirty: true,
      errors: [{ path: "concurrency", message: "too low" }],
    });
    const { getByTestId } = render(<ConfigPane configDraft={draft} />);

    expect((getByTestId("btn-save") as HTMLButtonElement).disabled).toBe(true);
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
