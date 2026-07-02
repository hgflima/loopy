import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { ConfigError, loadConfig, parseConfig } from "../../src/config/load";

// Path to the real example config committed at the repo root.
const EXAMPLE_YML = fileURLToPath(new URL("../../loopy.yml", import.meta.url));

/**
 * A minimal-but-complete valid config as a plain object. Tests clone this and
 * mutate a single field so each case reads as a self-contained specification.
 */
function baseConfig(): Record<string, unknown> {
  return {
    version: "1",
    name: "test-loop",
    workspace: {
      root: ".",
      parent_branch: "main",
      worktrees_dir: ".worktrees",
    },
    acp: {
      command: ["npx", "-y", "@agentclientprotocol/claude-agent-acp"],
      request_timeout_seconds: 1800,
      permissions: {
        default_mode: "acceptEdits",
        on_request: "allow",
      },
    },
    inputs: {
      spec: "SPEC.md",
      plan: "tasks/plan.md",
      todo: "tasks/todo.md",
      backlog: {
        pending_marker: "- [ ]",
        done_marker: "- [x]",
        task_id_pattern: "T-\\d+",
        body: "indented",
        mark_done_on_success: true,
      },
    },
    checks: {
      ci: [{ name: "typecheck", run: "npm run typecheck" }],
    },
    pipeline: [
      {
        id: "implement",
        type: "agent",
        prompt: "do it",
        verify: { run: "ci", max_attempts: 4, on_fail: "escalate" },
      },
      { id: "cleanup", type: "shell", always: true, run: ["echo done"] },
    ],
    stop_conditions: { max_iterations: 25, stop_signal_file: ".loopy.stop" },
    concurrency: 1,
    policies: {
      escalation: { action: "pause", keep_worktree: true, notify: "stderr" },
      git: { require_clean_parent: true },
    },
    logging: { dir: ".loopy/logs", per_task: true, capture_acp_traffic: true },
  };
}

/** Clone the base config and apply a mutation before serializing to YAML. */
function configYaml(mutate?: (c: Record<string, unknown>) => void): string {
  const cfg = structuredClone(baseConfig());
  mutate?.(cfg);
  return stringify(cfg);
}

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

describe("loadConfig — from disk", () => {
  it("validates the example loopy.yml at the repo root", () => {
    const config = loadConfig(EXAMPLE_YML);

    expect(config.name).toBe("agentic-loop");
    expect(config.pipeline).toHaveLength(7);
    expect(config.pipeline[0]?.id).toBe("create-worktree");
    expect(config.pipeline[0]?.type).toBe("shell");

    const implement = config.pipeline[1];
    expect(implement?.type).toBe("agent");
    if (implement?.type === "agent") {
      expect(implement.clear_context).toBe(true);
      expect(implement.verify?.run).toBe("ci");
      expect(implement.verify?.max_attempts).toBe(4);
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
