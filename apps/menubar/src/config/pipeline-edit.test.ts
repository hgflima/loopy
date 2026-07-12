import { describe, expect, it } from "vitest";

import type { StepConfig } from "loopy/types";

import {
  addStep,
  migrateStepType,
  orphanRefs,
  removeStep,
  reorderStep,
} from "./pipeline-edit";

// ── Fixtures ───────────────────────────────────────────────────────────

const shell = (id: string, extra: Partial<StepConfig> = {}): StepConfig =>
  ({ id, type: "shell", run: ["echo hi"], ...extra }) as StepConfig;

const agent = (id: string, extra: Partial<StepConfig> = {}): StepConfig =>
  ({ id, type: "agent", prompt: "do it", ...extra }) as StepConfig;

// ── addStep ────────────────────────────────────────────────────────────

describe("addStep", () => {
  it("appends a step with unique id and type defaults", () => {
    const pipeline: StepConfig[] = [shell("build")];
    const result = addStep(pipeline, "agent");
    expect(result).toHaveLength(2);
    expect(result[1].type).toBe("agent");
    expect(result[1].id).toBeTruthy();
    expect(result[1].id).not.toBe("build");
    expect((result[1] as { prompt: string }).prompt).toBe("");
  });

  it("inserts at a specific index", () => {
    const pipeline = [shell("a"), shell("b")];
    const result = addStep(pipeline, "checks", 1);
    expect(result).toHaveLength(3);
    expect(result[1].type).toBe("checks");
    expect(result[0].id).toBe("a");
    expect(result[2].id).toBe("b");
  });

  it("generates non-colliding ids", () => {
    // Pre-fill with "step-1" to force the generator to pick a different id
    const pipeline = [shell("step-1"), shell("step-2")];
    const result = addStep(pipeline, "approval");
    const allIds = result.map((s) => s.id);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("sets correct defaults per type", () => {
    const empty: StepConfig[] = [];

    const [ag] = addStep(empty, "agent");
    expect(ag.type).toBe("agent");
    expect((ag as { prompt: string }).prompt).toBe("");

    const [sh] = addStep(empty, "shell");
    expect((sh as unknown as { run: string[] }).run).toEqual([]);

    const [ch] = addStep(empty, "checks");
    expect((ch as { run: string }).run).toBe("");

    const [ap] = addStep(empty, "approval");
    expect((ap as { prompt: string }).prompt).toBe("");
  });

  it("does not mutate the original pipeline", () => {
    const pipeline = [shell("x")];
    const result = addStep(pipeline, "agent");
    expect(pipeline).toHaveLength(1);
    expect(result).toHaveLength(2);
  });
});

// ── removeStep ─────────────────────────────────────────────────────────

describe("removeStep", () => {
  it("removes a step by id", () => {
    const pipeline = [shell("a"), shell("b"), shell("c")];
    const result = removeStep(pipeline, "b");
    expect(result.map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("returns unchanged array when id not found", () => {
    const pipeline = [shell("a")];
    const result = removeStep(pipeline, "z");
    expect(result).toEqual(pipeline);
  });

  it("does not mutate the original pipeline", () => {
    const pipeline = [shell("a"), shell("b")];
    removeStep(pipeline, "a");
    expect(pipeline).toHaveLength(2);
  });
});

// ── reorderStep ────────────────────────────────────────────────────────

describe("reorderStep", () => {
  it("moves a step forward", () => {
    const pipeline = [shell("a"), shell("b"), shell("c")];
    const result = reorderStep(pipeline, 0, 2);
    expect(result.map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  it("moves a step backward", () => {
    const pipeline = [shell("a"), shell("b"), shell("c")];
    const result = reorderStep(pipeline, 2, 0);
    expect(result.map((s) => s.id)).toEqual(["c", "a", "b"]);
  });

  it("preserves ids", () => {
    const pipeline = [shell("a"), shell("b")];
    const result = reorderStep(pipeline, 0, 1);
    expect(new Set(result.map((s) => s.id))).toEqual(
      new Set(pipeline.map((s) => s.id)),
    );
  });

  it("does not mutate the original pipeline", () => {
    const pipeline = [shell("a"), shell("b")];
    reorderStep(pipeline, 0, 1);
    expect(pipeline[0].id).toBe("a");
  });
});

// ── migrateStepType ────────────────────────────────────────────────────

describe("migrateStepType", () => {
  it("is a no-op when type is the same", () => {
    const step = shell("x");
    expect(migrateStepType(step, "shell")).toBe(step);
  });

  it("preserves id and base fields", () => {
    const step = agent("impl", {
      always: true,
      on_success: { goto: "cleanup" },
      parallel_safe: true,
      on_fail: { goto: "fix" },
    } as Partial<StepConfig>);

    const migrated = migrateStepType(step, "shell");
    expect(migrated.id).toBe("impl");
    expect(migrated.type).toBe("shell");
    expect(migrated.always).toBe(true);
    expect(migrated.on_success).toEqual({ goto: "cleanup" });
    expect(migrated.parallel_safe).toBe(true);
    expect((migrated as { on_fail: unknown }).on_fail).toEqual({
      goto: "fix",
    });
  });

  it("discards type-specific fields from the old type", () => {
    const step: StepConfig = {
      id: "audit",
      type: "agent",
      prompt: "review code",
      mode: "plan",
      verify: { run: "ci", max_attempts: 3 },
      expect: "AUDIT: PASS",
      retry_prompt: "try again",
      clear_context: false,
      agent: "reviewer",
      model: "opus",
      effort: "high",
    };

    const migrated = migrateStepType(step, "checks");
    expect(migrated.type).toBe("checks");
    expect(migrated.id).toBe("audit");
    // Type-specific agent fields are gone
    expect("prompt" in migrated).toBe(false);
    expect("mode" in migrated).toBe(false);
    expect("verify" in migrated).toBe(false);
    expect("expect" in migrated).toBe(false);
    expect("retry_prompt" in migrated).toBe(false);
    expect("clear_context" in migrated).toBe(false);
    expect("agent" in migrated).toBe(false);
    expect("model" in migrated).toBe(false);
    expect("effort" in migrated).toBe(false);
    // New type defaults present
    expect((migrated as { run: string }).run).toBe("");
  });

  it("migrates shell → agent with correct defaults", () => {
    const step = shell("deploy");
    const migrated = migrateStepType(step, "agent");
    expect(migrated.type).toBe("agent");
    expect((migrated as { prompt: string }).prompt).toBe("");
    expect("run" in migrated).toBe(false);
  });

  it("migrates agent → approval", () => {
    const step = agent("gate");
    const migrated = migrateStepType(step, "approval");
    expect(migrated.type).toBe("approval");
    expect((migrated as { prompt: string }).prompt).toBe("");
    // agent-specific fields gone
    expect("mode" in migrated).toBe(false);
  });

  it("preserves on_fail: escalate", () => {
    const step: StepConfig = {
      id: "s",
      type: "shell",
      run: ["cmd"],
      on_fail: "escalate",
    };
    const migrated = migrateStepType(step, "checks");
    expect((migrated as { on_fail: string }).on_fail).toBe("escalate");
  });
});

// ── orphanRefs ─────────────────────────────────────────────────────────

describe("orphanRefs", () => {
  it("returns empty when all refs are valid", () => {
    const pipeline: StepConfig[] = [
      {
        ...shell("a"),
        on_success: { goto: "b" },
      } as StepConfig,
      shell("b"),
    ];
    expect(orphanRefs(pipeline)).toEqual([]);
  });

  it("detects orphan on_success.goto after removal", () => {
    const pipeline: StepConfig[] = [
      { ...shell("a"), on_success: { goto: "deleted" } } as StepConfig,
      shell("b"),
    ];
    expect(orphanRefs(pipeline)).toEqual([
      { stepId: "a", field: "on_success", target: "deleted" },
    ]);
  });

  it("detects orphan on_fail.goto", () => {
    const pipeline: StepConfig[] = [
      {
        id: "x",
        type: "agent",
        prompt: "go",
        on_fail: { goto: "missing" },
        verify: { run: "ci", max_attempts: 2 },
      },
      shell("y"),
    ];
    expect(orphanRefs(pipeline)).toEqual([
      { stepId: "x", field: "on_fail", target: "missing" },
    ]);
  });

  it("ignores on_fail: escalate (not a goto)", () => {
    const pipeline: StepConfig[] = [
      { id: "a", type: "shell", run: ["cmd"], on_fail: "escalate" },
    ];
    expect(orphanRefs(pipeline)).toEqual([]);
  });

  it("reports multiple orphans", () => {
    const pipeline: StepConfig[] = [
      { ...shell("a"), on_success: { goto: "gone1" } } as StepConfig,
      {
        id: "b",
        type: "checks",
        run: "ci",
        on_fail: { goto: "gone2" },
      },
    ];
    const result = orphanRefs(pipeline);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.target)).toContain("gone1");
    expect(result.map((r) => r.target)).toContain("gone2");
  });

  it("detects orphan after removeStep", () => {
    const pipeline: StepConfig[] = [
      { ...shell("a"), on_success: { goto: "target" } } as StepConfig,
      shell("target"),
    ];
    // Before removal: no orphans
    expect(orphanRefs(pipeline)).toEqual([]);
    // After removal: orphan detected
    const reduced = removeStep(pipeline, "target");
    expect(orphanRefs(reduced)).toEqual([
      { stepId: "a", field: "on_success", target: "target" },
    ]);
  });
});
