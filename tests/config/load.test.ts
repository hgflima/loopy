import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, parseConfig } from "../../src/config/load";
import { configYaml } from "./_helpers";

// Path to the canonical example config committed at examples/loopy.yml.
const EXAMPLE_YML = fileURLToPath(
  new URL("../../examples/loopy.yml", import.meta.url),
);

describe("parseConfig — valid input", () => {
  it("accepts a complete config and returns a typed LoopyConfig", () => {
    const config = parseConfig(configYaml());

    expect(config.version).toBe("1");
    expect(config.name).toBe("test-loop");
    expect(config.workspace.parent_branch).toBe("main");
    expect(config.checks.ci?.[0]?.run).toBe("npm run typecheck");
    expect(config.pipeline).toHaveLength(2);
  });

  it("preserves the discriminated step types in order", () => {
    const config = parseConfig(configYaml());

    const [implement, cleanup] = config.pipeline;
    expect(implement?.type).toBe("agent");
    expect(cleanup?.type).toBe("shell");
    if (implement?.type === "agent") {
      expect(implement.verify?.max_attempts).toBe(4);
    }
    if (cleanup?.type === "shell") {
      expect(cleanup.always).toBe(true);
      expect(cleanup.run).toEqual(["echo done"]);
    }
  });
});

describe("parseConfig — defaults", () => {
  it("defaults agent clear_context to true when omitted", () => {
    const config = parseConfig(configYaml());
    const implement = config.pipeline[0];

    expect(implement?.type).toBe("agent");
    if (implement?.type === "agent") {
      expect(implement.clear_context).toBe(true);
    }
  });

  it("keeps clear_context false when explicitly set", () => {
    const config = parseConfig(
      configYaml((c) => {
        (c.pipeline as { clear_context?: boolean }[])[0]!.clear_context = false;
      }),
    );
    const implement = config.pipeline[0];

    if (implement?.type === "agent") {
      expect(implement.clear_context).toBe(false);
    }
  });

  it("defaults acp.permissions.on_request to allow", () => {
    const config = parseConfig(
      configYaml((c) => {
        delete (
          (c.acp as { permissions: Record<string, unknown> }).permissions as {
            on_request?: unknown;
          }
        ).on_request;
      }),
    );

    expect(config.acp.permissions.on_request).toBe("allow");
  });

  it("defaults concurrency to 1 when omitted", () => {
    const config = parseConfig(
      configYaml((c) => {
        delete c.concurrency;
      }),
    );

    expect(config.concurrency).toBe(1);
  });
});

describe("parseConfig — invalid input", () => {
  it("throws ConfigError with the path and reason for a missing field", () => {
    const yaml = configYaml((c) => {
      delete c.pipeline;
    });

    expect(() => parseConfig(yaml)).toThrow(ConfigError);
    expect(() => parseConfig(yaml)).toThrow(/pipeline/);
  });

  it("flags unknown top-level keys", () => {
    const yaml = configYaml((c) => {
      c.unexpected_key = "surprise";
    });

    expect(() => parseConfig(yaml)).toThrow(/unexpected_key/);
  });

  it("flags unknown fields inside a step primitive", () => {
    const yaml = configYaml((c) => {
      (c.pipeline as Record<string, unknown>[])[0]!.bogus_field = 1;
    });

    expect(() => parseConfig(yaml)).toThrow(/bogus_field/);
  });

  it("rejects an unknown step type via the discriminated union", () => {
    const yaml = configYaml((c) => {
      (c.pipeline as Record<string, unknown>[])[0]!.type = "teleport";
    });

    expect(() => parseConfig(yaml)).toThrow(ConfigError);
    expect(() => parseConfig(yaml)).toThrow(/discriminator|type/i);
  });

  it("requires an agent step to declare a prompt", () => {
    const yaml = configYaml((c) => {
      delete (c.pipeline as Record<string, unknown>[])[0]!.prompt;
    });

    expect(() => parseConfig(yaml)).toThrow(/prompt/);
  });

  it("rejects a non-positive verify.max_attempts", () => {
    const yaml = configYaml((c) => {
      (
        (c.pipeline as Record<string, unknown>[])[0]!.verify as {
          max_attempts: number;
        }
      ).max_attempts = 0;
    });

    expect(() => parseConfig(yaml)).toThrow(/max_attempts/);
  });

  it("throws ConfigError on malformed YAML", () => {
    expect(() => parseConfig("version: '1'\n  bad: : indent")).toThrow(
      ConfigError,
    );
  });

  it("rejects a non-object document", () => {
    expect(() => parseConfig("just a string")).toThrow(ConfigError);
  });
});

/** Extract ConfigError from a throwing function. */
function getError(fn: () => unknown): ConfigError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ConfigError) return err;
    throw new Error(`Expected ConfigError, got ${err}`);
  }
  throw new Error("Expected function to throw");
}

/** Shorthand: parse with sourcePath so error messages include the path. */
function parseMigration(yaml: string): ConfigError {
  return getError(() => parseConfig(yaml, { sourcePath: "loopy.yml" }));
}

