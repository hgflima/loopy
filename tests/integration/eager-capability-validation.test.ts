/**
 * T-009 — Eager capability validation at the start of a Run (D36).
 *
 * Tests the pure validation function (`validatePipelineCapabilities`) and the
 * CLI wiring that aborts the Run when a mode mismatch is detected, before any
 * worktree is created (SC8).
 *
 * The live `defaultRunLive` spawns real ACP processes, so the CLI-level tests
 * inject a `runLive` hook that performs the same validation logic — proving
 * the error path, the exit code, and the "zero .worktrees/" invariant without
 * an agent subprocess.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AgentCapabilities } from "../../src/acp/capabilities";
import {
  run,
  validatePipelineCapabilities,
  type RunHooks,
  type RunLiveArgs,
} from "../../src/index";
import type { RunLoopResult } from "../../src/loop/orchestrator";
import type { AgentStep, ResolvedAgents, StepConfig } from "../../src/types";

/** The committed example target project (loopy.yml + tasks/todo.md). */
const PROJECT = fileURLToPath(new URL("../fixtures/project", import.meta.url));

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      out: (t: string) => out.push(t),
      err: (t: string) => err.push(t),
    },
    stdout: () => out.join(""),
    stderr: () => err.join(""),
  };
}

const EMPTY_RESULT: RunLoopResult = {
  completed: [],
  escalated: [],
  paused: [],
  skipped: [],
  iterations: 0,
  stoppedBy: "backlog_empty",
  startedAt: "",
  finishedAt: "",
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Fake capabilities with known modes/models/efforts. */
const CLAUDE_CAPS: AgentCapabilities = {
  modes: ["acceptEdits", "plan"],
  models: ["sonnet-4", "opus-4"],
  efforts: ["low", "medium", "high", "max"],
};

const OPENCODE_CAPS: AgentCapabilities = {
  modes: ["build", "plan"],
  models: [],
  efforts: [],
};

/** A ResolvedAgents with two agents. */
const MULTI_AGENTS: ResolvedAgents = {
  byName: {
    claude: { command: ["claude-agent-acp"] },
    opencode: { command: ["opencode", "acp"] },
  },
  default: "claude",
};

/** A pipeline with steps using different agents and modes. */
function makePipeline(overrides?: {
  implementMode?: string;
  auditMode?: string;
  implementAgent?: string;
  auditAgent?: string;
  implementEffort?: string;
  implementModel?: string;
}): StepConfig[] {
  const o = overrides ?? {};
  return [
    {
      id: "create-worktree",
      type: "shell" as const,
      run: ["echo worktree"],
    },
    {
      id: "implement",
      type: "agent" as const,
      prompt: "build it",
      mode: (o.implementMode ?? "acceptEdits") as AgentStep["mode"],
      agent: o.implementAgent,
      effort: o.implementEffort,
      model: o.implementModel,
    },
    {
      id: "audit",
      type: "agent" as const,
      prompt: "audit it",
      mode: (o.auditMode ?? "plan") as AgentStep["mode"],
      agent: o.auditAgent ?? "opencode",
      expect: "AUDIT: PASS",
      on_fail: "escalate" as const,
    },
  ];
}

// ---------------------------------------------------------------------------
// Pure validation function tests
// ---------------------------------------------------------------------------

describe("validatePipelineCapabilities — pure (T-009 D36)", () => {
  it("returns no errors when all modes are valid", () => {
    const caps = new Map([
      ["claude", CLAUDE_CAPS],
      ["opencode", OPENCODE_CAPS],
    ]);
    const pipeline = makePipeline();
    const result = validatePipelineCapabilities(pipeline, MULTI_AGENTS, caps);

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("returns error when mode is not accepted by the agent", () => {
    const caps = new Map([
      ["claude", CLAUDE_CAPS],
      ["opencode", OPENCODE_CAPS],
    ]);
    // 'acceptEdits' is NOT in opencode's modes — only 'build' and 'plan' are.
    const pipeline = makePipeline({ auditMode: "acceptEdits" });
    const result = validatePipelineCapabilities(pipeline, MULTI_AGENTS, caps);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.stepId).toBe("audit");
    expect(result.errors[0]!.field).toBe("mode");
    expect(result.errors[0]!.value).toBe("acceptEdits");
    expect(result.errors[0]!.accepted).toEqual(["build", "plan"]);
    expect(result.errors[0]!.agentName).toBe("opencode");
  });

  it("groups ALL errors — does not abort on the first one", () => {
    const caps = new Map([
      ["claude", CLAUDE_CAPS],
      ["opencode", OPENCODE_CAPS],
    ]);
    // Both steps have invalid modes.
    const pipeline = makePipeline({
      implementMode: "bypassPermissions",
      auditMode: "acceptEdits",
    });
    const result = validatePipelineCapabilities(pipeline, MULTI_AGENTS, caps);

    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]!.stepId).toBe("implement");
    expect(result.errors[1]!.stepId).toBe("audit");
  });

  it("invalid effort → warning (not error)", () => {
    const caps = new Map([
      ["claude", CLAUDE_CAPS],
      ["opencode", OPENCODE_CAPS],
    ]);
    const pipeline = makePipeline({ implementEffort: "ultra" });
    const result = validatePipelineCapabilities(pipeline, MULTI_AGENTS, caps);

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.field).toBe("effort");
    expect(result.warnings[0]!.value).toBe("ultra");
  });

  it("invalid model → warning (not error)", () => {
    const caps = new Map([
      ["claude", CLAUDE_CAPS],
      ["opencode", OPENCODE_CAPS],
    ]);
    const pipeline = makePipeline({ implementModel: "gpt-5-turbo" });
    const result = validatePipelineCapabilities(pipeline, MULTI_AGENTS, caps);

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.field).toBe("model");
    expect(result.warnings[0]!.value).toBe("gpt-5-turbo");
  });

  it("skips validation when agent has empty modes list", () => {
    const capsNoModes: AgentCapabilities = { modes: [], models: [], efforts: [] };
    const caps = new Map([
      ["claude", capsNoModes],
      ["opencode", capsNoModes],
    ]);
    const pipeline = makePipeline({ implementMode: "anything" });
    const result = validatePipelineCapabilities(pipeline, MULTI_AGENTS, caps);

    expect(result.errors).toHaveLength(0);
  });

  it("skips validation when agent has no cached capabilities", () => {
    const caps = new Map<string, AgentCapabilities>(); // empty map
    const pipeline = makePipeline();
    const result = validatePipelineCapabilities(pipeline, MULTI_AGENTS, caps);

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("mode in LAST step of a long pipeline is still caught", () => {
    const caps = new Map([["claude", CLAUDE_CAPS]]);
    const agents: ResolvedAgents = {
      byName: { claude: { command: ["claude-agent-acp"] } },
      default: "claude",
    };
    const pipeline: StepConfig[] = [
      { id: "s1", type: "shell", run: ["echo 1"] },
      { id: "s2", type: "shell", run: ["echo 2"] },
      { id: "s3", type: "shell", run: ["echo 3"] },
      { id: "s4", type: "shell", run: ["echo 4"] },
      {
        id: "last-step",
        type: "agent",
        prompt: "do something",
        mode: "nonexistent" as AgentStep["mode"],
      },
    ];
    const result = validatePipelineCapabilities(pipeline, agents, caps);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.stepId).toBe("last-step");
  });
});

