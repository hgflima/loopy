import { describe, expect, it } from "vitest";
import { parseConfig } from "../../src/config/load";
import { configYaml } from "./_helpers";

// ---------------------------------------------------------------------------
// OQ-7 original — on_fail exige verify ou expect (escalate)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// T-003 — id único no pipeline (superRefine #1)
// ---------------------------------------------------------------------------

describe("pipelineSchema — id único no pipeline", () => {
  it("rejeita ids duplicados com erro pt-BR citando os ids repetidos", () => {
    const yaml = configYaml((c) => {
      c.pipeline = [
        { id: "dup", type: "agent", prompt: "a", verify: { run: "ci", max_attempts: 3 } },
        { id: "dup", type: "shell", run: ["echo x"] },
        { id: "ok", type: "shell", always: true, run: ["echo done"] },
      ];
    });

    expect(() => parseConfig(yaml)).toThrow(/duplicado.*dup/i);
  });

  it("aceita ids distintos", () => {
    const yaml = configYaml(); // base config has "implement" and "cleanup"
    expect(() => parseConfig(yaml)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// T-003 — goto referencia id existente (superRefine #2)
// ---------------------------------------------------------------------------

describe("pipelineSchema — goto referencia id existente", () => {
  it("rejeita on_fail.goto para alvo inexistente com erro pt-BR", () => {
    const yaml = configYaml((c) => {
      c.pipeline = [
        {
          id: "review",
          type: "agent",
          prompt: "review it",
          expect: "REVIEW: PASS",
          on_fail: { goto: "nao-existe" },
        },
        { id: "cleanup", type: "shell", always: true, run: ["echo done"] },
      ];
    });

    expect(() => parseConfig(yaml)).toThrow(/on_fail\.goto.*nao-existe/);
  });

  it("rejeita on_success.goto para alvo inexistente com erro pt-BR", () => {
    const yaml = configYaml((c) => {
      c.pipeline = [
        {
          id: "impl",
          type: "agent",
          prompt: "do it",
          verify: { run: "ci", max_attempts: 3 },
          on_success: { goto: "fantasma" },
        },
        { id: "cleanup", type: "shell", always: true, run: ["echo done"] },
      ];
    });

    expect(() => parseConfig(yaml)).toThrow(/on_success\.goto.*fantasma/);
  });

  it("aceita on_fail.goto para alvo existente", () => {
    const yaml = configYaml((c) => {
      c.pipeline = [
        {
          id: "implement",
          type: "agent",
          prompt: "do it",
          verify: { run: "ci", max_attempts: 3 },
        },
        {
          id: "review",
          type: "agent",
          prompt: "review it",
          expect: "REVIEW: PASS",
          on_fail: { goto: "implement" },
        },
        { id: "cleanup", type: "shell", always: true, run: ["echo done"] },
      ];
    });

    expect(() => parseConfig(yaml)).not.toThrow();
  });

  it("aceita on_success.goto para alvo existente", () => {
    const yaml = configYaml((c) => {
      c.pipeline = [
        {
          id: "implement",
          type: "agent",
          prompt: "do it",
          verify: { run: "ci", max_attempts: 3 },
          on_success: { goto: "cleanup" },
        },
        { id: "cleanup", type: "shell", always: true, run: ["echo done"] },
      ];
    });

    expect(() => parseConfig(yaml)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// T-003 — guard do agente generalizado para on_fail: {goto} (superRefine #3)
// ---------------------------------------------------------------------------

describe("agentStepSchema — on_fail generalizado (escalate|goto) exige verify ou expect", () => {
  it("rejeita on_fail: { goto } sem verify nem expect", () => {
    const yaml = configYaml((c) => {
      c.pipeline = [
        {
          id: "orphan-goto",
          type: "agent",
          prompt: "do it",
          on_fail: { goto: "cleanup" },
        },
        { id: "cleanup", type: "shell", always: true, run: ["echo done"] },
      ];
    });

    expect(() => parseConfig(yaml)).toThrow(/on_fail/);
  });

  it("aceita on_fail: { goto } com verify", () => {
    const yaml = configYaml((c) => {
      c.pipeline = [
        {
          id: "with-goto-verify",
          type: "agent",
          prompt: "do it",
          verify: { run: "ci", max_attempts: 3 },
          on_fail: { goto: "cleanup" },
        },
        { id: "cleanup", type: "shell", always: true, run: ["echo done"] },
      ];
    });

    expect(() => parseConfig(yaml)).not.toThrow();
  });

  it("aceita on_fail: { goto } com expect", () => {
    const yaml = configYaml((c) => {
      c.pipeline = [
        {
          id: "with-goto-expect",
          type: "agent",
          prompt: "do it",
          expect: "AUDIT: PASS",
          on_fail: { goto: "cleanup" },
        },
        { id: "cleanup", type: "shell", always: true, run: ["echo done"] },
      ];
    });

    expect(() => parseConfig(yaml)).not.toThrow();
  });

  it("shell com on_fail: { goto } NÃO recebe guard", () => {
    const yaml = configYaml((c) => {
      c.pipeline = [
        { id: "build", type: "shell", run: ["npm run build"], on_fail: { goto: "cleanup" } },
        { id: "cleanup", type: "shell", always: true, run: ["echo done"] },
      ];
    });

    expect(() => parseConfig(yaml)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// T-003 — configs válidas com e sem goto + default max_step_visits
// ---------------------------------------------------------------------------

describe("configs válidas com e sem goto", () => {
  it("aceita pipeline sem goto (regressão zero)", () => {
    const yaml = configYaml();
    expect(() => parseConfig(yaml)).not.toThrow();
  });

  it("aceita fix-loop canônico (review on_fail goto implement)", () => {
    const yaml = configYaml((c) => {
      c.pipeline = [
        {
          id: "implement",
          type: "agent",
          prompt: "do it",
          verify: { run: "ci", max_attempts: 3 },
        },
        {
          id: "review",
          type: "agent",
          prompt: "review it",
          expect: "REVIEW: PASS",
          on_fail: { goto: "implement" },
        },
        { id: "commit", type: "shell", run: ["echo commit"] },
        { id: "cleanup", type: "shell", always: true, run: ["echo done"] },
      ];
    });

    expect(() => parseConfig(yaml)).not.toThrow();
  });

  it("aplica default max_step_visits=10", () => {
    const yaml = configYaml();
    const config = parseConfig(yaml);
    expect(config.stop_conditions.max_step_visits).toBe(10);
  });

  it("aceita max_step_visits explícito", () => {
    const yaml = configYaml((c) => {
      (c.stop_conditions as Record<string, unknown>).max_step_visits = 5;
    });
    const config = parseConfig(yaml);
    expect(config.stop_conditions.max_step_visits).toBe(5);
  });
});
