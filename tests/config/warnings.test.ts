import { describe, expect, it } from "vitest";
import { parseConfig } from "../../src/config/load";
import {
  collectPipelineWarnings,
  formatWarnings,
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
