/**
 * Orchestrator — the outer loop over the backlog.
 *
 * The full engine (worktree → interpret pipeline → stop conditions →
 * escalation → mark-done) lands across later tasks (T-010/T-015/T-018). This
 * module currently carries only the **dry-run planner** (T-005): the pure,
 * side-effect-free slice that turns config + backlog into the *resolved*
 * pipeline for `--dry-run` to print — no writes, no git, no ACP.
 *
 * Invariant (AD-1): this is mechanics only. It interprets whatever `pipeline`
 * the yml declares, resolving each primitive's own template fields; it hardcodes
 * no step order, prompt, or command. Swapping the loop's behavior means editing
 * `loopy.yml`, never this file.
 *
 * The scope-building helpers (`buildScopeVars` / `worktreePathFor`) are shared
 * with the real per-task/attempt context the executing loop will assemble later
 * (AD-4), so the dry-run "plan" and the live run resolve identical strings.
 */
import {
  createResolver,
  createScope,
  selectPrompt,
  type ScopeVars,
} from "../interp/resolver";
import type { LoopyConfig, StepConfig, StepType, Task } from "../types";

// ---------------------------------------------------------------------------
// Scope construction (shared with the live loop, AD-4)
// ---------------------------------------------------------------------------

/** Runtime values that vary per task/attempt when building the scope. */
export interface ScopeRuntime {
  /** Outer-loop iteration index (`${iteration}`). */
  readonly iteration: number;
  /** Inner-loop attempt index (`${attempt}`). */
  readonly attempt: number;
  /** Absolute-or-relative worktree path (`${worktree.path}`). */
  readonly worktreePath: string;
  /** Current diff (`${worktree.diff}`); `""` when none yet. */
  readonly diff: string;
  /** Aggregated checks report (`${checks.report}`); `""` before the first run. */
  readonly checksReport: string;
}

/**
 * Compute `${worktree.path}` for a task: `<worktrees_dir>/<task.id>` (matching
 * the `create-worktree` step in the example yml, per T-007). A trailing slash on
 * `worktrees_dir` is normalized away; forward slashes are used so the value is
 * git-friendly and deterministic across platforms.
 */
export function worktreePathFor(config: LoopyConfig, task: Task): string {
  const dir = config.workspace.worktrees_dir.replace(/[/\\]+$/, "");
  return `${dir}/${task.id}`;
}

/**
 * Assemble the documented `${...}` interpolation variables for one task from the
 * config, the task, and the current runtime values. This is the single source of
 * truth for the scope, reused by both the dry-run planner and (later) the live
 * `StepContext`.
 */
export function buildScopeVars(
  config: LoopyConfig,
  task: Task,
  runtime: ScopeRuntime,
): ScopeVars {
  return {
    task: {
      id: task.id,
      slug: task.slug,
      title: task.title,
      body: task.body,
      branch: task.branch,
    },
    worktree: { path: runtime.worktreePath, diff: runtime.diff },
    iteration: runtime.iteration,
    attempt: runtime.attempt,
    checks: { report: runtime.checksReport },
    inputs: {
      spec: config.inputs.spec,
      plan: config.inputs.plan,
      todo: config.inputs.todo,
    },
    workspace: {
      root: config.workspace.root,
      parent_branch: config.workspace.parent_branch,
      worktrees_dir: config.workspace.worktrees_dir,
    },
  };
}

// ---------------------------------------------------------------------------
// Resolved-plan data model (what `--dry-run` prints)
// ---------------------------------------------------------------------------

/** One resolved, displayable piece of a step. */
export type ResolvedField =
  /** A scalar, non-interpolated setting worth surfacing (mode, verify, …). */
  | { readonly kind: "setting"; readonly label: string; readonly value: string }
  /** A resolved prompt template (may be multi-line). */
  | { readonly kind: "prompt"; readonly label: string; readonly value: string }
  /** A resolved shell command. */
  | { readonly kind: "command"; readonly value: string };

/** A pipeline step with its `${...}` fields resolved for a specific task. */
export interface ResolvedStep {
  readonly id: string;
  readonly type: StepType;
  /** `true` when the step runs even after a previous failure. */
  readonly always: boolean;
  readonly fields: readonly ResolvedField[];
}

/** The resolved pipeline for a single task. */
export interface ResolvedTaskPlan {
  readonly task: Task;
  readonly iteration: number;
  readonly worktreePath: string;
  readonly steps: readonly ResolvedStep[];
}

