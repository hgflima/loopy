/**
 * Tests for SpecsPane — the Specs tab: the Changes list, the agent/model/effort
 * selector, the Run-active warning, and the entry points into the Interview
 * (C-0018, T-013).
 *
 * SpecsPane is the tab's **shell**: it lists the project's Changes (via
 * `read_changes`, T-007), starts a fresh Interview (`+ Nova spec`), resumes a
 * partial one at a chosen Phase (`Continuar`, D12/D13), discards one with
 * confirmation (`discard_change`, D21), and persists the authoring selection to
 * `launch-config.json` (D18). The Interview itself is mocked here — its flow is
 * covered by `Interview.test.tsx`; this file proves the list and the wiring.
 *
 * `useAgentCapabilities` is mocked (as in `ConfigPane.test.tsx`): idle by
 * default, so model/effort degrade to free-text fields — the D31 fallback — and
 * persistence is testable without a real probe.
 *
 * Run: `npm test -w apps/menubar -- SpecsPane`
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";

// Tauri bridge — isTauri true so the loads run; invoke is the command router.
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(),
}));

// Probe hook — idle by default (no probe), so model/effort are text fields.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockUseAgentCapabilities = vi.fn<(...args: any[]) => any>(() => ({
  status: "idle",
  caps: undefined,
  reason: undefined,
  probe: vi.fn(),
}));
vi.mock("../config/useAgentCapabilities", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useAgentCapabilities: (...args: any[]) => mockUseAgentCapabilities(...args),
}));

// The Interview is mocked to a thin stub that echoes the props SpecsPane wired.
vi.mock("./Interview", () => ({
  Interview: (props: {
    dir: string;
    agent?: string;
    model?: string;
    effort?: string;
    resume?: unknown;
    onClose: () => void;
  }) => (
    <div
      data-testid="interview-mock"
      data-dir={props.dir}
      data-agent={props.agent ?? ""}
      data-model={props.model ?? ""}
      data-effort={props.effort ?? ""}
      data-resume={JSON.stringify(props.resume ?? null)}
    >
      <button type="button" onClick={props.onClose}>
        fechar-entrevista
      </button>
    </div>
  ),
}));

import { invoke } from "@tauri-apps/api/core";
import { SpecsPane, remainingPhases } from "./SpecsPane";
import type { ChangeSummary } from "./SpecsPane";

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Fixtures + command router
// ---------------------------------------------------------------------------

function change(over: Partial<ChangeSummary> = {}): ChangeSummary {
  return {
    id: "C-0007",
    slug: "example",
    has_spec: true,
    has_plan: true,
    has_todo: true,
    task_count: 4,
    done_count: 1,
    ...over,
  };
}

const BASE_LAUNCH = {
  dir: "/proj",
  yes: false,
  task_id: "",
  verbose: false,
  authoring_agent: "",
  authoring_model: "",
  authoring_effort: "",
};

/** Wire `invoke` to a per-command handler map; unlisted commands resolve undefined. */
function routeInvoke(
  handlers: Record<string, (args: unknown) => unknown>,
): void {
  mockInvoke.mockImplementation((cmd: string, args: unknown) => {
    const h = handlers[cmd];
    return Promise.resolve(h ? h(args) : undefined);
  });
}

function callsFor(cmd: string): unknown[][] {
  return mockInvoke.mock.calls.filter((c) => c[0] === cmd);
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockUseAgentCapabilities.mockClear();
});
afterEach(cleanup);

// ---------------------------------------------------------------------------
// remainingPhases (pure)
// ---------------------------------------------------------------------------

describe("remainingPhases", () => {
  it("offers refine and plan once the spec exists (SC9)", () => {
    expect(
      remainingPhases(
        change({ has_spec: true, has_plan: false, has_todo: false }),
      ),
    ).toEqual(["refine", "plan"]);
  });

  it("offers spec when even the spec is missing", () => {
    expect(
      remainingPhases(
        change({ has_spec: false, has_plan: false, has_todo: false }),
      ),
    ).toEqual(["spec"]);
  });
});

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

describe("SpecsPane — list", () => {
  it("renders each Change with its three .md flags and task count", async () => {
    routeInvoke({
      read_changes: () => [
        change({
          id: "C-0018",
          slug: "specs-authoring",
          has_spec: true,
          has_plan: false,
          has_todo: false,
          task_count: 18,
          done_count: 3,
        }),
        change({ id: "C-0007", slug: "example" }),
      ],
      load_launch_config: () => BASE_LAUNCH,
    });

    const { findByTestId } = render(<SpecsPane dir="/proj" />);

    const row = await findByTestId("change-C-0018");
    const u = within(row);
    // Flags reflect has_spec/has_plan/has_todo.
    expect(u.getByTestId("flag-spec").dataset.present).toBe("true");
    expect(u.getByTestId("flag-plan").dataset.present).toBe("false");
    expect(u.getByTestId("flag-todo").dataset.present).toBe("false");
    // Task count is done/total.
    expect(u.getByTestId("task-count").textContent).toContain("3/18");

    // Both changes present.
    expect(await findByTestId("change-C-0007")).toBeTruthy();
  });

  it("reads the changes for the given dir", async () => {
    routeInvoke({
      read_changes: () => [],
      load_launch_config: () => BASE_LAUNCH,
    });
    render(<SpecsPane dir="/proj" />);
    await waitFor(() =>
      expect(callsFor("read_changes").length).toBeGreaterThan(0),
    );
    expect(callsFor("read_changes")[0][1]).toEqual({ dir: "/proj" });
  });
});

