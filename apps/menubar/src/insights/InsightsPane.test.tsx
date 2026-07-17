/**
 * Testes de componente da InsightsPane — os 4 Success Criteria da spec com o
 * bridge Tauri (`@tauri-apps/api/core`) mockado por comando.
 *
 *  SC1 — custo/tentativas por task; custo por-tentativa ao expandir os passos.
 *  SC2 — marcar pass/fail e reverter (tri-estado; write-back + reload).
 *  SC3 — comparar contra média±desvio e outra change, absoluto↔normalizado, Δ%.
 *  SC4 — bug add liga à task (invoca o CLI pelo comando Rust).
 *  + degradação para "sem telemetria" sem `.db` (OQ3).
 *
 * Run: `npm test -w apps/menubar -- insights/InsightsPane`
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { ChangeRow, BaselineRow, TaskRow, StepRow } from "./rows";

// ---------------------------------------------------------------------------
// Tauri bridge mock — a per-command dispatcher tests can reconfigure.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockInvoke = vi.fn<(cmd: string, args?: any) => Promise<unknown>>();

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invoke: (cmd: string, args?: any) => mockInvoke(cmd, args),
}));

import { InsightsPane } from "./InsightsPane";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function change(over: Partial<ChangeRow> = {}): ChangeRow {
  return {
    change_id: "C-0017",
    name: "telemetry",
    repo: "loopy",
    base_sha: null,
    pipeline_version: "pv1",
    created_at: "2026-07-15T00:00:00Z",
    ended_at: "2026-07-15T01:00:00Z",
    status: "merged",
    tasks: 2,
    cost_usd: 3.2,
    cost_confidence: "exact",
    work_s: 600,
    lead_s: 1200,
    human_s: 30,
    churn: 160,
    usd_per_line: 0.02,
    first_pass_rate: 0.5,
    human_pass_rate: 0.5,
    bugs: 1,
    bugs_open: 1,
    ...over,
  };
}

function baseline(over: Partial<BaselineRow> = {}): BaselineRow {
  return {
    n: 2,
    cost_usd: 2.5,
    cost_usd_sd: 0.5,
    usd_per_line: 0.018,
    usd_per_line_sd: 0.004,
    lead_s: 1000,
    lead_s_sd: 100,
    work_s: 500,
    work_s_sd: 50,
    human_s: 25,
    human_s_sd: 5,
    tasks: 2,
    tasks_sd: 0,
    first_pass_rate: 0.6,
    human_pass_rate: 0.7,
    bugs: 0.5,
    bugs_sd: 0.5,
    ...over,
  };
}

function task(over: Partial<TaskRow> = {}): TaskRow {
  return {
    task_id: "C-0017/T-001",
    change_id: "C-0017",
    task_number: "T-001",
    name: "uma task",
    status: "merged",
    size_files: 2,
    size_added: 40,
    size_removed: 10,
    attempts: 1,
    first_pass: 1,
    cost_usd: 1.5,
    cost_confidence: "exact",
    work_s: 300,
    lead_s: 600,
    human_s: 12,
    human_verdict: null,
    bugs: 0,
    bugs_open: 0,
    ...over,
  };
}

function step(over: Partial<StepRow> = {}): StepRow {
  return {
    step_id: "s1",
    task_id: "C-0017/T-001",
    change_id: "C-0017",
    seq: 1,
    name: "build",
    kind: "agent",
    visit_no: 1,
    attempt_no: 1,
    status: "pass",
    fail_reason: null,
    fail_detail: null,
    config_id: "cfg1",
    preset: "claude",
    model: "opus",
    mode: "acceptEdits",
    effort: "high",
    tokens_in: 100,
    tokens_out: 50,
    tokens_cache_read: 0,
    tokens_cache_write: 0,
    cost_usd: 0.42,
    cost_confidence: "exact",
    price_version: null,
    human_seconds: null,
    work_s: 120,
    queued_at: null,
    started_at: "2026-07-15T00:00:00Z",
    ended_at: "2026-07-15T00:02:00Z",
    ...over,
  };
}

/** Configure `mockInvoke` to answer each command with the given data. */
function seed(data: {
  changes?: ChangeRow[];
  baseline?: BaselineRow[];
  tasks?: TaskRow[];
  steps?: StepRow[];
  dbExists?: boolean;
}) {
  mockInvoke.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case "read_change_list":
        return data.changes ?? [];
      case "read_baseline":
        return data.baseline ?? [];
      case "read_task_insights":
        return data.tasks ?? [];
      case "read_step_insights":
        return data.steps ?? [];
      case "telemetry_db_exists":
        return data.dbExists ?? true;
      default:
        return "ok"; // write commands
    }
  });
}

