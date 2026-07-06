/**
 * Tests for `resolveAgentEnv` — pure env-only scope resolution (T-003).
 */
import { describe, expect, it } from "vitest";
import { resolveAgentEnv } from "../../src/config/env";
import { ConfigError } from "../../src/config/load";
import type { AgentDef } from "../../src/types";

describe("resolveAgentEnv", () => {
  it("resolves ${env.KEY} from processEnv", () => {
    const agents: Record<string, AgentDef> = {
      codex: {
        command: ["codex-acp"],
        env: { CODEX_API_KEY: "${env.MY_KEY}" },
      },
    };
    const result = resolveAgentEnv(agents, { MY_KEY: "sk-123" });
    expect(result.codex).toEqual({ CODEX_API_KEY: "sk-123" });
  });

  it("returns empty record for agents without env (subscription auth)", () => {
    const agents: Record<string, AgentDef> = {
      codex: { command: ["codex-acp"] },
    };
    const result = resolveAgentEnv(agents, {});
    expect(result.codex).toEqual({});
  });

  it("throws ConfigError when referenced env var is missing (fail-fast)", () => {
    const agents: Record<string, AgentDef> = {
      codex: {
        command: ["codex-acp"],
        env: { CODEX_API_KEY: "${env.MISSING_VAR}" },
      },
    };
    expect(() => resolveAgentEnv(agents, {})).toThrow(ConfigError);
    expect(() => resolveAgentEnv(agents, {})).toThrow("MISSING_VAR");
  });

  it("resolves multiple refs in the same value", () => {
    const agents: Record<string, AgentDef> = {
      api: {
        command: ["api-acp"],
        env: { AUTH: "${env.USER}:${env.PASS}" },
      },
    };
    const result = resolveAgentEnv(agents, { USER: "admin", PASS: "s3cret" });
    expect(result.api).toEqual({ AUTH: "admin:s3cret" });
  });

  it("passes through literal values without ${env.*}", () => {
    const agents: Record<string, AgentDef> = {
      codex: {
        command: ["codex-acp"],
        env: { MODE: "production" },
      },
    };
    const result = resolveAgentEnv(agents, {});
    expect(result.codex).toEqual({ MODE: "production" });
  });

  it("handles multiple agents independently", () => {
    const agents: Record<string, AgentDef> = {
      claude: { command: ["claude-acp"] },
      codex: {
        command: ["codex-acp"],
        env: { CODEX_API_KEY: "${env.CODEX_KEY}" },
      },
    };
    const result = resolveAgentEnv(agents, { CODEX_KEY: "sk-abc" });
    expect(result.claude).toEqual({});
    expect(result.codex).toEqual({ CODEX_API_KEY: "sk-abc" });
  });

  it("error message includes agent name and key for diagnosis", () => {
    const agents: Record<string, AgentDef> = {
      myagent: {
        command: ["agent-acp"],
        env: { SECRET: "${env.NOPE}" },
      },
    };
    try {
      resolveAgentEnv(agents, {});
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const msg = (err as ConfigError).message;
      expect(msg).toContain("myagent");
      expect(msg).toContain("SECRET");
      expect(msg).toContain("NOPE");
    }
  });
});
