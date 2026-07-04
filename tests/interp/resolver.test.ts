import { describe, expect, it } from "vitest";
import {
  InterpolationError,
  createResolver,
  createScope,
  resolve,
  selectPrompt,
  type ScopeVars,
} from "../../src/interp/resolver";

/** A fully-populated scope mirroring every documented `${...}` variable. */
function sampleVars(overrides: Partial<ScopeVars> = {}): ScopeVars {
  return {
    task: {
      id: "T-004",
      slug: "resolver-interpolacao",
      title: "Resolver de interpolação",
      body: "corpo da task",
      branch: "T-004-resolver-interpolacao",
    },
    worktree: { path: "/repo/.worktrees/T-004", diff: "" },
    iteration: 3,
    attempt: 1,
    checks: { report: "" },
    inputs: { spec: "SPEC.md", plan: "tasks/plan.md", todo: "tasks/todo.md" },
    workspace: {
      root: ".",
      parent_branch: "main",
      worktrees_dir: ".worktrees",
    },
    change: { id: "C-0005-step-metrics", dir: ".harn/devy/changes/C-0005-step-metrics" },
    ...overrides,
  };
}

describe("resolve — substitution", () => {
  it("replaces a single known variable with its value", () => {
    const scope = createScope(sampleVars());
    expect(resolve("${task.id}", scope)).toBe("T-004");
  });

  it("replaces multiple variables interleaved with literal text", () => {
    const scope = createScope(sampleVars());
    expect(resolve("Implemente ${task.id} — ${task.title}.", scope)).toBe(
      "Implemente T-004 — Resolver de interpolação.",
    );
  });

  it("resolves nested keys from every documented namespace", () => {
    const scope = createScope(sampleVars());
    expect(resolve("${task.slug}", scope)).toBe("resolver-interpolacao");
    expect(resolve("${task.branch}", scope)).toBe(
      "T-004-resolver-interpolacao",
    );
    expect(resolve("${worktree.path}", scope)).toBe("/repo/.worktrees/T-004");
    expect(resolve("${inputs.spec}", scope)).toBe("SPEC.md");
    expect(resolve("${workspace.parent_branch}", scope)).toBe("main");
    expect(resolve("${workspace.worktrees_dir}", scope)).toBe(".worktrees");
  });

  it("renders numeric scalars (${iteration}/${attempt}) as strings", () => {
    const scope = createScope(sampleVars({ iteration: 3, attempt: 2 }));
    expect(resolve("iter=${iteration} try=${attempt}", scope)).toBe(
      "iter=3 try=2",
    );
  });

  it("supports adjacent placeholders with no separator", () => {
    const scope = createScope(sampleVars());
    expect(resolve("${task.id}${task.slug}", scope)).toBe(
      "T-004resolver-interpolacao",
    );
  });

  it("trims surrounding whitespace inside the braces", () => {
    const scope = createScope(sampleVars());
    expect(resolve("${  task.id  }", scope)).toBe("T-004");
  });

  it("resolves placeholders spread across a multi-line template", () => {
    const scope = createScope(sampleVars());
    const template = "Audite ${task.id}\nconforme ${inputs.spec}\n";
    expect(resolve(template, scope)).toBe("Audite T-004\nconforme SPEC.md\n");
  });

  it("returns templates without placeholders unchanged", () => {
    const scope = createScope(sampleVars());
    expect(resolve("no placeholders here", scope)).toBe("no placeholders here");
  });
});

describe("resolve — known-but-empty renders empty (OQ1)", () => {
  it("renders ${checks.report} empty on the first prompt (no report yet)", () => {
    const scope = createScope(sampleVars({ checks: { report: "" } }));
    expect(resolve("relatório:[${checks.report}]", scope)).toBe("relatório:[]");
  });

  it("renders ${worktree.diff} empty when there is no diff", () => {
    const scope = createScope(
      sampleVars({ worktree: { path: "/w", diff: "" } }),
    );
    expect(resolve("<${worktree.diff}>", scope)).toBe("<>");
  });

  it("renders an empty ${task.body} as empty (no error)", () => {
    const vars = sampleVars();
    const scope = createScope({ ...vars, task: { ...vars.task, body: "" } });
    expect(resolve("[${task.body}]", scope)).toBe("[]");
  });
});

