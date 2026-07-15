import { describe, it, expect } from "vitest";
import type { TaskRow } from "./rows";
import {
  verdictOf,
  taskChurn,
  isEscapedDefect,
  toTaskView,
  buildTaskViews,
  countUnrated,
  filterEscapedDefects,
} from "./tasks";
import { buildInsights } from "./model";

// ---------------------------------------------------------------------------
// Helper — linha mínima de v_task
// ---------------------------------------------------------------------------

function task(over: Partial<TaskRow> = {}): TaskRow {
  return {
    task_id: "C-0017/T-001",
    change_id: "C-0017",
    task_number: "T-001",
    name: "Uma task",
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

// ---------------------------------------------------------------------------
// verdictOf — tri-estado pass / fail / unrated
// ---------------------------------------------------------------------------

describe("verdictOf", () => {
  it("mapeia o veredito humano para pass/fail", () => {
    expect(verdictOf(task({ human_verdict: "pass" }))).toBe("pass");
    expect(verdictOf(task({ human_verdict: "fail" }))).toBe("fail");
  });

  it("ausência de veredito (null) vira 'unrated' — o terceiro estado", () => {
    expect(verdictOf(task({ human_verdict: null }))).toBe("unrated");
  });
});

// ---------------------------------------------------------------------------
// taskChurn — size_added + size_removed
// ---------------------------------------------------------------------------

describe("taskChurn", () => {
  it("soma added + removed", () => {
    expect(taskChurn(task({ size_added: 40, size_removed: 10 }))).toBe(50);
  });

  it("um lado null conta como zero", () => {
    expect(taskChurn(task({ size_added: 40, size_removed: null }))).toBe(40);
  });

  it("ambos null ⇒ null (churn desconhecido, não zero)", () => {
    expect(taskChurn(task({ size_added: null, size_removed: null }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isEscapedDefect + filterEscapedDefects — o defeito escapado (D23)
// ---------------------------------------------------------------------------

describe("defeito escapado (D23)", () => {
  it("merged + human_verdict='fail' é defeito escapado", () => {
    expect(isEscapedDefect(task({ status: "merged", human_verdict: "fail" }))).toBe(true);
  });

  it("merged + pass NÃO é escapado", () => {
    expect(isEscapedDefect(task({ status: "merged", human_verdict: "pass" }))).toBe(false);
  });

  it("fail mas não-merged (failed) NÃO é escapado — nunca chegou à main", () => {
    expect(isEscapedDefect(task({ status: "failed", human_verdict: "fail" }))).toBe(false);
  });

  it("merged sem veredito (null) NÃO é escapado", () => {
    expect(isEscapedDefect(task({ status: "merged", human_verdict: null }))).toBe(false);
  });

  it("filtra só as tasks escapadas", () => {
    const views = buildTaskViews([
      task({ task_id: "A", status: "merged", human_verdict: "fail", bugs_open: 0 }),
      task({ task_id: "B", status: "merged", human_verdict: "pass" }),
      task({ task_id: "C", status: "merged", human_verdict: "fail", bugs_open: 2 }),
      task({ task_id: "D", status: "failed", human_verdict: "fail" }),
    ]);
    expect(filterEscapedDefects(views).map((v) => v.taskId)).toEqual(["A", "C"]);
  });

  it("bônus: requireOpenBug exige também bug aberto (bugs_open > 0)", () => {
    const views = buildTaskViews([
      task({ task_id: "A", status: "merged", human_verdict: "fail", bugs_open: 0 }),
      task({ task_id: "C", status: "merged", human_verdict: "fail", bugs_open: 2 }),
    ]);
    expect(filterEscapedDefects(views, { requireOpenBug: true }).map((v) => v.taskId)).toEqual(["C"]);
  });
});

// ---------------------------------------------------------------------------
// toTaskView — projeção camelCase + marca estimated
// ---------------------------------------------------------------------------

describe("toTaskView", () => {
  it("projeta a linha para o view-model (churn, first_pass, verdict, escaped)", () => {
    const v = toTaskView(
      task({
        task_id: "C-0017/T-002",
        task_number: "T-002",
        status: "merged",
        human_verdict: "fail",
        size_added: 40,
        size_removed: 10,
        first_pass: 0,
        attempts: 3,
        bugs: 2,
        bugs_open: 1,
      }),
    );
    expect(v.taskId).toBe("C-0017/T-002");
    expect(v.taskNumber).toBe("T-002");
    expect(v.verdict).toBe("fail");
    expect(v.churn).toBe(50);
    expect(v.firstPass).toBe(false);
    expect(v.attempts).toBe(3);
    expect(v.bugs).toBe(2);
    expect(v.bugsOpen).toBe(1);
    expect(v.escapedDefect).toBe(true);
  });

  it("marca estimated quando cost_confidence='estimated'", () => {
    expect(toTaskView(task({ cost_confidence: "estimated" })).estimated).toBe(true);
    expect(toTaskView(task({ cost_confidence: "exact" })).estimated).toBe(false);
  });

  it("bugs/bugs_open null viram 0", () => {
    const v = toTaskView(task({ bugs: null, bugs_open: null }));
    expect(v.bugs).toBe(0);
    expect(v.bugsOpen).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// countUnrated — o contador de não-avaliadas
// ---------------------------------------------------------------------------

describe("countUnrated", () => {
  it("conta só as tasks sem veredito", () => {
    const views = buildTaskViews([
      task({ task_id: "A", human_verdict: "pass" }),
      task({ task_id: "B", human_verdict: null }),
      task({ task_id: "C", human_verdict: null }),
      task({ task_id: "D", human_verdict: "fail" }),
    ]);
    expect(countUnrated(views)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// buildInsights — o agregado consumido pela InsightsPane (T-011)
// ---------------------------------------------------------------------------

describe("buildInsights", () => {
  it("monta header + tasks + contadores num só modelo", () => {
    const model = buildInsights(
      {
        thisChange: null,
        comparedChange: null,
        baseline: null,
        tasks: [
          task({ task_id: "A", status: "merged", human_verdict: "fail", bugs_open: 1 }),
          task({ task_id: "B", status: "merged", human_verdict: null }),
          task({ task_id: "C", status: "merged", human_verdict: "pass" }),
        ],
      },
      "absolute",
    );
    expect(model.tasks).toHaveLength(3);
    expect(model.unrated).toBe(1);
    expect(model.escapedDefects).toBe(1);
    expect(model.header.length).toBeGreaterThan(0);
  });

  it("hasEstimated verdadeiro quando qualquer task tem custo estimado", () => {
    const model = buildInsights(
      {
        thisChange: null,
        comparedChange: null,
        baseline: null,
        tasks: [task({ cost_confidence: "exact" }), task({ task_id: "B", cost_confidence: "estimated" })],
      },
      "absolute",
    );
    expect(model.hasEstimated).toBe(true);
  });
});
