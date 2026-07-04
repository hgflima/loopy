import { describe, expect, it } from "vitest";
import { parseConfig } from "../../src/config/load";
import { configYaml } from "./_helpers";

describe("agentStepSchema — on_fail exige verify ou expect (OQ-7)", () => {
  it("rejeita on_fail órfão (sem verify nem expect)", () => {
    const yaml = configYaml((c) => {
      (c.pipeline as Record<string, unknown>[])[0] = {
        id: "orphan",
        type: "agent",
        prompt: "do it",
        on_fail: "escalate",
        // sem verify, sem expect
      };
    });

    expect(() => parseConfig(yaml)).toThrow(/on_fail/);
  });

  it("aceita on_fail com verify presente", () => {
    const yaml = configYaml((c) => {
      (c.pipeline as Record<string, unknown>[])[0] = {
        id: "with-verify",
        type: "agent",
        prompt: "do it",
        verify: { run: "ci", max_attempts: 3 },
        on_fail: "escalate",
      };
    });

    expect(() => parseConfig(yaml)).not.toThrow();
  });

  it("aceita on_fail com expect presente", () => {
    const yaml = configYaml((c) => {
      (c.pipeline as Record<string, unknown>[])[0] = {
        id: "with-expect",
        type: "agent",
        prompt: "do it",
        expect: "AUDIT: PASS",
        on_fail: "escalate",
      };
    });

    expect(() => parseConfig(yaml)).not.toThrow();
  });

  it("aceita on_fail com verify E expect presentes", () => {
    const yaml = configYaml((c) => {
      (c.pipeline as Record<string, unknown>[])[0] = {
        id: "with-both",
        type: "agent",
        prompt: "do it",
        verify: { run: "ci", max_attempts: 3 },
        expect: "AUDIT: PASS",
        on_fail: "escalate",
      };
    });

    expect(() => parseConfig(yaml)).not.toThrow();
  });

  it("aceita agent sem on_fail (campo opcional)", () => {
    const yaml = configYaml((c) => {
      (c.pipeline as Record<string, unknown>[])[0] = {
        id: "no-on-fail",
        type: "agent",
        prompt: "do it",
        // sem on_fail, sem verify, sem expect — válido (on_fail é opcional)
      };
    });

    expect(() => parseConfig(yaml)).not.toThrow();
  });

  it("approval com on_fail NÃO recebe guarda equivalente", () => {
    const yaml = configYaml((c) => {
      (c.pipeline as Record<string, unknown>[]).push({
        id: "merge",
        type: "approval",
        prompt: "approve?",
        on_fail: "escalate",
        // sem verify nem expect — válido para approval
      });
    });

    expect(() => parseConfig(yaml)).not.toThrow();
  });
});
