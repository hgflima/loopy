import { describe, it, expect } from "vitest";
import type { ChangeRow, BaselineRow } from "./rows";
import {
  deltaPct,
  normalizeByChurn,
  buildHeaderRows,
  METRICS,
  type HeaderRow,
} from "./metrics";

// ---------------------------------------------------------------------------
// Helpers — linhas mínimas de v_change / v_change_baseline
// ---------------------------------------------------------------------------

function change(over: Partial<ChangeRow> = {}): ChangeRow {
  return {
    change_id: "C-0017",
    name: "telemetry",
    repo: "loopy",
    base_sha: "abc",
    pipeline_version: "sha256:x",
    created_at: "2026-07-14T00:00:00Z",
    ended_at: null,
    status: null,
    tasks: 3,
    cost_usd: 6,
    cost_confidence: "exact",
    work_s: 1200,
    lead_s: 3600,
    human_s: 60,
    churn: 300,
    usd_per_line: 0.02,
    first_pass_rate: 0.66,
    human_pass_rate: 1,
    bugs: 1,
    bugs_open: 0,
    ...over,
  };
}

function baseline(over: Partial<BaselineRow> = {}): BaselineRow {
  return {
    n: 4,
    cost_usd: 10,
    cost_usd_sd: 2,
    usd_per_line: 0.05,
    usd_per_line_sd: 0.01,
    lead_s: 4800,
    lead_s_sd: 600,
    work_s: 1500,
    work_s_sd: 300,
    human_s: 120,
    human_s_sd: 30,
    tasks: 4,
    tasks_sd: 1,
    first_pass_rate: 0.5,
    human_pass_rate: 0.75,
    bugs: 2,
    bugs_sd: 1,
    ...over,
  };
}

function row(rows: HeaderRow[], key: string): HeaderRow {
  const r = rows.find((h) => h.key === key);
  if (!r) throw new Error(`sem header row '${key}'`);
  return r;
}

// ---------------------------------------------------------------------------
// deltaPct — a Δ% da 3ª coluna (esta change vs a comparada)
// ---------------------------------------------------------------------------

describe("deltaPct", () => {
  it("percentual assinado de current vs compared", () => {
    // custo caiu de 10 → 6: -40%
    expect(deltaPct(6, 10)).toBeCloseTo(-40);
    // subiu de 4 → 6: +50%
    expect(deltaPct(6, 4)).toBeCloseTo(50);
    // igual: 0%
    expect(deltaPct(5, 5)).toBe(0);
  });

  it("null quando qualquer lado é null", () => {
    expect(deltaPct(null, 10)).toBeNull();
    expect(deltaPct(6, null)).toBeNull();
    expect(deltaPct(null, null)).toBeNull();
  });

  it("null quando o comparado é zero (divisão indefinida)", () => {
    expect(deltaPct(6, 0)).toBeNull();
    // zero contra zero também é indefinido, não 0%
    expect(deltaPct(0, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizeByChurn — o divisor do toggle absoluto↔normalizado
// ---------------------------------------------------------------------------

describe("normalizeByChurn", () => {
  it("divide o valor pelo churn", () => {
    expect(normalizeByChurn(6, 300)).toBeCloseTo(0.02);
  });

  it("null com valor ausente, churn ausente ou churn zero", () => {
    expect(normalizeByChurn(null, 300)).toBeNull();
    expect(normalizeByChurn(6, null)).toBeNull();
    expect(normalizeByChurn(6, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildHeaderRows — as três colunas do cabeçalho
// ---------------------------------------------------------------------------

describe("buildHeaderRows", () => {
  it("uma linha por métrica do catálogo, na ordem do catálogo", () => {
    const rows = buildHeaderRows(change(), baseline(), change(), "absolute");
    expect(rows.map((r) => r.key)).toEqual(METRICS.map((m) => m.key));
  });

  it("modo absoluto: valor cru da change nas 3 colunas + Δ%", () => {
    const rows = buildHeaderRows(
      change({ cost_usd: 6 }),
      baseline({ cost_usd: 10, cost_usd_sd: 2 }),
      change({ cost_usd: 10 }),
      "absolute",
    );
    const cost = row(rows, "cost");
    expect(cost.current).toBe(6);
    expect(cost.baselineMean).toBe(10);
    expect(cost.baselineSd).toBe(2);
    expect(cost.compared).toBe(10);
    // Δ% vem da 3ª coluna: 6 vs 10 = -40%
    expect(cost.deltaPct).toBeCloseTo(-40);
    expect(cost.mode).toBe("absolute");
  });

  it("modo normalizado: custo vira custo-por-churn nas colunas de change", () => {
    const rows = buildHeaderRows(
      change({ cost_usd: 6, churn: 300 }),
      baseline(),
      change({ cost_usd: 10, churn: 200 }),
      "normalized",
    );
    const cost = row(rows, "cost");
    expect(cost.current).toBeCloseTo(0.02); // 6/300
    expect(cost.compared).toBeCloseTo(0.05); // 10/200
    expect(cost.mode).toBe("normalized");
    // Δ%: 0.02 vs 0.05 = -60%
    expect(cost.deltaPct).toBeCloseTo(-60);
  });

  it("modo normalizado: baseline do custo usa a coluna usd_per_line dedicada", () => {
    const rows = buildHeaderRows(
      change(),
      baseline({ usd_per_line: 0.05, usd_per_line_sd: 0.01 }),
      change(),
      "normalized",
    );
    const cost = row(rows, "cost");
    expect(cost.baselineMean).toBeCloseTo(0.05);
    expect(cost.baselineSd).toBeCloseTo(0.01);
  });

  it("métrica não-normalizável (tasks) ignora o toggle e fica sempre absoluta", () => {
    const rows = buildHeaderRows(change({ tasks: 3 }), baseline(), change(), "normalized");
    const tasks = row(rows, "tasks");
    expect(tasks.mode).toBe("absolute");
    expect(tasks.current).toBe(3);
  });

  it("marca estimated no custo quando cost_confidence='estimated'", () => {
    const est = buildHeaderRows(change({ cost_confidence: "estimated" }), baseline(), null, "absolute");
    expect(row(est, "cost").estimated).toBe(true);

    const exact = buildHeaderRows(change({ cost_confidence: "exact" }), baseline(), null, "absolute");
    expect(row(exact, "cost").estimated).toBe(false);
  });

  it("colunas ausentes (change/baseline/comparada null) ⇒ null, sem lançar", () => {
    const rows = buildHeaderRows(null, null, null, "absolute");
    const cost = row(rows, "cost");
    expect(cost.current).toBeNull();
    expect(cost.baselineMean).toBeNull();
    expect(cost.compared).toBeNull();
    expect(cost.deltaPct).toBeNull();
  });
});