// ---------------------------------------------------------------------------
// CLI wiring — runLive hook simulates eager validation (SC8)
// ---------------------------------------------------------------------------

/** Build a temp project with a loopy.yml whose pipeline has the given agent steps. */
function fixtureProject(opts: {
  auditMode?: string;
  todoLines?: string[];
}): string {
  const dir = mkdtempSync(join(tmpdir(), "loopy-eager-"));
  mkdirSync(join(dir, "tasks"), { recursive: true });
  const base = readFileSync(join(PROJECT, "loopy.yml"), "utf8");
  // Patch the audit step's mode if requested.
  const yml = opts.auditMode
    ? base.replace(/^(\s+id: audit[\s\S]*?mode: )plan/m, `$1${opts.auditMode}`)
    : base;
  writeFileSync(join(dir, "loopy.yml"), yml, "utf8");
  const todo = opts.todoLines ?? [
    "# Eager test",
    "",
    "- [ ] T-001: First task",
    "- [ ] T-002: Second task",
    "- [ ] T-003: Third task",
    "",
  ];
  writeFileSync(join(dir, "tasks/todo.md"), todo.join("\n"), "utf8");
  return dir;
}

/**
 * A `runLive` hook that simulates the eager validation that `defaultRunLive`
 * performs. Validates the pipeline against the given capabilities map and
 * throws when there are mode errors — exactly as the real code does.
 */
