import { describe, it, expect } from "vitest";
import type { LoopyConfigParsed } from "loopy/config";
import { renameStepId, renameAgent, renameChecksList } from "./rename";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseConfig(overrides: Partial<LoopyConfigParsed> = {}): LoopyConfigParsed {
  return {
    version: "1",
    name: "test",
    workspace: { root: ".", parent_branch: "main", worktrees_dir: ".worktrees" },
    acp: {
      adapter: "claude",
      default_agent: "coder",
      request_timeout_seconds: 300,
      permissions: { on_request: "allow" },
    },
    inputs: { backlog: { path: "todo.md", task_id_pattern: "T-\\d+", body: "indented" } },
    checks: { ci: ["npm test"], lint: ["npm run lint"] },
    pipeline: [
      { id: "implement", type: "agent", prompt: "code it", agent: "coder", verify: { run: "ci", max_attempts: 3 } },
      { id: "simplify", type: "agent", prompt: "simplify", on_success: { goto: "implement" }, on_fail: { goto: "implement" } },
      { id: "test", type: "checks", run: "ci", on_fail: { goto: "implement" } },
      { id: "review", type: "approval", prompt: "ok?" },
    ],
    stop_conditions: { max_iterations: 10, max_step_visits: 10 },
    concurrency: 1,
    policies: { escalation: { action: "pause" }, git: { on_merge_conflict: "escalate" } },
    logging: { level: "info", capture_acp_traffic: false },
    ...overrides,
  } as unknown as LoopyConfigParsed;
}

// ---------------------------------------------------------------------------
// renameStepId
// ---------------------------------------------------------------------------

describe("renameStepId", () => {
  it("renames step id and rewrites on_success.goto / on_fail.goto referrers", () => {
    const cfg = baseConfig();
    const result = renameStepId(cfg, "implement", "build");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Step itself renamed
    expect(result.config.pipeline[0].id).toBe("build");

    // on_success.goto rewritten
    expect(result.config.pipeline[1].on_success).toEqual({ goto: "build" });

    // on_fail.goto rewritten (in simplify and test steps)
    expect(result.config.pipeline[1].on_fail).toEqual({ goto: "build" });
    expect((result.config.pipeline[2] as { on_fail: { goto: string } }).on_fail).toEqual({ goto: "build" });
  });

  it("rejects collision with existing step id", () => {
    const cfg = baseConfig();
    const result = renameStepId(cfg, "implement", "simplify");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("simplify");
  });

  it("no-op when old === new", () => {
    const cfg = baseConfig();
    const result = renameStepId(cfg, "implement", "implement");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toBe(cfg); // reference identity
  });
});

// ---------------------------------------------------------------------------
// renameAgent
// ---------------------------------------------------------------------------

describe("renameAgent", () => {
  it("renames agent key, default_agent, and step.agent references", () => {
    const cfg = baseConfig({
      agents: { coder: { command: ["claude"] }, reviewer: { command: ["claude"] } },
    } as unknown as Partial<LoopyConfigParsed>);
    const result = renameAgent(cfg, "coder", "builder");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Key renamed
    expect(Object.keys(result.config.agents!)).toContain("builder");
    expect(Object.keys(result.config.agents!)).not.toContain("coder");

    // acp.default_agent rewritten
    expect(result.config.acp.default_agent).toBe("builder");

    // step.agent rewritten
    expect((result.config.pipeline[0] as { agent?: string }).agent).toBe("builder");
  });

  it("rejects collision with existing agent name", () => {
    const cfg = baseConfig({
      agents: { coder: { command: ["claude"] }, reviewer: { command: ["claude"] } },
    } as unknown as Partial<LoopyConfigParsed>);
    const result = renameAgent(cfg, "coder", "reviewer");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("reviewer");
  });

  it("no-op when old === new", () => {
    const cfg = baseConfig();
    const result = renameAgent(cfg, "coder", "coder");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toBe(cfg);
  });
});

// ---------------------------------------------------------------------------
// renameChecksList
// ---------------------------------------------------------------------------

describe("renameChecksList", () => {
  it("renames checks key, verify.run, and checks-step run references", () => {
    const cfg = baseConfig();
    const result = renameChecksList(cfg, "ci", "unit");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Key renamed
    expect(Object.keys(result.config.checks)).toContain("unit");
    expect(Object.keys(result.config.checks)).not.toContain("ci");

    // verify.run rewritten
    expect((result.config.pipeline[0] as { verify: { run: string } }).verify.run).toBe("unit");

    // checks step run rewritten
    expect((result.config.pipeline[2] as { run: string }).run).toBe("unit");
  });

  it("rejects collision with existing checks-list name", () => {
    const cfg = baseConfig();
    const result = renameChecksList(cfg, "ci", "lint");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("lint");
  });

  it("no-op when old === new", () => {
    const cfg = baseConfig();
    const result = renameChecksList(cfg, "ci", "ci");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toBe(cfg);
  });
});