beforeEach(() => {
  mockInvoke.mockReset();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Degradation — no `.db` (OQ3)
// ---------------------------------------------------------------------------

describe("degradação sem telemetria (OQ3)", () => {
  it("sem `.db`: diz que o arquivo não existe", async () => {
    seed({ changes: [], dbExists: false });
    const { findByTestId, queryByTestId } = render(<InsightsPane dir="/proj" />);
    expect(await findByTestId("insights-empty-missing")).toBeTruthy();
    expect(queryByTestId("insights-empty-norows")).toBeNull();
  });

  it("`.db` existe mas sem changes: NÃO afirma que o arquivo falta", async () => {
    seed({ changes: [], dbExists: true });
    const { findByTestId, queryByTestId } = render(<InsightsPane dir="/proj" />);
    expect(await findByTestId("insights-empty-norows")).toBeTruthy();
    expect(queryByTestId("insights-empty-missing")).toBeNull();
  });

  it("shell antigo sem o comando `telemetry_db_exists` degrada para 'sem arquivo' (legado)", async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "telemetry_db_exists") throw new Error("unknown command");
      return [];
    });
    const { findByTestId } = render(<InsightsPane dir="/proj" />);
    expect(await findByTestId("insights-empty-missing")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// SC3 — header 3-col, baseline, compared Δ%, absolute↔normalized
// ---------------------------------------------------------------------------

describe("SC3 — cabeçalho de três colunas", () => {
  it("renderiza a métrica de custo com esta change, baseline e comparada", async () => {
    seed({
      changes: [
        change({ change_id: "C-0017", created_at: "2026-07-15T00:00:00Z", cost_usd: 3.2 }),
        change({ change_id: "C-0016", created_at: "2026-07-01T00:00:00Z", cost_usd: 2.0 }),
      ],
      baseline: [baseline()],
      tasks: [task()],
    });
    const { findByTestId, getByTestId } = render(<InsightsPane dir="/proj" />);

    // this change (C-0017) cost absolute
    const current = await findByTestId("metric-cost-current");
    expect(current.textContent).toBe("$3.20");
    // baseline mean ± sd
    expect(getByTestId("metric-cost").textContent).toContain("$2.50 ± $0.50");
    // compared = C-0016 by default (D22: merged-before)
    expect(getByTestId("insights-compared-header").textContent).toContain("C-0016");
  });

  it("nasce ABSOLUTO e o toggle vira normalizado (por churn)", async () => {
    seed({ changes: [change()], baseline: [baseline()], tasks: [task()] });
    const { findByTestId, getByRole } = render(<InsightsPane dir="/proj" />);

    const current = await findByTestId("metric-cost-current");
    expect(current.textContent).toBe("$3.20"); // absoluto por default

    // Toggle → Normalizado: custo vira por-linha ($/L).
    fireEvent.click(getByRole("radio", { name: "Normalizado" }));
    await waitFor(() => expect(current.textContent).toContain("/L"));
  });

  it("Δ% da 3ª coluna compara esta change com a comparada", async () => {
    seed({
      changes: [
        change({ change_id: "C-0017", created_at: "2026-07-15T00:00:00Z", cost_usd: 3.0 }),
        change({ change_id: "C-0016", created_at: "2026-07-01T00:00:00Z", cost_usd: 2.0 }),
      ],
      baseline: [baseline()],
      tasks: [task()],
    });
    const { findByTestId } = render(<InsightsPane dir="/proj" />);
    // (3.0 - 2.0) / 2.0 = +50%
    const delta = await findByTestId("metric-cost-delta");
    expect(delta.textContent).toBe("+50%");
  });
});

// ---------------------------------------------------------------------------
// SC2 — tri-state verdict (set + revert), write-back invokes the CLI
// ---------------------------------------------------------------------------

describe("SC2 — veredito tri-estado", () => {
  it("marcar 'fail' invoca insights_set_verdict e recarrega", async () => {
    seed({ changes: [change()], baseline: [baseline()], tasks: [task({ human_verdict: null })] });
    const { findByTestId } = render(<InsightsPane dir="/proj" />);

    const failBtn = await findByTestId("verdict-fail-C-0017/T-001");
    mockInvoke.mockClear();
    fireEvent.click(failBtn);

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("insights_set_verdict", {
        dir: "/proj",
        task: "C-0017/T-001",
        verdict: "fail",
        note: undefined,
        by: undefined,
      }),
    );
    // reload after write-back
    await waitFor(() =>
      expect(mockInvoke.mock.calls.some((c) => c[0] === "read_change_list")).toBe(true),
    );
  });

  it("clicar no veredito ativo reverte para 'clear' (D20)", async () => {
    seed({ changes: [change()], baseline: [baseline()], tasks: [task({ human_verdict: "pass" })] });
    const { findByTestId } = render(<InsightsPane dir="/proj" />);

    const passBtn = await findByTestId("verdict-pass-C-0017/T-001");
    expect(passBtn.getAttribute("aria-pressed")).toBe("true");
    mockInvoke.mockClear();
    fireEvent.click(passBtn);

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("insights_set_verdict", {
        dir: "/proj",
        task: "C-0017/T-001",
        verdict: "clear",
        note: undefined,
        by: undefined,
      }),
    );
  });

  it("conta as tasks não avaliadas", async () => {
    seed({
      changes: [change()],
      baseline: [baseline()],
      tasks: [
        task({ task_id: "C-0017/T-001", task_number: "T-001", human_verdict: null }),
        task({ task_id: "C-0017/T-002", task_number: "T-002", human_verdict: "pass" }),
      ],
    });
    const { findByTestId } = render(<InsightsPane dir="/proj" />);
    expect((await findByTestId("insights-unrated")).textContent).toContain("1 não avaliada");
  });
});

// ---------------------------------------------------------------------------
// D23 — escaped defect badge + filter
// ---------------------------------------------------------------------------

describe("D23 — defeito escapado", () => {
  it("marca e filtra tasks merged + human_verdict='fail'", async () => {
    seed({
      changes: [change()],
      baseline: [baseline()],
      tasks: [
        task({ task_id: "C-0017/T-001", task_number: "T-001", human_verdict: null }),
        task({ task_id: "C-0017/T-002", task_number: "T-002", human_verdict: "fail" }), // escapado
      ],
    });
    const { findByTestId, getByTestId, queryByTestId } = render(<InsightsPane dir="/proj" />);

    // Badge on the escaped task
    expect(await findByTestId("escaped-C-0017/T-002")).toBeTruthy();

    // Filter shows only the escaped one
    fireEvent.click(getByTestId("insights-escaped-filter"));
    await waitFor(() => expect(queryByTestId("task-C-0017/T-001")).toBeNull());
    expect(getByTestId("task-C-0017/T-002")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// SC1 — expand a task into its per-attempt steps
// ---------------------------------------------------------------------------

describe("SC1 — expansão nos passos (custo por-tentativa)", () => {
  it("expandir uma task carrega v_step e mostra o custo por-tentativa", async () => {
    seed({
      changes: [change()],
      baseline: [baseline()],
      tasks: [task()],
      steps: [
        step({ step_id: "s1", seq: 1, cost_usd: 0.42 }),
        step({ step_id: "s2", seq: 2, visit_no: 2, cost_usd: 0.31 }),
      ],
    });
    const { findByTestId, getByTestId } = render(<InsightsPane dir="/proj" />);

    const toggle = await findByTestId("task-toggle-C-0017/T-001");
    fireEvent.click(toggle);

    // v_step is read for the expanded task
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("read_step_insights", {
        dir: "/proj",
        taskId: "C-0017/T-001",
      }),
    );
    // per-attempt cost rendered
    expect((await findByTestId("step-cost-s1")).textContent).toContain("$0.42");
    expect(getByTestId("step-cost-s2").textContent).toContain("$0.31");
  });
});

// ---------------------------------------------------------------------------
// SC4 — add a bug, linked to the task, via the CLI command
// ---------------------------------------------------------------------------

describe("SC4 — bug add", () => {
  it("adiciona um bug ligado à task (invoca insights_add_bug com found_in = change)", async () => {
    seed({ changes: [change()], baseline: [baseline()], tasks: [task()] });
    const { findByTestId, getByTestId } = render(<InsightsPane dir="/proj" />);

    fireEvent.click(await findByTestId("bug-add-C-0017/T-001"));
    fireEvent.change(getByTestId("bug-title-C-0017/T-001"), {
      target: { value: "regressão no parser" },
    });
    mockInvoke.mockClear();
    fireEvent.click(getByTestId("bug-submit-C-0017/T-001"));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("insights_add_bug", {
        dir: "/proj",
        task: "C-0017/T-001",
        severity: "medium",
        title: "regressão no parser",
        detail: undefined,
        foundIn: "C-0017",
      }),
    );
  });
});
