/**
 * Acceptance pass (T-019) — the executable gate for Checkpoint E.
 *
 * The eight Success Criteria in `SPEC.md` are each proven end-to-end by a
 * dedicated test elsewhere in this suite (see the matrix in `README.md`). This
 * file does NOT re-run those heavy e2e flows; it locks down the acceptance
 * artifacts T-019 is responsible for and that nothing else guards:
 *
 *  - the committed example `loopy.yml` still matches the FINAL schema and plans
 *    cleanly (SC #2 / #8 — config-driven, `--dry-run` resolves every `${…}`);
 *  - repo hygiene: `.gitignore` covers every runtime artifact and none of them
 *    leaked into the working tree (SC #7 — nothing temporary is left behind);
 *  - the usage docs (`README.md`) exist and document every CLI flag plus the
 *    Success-Criteria checklist (the "docs de uso presentes" acceptance item).
 *
 * These are all "small" tests: read repo files, run the pure planner. No git,
 * no subprocess, no network.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/load";
import { formatDryRunPlan, planDryRun } from "../../src/loop/orchestrator";
import type { LoopyConfig, Task } from "../../src/types";

/** Absolute path of a file at the repo root. */
function repoFile(name: string): string {
  return fileURLToPath(new URL(`../../${name}`, import.meta.url));
}

/** Read a repo-root file as UTF-8 text. */
function readRepoFile(name: string): string {
  return readFileSync(repoFile(name), "utf8");
}

/** Load the committed example `loopy.yml` through the engine's own loader. */
function loadExampleConfig(): LoopyConfig {
  return loadConfig(repoFile("examples/loopy.yml"));
}

/** A single fabricated pending task, enough to resolve every interpolation. */
function sampleTask(): Task {
  return {
    id: "T-042",
    slug: "amostra",
    title: "Task de amostra",
    body: "Corpo da task de amostra.",
    branch: "T-042-amostra",
    done: false,
    deps: [],
  };
}

/** Render the resolved dry-run plan for a single task to its printed text. */
function dryRunPlanText(config: LoopyConfig, task: Task): string {
  return formatDryRunPlan(planDryRun(config, [task]));
}

/** The step ids, in the order the resolved plan lists them. */
function planStepOrder(config: LoopyConfig, task: Task): string[] {
  const text = dryRunPlanText(config, task);
  return [...text.matchAll(/\[\d+\] (\S+)/g)].map((m) => m[1]!);
}

// ---------------------------------------------------------------------------
// Example config ↔ final schema (SC #2 / #8)
// ---------------------------------------------------------------------------

describe("acceptance · example loopy.yml matches the final schema", () => {
  const config = loadExampleConfig();

  it("loads the committed example through the engine's own loader", () => {
    expect(config.version).toBe("1");
    expect(config.name).toBe("agentic-loop");
    expect(config.concurrency).toBe(1);
  });

  it("declares the full example pipeline in order, each a known primitive", () => {
    const order = config.pipeline.map((s) => `${s.id}:${s.type}`);
    expect(order).toEqual([
      "create-worktree:shell",
      "install-deps:shell",
      "implement:agent",
      "simplify:agent",
      "review:agent",
      "commit:shell",
      "merge:approval",
      "cleanup:shell",
    ]);
  });

  it("applies documented defaults (agent clear_context → true)", () => {
    for (const step of config.pipeline) {
      if (step.type === "agent") expect(step.clear_context).toBe(true);
    }
  });

  it("every verify/checks step references a declared check list", () => {
    const lists = new Set(Object.keys(config.checks));
    for (const step of config.pipeline) {
      if (step.type === "agent" && step.verify) {
        expect(lists.has(step.verify.run)).toBe(true);
      }
      if (step.type === "checks") expect(lists.has(step.run)).toBe(true);
    }
  });

  it("plans cleanly — every ${…} in the example resolves (SC #8)", () => {
    const plan = dryRunPlanText(config, sampleTask());
    // A dry-run of the real example leaks no unresolved interpolation tokens.
    expect(plan).not.toContain("${");
    expect(plan).toContain("T-042");
  });
});

// ---------------------------------------------------------------------------
// SC multi-agent — dry-run prints Agent/model/effort per step (T-009)
// ---------------------------------------------------------------------------

