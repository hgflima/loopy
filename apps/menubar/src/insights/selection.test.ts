/**
 * Testes da seleção de changes (defaults do cabeçalho, D22).
 *
 * Run: `npm test -w apps/menubar -- insights/selection`
 */
import { describe, it, expect } from "vitest";
import type { ChangeRow } from "./rows";
import { pickDefaultThisChange, pickDefaultCompared, findChange } from "./selection";

function change(over: Partial<ChangeRow> = {}): ChangeRow {
  return {
    change_id: "C-0001",
    name: "uma change",
    repo: "loopy",
    base_sha: null,
    pipeline_version: "pv1",
    created_at: "2026-01-01T00:00:00Z",
    ended_at: null,
    status: "merged",
    tasks: 1,
    cost_usd: 1,
    cost_confidence: "exact",
    work_s: 100,
    lead_s: 200,
    human_s: 5,
    churn: 50,
    usd_per_line: 0.02,
    first_pass_rate: 1,
    human_pass_rate: 1,
    bugs: 0,
    bugs_open: 0,
    ...over,
  };
}

describe("pickDefaultThisChange", () => {
  it("escolhe a change mais recente por created_at", () => {
    const list = [
      change({ change_id: "C-0003", created_at: "2026-03-01T00:00:00Z" }),
      change({ change_id: "C-0001", created_at: "2026-01-01T00:00:00Z" }),
      change({ change_id: "C-0002", created_at: "2026-02-01T00:00:00Z" }),
    ];
    expect(pickDefaultThisChange(list)).toBe("C-0003");
  });

  it("lista vazia → null (sem telemetria)", () => {
    expect(pickDefaultThisChange([])).toBeNull();
  });
});

describe("pickDefaultCompared (D22)", () => {
  const list = [
    change({ change_id: "C-0004", created_at: "2026-04-01T00:00:00Z", status: null }), // em andamento
    change({ change_id: "C-0003", created_at: "2026-03-01T00:00:00Z", status: "merged" }),
    change({ change_id: "C-0002", created_at: "2026-02-01T00:00:00Z", status: "merged" }),
    change({ change_id: "C-0001", created_at: "2026-01-01T00:00:00Z", status: "abandoned" }),
  ];

  it("pega a merged imediatamente anterior por created_at", () => {
    // Foco = C-0003 → anterior merged = C-0002 (C-0001 é abandoned, ignorada).
    expect(pickDefaultCompared(list, "C-0003")).toBe("C-0002");
  });

  it("ignora a change em andamento (status null) como foco e como alvo", () => {
    // Foco = C-0004 (em andamento) → anterior merged = C-0003.
    expect(pickDefaultCompared(list, "C-0004")).toBe("C-0003");
  });

  it("ignora changes não-merged como alvo (abandoned/failed)", () => {
    // Foco = C-0002 → anterior seria C-0001, mas é abandoned → null.
    expect(pickDefaultCompared(list, "C-0002")).toBeNull();
  });

  it("sem merged anterior → null (a 3ª coluna nasce vazia)", () => {
    expect(pickDefaultCompared(list, "C-0001")).toBeNull();
  });

  it("foco desconhecido → null", () => {
    expect(pickDefaultCompared(list, "C-9999")).toBeNull();
    expect(pickDefaultCompared(list, null)).toBeNull();
  });

  it("não compara uma change consigo mesma", () => {
    const dup = [
      change({ change_id: "C-0002", created_at: "2026-02-01T00:00:00Z", status: "merged" }),
    ];
    expect(pickDefaultCompared(dup, "C-0002")).toBeNull();
  });
});

describe("findChange", () => {
  it("acha por id", () => {
    const list = [change({ change_id: "C-0001" }), change({ change_id: "C-0002" })];
    expect(findChange(list, "C-0002")?.change_id).toBe("C-0002");
  });

  it("id ausente ou null → null", () => {
    expect(findChange([change()], "C-9999")).toBeNull();
    expect(findChange([change()], null)).toBeNull();
  });
});
