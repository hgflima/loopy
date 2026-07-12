/**
 * Tests for ConfigPane — the visual editor for top-level loopy.yml settings.
 *
 * Covers (T-008):
 * - workspace + concurrency fields render and call patch on edit
 * - invalid concurrency (0) ⇒ inline error + section counter + Save disabled
 * - valid edit ⇒ dirty indicator + Save calls save()
 * - cross-field error banner appears for errors outside visible sections
 * - Save disabled when any error exists (fail-closed, C4)
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

function makeDraft(overrides?: Partial<ConfigDraftAPI>): ConfigDraftAPI {
  return {
    draft: {
      workspace: { root: ".", parent_branch: "main", worktrees_dir: ".worktrees" },
      concurrency: 2,
    } as ConfigDraftAPI["draft"],
    errors: [] as ConfigError[],
    dirty: false,
    tasks: [],
    load: vi.fn(),
    patch: vi.fn(),
    save: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
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
    const { getByRole, getByTestId } = render(<ConfigPane configDraft={draft} />);

    // Inline error
    expect(getByRole("alert").textContent).toBe("Must be ≥ 1");

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
        { path: "acp.command", message: "No resolvable agent" },
      ],
    });
    const { getByTestId } = render(<ConfigPane configDraft={draft} />);

    const banner = getByTestId("config-banner");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("agents and acp.command are mutually exclusive");
    expect(banner.textContent).toContain("No resolvable agent");
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