describe("resolve — unknown key aborts with a clear error (OQ1)", () => {
  it("throws InterpolationError for a truly unknown namespace", () => {
    const scope = createScope(sampleVars());
    expect(() => resolve("${foo.bar}", scope)).toThrow(InterpolationError);
  });

  it("throws for an unknown leaf under a known namespace", () => {
    const scope = createScope(sampleVars());
    expect(() => resolve("${task.unknown}", scope)).toThrow(InterpolationError);
  });

  it("throws when a known namespace object is referenced without a leaf", () => {
    const scope = createScope(sampleVars());
    // `${checks}` is an object, not a renderable leaf → unknown.
    expect(() => resolve("${checks}", scope)).toThrow(InterpolationError);
  });

  it("names the offending variable and the step in the message", () => {
    const scope = createScope(sampleVars());
    let error: unknown;
    try {
      resolve("prefixo ${task.nope} sufixo", scope, { stepId: "audit" });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(InterpolationError);
    const message = (error as InterpolationError).message;
    expect(message).toContain("task.nope");
    expect(message).toContain("audit");
    expect((error as InterpolationError).variable).toBe("task.nope");
    expect((error as InterpolationError).stepId).toBe("audit");
  });

  it("lists the available variables to aid debugging", () => {
    const scope = createScope(sampleVars());
    try {
      resolve("${task.nope}", scope);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as InterpolationError).message).toContain("task.id");
    }
  });

  it("fails on the first unknown even when a known one precedes it", () => {
    const scope = createScope(sampleVars());
    expect(() => resolve("${task.id} then ${bogus}", scope)).toThrow(/bogus/);
  });
});

describe("createScope — introspection", () => {
  it("exposes every documented key via keys(), sorted", () => {
    const scope = createScope(sampleVars());
    expect(scope.keys()).toEqual([
      "attempt",
      "change.dir",
      "change.id",
      "checks.report",
      "inputs.plan",
      "inputs.spec",
      "inputs.todo",
      "iteration",
      "task.body",
      "task.branch",
      "task.id",
      "task.slug",
      "task.title",
      "workspace.parent_branch",
      "workspace.root",
      "workspace.worktrees_dir",
      "worktree.diff",
      "worktree.path",
    ]);
  });

  it("returns undefined from lookup for an unknown key, value for a known one", () => {
    const scope = createScope(sampleVars());
    expect(scope.lookup("task.id")).toBe("T-004");
    expect(scope.lookup("checks.report")).toBe("");
    expect(scope.lookup("nope")).toBeUndefined();
  });
});

describe("createResolver — bound to a scope + step (resolved once per task/attempt)", () => {
  it("binds a scope once and reuses it across many templates", () => {
    const scope = createScope(sampleVars());
    const r = createResolver(scope, { stepId: "implement" });
    expect(r("${task.id}")).toBe("T-004");
    expect(r("${task.title}")).toBe("Resolver de interpolação");
  });

  it("propagates the bound stepId into the error message", () => {
    const scope = createScope(sampleVars());
    const r = createResolver(scope, { stepId: "implement" });
    expect(() => r("${nope}")).toThrow(/implement/);
  });
});

describe("selectPrompt — retry_prompt vs prompt", () => {
  const step = { prompt: "PRIMEIRO", retry_prompt: "RETENTATIVA" };

  it("uses prompt on the first attempt", () => {
    expect(selectPrompt(step, 1)).toBe("PRIMEIRO");
  });

  it("uses retry_prompt on subsequent attempts", () => {
    expect(selectPrompt(step, 2)).toBe("RETENTATIVA");
    expect(selectPrompt(step, 5)).toBe("RETENTATIVA");
  });

  it("falls back to prompt when retry_prompt is absent, even on retries", () => {
    const noRetry = { prompt: "SÓ ESSE" };
    expect(selectPrompt(noRetry, 1)).toBe("SÓ ESSE");
    expect(selectPrompt(noRetry, 3)).toBe("SÓ ESSE");
  });

  it("treats attempt 0 (or below) as the first prompt", () => {
    expect(selectPrompt(step, 0)).toBe("PRIMEIRO");
  });
});

// ---------------------------------------------------------------------------
// T-001 — ${change.id} / ${change.dir} (C-0005)
// ---------------------------------------------------------------------------

describe("resolve — ${change.*} (C-0005 T-001)", () => {
  it("resolves ${change.id} from the scope", () => {
    const scope = createScope(sampleVars());
    expect(resolve("change: ${change.id}", scope)).toBe("change: C-0005-step-metrics");
  });

  it("resolves ${change.dir} from the scope", () => {
    const scope = createScope(sampleVars());
    expect(resolve("dir: ${change.dir}", scope)).toBe(
      "dir: .harn/devy/changes/C-0005-step-metrics",
    );
  });

  it("lists change.id and change.dir in keys()", () => {
    const scope = createScope(sampleVars());
    expect(scope.keys()).toContain("change.id");
    expect(scope.keys()).toContain("change.dir");
  });

  it("unknown var still fails fast even with change.* in scope", () => {
    const scope = createScope(sampleVars());
    expect(() => resolve("${change.nope}", scope)).toThrow(InterpolationError);
  });
});
