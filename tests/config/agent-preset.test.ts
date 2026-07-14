/**
 * Catálogo de Agentes: `preset` empresta o argv, `command` o declara na mão.
 *
 * O contrato que estes testes prendem: o `preset` é uma conveniência **de
 * escrita**, não um conceito de runtime. Ele é resolvido em `resolveAgents` e
 * some — todo consumidor a jusante (pool, dry-run, `probe-agent`, o cache keyed
 * por argv) só vê `command`. Se algum dia o motor passar a ramificar por nome de
 * agente, é aqui que a regressão aparece (AD-1).
 *
 * Run: `npm test -- agent-preset`
 */

import { describe, it, expect } from "vitest";
import { stringify } from "yaml";
import { parseConfig, ConfigError } from "../../src/config/parse.js";
import { AGENT_CATALOG, findAgentPreset } from "../../src/acp/catalog.js";
import { baseConfig } from "./_helpers.js";

/** Um config válido cujo registry de agentes é exatamente `agents`. */
function withAgents(agents: Record<string, unknown>): string {
  const cfg = baseConfig();
  // `agents:` e `acp.command` são mutuamente exclusivos.
  delete (cfg.acp as Record<string, unknown>).command;
  cfg.agents = agents;
  return stringify(cfg);
}

describe("agents — preset resolve para o argv do Catálogo", () => {
  it.each(AGENT_CATALOG.map((p) => p.id))(
    "'%s' resolve para o argv do Catálogo, e o preset não sobrevive",
    (id) => {
      const config = parseConfig(withAgents({ a: { preset: id } }));
      const resolved = config.resolvedAgents.byName.a!;

      expect(resolved.command).toEqual(findAgentPreset(id)!.command);
      // O que o runtime vê é só argv — nada de `preset`.
      expect(resolved).not.toHaveProperty("preset");
    },
  );

  it("preserva os demais campos do agente ao resolver", () => {
    const config = parseConfig(
      withAgents({
        a: { preset: "codex", model: "gpt-5.6-terra", effort: "xhigh", display_name: "codex" },
      }),
    );
    const resolved = config.resolvedAgents.byName.a!;

    expect(resolved.model).toBe("gpt-5.6-terra");
    expect(resolved.effort).toBe("xhigh");
    expect(resolved.display_name).toBe("codex");
  });

  it("`command` explícito segue válido — o Catálogo não é allowlist", () => {
    const argv = ["meu-adapter", "--acp"];
    const config = parseConfig(withAgents({ a: { command: argv } }));

    expect(config.resolvedAgents.byName.a!.command).toEqual(argv);
  });
});

describe("agents — preset × command é XOR", () => {
  it("rejeita os dois juntos", () => {
    expect(() =>
      parseConfig(withAgents({ a: { preset: "claude", command: ["npx", "x"] } })),
    ).toThrow(/mutuamente exclusivos/);
  });

  it("rejeita nenhum dos dois, listando os presets conhecidos", () => {
    expect(() => parseConfig(withAgents({ a: { model: "opus" } }))).toThrow(
      /Agente sem argv.*claude.*codex.*opencode/s,
    );
  });

  it("rejeita preset fora do Catálogo e aponta a saída (`command`)", () => {
    let err: unknown;
    try {
      parseConfig(withAgents({ a: { preset: "gemini" } }));
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).message).toMatch(/'preset' desconhecido: "gemini"/);
    expect((err as ConfigError).message).toMatch(/Use 'command'/);
  });
});
