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

// ---------------------------------------------------------------------------
// T-003 — parallel_safe (stepBaseShape, default false)
// ---------------------------------------------------------------------------

describe("stepBaseShape — parallel_safe", () => {
  it("aplica default parallel_safe=false", () => {
    const yaml = configYaml();
    const config = parseConfig(yaml);
    expect(config.pipeline[0]!.parallel_safe).toBe(false);
  });

  it("aceita parallel_safe: true em shell step", () => {
    const yaml = configYaml((c) => {
      c.pipeline = [
        { id: "safe-cmd", type: "shell", run: ["npm ci --prefix .worktrees/T-001"], parallel_safe: true },
        { id: "cleanup", type: "shell", always: true, run: ["echo done"] },
      ];
    });
    const config = parseConfig(yaml);
    expect(config.pipeline[0]!.parallel_safe).toBe(true);
  });

  it("aceita parallel_safe: true em agent step", () => {
    const yaml = configYaml((c) => {
      (c.pipeline as Record<string, unknown>[])[0]!.parallel_safe = true;
    });
    expect(() => parseConfig(yaml)).not.toThrow();
  });

  it("rejeita parallel_safe com valor não-booleano (strict)", () => {
    const yaml = configYaml((c) => {
      (c.pipeline as Record<string, unknown>[])[0]!.parallel_safe = "yes";
    });
    expect(() => parseConfig(yaml)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// T-003 — on_merge_conflict (gitPolicySchema, default 'escalate')
// ---------------------------------------------------------------------------

describe("gitPolicySchema — on_merge_conflict", () => {
  it("aplica default on_merge_conflict='escalate'", () => {
    const yaml = configYaml();
    const config = parseConfig(yaml);
    expect(config.policies.git.on_merge_conflict).toBe("escalate");
  });

  it("aceita on_merge_conflict: 'rebase'", () => {
    const yaml = configYaml((c) => {
      (c.policies as Record<string, unknown>).git = {
        require_clean_parent: true,
        on_merge_conflict: "rebase",
      };
    });
    const config = parseConfig(yaml);
    expect(config.policies.git.on_merge_conflict).toBe("rebase");
  });

  it("rejeita on_merge_conflict com valor inválido", () => {
    const yaml = configYaml((c) => {
      (c.policies as Record<string, unknown>).git = {
        require_clean_parent: true,
        on_merge_conflict: "abort",
      };
    });
    expect(() => parseConfig(yaml)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// T-003 — concurrency legível (já existente, confirmar default)
// ---------------------------------------------------------------------------

describe("concurrency", () => {
  it("aplica default concurrency=1", () => {
    const yaml = configYaml((c) => {
      delete c.concurrency;
    });
    const config = parseConfig(yaml);
    expect(config.concurrency).toBe(1);
  });

  it("aceita concurrency explícito", () => {
    const yaml = configYaml((c) => {
      c.concurrency = 4;
    });
    const config = parseConfig(yaml);
    expect(config.concurrency).toBe(4);
  });

  it("rejeita concurrency=0", () => {
    const yaml = configYaml((c) => {
      c.concurrency = 0;
    });
    expect(() => parseConfig(yaml)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// T-001 — bloco `metrics` opt-in (C-0005)
// ---------------------------------------------------------------------------

describe("metrics — bloco opt-in (C-0005 T-001)", () => {
  it("aceita config sem bloco metrics (regressão zero)", () => {
    const yaml = configYaml();
    const config = parseConfig(yaml);
    expect(config.metrics).toBeUndefined();
  });

  it("aceita metrics vazio (sem report)", () => {
    const yaml = configYaml((c) => {
      c.metrics = {};
    });
    const config = parseConfig(yaml);
    expect(config.metrics).toBeDefined();
    expect(config.metrics!.report).toBeUndefined();
  });

  it("aceita metrics com report.index válido", () => {
    const yaml = configYaml((c) => {
      c.metrics = { report: { index: "${change.dir}/../index.md" } };
    });
    const config = parseConfig(yaml);
    expect(config.metrics!.report!.index).toBe("${change.dir}/../index.md");
  });

  it("rejeita report sem index (campo obrigatório quando report presente)", () => {
    const yaml = configYaml((c) => {
      c.metrics = { report: {} };
    });
    expect(() => parseConfig(yaml)).toThrow();
  });

  it("rejeita report.index vazio", () => {
    const yaml = configYaml((c) => {
      c.metrics = { report: { index: "" } };
    });
    expect(() => parseConfig(yaml)).toThrow();
  });

  it("rejeita chave desconhecida em metrics (strict)", () => {
    const yaml = configYaml((c) => {
      c.metrics = { unknown_key: true };
    });
    expect(() => parseConfig(yaml)).toThrow();
  });

  it("rejeita chave desconhecida em metrics.report (strict)", () => {
    const yaml = configYaml((c) => {
      c.metrics = { report: { index: "x.md", extra: "nope" } };
    });
    expect(() => parseConfig(yaml)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// C-0008 T-001 — agents registry + agent/model/effort per step
// ---------------------------------------------------------------------------

/** Helper: config com agents registry (sem acp.command legado). */
function agentsConfigYaml(
  mutate?: (c: Record<string, unknown>) => void,
): string {
  return configYaml((c) => {
    // Replace acp.command with agents registry
    c.agents = {
      claude: { command: ["npx", "-y", "@agentclientprotocol/claude-agent-acp"] },
    };
    delete (c.acp as Record<string, unknown>).command;
    mutate?.(c);
  });
}

describe("agents registry — schema (C-0008 T-001)", () => {
  it("aceita agents: com um agente (default implícito)", () => {
    const yaml = agentsConfigYaml();
    expect(() => parseConfig(yaml)).not.toThrow();
  });

  it("aceita agents: com vários agentes + default_agent", () => {
    const yaml = agentsConfigYaml((c) => {
      (c.agents as Record<string, unknown>).codex = {
        command: ["npx", "-y", "@agentclientprotocol/codex-acp"],
        model: "gpt-5-codex",
        effort: "medium",
      };
      (c.acp as Record<string, unknown>).default_agent = "claude";
    });
    expect(() => parseConfig(yaml)).not.toThrow();
  });

  it("aceita agent env opcional", () => {
    const yaml = agentsConfigYaml((c) => {
      (c.agents as Record<string, unknown>).codex = {
        command: ["npx", "-y", "@agentclientprotocol/codex-acp"],
        env: { CODEX_API_KEY: "${env.CODEX_API_KEY}" },
      };
      (c.acp as Record<string, unknown>).default_agent = "claude";
    });
    expect(() => parseConfig(yaml)).not.toThrow();
  });

  it("rejeita agents: + acp.command (mutuamente exclusivos)", () => {
    const yaml = configYaml((c) => {
      c.agents = {
        claude: { command: ["npx", "-y", "@agentclientprotocol/claude-agent-acp"] },
      };
      // acp.command is still there from base config
    });
    expect(() => parseConfig(yaml)).toThrow(/mutuamente exclusivos/);
  });

  it("rejeita sem agents: nem acp.command (nenhum agente resolvível)", () => {
    const yaml = configYaml((c) => {
      delete (c.acp as Record<string, unknown>).command;
    });
    expect(() => parseConfig(yaml)).toThrow(/[Nn]enhum agente resolvível/);
  });

  it("rejeita default_agent inexistente no registry", () => {
    const yaml = agentsConfigYaml((c) => {
      (c.acp as Record<string, unknown>).default_agent = "fantasma";
    });
    expect(() => parseConfig(yaml)).toThrow(/fantasma/);
  });

  it("rejeita step.agent inexistente no registry", () => {
    const yaml = agentsConfigYaml((c) => {
      (c.pipeline as Record<string, unknown>[])[0] = {
        id: "implement",
        type: "agent",
        prompt: "do it",
        agent: "nao-existe",
        verify: { run: "ci", max_attempts: 3 },
      };
    });
    expect(() => parseConfig(yaml)).toThrow(/nao-existe/);
  });

  it("rejeita >1 agente sem default_agent quando step omite agent:", () => {
    const yaml = agentsConfigYaml((c) => {
      (c.agents as Record<string, unknown>).codex = {
        command: ["npx", "-y", "@agentclientprotocol/codex-acp"],
      };
      // No default_agent, step[0] (type: agent) omits agent:
    });
    expect(() => parseConfig(yaml)).toThrow(/obrigatório/);
  });

  it("aceita >1 agente sem default_agent se todos os steps tem agent:", () => {
    const yaml = agentsConfigYaml((c) => {
      (c.agents as Record<string, unknown>).codex = {
        command: ["npx", "-y", "@agentclientprotocol/codex-acp"],
      };
      c.pipeline = [
        {
          id: "implement",
          type: "agent",
          prompt: "do it",
          agent: "claude",
          verify: { run: "ci", max_attempts: 3 },
        },
        { id: "cleanup", type: "shell", always: true, run: ["echo done"] },
      ];
    });
    expect(() => parseConfig(yaml)).not.toThrow();
  });

  it("rejeita chave desconhecida em agentDef (strict)", () => {
    const yaml = agentsConfigYaml((c) => {
      (c.agents as Record<string, unknown>).claude = {
        command: ["npx", "-y", "@agentclientprotocol/claude-agent-acp"],
        bogus: true,
      };
    });
    expect(() => parseConfig(yaml)).toThrow(/bogus/);
  });
});

describe("agentStepSchema — agent/model/effort (C-0008 T-001)", () => {
  it("aceita agent/model/effort em step agent", () => {
    const yaml = agentsConfigYaml((c) => {
      (c.agents as Record<string, unknown>).codex = {
        command: ["npx", "-y", "@agentclientprotocol/codex-acp"],
      };
      (c.acp as Record<string, unknown>).default_agent = "claude";
      (c.pipeline as Record<string, unknown>[])[0] = {
        id: "implement",
        type: "agent",
        prompt: "do it",
        agent: "codex",
        model: "gpt-5-codex",
        effort: "high",
        verify: { run: "ci", max_attempts: 3 },
      };
    });
    expect(() => parseConfig(yaml)).not.toThrow();
  });

  it("rejeita agent em step shell (strict discriminated union)", () => {
    const yaml = agentsConfigYaml((c) => {
      c.pipeline = [
        { id: "build", type: "shell", run: ["npm run build"], agent: "claude" },
        { id: "cleanup", type: "shell", always: true, run: ["echo done"] },
      ];
    });
    expect(() => parseConfig(yaml)).toThrow();
  });

  it("rejeita model em step checks (strict discriminated union)", () => {
    const yaml = agentsConfigYaml((c) => {
      c.pipeline = [
        { id: "ci", type: "checks", run: "ci", model: "gpt-5" },
        { id: "cleanup", type: "shell", always: true, run: ["echo done"] },
      ];
    });
    expect(() => parseConfig(yaml)).toThrow();
  });

  it("rejeita effort em step approval (strict discriminated union)", () => {
    const yaml = agentsConfigYaml((c) => {
      c.pipeline = [
        { id: "approve", type: "approval", prompt: "ok?", effort: "high" },
        { id: "cleanup", type: "shell", always: true, run: ["echo done"] },
      ];
    });
    expect(() => parseConfig(yaml)).toThrow();
  });
});