describe("acceptance · multi-agent dry-run resolves agent/model/effort per step", () => {
  const config = loadExampleConfig();
  const task = sampleTask();

  it("the example declares a multi-agent registry with claude (default) and codex", () => {
    expect(config.resolvedAgents).toBeDefined();
    expect(config.resolvedAgents.default).toBe("claude");
    expect(Object.keys(config.resolvedAgents.byName).sort()).toEqual(["claude", "codex"]);
  });

  it("dry-run resolves agent bindings per step without writing anything", () => {
    const plan = planDryRun(config, [task]);

    /** Extract the value of a setting field by label, or `undefined` if absent. */
    const settingValue = (stepId: string, label: string): string | undefined =>
      plan.tasks[0]!.steps
        .find((s) => s.id === stepId)
        ?.fields.find((f) => f.kind === "setting" && "label" in f && f.label === label)
        ?.value;

    // implement: agent=claude (default), no model/effort override
    expect(settingValue("implement", "agent")).toBe("claude");

    // simplify: agent=codex (step override), effort=low (step + registry default)
    expect(settingValue("simplify", "agent")).toBe("codex");
    expect(settingValue("simplify", "effort")).toBe("low");

    // review: agent=claude (default), mode=plan (shown as setting)
    expect(settingValue("review", "agent")).toBe("claude");
    expect(settingValue("review", "mode")).toBe("plan");
  });
});

// ---------------------------------------------------------------------------
// SC #2 / AD-1 — behavior is config-driven: step ORDER is data, not code.
// ---------------------------------------------------------------------------

describe("acceptance · reordering the pipeline is a config edit (AD-1)", () => {
  it("reversing the example pipeline reverses the resolved plan, no engine change", () => {
    const config = loadExampleConfig();
    const task = sampleTask();

    const forward = planStepOrder(config, task);
    const reversed = planStepOrder(
      { ...config, pipeline: [...config.pipeline].reverse() },
      task,
    );

    expect(forward[0]).toBe("create-worktree");
    expect(reversed).toEqual([...forward].reverse());
    // The very same engine call produced a different order purely from the yml.
    expect(reversed[0]).toBe("cleanup");
  });
});

// ---------------------------------------------------------------------------
// SC #7 — repo hygiene: runtime artifacts are ignored and nothing leaked.
// ---------------------------------------------------------------------------

describe("acceptance · .gitignore covers every runtime artifact (SC #7)", () => {
  const gitignore = readRepoFile(".gitignore");
  const config = loadExampleConfig();

  it("ignores the worktrees dir, the loopy state dir and the stop signal", () => {
    for (const line of [".worktrees/", ".loopy/", ".loopy.stop"]) {
      expect(gitignore).toContain(line);
    }
  });

  it("the ignored paths match what the config actually produces", () => {
    const worktrees = `${config.workspace.worktrees_dir}/`;
    const loopyDir = `${config.logging.dir.split("/")[0]}/`;
    const stop = config.stop_conditions.stop_signal_file;
    expect(gitignore).toContain(worktrees);
    expect(gitignore).toContain(loopyDir);
    expect(gitignore).toContain(stop);
  });

  it("no runtime artifact leaked into the committed working tree", () => {
    for (const artifact of [".worktrees", ".loopy", ".loopy.stop"]) {
      expect(existsSync(repoFile(artifact))).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Usage docs present (the "docs de uso presentes" acceptance item).
// ---------------------------------------------------------------------------

describe("acceptance · README documents usage and the SC checklist", () => {
  it("a README exists at the repo root", () => {
    expect(existsSync(repoFile("README.md"))).toBe(true);
  });

  it("documents every CLI flag from the SPEC", () => {
    const readme = readRepoFile("README.md");
    for (const flag of [
      "--config",
      "--dry-run",
      "--task",
      "--max-iterations",
      "--yes",
      "--no-tui",
      "--verbose",
    ]) {
      expect(readme).toContain(flag);
    }
  });

  it("names the config-driven invariant (AD-1) and each Success Criterion #1–#8", () => {
    const readme = readRepoFile("README.md");
    expect(readme).toContain("AD-1");
    expect(readme.toLowerCase()).toContain("config-driven");
    for (let n = 1; n <= 8; n++) {
      expect(readme).toContain(`#${n}`);
    }
  });
});
