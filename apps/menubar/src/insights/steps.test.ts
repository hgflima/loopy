/**
 * Testes da projeção `v_step` → view-model (a expansão por-tentativa, SC1).
 *
 * Run: `npm test -w apps/menubar -- insights/steps`
 */
import { describe, it, expect } from "vitest";
import type { StepRow } from "./rows";
import { toStepView, buildStepViews } from "./steps";

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
    tokens_cache_read: 20,
    tokens_cache_write: 5,
    cost_usd: 0.5,
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

describe("toStepView", () => {
  it("renomeia snake→camel e preserva o custo por-tentativa (SC1)", () => {
    const v = toStepView(step({ cost_usd: 0.42, visit_no: 2, attempt_no: 3 }));
    expect(v.stepId).toBe("s1");
    expect(v.name).toBe("build");
    expect(v.kind).toBe("agent");
    expect(v.visitNo).toBe(2);
    expect(v.attemptNo).toBe(3);
    expect(v.costUsd).toBe(0.42);
    expect(v.model).toBe("opus");
  });

  it("ok é true só quando status === 'pass'", () => {
    expect(toStepView(step({ status: "pass" })).ok).toBe(true);
    expect(toStepView(step({ status: "fail" })).ok).toBe(false);
    expect(toStepView(step({ status: "error" })).ok).toBe(false);
  });

  it("marca estimated quando cost_confidence é estimated", () => {
    expect(toStepView(step({ cost_confidence: "estimated" })).estimated).toBe(true);
    expect(toStepView(step({ cost_confidence: "exact" })).estimated).toBe(false);
  });

  it("soma os 4 contadores de token, ausência conta como zero", () => {
    expect(toStepView(step()).tokensTotal).toBe(175);
    expect(
      toStepView(
        step({
          tokens_in: null,
          tokens_out: null,
          tokens_cache_read: null,
          tokens_cache_write: null,
        }),
      ).tokensTotal,
    ).toBe(0);
  });

  it("preserva o motivo mecânico da falha e o dialeto do agente", () => {
    const v = toStepView(step({ status: "fail", fail_reason: "test-fail", fail_detail: "3 specs" }));
    expect(v.failReason).toBe("test-fail");
    expect(v.failDetail).toBe("3 specs");
    expect(v.mode).toBe("acceptEdits");
    expect(v.effort).toBe("high");
  });

  it("step não-agente: dialeto null passa reto", () => {
    const v = toStepView(
      step({ kind: "checks", config_id: null, preset: null, model: null, mode: null, effort: null }),
    );
    expect(v.model).toBeNull();
    expect(v.kind).toBe("checks");
  });
});

describe("buildStepViews", () => {
  it("projeta preservando a ordem (a linha do tempo por seq)", () => {
    const views = buildStepViews([
      step({ step_id: "a", seq: 1 }),
      step({ step_id: "b", seq: 2 }),
    ]);
    expect(views.map((v) => v.stepId)).toEqual(["a", "b"]);
  });

  it("lista vazia projeta vazia", () => {
    expect(buildStepViews([])).toEqual([]);
  });
});
