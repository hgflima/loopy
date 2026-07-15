import { describe, expect, it } from "vitest";
import { parseConfig } from "../../src/config/load";
import {
  collectDeprecationWarnings,
  collectPipelineWarnings,
  formatWarnings,
  referencedAgents,
} from "../../src/config/warnings";
import { configYaml } from "./_helpers";

// ---------------------------------------------------------------------------
// T-004 — ciclo no grafo de goto -> warning nao-bloqueante
// ---------------------------------------------------------------------------

describe("collectPipelineWarnings — ciclos no grafo de goto", () => {
  it("fix-loop canonico (review on_fail goto implement) -> 1 warning", () => {
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

    const config = parseConfig(yaml);
    const warnings = collectPipelineWarnings(config.pipeline);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/ciclo/i);
    expect(warnings[0]).toMatch(/implement/);
    expect(warnings[0]).toMatch(/review/);
    expect(warnings[0]).toMatch(/intencional/);
  });

  it("pipeline sem goto -> zero warnings", () => {
    const yaml = configYaml();
    const config = parseConfig(yaml);
    const warnings = collectPipelineWarnings(config.pipeline);

    expect(warnings).toHaveLength(0);
  });

  it("goto forward (sem ciclo) -> zero warnings", () => {
    const yaml = configYaml((c) => {
      c.pipeline = [
        {
          id: "implement",
          type: "agent",
          prompt: "do it",
          verify: { run: "ci", max_attempts: 3 },
          on_success: { goto: "commit" },
        },
        {
          id: "review",
          type: "agent",
          prompt: "review it",
          expect: "REVIEW: PASS",
          on_fail: { goto: "commit" },
        },
        { id: "commit", type: "shell", run: ["echo commit"] },
        { id: "cleanup", type: "shell", always: true, run: ["echo done"] },
      ];
    });

    const config = parseConfig(yaml);
    const warnings = collectPipelineWarnings(config.pipeline);

    expect(warnings).toHaveLength(0);
  });

  it("self-loop (on_fail goto self) -> 1 warning", () => {
    const yaml = configYaml((c) => {
      c.pipeline = [
        {
          id: "retry-build",
          type: "shell",
          run: ["npm run build"],
          on_fail: { goto: "retry-build" },
        },
        { id: "cleanup", type: "shell", always: true, run: ["echo done"] },
      ];
    });

    const config = parseConfig(yaml);
    const warnings = collectPipelineWarnings(config.pipeline);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/ciclo/i);
    expect(warnings[0]).toMatch(/retry-build/);
  });
});

// ---------------------------------------------------------------------------
// T-004 — on_success/on_fail:{goto} em step always -> warning
// ---------------------------------------------------------------------------

