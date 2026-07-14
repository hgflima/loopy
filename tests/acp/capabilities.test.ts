/**
 * Tests for {@link parseCapabilities} — driven by real spike fixtures from the
 * three ACP adapters (claude-agent-acp 0.59, codex-acp 1.1.2, opencode 1.17.9).
 *
 * No invented mocks. The fixtures are verbatim copies of the `spikes/*.out.json`
 * files produced by the probe scripts.
 */
import { describe, expect, it } from "vitest";
import { parseCapabilities } from "../../src/acp/capabilities";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";

// Fixtures — full spike output; tests read session.configOptions and session.modes.
import claudeFixture from "../fixtures/capabilities/claude.json";
import codexFixture from "../fixtures/capabilities/codex.json";
import opencodeFixture from "../fixtures/capabilities/opencode.json";

// Helper to extract configOptions from a fixture's session field.
function configOptions(fixture: { session: { configOptions?: unknown[] } }): SessionConfigOption[] {
  return (fixture.session.configOptions ?? []) as SessionConfigOption[];
}

describe("parseCapabilities", () => {
  // -----------------------------------------------------------------------
  // Claude (claude-agent-acp 0.59)
  // -----------------------------------------------------------------------
  describe("Claude adapter", () => {
    const caps = parseCapabilities(configOptions(claudeFixture));

    it("parses 6 modes from configOptions", () => {
      expect(caps.modes).toEqual([
        "auto",
        "default",
        "acceptEdits",
        "plan",
        "dontAsk",
        "bypassPermissions",
      ]);
    });

    it("parses 4 models", () => {
      expect(caps.models).toEqual(["default", "opus[1m]", "sonnet", "haiku"]);
    });

    it("parses 6 efforts", () => {
      expect(caps.efforts).toEqual(["default", "low", "medium", "high", "xhigh", "max"]);
    });

    it("discovers effortConfigId as 'effort'", () => {
      expect(caps.effortConfigId).toBe("effort");
    });

    it("discovers modeConfigId as 'mode'", () => {
      expect(caps.modeConfigId).toBe("mode");
    });

    it("discovers modelConfigId as 'model'", () => {
      expect(caps.modelConfigId).toBe("model");
    });
  });

  // -----------------------------------------------------------------------
  // Codex (codex-acp 1.1.2)
  // -----------------------------------------------------------------------
  describe("Codex adapter", () => {
    const caps = parseCapabilities(configOptions(codexFixture));

    it("parses 3 modes", () => {
      expect(caps.modes).toEqual(["read-only", "agent", "agent-full-access"]);
    });

    it("parses 6 models", () => {
      expect(caps.models).toEqual([
        "gpt-5.6-sol",
        "gpt-5.6-terra",
        "gpt-5.6-luna",
        "gpt-5.5",
        "gpt-5.4",
        "gpt-5.4-mini",
      ]);
    });

    it("parses 4 efforts (low..xhigh)", () => {
      expect(caps.efforts).toEqual(["low", "medium", "high", "xhigh"]);
    });

    it("discovers effortConfigId as 'reasoning_effort'", () => {
      expect(caps.effortConfigId).toBe("reasoning_effort");
    });
  });

  // -----------------------------------------------------------------------
  // OpenCode (opencode 1.17.9) — the adapter that motivated this change
  // -----------------------------------------------------------------------
  describe("OpenCode adapter", () => {
    const caps = parseCapabilities(configOptions(opencodeFixture));

    it("extracts modes from configOptions despite session.modes being absent", () => {
      // The whole point: session.modes is null/undefined, but configOptions
      // has category "mode" with build and plan.
      expect(opencodeFixture.session).not.toHaveProperty("modes");
      expect(caps.modes).toEqual(["build", "plan"]);
    });

    it("parses 146 models in provider/model format", () => {
      expect(caps.models).toHaveLength(146);
      // Spot-check format
      expect(caps.models[0]).toBe("huggingface/deepseek-ai/DeepSeek-V4-Flash");
      expect(caps.models).toContain("opencode/big-pickle");
      expect(caps.models).toContain("openai/gpt-5.6");
      expect(caps.models).toContain("zai/glm-5.2");
    });

    it("returns empty efforts when thought_level is absent", () => {
      expect(caps.efforts).toEqual([]);
    });

    it("has no effortConfigId when thought_level is absent", () => {
      expect(caps.effortConfigId).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Fallback & edge cases
  // -----------------------------------------------------------------------
  describe("fallbackModes", () => {
    it("uses fallbackModes when configOptions is undefined", () => {
      const caps = parseCapabilities(undefined, ["acceptEdits", "plan"]);
      expect(caps.modes).toEqual(["acceptEdits", "plan"]);
      expect(caps.models).toEqual([]);
      expect(caps.efforts).toEqual([]);
    });

    it("configOptions mode category takes precedence over divergent fallbackModes", () => {
      // Claude's configOptions say 6 modes; fallback says something different.
      const caps = parseCapabilities(configOptions(claudeFixture), ["build", "plan"]);
      expect(caps.modes).toEqual([
        "auto",
        "default",
        "acceptEdits",
        "plan",
        "dontAsk",
        "bypassPermissions",
      ]);
    });

    it("uses fallbackModes when configOptions exists but has no mode category", () => {
      // Simulate an adapter that announces models but not modes in configOptions.
      const opts = configOptions(codexFixture).filter((o) => o.category !== "mode");
      const caps = parseCapabilities(opts, ["read-only", "agent"]);
      expect(caps.modes).toEqual(["read-only", "agent"]);
      // Other categories still parsed normally.
      expect(caps.models.length).toBeGreaterThan(0);
    });
  });

  describe("empty / degraded input", () => {
    it("returns all empty arrays when configOptions is undefined and no fallback", () => {
      const caps = parseCapabilities(undefined);
      expect(caps.modes).toEqual([]);
      expect(caps.models).toEqual([]);
      expect(caps.efforts).toEqual([]);
      expect(caps.modeConfigId).toBeUndefined();
      expect(caps.modelConfigId).toBeUndefined();
      expect(caps.effortConfigId).toBeUndefined();
    });

    it("returns all empty arrays for an empty configOptions array", () => {
      const caps = parseCapabilities([]);
      expect(caps.modes).toEqual([]);
      expect(caps.models).toEqual([]);
      expect(caps.efforts).toEqual([]);
    });

    it("does not throw on any input", () => {
      expect(() => parseCapabilities(undefined)).not.toThrow();
      expect(() => parseCapabilities([])).not.toThrow();
      expect(() => parseCapabilities(undefined, [])).not.toThrow();
      expect(() => parseCapabilities(undefined, ["x"])).not.toThrow();
    });
  });
});