describe("parseConfig — migration pre-scan (T-026)", () => {
  it("rejects on_expect_fail with a guided error citing the step and on_fail", () => {
    const yaml = configYaml((c) => {
      (c.pipeline as Record<string, unknown>[])[0]!.on_expect_fail = "escalate";
    });

    const err = parseMigration(yaml);
    expect(err.message).toMatch(/on_expect_fail/);
    expect(err.message).toMatch(/on_fail/);
    expect(err.message).toMatch(/step "implement"/);
  });

  it("rejects on_conflict with a guided error citing the step and on_fail", () => {
    const yaml = configYaml((c) => {
      (c.pipeline as Record<string, unknown>[]).push({
        id: "merge",
        type: "approval",
        prompt: "merge?",
        on_conflict: "escalate",
      });
    });

    const err = parseMigration(yaml);
    expect(err.message).toMatch(/on_conflict/);
    expect(err.message).toMatch(/on_fail/);
    expect(err.message).toMatch(/step "merge"/);
  });

  it("rejects verify.on_fail with a message to move to step level (OQ-5)", () => {
    const yaml = configYaml((c) => {
      (c.pipeline as Record<string, unknown>[])[0]!.verify = {
        run: "ci",
        max_attempts: 3,
        on_fail: "escalate",
      };
    });

    const err = parseMigration(yaml);
    expect(err.message).toMatch(/verify\.on_fail/);
    expect(err.message).toMatch(/mova para 'on_fail' no nível do step/);
  });

  it("collects multiple legacy keys in a single report (OQ-3)", () => {
    const yaml = configYaml((c) => {
      const pipeline = c.pipeline as Record<string, unknown>[];
      pipeline[0]!.on_expect_fail = "escalate";
      pipeline.push({
        id: "merge",
        type: "approval",
        prompt: "merge?",
        on_conflict: "escalate",
      });
    });

    const err = parseMigration(yaml);
    expect(err.message).toMatch(/on_expect_fail/);
    expect(err.message).toMatch(/on_conflict/);
    expect(err.message).toMatch(/step "implement"/);
    expect(err.message).toMatch(/step "merge"/);
  });

  it("uses pipeline[<i>] when step has no id (OQ-6)", () => {
    const yaml = configYaml((c) => {
      const pipeline = c.pipeline as Record<string, unknown>[];
      delete pipeline[0]!.id;
      pipeline[0]!.on_expect_fail = "escalate";
    });

    const err = parseMigration(yaml);
    expect(err.message).toMatch(/pipeline\[0\]/);
  });
});

// ---------------------------------------------------------------------------
// C-0008 T-001 — ResolvedAgents normalization
// ---------------------------------------------------------------------------

describe("parseConfig — ResolvedAgents (C-0008 T-001)", () => {
  it("sintetiza default do acp.command legado", () => {
    const config = parseConfig(configYaml());
    expect(config.resolvedAgents).toBeDefined();
    expect(config.resolvedAgents.default).toBe("default");
    expect(config.resolvedAgents.byName.default).toBeDefined();
    expect(config.resolvedAgents.byName.default!.command).toEqual([
      "npx", "-y", "@agentclientprotocol/claude-agent-acp",
    ]);
  });

  it("normaliza agents: registry com default_agent", () => {
    const yaml = configYaml((c) => {
      c.agents = {
        claude: { command: ["claude-agent-acp"] },
        codex: { command: ["codex-acp"], model: "gpt-5-codex", effort: "medium" },
      };
      delete (c.acp as Record<string, unknown>).command;
      (c.acp as Record<string, unknown>).default_agent = "claude";
    });
    const config = parseConfig(yaml);
    expect(config.resolvedAgents.default).toBe("claude");
    expect(Object.keys(config.resolvedAgents.byName)).toEqual(
      expect.arrayContaining(["claude", "codex"]),
    );
    expect(config.resolvedAgents.byName.codex!.model).toBe("gpt-5-codex");
    expect(config.resolvedAgents.byName.codex!.effort).toBe("medium");
  });

  it("normaliza agents: registry com agente único (default implícito)", () => {
    const yaml = configYaml((c) => {
      c.agents = {
        claude: { command: ["claude-agent-acp"] },
      };
      delete (c.acp as Record<string, unknown>).command;
    });
    const config = parseConfig(yaml);
    expect(config.resolvedAgents.default).toBe("claude");
    expect(Object.keys(config.resolvedAgents.byName)).toEqual(["claude"]);
  });

  it("preserva env no ResolvedAgents", () => {
    const yaml = configYaml((c) => {
      c.agents = {
        codex: {
          command: ["codex-acp"],
          env: { CODEX_API_KEY: "${env.CODEX_API_KEY}" },
        },
      };
      delete (c.acp as Record<string, unknown>).command;
    });
    const config = parseConfig(yaml);
    expect(config.resolvedAgents.byName.codex!.env).toEqual({
      CODEX_API_KEY: "${env.CODEX_API_KEY}",
    });
  });
});

describe("loadConfig — from disk", () => {
  it("validates the canonical example loopy.yml (examples/loopy.yml)", () => {
    const config = loadConfig(EXAMPLE_YML);

    expect(config.name).toBe("agentic-loop");
    expect(config.pipeline).toHaveLength(8);
    expect(config.pipeline[0]?.id).toBe("create-worktree");
    expect(config.pipeline[0]?.type).toBe("shell");

    const implement = config.pipeline[2];
    expect(implement?.type).toBe("agent");
    if (implement?.type === "agent") {
      expect(implement.clear_context).toBe(true);
      expect(implement.verify?.run).toBe("ci");
      expect(implement.verify?.max_attempts).toBe(3);
    }
  });

  it("throws ConfigError mentioning the file path when the file is missing", () => {
    const missing = fileURLToPath(
      new URL("../../does-not-exist.yml", import.meta.url),
    );
    expect(() => loadConfig(missing)).toThrow(ConfigError);
    expect(() => loadConfig(missing)).toThrow(/does-not-exist\.yml/);
  });

  it("matches the committed example against the schema exactly", () => {
    // Round-trips the on-disk YAML through the loader without throwing and
    // exposes the fully-defaulted, typed shape used by the rest of the engine.
    const raw = readFileSync(EXAMPLE_YML, "utf8");
    const config = parseConfig(raw, { sourcePath: EXAMPLE_YML });
    expect(config.concurrency).toBe(1);
    expect(config.policies.escalation.action).toBe("pause");
  });
});