describe("collectPipelineWarnings — goto em step always", () => {
  it("step always com on_success -> warning", () => {
    const yaml = configYaml((c) => {
      c.pipeline = [
        {
          id: "implement",
          type: "agent",
          prompt: "do it",
          verify: { run: "ci", max_attempts: 3 },
        },
        {
          id: "cleanup",
          type: "shell",
          always: true,
          run: ["echo done"],
          on_success: { goto: "implement" },
        },
      ];
    });

    const config = parseConfig(yaml);
    const warnings = collectPipelineWarnings(config.pipeline);

    expect(
      warnings.some(
        (w) => w.includes("cleanup") && w.includes("teardown"),
      ),
    ).toBe(true);
  });

  it("step always com on_fail:{goto} -> warning", () => {
    const yaml = configYaml((c) => {
      c.pipeline = [
        {
          id: "implement",
          type: "agent",
          prompt: "do it",
          verify: { run: "ci", max_attempts: 3 },
        },
        {
          id: "cleanup",
          type: "shell",
          always: true,
          run: ["echo done"],
          on_fail: { goto: "implement" },
        },
      ];
    });

    const config = parseConfig(yaml);
    const warnings = collectPipelineWarnings(config.pipeline);

    expect(
      warnings.some(
        (w) => w.includes("cleanup") && w.includes("teardown"),
      ),
    ).toBe(true);
  });

  it("step always com on_success E on_fail:{goto} -> 1 warning mencionando ambos", () => {
    const yaml = configYaml((c) => {
      c.pipeline = [
        {
          id: "implement",
          type: "agent",
          prompt: "do it",
          verify: { run: "ci", max_attempts: 3 },
        },
        {
          id: "cleanup",
          type: "shell",
          always: true,
          run: ["echo done"],
          on_success: { goto: "implement" },
          on_fail: { goto: "implement" },
        },
      ];
    });

    const config = parseConfig(yaml);
    const warnings = collectPipelineWarnings(config.pipeline);

    expect(
      warnings.some(
        (w) =>
          w.includes("cleanup") &&
          w.includes("on_success") &&
          w.includes("on_fail"),
      ),
    ).toBe(true);
  });

  it("step always com on_fail:'escalate' -> zero warnings (sem goto)", () => {
    const yaml = configYaml((c) => {
      c.pipeline = [
        {
          id: "implement",
          type: "agent",
          prompt: "do it",
          verify: { run: "ci", max_attempts: 3 },
        },
        {
          id: "cleanup",
          type: "shell",
          always: true,
          run: ["echo done"],
          on_fail: "escalate",
        },
      ];
    });

    const config = parseConfig(yaml);
    const warnings = collectPipelineWarnings(config.pipeline);

    expect(warnings).toHaveLength(0);
  });

  it("step always sem goto/on_success -> zero warnings", () => {
    const yaml = configYaml();
    const config = parseConfig(yaml);
    const warnings = collectPipelineWarnings(config.pipeline);

    expect(warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T-003 — parallel_safe com argv que aparenta mutar o parent -> warning
// ---------------------------------------------------------------------------

describe("collectPipelineWarnings — parallel_safe + parent-mutating argv", () => {
  it("shell parallel_safe com 'git merge' -> warning", () => {
    const yaml = configYaml((c) => {
      c.pipeline = [
        {
          id: "merge-step",
          type: "shell",
          run: ["git merge --no-ff feature"],
          parallel_safe: true,
        },
        { id: "cleanup", type: "shell", always: true, run: ["echo done"] },
      ];
    });

    const config = parseConfig(yaml);
    const warnings = collectPipelineWarnings(config.pipeline);

    expect(warnings.some((w) => w.includes("merge-step") && w.includes("parallel_safe"))).toBe(true);
  });

  it("shell parallel_safe com 'git commit' -> warning", () => {
    const yaml = configYaml((c) => {
      c.pipeline = [
        {
          id: "commit-step",
          type: "shell",
          run: ["git commit -m 'test'"],
          parallel_safe: true,
        },
        { id: "cleanup", type: "shell", always: true, run: ["echo done"] },
      ];
    });

    const config = parseConfig(yaml);
    const warnings = collectPipelineWarnings(config.pipeline);

    expect(warnings.some((w) => w.includes("commit-step") && w.includes("parallel_safe"))).toBe(true);
  });

  it("shell parallel_safe com argv seguro -> zero warnings", () => {
    const yaml = configYaml((c) => {
      c.pipeline = [
        {
          id: "safe-cmd",
          type: "shell",
          run: ["npm ci --prefix .worktrees/T-001"],
          parallel_safe: true,
        },
        { id: "cleanup", type: "shell", always: true, run: ["echo done"] },
      ];
    });

    const config = parseConfig(yaml);
    const warnings = collectPipelineWarnings(config.pipeline);

    expect(warnings).toHaveLength(0);
  });

  it("shell sem parallel_safe com 'git merge' -> zero warnings (default false)", () => {
    const yaml = configYaml((c) => {
      c.pipeline = [
        {
          id: "merge-step",
          type: "shell",
          run: ["git merge --no-ff feature"],
        },
        { id: "cleanup", type: "shell", always: true, run: ["echo done"] },
      ];
    });

    const config = parseConfig(yaml);
    const warnings = collectPipelineWarnings(config.pipeline);

    expect(warnings.some((w) => w.includes("parallel_safe"))).toBe(false);
  });

  it("agent parallel_safe -> zero warnings (agent não tem argv)", () => {
    const yaml = configYaml((c) => {
      (c.pipeline as Record<string, unknown>[])[0]!.parallel_safe = true;
    });

    const config = parseConfig(yaml);
    const warnings = collectPipelineWarnings(config.pipeline);

    expect(warnings.some((w) => w.includes("parallel_safe"))).toBe(false);
  });

  it("shell parallel_safe com ${workspace.root} -> warning", () => {
    const yaml = configYaml((c) => {
      c.pipeline = [
        {
          id: "root-ref",
          type: "shell",
          run: ["ls -la ${workspace.root}"],
          parallel_safe: true,
        },
        { id: "cleanup", type: "shell", always: true, run: ["echo done"] },
      ];
    });

    const config = parseConfig(yaml);
    const warnings = collectPipelineWarnings(config.pipeline);

    expect(warnings.some((w) => w.includes("root-ref") && w.includes("parallel_safe"))).toBe(true);
  });

  it("warning é não-fatal (parseConfig não lança)", () => {
    const yaml = configYaml((c) => {
      c.pipeline = [
        {
          id: "merge-step",
          type: "shell",
          run: ["git merge --no-ff feature"],
          parallel_safe: true,
        },
        { id: "cleanup", type: "shell", always: true, run: ["echo done"] },
      ];
    });

    expect(() => parseConfig(yaml)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// T-004 — formatWarnings
// ---------------------------------------------------------------------------

describe("formatWarnings", () => {
  it("formata warnings com caminho do arquivo", () => {
    const result = formatWarnings(
      ["ciclo detectado: A -> B -> A"],
      "/path/to/loopy.yml",
    );

    expect(result).toContain("Aviso(s)");
    expect(result).toContain("/path/to/loopy.yml");
    expect(result).toContain("ciclo detectado");
  });

  it("formata warnings sem caminho do arquivo", () => {
    const result = formatWarnings(["algo errado"]);

    expect(result).toContain("Aviso(s) no config:");
    expect(result).toContain("algo errado");
    expect(result).not.toContain('em "');
  });
});

// ---------------------------------------------------------------------------
// C-0008 T-001 — referencedAgents helper
// ---------------------------------------------------------------------------

describe("referencedAgents — helper puro (C-0008 T-001)", () => {
  it("inclui o default quando step omite agent:", () => {
    const yaml = configYaml();
    const config = parseConfig(yaml);
    const refs = referencedAgents(config.pipeline, "default");
    expect(refs.has("default")).toBe(true);
  });

  it("inclui o agente explícito do step", () => {
    const yaml = configYaml((c) => {
      c.agents = {
        claude: { command: ["claude-acp"] },
        codex: { command: ["codex-acp"] },
      };
      delete (c.acp as Record<string, unknown>).command;
      (c.acp as Record<string, unknown>).default_agent = "claude";
      c.pipeline = [
        { id: "impl", type: "agent", prompt: "do it", agent: "codex", verify: { run: "ci", max_attempts: 3 } },
        { id: "cleanup", type: "shell", always: true, run: ["echo done"] },
      ];
    });
    const config = parseConfig(yaml);
    const refs = referencedAgents(config.pipeline, config.resolvedAgents.default);
    expect(refs.has("codex")).toBe(true);
    expect(refs.has("claude")).toBe(false);
  });

  it("ignora steps não-agent", () => {
    const yaml = configYaml();
    const config = parseConfig(yaml);
    const refs = referencedAgents(config.pipeline, "default");
    // Only the implement step (agent) contributes; cleanup (shell) does not
    expect(refs.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// C-0008 T-001 — dead-profile warning
// ---------------------------------------------------------------------------

describe("collectPipelineWarnings — dead agent profile (C-0008 T-001)", () => {
  it("avisa sobre agente no registry nunca referenciado", () => {
    const yaml = configYaml((c) => {
      c.agents = {
        claude: { command: ["claude-acp"] },
        codex: { command: ["codex-acp"] },
      };
      delete (c.acp as Record<string, unknown>).command;
      (c.acp as Record<string, unknown>).default_agent = "claude";
      c.pipeline = [
        { id: "impl", type: "agent", prompt: "do it", verify: { run: "ci", max_attempts: 3 } },
        { id: "cleanup", type: "shell", always: true, run: ["echo done"] },
      ];
    });
    const config = parseConfig(yaml);
    const warnings = collectPipelineWarnings(config.pipeline, config.resolvedAgents);
    expect(warnings.some((w) => w.includes("codex") && w.includes("perfil morto"))).toBe(true);
  });

  it("sem warning quando todos os agentes são referenciados", () => {
    const yaml = configYaml((c) => {
      c.agents = {
        claude: { command: ["claude-acp"] },
        codex: { command: ["codex-acp"] },
      };
      delete (c.acp as Record<string, unknown>).command;
      (c.acp as Record<string, unknown>).default_agent = "claude";
      c.pipeline = [
        { id: "impl", type: "agent", prompt: "do it", agent: "codex", verify: { run: "ci", max_attempts: 3 } },
        { id: "review", type: "agent", prompt: "review", expect: "PASS", on_fail: { goto: "impl" } },
        { id: "cleanup", type: "shell", always: true, run: ["echo done"] },
      ];
    });
    const config = parseConfig(yaml);
    const warnings = collectPipelineWarnings(config.pipeline, config.resolvedAgents);
    expect(warnings.some((w) => w.includes("perfil morto"))).toBe(false);
  });

  it("sem warning de dead-profile para legado single-agent", () => {
    const yaml = configYaml();
    const config = parseConfig(yaml);
    const warnings = collectPipelineWarnings(config.pipeline, config.resolvedAgents);
    expect(warnings.some((w) => w.includes("perfil morto"))).toBe(false);
  });

  it("sem warning de dead-profile sem resolvedAgents (backward compat)", () => {
    const yaml = configYaml();
    const config = parseConfig(yaml);
    const warnings = collectPipelineWarnings(config.pipeline);
    expect(warnings.some((w) => w.includes("perfil morto"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C-0017 D21 — metrics.report obsoleto: aceito-mas-ignorado + warning
// ---------------------------------------------------------------------------

describe("collectDeprecationWarnings — metrics.report obsoleto (C-0017 D21)", () => {
  it("metrics.report presente -> 1 warning de deprecação apontando a chave", () => {
    const yaml = configYaml((c) => {
      c.metrics = { report: { index: "${change.dir}/../index.md" } };
    });
    const config = parseConfig(yaml);
    const warnings = collectDeprecationWarnings(config);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/metrics\.report/);
    expect(warnings[0]).toMatch(/obsolet|ignorad|aposentad/i);
  });

  it("metrics presente sem report -> zero warnings (gate opt-in sobrevive)", () => {
    const yaml = configYaml((c) => {
      c.metrics = {};
    });
    const config = parseConfig(yaml);
    expect(collectDeprecationWarnings(config)).toEqual([]);
  });

  it("sem bloco metrics -> zero warnings", () => {
    const yaml = configYaml();
    const config = parseConfig(yaml);
    expect(collectDeprecationWarnings(config)).toEqual([]);
  });
});