/** The full `--dry-run` result: every task with its resolved pipeline. */
export interface DryRunPlan {
  readonly tasks: readonly ResolvedTaskPlan[];
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/** The 1-based attempt a first-pass plan shows (`prompt`, not `retry_prompt`). */
const FIRST_ATTEMPT = 1;

// Constructors for the displayable field kinds — keep the `resolveStep` call
// sites terse and free of repeated `kind`/`label`/`value` keys.
const setting = (label: string, value: string): ResolvedField => ({
  kind: "setting",
  label,
  value,
});
const prompt = (label: string, value: string): ResolvedField => ({
  kind: "prompt",
  label,
  value,
});
const command = (value: string): ResolvedField => ({ kind: "command", value });

/**
 * Resolve the template fields of one step against `resolve`. Each primitive
 * exposes different templated fields; this switch encodes only that structural
 * knowledge (the same the schema encodes), never pipeline behavior.
 */
function resolveStep(
  step: StepConfig,
  resolve: (template: string) => string,
): ResolvedStep {
  const fields: ResolvedField[] = [];

  switch (step.type) {
    case "agent": {
      if (step.mode) fields.push(setting("mode", step.mode));
      fields.push(setting("clear_context", String(step.clear_context ?? true)));
      fields.push(prompt("prompt", resolve(selectPrompt(step, FIRST_ATTEMPT))));
      if (step.verify) {
        const { run, max_attempts, on_fail } = step.verify;
        fields.push(
          setting(
            "verify",
            `run=${run} max_attempts=${max_attempts} on_fail=${on_fail}`,
          ),
        );
      }
      if (step.expect) fields.push(setting("expect", resolve(step.expect)));
      if (step.on_expect_fail) {
        fields.push(setting("on_expect_fail", step.on_expect_fail));
      }
      break;
    }
    case "shell": {
      for (const cmd of step.run) fields.push(command(resolve(cmd)));
      if (step.on_fail) fields.push(setting("on_fail", step.on_fail));
      break;
    }
    case "checks": {
      fields.push(setting("run", step.run));
      if (step.on_fail) fields.push(setting("on_fail", step.on_fail));
      break;
    }
    case "approval": {
      fields.push(prompt("prompt", resolve(step.prompt)));
      for (const cmd of step.run ?? []) fields.push(command(resolve(cmd)));
      if (step.on_conflict) {
        fields.push(setting("on_conflict", step.on_conflict));
      }
      break;
    }
  }

  return {
    id: step.id,
    type: step.type,
    always: step.always ?? false,
    fields,
  };
}

/**
 * Build the `--dry-run` plan: for each task (in the given order), resolve the
 * whole pipeline against that task's scope. Purely functional — no I/O, no git,
 * no ACP (Success Criterion #8). Fails fast with an `InterpolationError` if any
 * template references an unknown variable (OQ1), before returning any output.
 *
 * `tasks` is the already-selected list (the caller filters pending / `--task`);
 * `iteration` is that list's 1-based position.
 */
export function planDryRun(
  config: LoopyConfig,
  tasks: readonly Task[],
): DryRunPlan {
  const plans = tasks.map((task, index): ResolvedTaskPlan => {
    const iteration = index + 1;
    const worktreePath = worktreePathFor(config, task);
    const scope = createScope(
      buildScopeVars(config, task, {
        iteration,
        attempt: FIRST_ATTEMPT,
        worktreePath,
        diff: "",
        checksReport: "",
      }),
    );
    const steps = config.pipeline.map((step) =>
      resolveStep(step, createResolver(scope, { stepId: step.id })),
    );
    return { task, iteration, worktreePath, steps };
  });

  return { tasks: plans };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const STEP_INDENT = "      ";
const PROMPT_INDENT = "        ";

/** Render one resolved field as one or more display lines. */
function renderField(field: ResolvedField): string[] {
  switch (field.kind) {
    case "command":
      return [`${STEP_INDENT}$ ${field.value}`];
    case "setting":
      return [`${STEP_INDENT}${field.label}: ${field.value}`];
    case "prompt": {
      const body = field.value.trimEnd();
      const lines = body === "" ? ["(vazio)"] : body.split("\n");
      return [
        `${STEP_INDENT}${field.label}:`,
        ...lines.map((line) => `${PROMPT_INDENT}${line}`),
      ];
    }
  }
}

/** Render one resolved step block. */
function renderStep(step: ResolvedStep, position: number): string[] {
  const flag = step.always ? " [always]" : "";
  const header = `  [${position}] ${step.id} (${step.type})${flag}`;
  return [header, ...step.fields.flatMap(renderField)];
}

/** Render one task's resolved plan. */
function renderTaskPlan(plan: ResolvedTaskPlan): string {
  const { task } = plan;
  const lines = [
    `=== ${task.id} — ${task.title} ===`,
    `  iteration: ${plan.iteration}`,
    `  branch:    ${task.branch}`,
    `  worktree:  ${plan.worktreePath}`,
    "",
    ...plan.steps.flatMap((step, index) => renderStep(step, index + 1)),
  ];
  return lines.join("\n");
}

/**
 * Render the whole dry-run plan as human-readable, deterministic text — the
 * exact output `--dry-run` prints. Contains only config/backlog-derived values
 * (no absolute paths), so it is stable for snapshotting. Empty when there are no
 * tasks to plan.
 */
export function formatDryRunPlan(plan: DryRunPlan): string {
  if (plan.tasks.length === 0) return "";
  return plan.tasks.map(renderTaskPlan).join("\n\n");
}