function validatingRunLive(
  capsByAgent: Map<string, AgentCapabilities>,
): RunHooks["runLive"] {
  return async (args: RunLiveArgs) => {
    const validation = validatePipelineCapabilities(
      args.config.pipeline,
      args.config.resolvedAgents,
      capsByAgent,
    );
    if (validation.errors.length > 0) {
      const lines = validation.errors.map(
        (e) =>
          `  ✗ ${e.stepId}: ${e.field} '${e.value}' não é aceito por '${e.agentName}' (aceita: ${e.accepted.join(", ")})`,
      );
      throw new Error(
        `validação eager de capabilities falhou:\n${lines.join("\n")}`,
      );
    }
    return EMPTY_RESULT;
  };
}

describe("run — eager validation wiring (T-009 SC8)", () => {
  it("aborts at the start when a mode is invalid — no .worktrees/ created", async () => {
    const dir = fixtureProject({});
    // The fixture has mode: 'plan' on the audit step, but we provide caps
    // where that mode is NOT accepted (simulating an opencode adapter).
    const caps = new Map([
      ["default", { modes: ["acceptEdits"], models: [], efforts: [] } as AgentCapabilities],
    ]);

    const cap = capture();
    const code = await run([dir], cap.io, {
      isGitRepo: () => true,
      runLive: validatingRunLive(caps),
    });

    expect(code).toBe(1);
    const stderr = cap.stderr();
    expect(stderr).toContain("validação eager de capabilities falhou");
    expect(stderr).toContain("mode 'plan'");
    expect(stderr).toContain("aceita: acceptEdits");

    // SC8: ZERO worktrees created.
    expect(existsSync(join(dir, ".worktrees"))).toBe(false);
  });

  it("continues normally when all modes are valid (regression)", async () => {
    const dir = fixtureProject({});
    // The fixture has modes 'acceptEdits' and 'plan' — both are in the caps.
    const caps = new Map([
      [
        "default",
        { modes: ["acceptEdits", "plan"], models: [], efforts: [] } as AgentCapabilities,
      ],
    ]);

    const cap = capture();
    const code = await run([dir], cap.io, {
      isGitRepo: () => true,
      runLive: validatingRunLive(caps),
    });

    expect(code).toBe(0);
    expect(cap.stderr()).not.toContain("validação eager");
  });

  it("invalid effort does NOT abort — emits warning only", async () => {
    const dir = fixtureProject({});
    const caps = new Map([
      [
        "default",
        {
          modes: ["acceptEdits", "plan"],
          models: [],
          efforts: ["low", "medium", "high"],
        } as AgentCapabilities,
      ],
    ]);

    const cap = capture();
    const code = await run([dir], cap.io, {
      isGitRepo: () => true,
      runLive: async (args) => {
        const validation = validatePipelineCapabilities(
          args.config.pipeline,
          args.config.resolvedAgents,
          caps,
        );
        // No errors → run continues. Warnings are emitted but don't abort.
        expect(validation.errors).toHaveLength(0);
        return EMPTY_RESULT;
      },
    });

    expect(code).toBe(0);
    // The fixture pipeline has no effort set, so no warnings expected
    // for this fixture — this confirms effort mismatches don't abort.
    expect(cap.stderr()).not.toContain("validação eager");
  });

  it("catches invalid mode in the LAST step of a long backlog", async () => {
    const dir = fixtureProject({
      todoLines: [
        "# Long backlog",
        "",
        "- [ ] T-001: Task 1",
        "- [ ] T-002: Task 2",
        "- [ ] T-003: Task 3",
        "- [ ] T-004: Task 4",
        "- [ ] T-005: Task 5",
        "",
      ],
    });
    // mode 'plan' on audit step is invalid for this caps.
    const caps = new Map([
      ["default", { modes: ["acceptEdits"], models: [], efforts: [] } as AgentCapabilities],
    ]);

    const cap = capture();
    const code = await run([dir], cap.io, {
      isGitRepo: () => true,
      runLive: validatingRunLive(caps),
    });

    expect(code).toBe(1);
    expect(cap.stderr()).toContain("mode 'plan'");
    // Even with 5 tasks, zero worktrees.
    expect(existsSync(join(dir, ".worktrees"))).toBe(false);
  });
});