// ---------------------------------------------------------------------------
// + Nova spec → the Interview
// ---------------------------------------------------------------------------

describe("SpecsPane — new spec", () => {
  it("mounts the Interview (no resume) wired with dir and the authoring selection", async () => {
    routeInvoke({
      read_changes: () => [],
      load_launch_config: () => ({
        ...BASE_LAUNCH,
        authoring_agent: "claude",
        authoring_model: "opus",
        authoring_effort: "high",
      }),
    });

    const { findByText, findByTestId } = render(<SpecsPane dir="/proj" />);
    fireEvent.click(await findByText("+ Nova spec"));

    const mock = await findByTestId("interview-mock");
    expect(mock.dataset.dir).toBe("/proj");
    expect(mock.dataset.resume).toBe("null");
    expect(mock.dataset.agent).toBe("claude");
    expect(mock.dataset.model).toBe("opus");
    expect(mock.dataset.effort).toBe("high");
  });

  it("disables + Nova spec without a dir", () => {
    routeInvoke({});
    const { getByText } = render(<SpecsPane dir="" />);
    expect((getByText("+ Nova spec") as HTMLButtonElement).disabled).toBe(true);
  });

  it("returns to the list when the Interview closes", async () => {
    routeInvoke({
      read_changes: () => [],
      load_launch_config: () => BASE_LAUNCH,
    });
    const { findByText, queryByTestId } = render(<SpecsPane dir="/proj" />);
    fireEvent.click(await findByText("+ Nova spec"));
    fireEvent.click(await findByText("fechar-entrevista"));
    await waitFor(() => expect(queryByTestId("interview-mock")).toBeNull());
    // Back to the list.
    expect(await findByText("+ Nova spec")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Continuar → the phase picker (D12/D13)
// ---------------------------------------------------------------------------

describe("SpecsPane — continue a partial Change", () => {
  it("offers the remaining phases and resumes into the chosen one", async () => {
    routeInvoke({
      read_changes: () => [
        change({
          id: "C-0018",
          slug: "specs-authoring",
          has_spec: true,
          has_plan: false,
          has_todo: false,
        }),
      ],
      load_launch_config: () => BASE_LAUNCH,
    });

    const { findByTestId } = render(<SpecsPane dir="/proj" />);
    const row = await findByTestId("change-C-0018");
    fireEvent.click(within(row).getByText("Continuar"));

    // The picker offers refine and plan (not spec — D12/D13), never spec.
    const picker = await findByTestId("phase-picker");
    expect(within(picker).getByText("Refinamento")).toBeTruthy();
    expect(within(picker).getByText("Plano")).toBeTruthy();
    expect(within(picker).queryByText("Especificação")).toBeNull();

    // Choosing "Plano" resumes there. The engine resolves the dir from the id
    // (AD-4: the `.harn/devy/changes` constant lives only in engine + Rust), so
    // the resume carries `change` + `phase`, not a changeDir.
    fireEvent.click(within(picker).getByText("Plano"));
    const mock = await findByTestId("interview-mock");
    const resume = JSON.parse(mock.dataset.resume ?? "null");
    expect(resume).toMatchObject({ change: "C-0018", phase: "plan" });
    expect(resume.changeDir ?? null).toBeNull();
  });

  it("does not offer Continuar on a complete Change", async () => {
    routeInvoke({
      read_changes: () => [change({ id: "C-0007", slug: "done" })],
      load_launch_config: () => BASE_LAUNCH,
    });
    const { findByTestId } = render(<SpecsPane dir="/proj" />);
    const row = await findByTestId("change-C-0007");
    expect(within(row).queryByText("Continuar")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Descartar → confirmation + discard_change (D21)
// ---------------------------------------------------------------------------

describe("SpecsPane — discard", () => {
  it("asks for confirmation, then calls discard_change and reloads", async () => {
    let changesList: ChangeSummary[] = [
      change({
        id: "C-0018",
        slug: "specs-authoring",
        has_plan: false,
        has_todo: false,
      }),
    ];
    routeInvoke({
      read_changes: () => changesList,
      load_launch_config: () => BASE_LAUNCH,
      discard_change: () => {
        changesList = [];
        return undefined;
      },
    });

    const { findByTestId, queryByText } = render(<SpecsPane dir="/proj" />);
    const row = await findByTestId("change-C-0018");
    fireEvent.click(within(row).getByText("Descartar"));

    // A confirmation appears (no command fired yet).
    const confirm = await findByTestId("discard-confirm");
    expect(callsFor("discard_change").length).toBe(0);

    fireEvent.click(within(confirm).getByText("Descartar"));
    await waitFor(() => expect(callsFor("discard_change").length).toBe(1));
    expect(callsFor("discard_change")[0][1]).toEqual({
      dir: "/proj",
      id: "C-0018",
    });

    // The list reloaded and the Change is gone.
    await waitFor(() => expect(queryByText("C-0018")).toBeNull());
  });

  it("cancelling the confirmation fires nothing", async () => {
    routeInvoke({
      read_changes: () => [
        change({ id: "C-0018", slug: "s", has_plan: false, has_todo: false }),
      ],
      load_launch_config: () => BASE_LAUNCH,
    });
    const { findByTestId } = render(<SpecsPane dir="/proj" />);
    const row = await findByTestId("change-C-0018");
    fireEvent.click(within(row).getByText("Descartar"));
    const confirm = await findByTestId("discard-confirm");
    fireEvent.click(within(confirm).getByText("Cancelar"));
    expect(callsFor("discard_change").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Selector persistence (D18)
// ---------------------------------------------------------------------------

describe("SpecsPane — authoring selector", () => {
  it("persists the three keys to launch-config.json on change", async () => {
    routeInvoke({
      read_changes: () => [],
      load_launch_config: () => ({ ...BASE_LAUNCH, authoring_agent: "claude" }),
    });

    const { findByLabelText } = render(<SpecsPane dir="/proj" />);

    // Probe idle → model is a free-text field (D31 fallback).
    const modelField = await findByLabelText("model");
    fireEvent.change(modelField, { target: { value: "opus" } });

    await waitFor(() =>
      expect(callsFor("save_launch_config").length).toBeGreaterThan(0),
    );
    const lastSave = callsFor("save_launch_config").at(-1)![1] as {
      config: Record<string, unknown>;
    };
    // All three authoring keys travel together, and dir/flags are preserved.
    expect(lastSave.config.authoring_model).toBe("opus");
    expect(lastSave.config.authoring_agent).toBe("claude");
    expect(lastSave.config).toHaveProperty("authoring_effort");
    expect(lastSave.config.dir).toBe("/proj");
  });

  it("probes by the resolved argv, keyed by (agent, model)", async () => {
    routeInvoke({
      read_changes: () => [],
      load_launch_config: () => BASE_LAUNCH,
    });
    render(<SpecsPane dir="/proj" />);
    await waitFor(() => expect(mockUseAgentCapabilities).toHaveBeenCalled());
    // agentName, agentCommand, dir, model — the C-0016 contract.
    const [agentName, command, dir] =
      mockUseAgentCapabilities.mock.calls.at(-1)!;
    expect(agentName).toBe("claude");
    expect(Array.isArray(command)).toBe(true);
    expect(dir).toBe("/proj");
  });

  it("renders probed selects when the probe is ok (reuses SelectField/ensureOption)", async () => {
    mockUseAgentCapabilities.mockReturnValue({
      status: "ok",
      caps: {
        modes: [],
        models: ["opus", "sonnet"],
        efforts: ["high", "max"],
        defaultModel: "opus",
        defaultEffort: "high",
      },
      reason: undefined,
      probe: vi.fn(),
    });
    routeInvoke({
      read_changes: () => [],
      load_launch_config: () => BASE_LAUNCH,
    });

    const { findByLabelText } = render(<SpecsPane dir="/proj" />);
    const modelSelect = (await findByLabelText("model")) as HTMLSelectElement;
    expect(modelSelect.tagName).toBe("SELECT");
    const values = Array.from(modelSelect.options).map((o) => o.value);
    expect(values).toContain("opus");
    expect(values).toContain("sonnet");
  });
});

// ---------------------------------------------------------------------------
// Run-active warning (D22)
// ---------------------------------------------------------------------------

describe("SpecsPane — Run-active warning", () => {
  it("shows the warning only when a Run is active", async () => {
    routeInvoke({
      read_changes: () => [],
      load_launch_config: () => BASE_LAUNCH,
    });

    const { queryByTestId, findByTestId, rerender } = render(
      <SpecsPane dir="/proj" runActive={false} />,
    );
    // Give the loads a tick, then assert absence.
    await findByTestId("specs-pane");
    expect(queryByTestId("run-active-warning")).toBeNull();

    rerender(<SpecsPane dir="/proj" runActive={true} />);
    const warn = await findByTestId("run-active-warning");
    // The text tells the truth: a new Change dirties the parent (require_clean_parent).
    expect(warn.textContent).toMatch(/require_clean_parent|parent/i);
  });
});
