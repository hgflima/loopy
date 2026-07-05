/**
 * Orchestrator — the outer loop over the backlog.
 *
 * Two capabilities live here, sharing one scope-building core:
 *
 *  - **Dry-run planner** (T-005): the pure, side-effect-free slice that turns
 *    config + backlog into the *resolved* pipeline for `--dry-run` to print —
 *    no writes, no git, no ACP.
 *  - **Live outer loop** (T-010, {@link runLoop}): iterate the pending tasks in
 *    order; for each, interpret the `pipeline` via the step registry (AD-2),
 *    respecting order / `always`; apply `stop_conditions` (backlog empty,
 *    `max_iterations`, `stop_signal_file`) and `policies.escalation`; and mark
 *    `- [x]` **only** after the whole pipeline succeeds, committing that mark.
 *    The `agent` step is not yet registered (T-015) — the loop skips any step
 *    type with no interpreter, so the mechanics are proven with shell/checks/
 *    approval first.
 *
 * Invariant (AD-1): this is mechanics only. It interprets whatever `pipeline`
 * the yml declares, resolving each primitive's own template fields and reading
 * `always` / escalation / stop-conditions from config; it hardcodes no step
 * order, prompt, or command. Swapping the loop's behavior means editing
 * `loopy.yml`, never this file.
 *
 * The scope-building helpers (`buildScopeVars` / `worktreePathFor`) are shared
 * by the dry-run "plan" and the live run, so both resolve identical strings
 * (AD-4).
 */
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { markDoneInFile, type BacklogOptions } from "../backlog/todo";
import { buildGraph, readySet, skipDescendants } from "../scheduler/index";
import type { SchedulerTaskStatus, TaskGraph } from "../scheduler/types";
import {
  createResolver,
  createScope,
  selectPrompt,
  type ScopeVars,
} from "../interp/resolver";
import { foldSamples } from "../metrics/folds.js";
import {
  clearTaskIn,
  loadState,
  pipelineFingerprint,
  pruneOrphansIn,
  resumeStateFor,
  saveProgressIn,
  saveState,
  setStatusIn,
  type ResumePoint,
} from "../resume/state";
import type { StepRegistry } from "../steps/index";
import type { Mutex } from "./mutex";
import { guarded } from "./mutex";
import type {
  AgentSession,
  CheckpointPort,
  ChecksRunnerPort,
  EscalationAction,
  GitPort,
  LoggerPort,
  LoopyConfig,
  OnFailAction,
  PipelineOutcome,
  RunFlags,
  RunMetrics,
  Sample,
  StepConfig,
  StepContext,
  StepCost,
  StepMetrics,
  StepResult,
  StepType,
  Task,
  TaskMetrics,
  UiPort,
} from "../types";

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
 * Derive `change.id` and `change.dir` from `dirname(inputs.todo)`.
 * Fallback: when the backlog lives at the repo root (`dirname` is `"."`
 * or empty), `change.id` falls back to `config.name`.
 */
export function deriveChange(config: LoopyConfig): { readonly id: string; readonly dir: string } {
  const dir = dirname(config.inputs.todo);
  if (dir === "." || dir === "") return { id: config.name, dir: "." };
  return { id: basename(dir), dir };
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
    change: deriveChange(config),
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
export const formatOnFail = (a: OnFailAction): string =>
  typeof a === "string" ? a : `goto ${a.goto}`;

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
        const { run, max_attempts } = step.verify;
        fields.push(
          setting("verify", `run=${run} max_attempts=${max_attempts}`),
        );
      }
      if (step.expect) fields.push(setting("expect", resolve(step.expect)));
      break;
    }
    case "shell": {
      for (const cmd of step.run) fields.push(command(resolve(cmd)));
      break;
    }
    case "checks": {
      fields.push(setting("run", step.run));
      break;
    }
    case "approval": {
      fields.push(prompt("prompt", resolve(step.prompt)));
      for (const cmd of step.run ?? []) fields.push(command(resolve(cmd)));
      break;
    }
  }

  // Common to all step types — pushed after per-type fields.
  if (step.on_success)
    fields.push(setting("on_success", `goto ${step.on_success.goto}`));
  if (step.on_fail) fields.push(setting("on_fail", formatOnFail(step.on_fail)));

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

// ---------------------------------------------------------------------------
// Live outer loop (T-010) — mark-done port
// ---------------------------------------------------------------------------

/**
 * Persists a task's completion. The orchestrator calls this once, after a task's
 * whole pipeline succeeds: rewrite `- [ ]` → `- [x]` and commit that edit on the
 * parent so `parent_branch` stays clean for the next task (SPEC "mark-done +
 * parent limpo"). It is a port so the loop stays testable without disk/git.
 */
export interface MarkDonePort {
  /** Mark `taskId` done and commit the mark. Idempotent (no-op if already done). */
  markDone(taskId: string): Promise<void>;
}

/** Options for {@link createMarkDonePort}. */
export interface CreateMarkDonePortOptions {
  /** Absolute path to the backlog file (`todo.md`) to rewrite. */
  readonly todoPath: string;
  /** Commits the given paths on the parent (canonically `git.commitPaths`). */
  readonly commit: (paths: readonly string[], message: string) => Promise<void>;
  /** Backlog markers/id-pattern (from `inputs.backlog`); defaults apply if omitted. */
  readonly backlogOptions?: BacklogOptions;
  /** Commit message builder; defaults to a `chore(loopy)` bookkeeping message. */
  readonly message?: (taskId: string) => string;
}

/**
 * Build a {@link MarkDonePort} backed by `todo.md` on disk + a commit function.
 * The write is idempotent (`markDoneInFile` returns `false` when the task is
 * already `- [x]`), and the commit runs **only** when the file actually changed,
 * so a re-run never produces an empty commit.
 */
export function createMarkDonePort(
  options: CreateMarkDonePortOptions,
): MarkDonePort {
  const message =
    options.message ?? ((taskId: string) => `chore(loopy): conclui ${taskId}`);
  const backlogOptions = options.backlogOptions ?? {};
  return {
    async markDone(taskId) {
      const changed = markDoneInFile(options.todoPath, taskId, backlogOptions);
      if (!changed) return;
      await options.commit([options.todoPath], message(taskId));
    },
  };
}

// ---------------------------------------------------------------------------
// Live outer loop — checkpoint port (C-0002 resume)
// ---------------------------------------------------------------------------

/** Options for {@link createCheckpointPort}. */
export interface CreateCheckpointPortOptions {
  /** Absolute path to `.loopy/state.json`. */
  readonly statePath: string;
  /** Pipeline fingerprint stamped on every write (constant per run). */
  readonly pipelineHash: string;
}

/**
 * Build a {@link CheckpointPort} backed by `.loopy/state.json` on disk. State is
 * held in memory (loaded once via `loadState`); every mutation applies the pure
 * transition from `state.ts` and `saveState` atomically to disk. The
 * `pipelineHash` is stamped on `saveProgress` / `setStatus` so the caller never
 * has to pass it per-call.
 */
export function createCheckpointPort(
  options: CreateCheckpointPortOptions,
): CheckpointPort {
  let state = loadState(options.statePath);
  return {
    read() {
      return state;
    },
    saveProgress(taskId, pc, visits, checksReport) {
      state = saveProgressIn(state, taskId, pc, visits, checksReport, options.pipelineHash);
      saveState(options.statePath, state);
    },
    setStatus(taskId, status) {
      state = setStatusIn(state, taskId, status, options.pipelineHash);
      saveState(options.statePath, state);
    },
    clearTask(taskId) {
      state = clearTaskIn(state, taskId);
      saveState(options.statePath, state);
    },
    pruneOrphans(knownTaskIds) {
      state = pruneOrphansIn(state, knownTaskIds);
      saveState(options.statePath, state);
    },
  };
}

// ---------------------------------------------------------------------------
// Live outer loop (T-010) — dependencies + not-wired handles
// ---------------------------------------------------------------------------

const NOT_WIRED =
  "handle não disponível no spine sem-agente (T-010); é wired quando o step agent chega (T-014/T-015)";

/** A fail-loud port method: any call throws, naming the `member` reached for. */
const notWired = (member: string) => (): never => {
  throw new Error(`${member}: ${NOT_WIRED}`);
};

/** Fail-loud `AgentSession`: the non-agent spine must never touch a session. */
const notWiredSession: AgentSession = {
  sessionId: "not-wired",
  setMode: notWired("session.setMode"),
  clear: notWired("session.clear"),
  prompt: notWired("session.prompt"),
  readText: notWired("session.readText"),
  cancel: notWired("session.cancel"),
  drainUsage: () => null,
  readCost: () => null,
};

/** Fail-loud `GitPort`: no non-agent step reaches for engine-level git here. */
const notWiredGit: GitPort = {
  addWorktree: notWired("git.addWorktree"),
  removeWorktree: notWired("git.removeWorktree"),
  merge: notWired("git.merge"),
  isParentClean: notWired("git.isParentClean"),
};

/**
 * Opens (or reuses) the ACP session bound to a task's worktree (AD-3: cwd is
 * immutable per session). Called with the worktree's absolute path the first
 * time an agent step reaches for the session — i.e. *after* `create-worktree`
 * has made the directory exist.
 */
export type SessionProvider = (worktreeCwd: string) => Promise<AgentSession>;

/**
 * Wrap a {@link SessionProvider} in an {@link AgentSession} that opens the real
 * session lazily and at most once (AD-3: one session per task/worktree). The
 * open is deferred to the first `setMode`/`clear`/`prompt`, so a task with no
 * agent step never opens a session at all; `readText`/`sessionId` read from the
 * resolved session (safe because the agent step always awaits a prompt turn
 * before reading its text). This keeps the orchestrator agnostic to step type
 * (AD-2): any step may reach for `ctx.session`, but the cost is only paid when
 * one actually does.
 */
function createLazySession(open: () => Promise<AgentSession>): AgentSession {
  let opened: AgentSession | undefined;
  let opening: Promise<AgentSession> | undefined;
  const ensure = (): Promise<AgentSession> => {
    opening ??= open().then((session) => {
      opened = session;
      return session;
    });
    return opening;
  };
  return {
    get sessionId(): string {
      return opened?.sessionId ?? "lazy(unopened)";
    },
    setMode: async (modeId) => (await ensure()).setMode(modeId),
    clear: async () => (await ensure()).clear(),
    prompt: async (text) => (await ensure()).prompt(text),
    readText: () => opened?.readText() ?? "",
    cancel: async () => {
      if (opened !== undefined) await opened.cancel();
    },
    drainUsage: () => opened?.drainUsage() ?? null,
    readCost: () => opened?.readCost() ?? null,
  };
}

/** Everything {@link runLoop} needs — the ports a {@link StepContext} is built from. */
export interface OrchestratorDeps {
  /**
   * Absolute workspace root. Two roles: the cwd every step runs in (see
   * {@link buildTaskStepContext}) and the base for the `stop_signal_file` check.
   */
  readonly root: string;
  /** Parsed CLI flags (e.g. `--yes` for approval gates). */
  readonly flags: RunFlags;
  /** Step registry (AD-2). A type with no interpreter is skipped (agent, T-015). */
  readonly registry: StepRegistry;
  /** Checks runner wired into each step's context. */
  readonly checks: ChecksRunnerPort;
  /** Human gate for `approval` steps. */
  readonly ui: UiPort;
  /** Per-run logger (T-016 richens this to per-task). */
  readonly logger: LoggerPort;
  /** Marks a task done + commits the mark, once its pipeline succeeds. */
  readonly markDone: MarkDonePort;
  /**
   * Operator notification sink for escalation / dirty-parent halts
   * (`policies.escalation.notify`, canonically stderr). Optional: absent on the
   * unit spine; wired to stderr by the CLI. The message is also logged.
   */
  readonly notify?: (message: string) => void;
  /**
   * Engine-level git handle. Used by the non-agent spine only for
   * `require_clean_parent` (when the policy is on); a step's own `ctx.git` falls
   * back to a fail-loud stub. When absent, `require_clean_parent` cannot run and
   * is a no-op — the CLI always wires a real handle, so the check is live there.
   */
  readonly git?: GitPort;
  /** ACP session; unused by the non-agent spine (fail-loud default). */
  readonly session?: AgentSession;
  /**
   * Opens the ACP session bound to a task's worktree, keyed by its absolute path
   * (T-015 — canonically `pool.session` from `acp/session.ts`). When present, the
   * orchestrator wraps it lazily and hands agent steps a per-task session; when
   * absent (the non-agent spine), the fail-loud {@link session} is used instead.
   */
  readonly sessionProvider?: SessionProvider;
  /**
   * Step-level checkpoint port (C-0002 resume). When present, `runLoop`
   * reconciles resume state before the loop and `runTaskPipeline` skips
   * completed steps + records progress. Absent → resume is fully inert.
   */
  readonly checkpoint?: CheckpointPort;
  /**
   * All known task ids from the backlog (pending + done). Used by
   * `pruneOrphans` to clean up orphaned checkpoint entries. Absent →
   * pruning uses only the `tasks` passed to `runLoop`.
   */
  readonly knownTaskIds?: readonly string[];
  /**
   * Injectable clock for timing measurements (default `Date.now`).
   * Returns milliseconds since epoch. Tests inject for determinism.
   */
  readonly now?: () => number;
  /**
   * Parent mutex (T-004). Serializes all parent-branch mutations (non-agent
   * step commands, commitPaths, isParentClean) behind a single FIFO lock.
   * When absent (tests without parallelism), no serialization occurs.
   */
  readonly parentMutex?: Mutex;
}

/**
 * Assemble the {@link StepContext} for one step of one task/attempt (AD-4).
 *
 * `worktreePath` (the cwd shell/checks/approval run in) is the **workspace root**,
 * not the worktree dir: in the config-driven pipeline the git commands that
 * create and tear down the worktree address it via `${worktree.path}` and must
 * run from a directory that outlives it (the worktree does not exist before
 * `create-worktree` nor after `cleanup`). The worktree is identified to those
 * commands through the `${worktree.path}` scope value. When the `agent` step
 * lands (T-014/T-015) its ACP session sets its own cwd to the worktree (AD-3),
 * independent of this shell cwd.
 */
function buildTaskStepContext(
  config: LoopyConfig,
  task: Task,
  step: StepConfig,
  runtime: ScopeRuntime,
  deps: OrchestratorDeps,
  session: AgentSession,
): StepContext {
  const scope = createScope(buildScopeVars(config, task, runtime));
  return {
    config,
    flags: deps.flags,
    task,
    iteration: runtime.iteration,
    attempt: runtime.attempt,
    worktreePath: deps.root,
    step,
    resolve: createResolver(scope, { stepId: step.id }),
    session,
    git: deps.git ?? notWiredGit,
    checks: deps.checks,
    ui: deps.ui,
    logger: deps.logger,
  };
}

// ---------------------------------------------------------------------------
// Live outer loop (T-010) — per-task pipeline
// ---------------------------------------------------------------------------

export type { PipelineOutcome };

/** Internal result from `runTaskPipeline` — outcome + collected metrics. */
interface PipelineRunResult {
  readonly outcome: PipelineOutcome;
  readonly taskMetrics: TaskMetrics;
}

/**
 * Run one task's pipeline via a **program counter (PC)** over
 * `stepIndex: Map<id, index>` (T-006). On each PC entry: increment
 * `visits[id]`; if `visits[id] > max_step_visits` → terminal escalate without
 * executing (fail-closed, respects `policies.escalation`). Execute the step;
 * on success → `on_success.goto ? stepIndex[goto] : PC+1`; on failure →
 * `on_fail: {goto}` ? `stepIndex[goto]` : escalate. PC past the last step
 * → terminal success. At any terminal, unexecuted `always` steps run in
 * declaration order, linearly (no PC/goto in teardown), respecting
 * `keep_worktree`. On `on_fail: {goto}`, the checks report is seeded from
 * `result.report?.text ?? result.output` (OQ-8 feedback carry).
 *
 * Errors are values (AD-5): interpreters return `ok:false` for expected
 * failures; only genuine faults throw and propagate to the caller.
 */
async function runTaskPipeline(
  config: LoopyConfig,
  task: Task,
  iteration: number,
  deps: OrchestratorDeps,
  resumePoint?: ResumePoint,
): Promise<PipelineRunResult> {
  const { pipeline, stop_conditions, policies } = config;
  const maxStepVisits = stop_conditions.max_step_visits;
  const worktreePath = worktreePathFor(config, task);
  const clock = deps.now ?? Date.now;

  // --- Sample accumulator (C-0005 T-004) ---
  const stepSamples = new Map<string, { type: StepType; samples: Sample[] }>();
  let lastCost: StepCost | null = null;
  const recordSample = (stepId: string, type: StepType, sample: Sample): void => {
    let entry = stepSamples.get(stepId);
    if (!entry) {
      entry = { type, samples: [] };
      stepSamples.set(stepId, entry);
    }
    entry.samples.push(sample);
    if (sample.cost !== null) lastCost = sample.cost;
  };

  // On a failed task, `keep_worktree` preserves the worktree for inspection —
  // which means the teardown (`always`) steps that would remove it must be
  // suppressed. Read once; it is config-driven, not engine policy (AD-1).
  const keepWorktree = policies.escalation.keep_worktree;

  // One ACP session per task (AD-3), bound to the worktree's absolute cwd and
  // opened lazily on the first agent step's use (after `create-worktree`). The
  // same instance is shared by every step of this task.
  const { sessionProvider } = deps;
  const session: AgentSession =
    sessionProvider !== undefined
      ? createLazySession(() =>
          sessionProvider(resolve(deps.root, worktreePath)),
        )
      : (deps.session ?? notWiredSession);

  /** Execute a step, measure duration, and record a Sample in one shot. */
  const timedExecute = async (
    interpreter: { execute(ctx: StepContext): Promise<StepResult> },
    ctx: StepContext,
  ): Promise<StepResult> => {
    const t0 = clock();
    const result = await interpreter.execute(ctx);
    recordSample(ctx.step.id, ctx.step.type, {
      durationMs: clock() - t0,
      usage: session.drainUsage(),
      cost: session.readCost(),
    });
    return result;
  };

  // Step index: Map<id, index> for O(1) goto resolution.
  const stepIndex = new Map<string, number>();
  for (let i = 0; i < pipeline.length; i++) {
    stepIndex.set(pipeline[i]!.id, i);
  }

  // Per-step visit counters (entry guard for max_step_visits).
  const visits: Record<string, number> = {};
  // Track which steps have executed (for always/teardown).
  const executedSteps = new Set<string>();
  let checksReport = "";

  // --- Program counter loop ---
  type Terminal =
    | { readonly ok: true }
    | {
        readonly ok: false;
        readonly failedStepId: string;
        readonly reason?: string;
        readonly visitExceeded?: PipelineOutcome["visitExceeded"];
      };
  let pc = 0;
  let terminal: Terminal | undefined;

  // Resume: restore PC position, visit counters, and carry from checkpoint.
  if (resumePoint) {
    const resumeIdx = stepIndex.get(resumePoint.pc);
    if (resumeIdx !== undefined) {
      pc = resumeIdx;
      Object.assign(visits, resumePoint.visits);
      checksReport = resumePoint.checksReport;
      deps.logger.info(
        `[orchestrator] resume: retomando de step "${resumePoint.pc}"`,
      );
    }
  }

  while (pc < pipeline.length) {
    const step = pipeline[pc]!;

    // Entry guard: increment visits; exceed → terminal escalate WITHOUT executing.
    visits[step.id] = (visits[step.id] ?? 0) + 1;
    if (visits[step.id]! > maxStepVisits) {
      const reason = `step "${step.id}" excedeu max_step_visits (${maxStepVisits})`;
      deps.logger.error(`[orchestrator] ${reason} — escalando`);
      // Save progress for resume (PC stays at this step).
      deps.checkpoint?.saveProgress(task.id, step.id, visits, checksReport);
      terminal = {
        ok: false,
        failedStepId: step.id,
        reason,
        visitExceeded: { stepId: step.id, visits: visits[step.id]! - 1 },
      };
      break;
    }

    // No interpreter → logged no-op, advance PC (AD-2).
    const interpreter = deps.registry.get(step.type);
    if (interpreter === undefined) {
      deps.logger.info(
        `[orchestrator] step "${step.id}" (type "${step.type}") sem intérprete registrado — pulado`,
      );
      executedSteps.add(step.id);
      pc += 1;
      continue;
    }

    // Build context and execute.
    const ctx = buildTaskStepContext(
      config,
      task,
      step,
      {
        iteration,
        attempt: FIRST_ATTEMPT,
        worktreePath,
        diff: "",
        checksReport,
      },
      deps,
      session,
    );
    const result: StepResult = await timedExecute(interpreter, ctx);
    executedSteps.add(step.id);

    if (result.ok) {
      // Thread checks report (normal flow — only from result.report).
      if (result.report !== undefined) checksReport = result.report.text;
      deps.logger.debug(`[orchestrator] step "${step.id}" ok`);

      // Resolve next PC: on_success goto or sequential.
      const nextPc = step.on_success
        ? (stepIndex.get(step.on_success.goto) ?? pc + 1)
        : pc + 1;

      // Save progress for resume (next step to execute).
      const nextStep = pipeline[nextPc];
      if (nextStep !== undefined) {
        deps.checkpoint?.saveProgress(task.id, nextStep.id, visits, checksReport);
      }

      pc = nextPc;
      continue;
    }

    // Step failed.
    deps.logger.error(
      `[orchestrator] step "${step.id}" falhou: ${result.reason ?? "(sem motivo)"}`,
    );

    const onFail = step.on_fail;
    if (onFail !== undefined && typeof onFail === "object") {
      // on_fail: { goto } — jump to target; thread feedback carry (OQ-8).
      // output-as-report only on goto jump; normal flow uses result.report only.
      checksReport = result.report?.text ?? result.output ?? "";
      const targetIdx = stepIndex.get(onFail.goto);
      if (targetIdx !== undefined) {
        // Save progress for resume (goto target + carry).
        deps.checkpoint?.saveProgress(task.id, pipeline[targetIdx]!.id, visits, checksReport);
        pc = targetIdx;
        continue;
      }
    }

    // escalate: explicit "escalate", omitted on_fail, or orphan goto target.
    // Save progress for resume (PC stays at this step).
    deps.checkpoint?.saveProgress(task.id, step.id, visits, checksReport);
    terminal = { ok: false, failedStepId: step.id, reason: result.reason };
    break;
  }

  // PC past last step → terminal success.
  terminal ??= { ok: true };

  // --- Teardown: run unexecuted always steps (best-effort, linear, no PC/goto). ---
  // Suppressed when escalation + keep_worktree (worktree preserved for inspection).
  if (terminal.ok || !keepWorktree) {
    for (const step of pipeline) {
      if (!(step.always ?? false)) continue;
      if (executedSteps.has(step.id)) continue;

      const interpreter = deps.registry.get(step.type);
      if (interpreter === undefined) continue;

      try {
        const ctx = buildTaskStepContext(
          config,
          task,
          step,
          {
            iteration,
            attempt: FIRST_ATTEMPT,
            worktreePath,
            diff: "",
            checksReport,
          },
          deps,
          session,
        );
        const result = await timedExecute(interpreter, ctx);
        executedSteps.add(step.id);

        if (result.ok) {
          deps.logger.debug(`[orchestrator] teardown step "${step.id}" ok`);
        } else {
          deps.logger.error(
            `[orchestrator] teardown step "${step.id}" falhou: ${result.reason ?? "(sem motivo)"}`,
          );
        }
      } catch (err) {
        deps.logger.error(
          `[orchestrator] teardown step "${step.id}" lançou exceção: ${err}`,
        );
      }
    }
  }

  // --- Build TaskMetrics from accumulated samples (C-0005 T-004) ---
  const steps: Record<string, StepMetrics> = {};
  for (const [stepId, { type, samples }] of stepSamples) {
    steps[stepId] = foldSamples(type, samples);
  }
  const taskMetrics: TaskMetrics = { steps, cost: lastCost };

  return { outcome: terminal, taskMetrics };
}

// ---------------------------------------------------------------------------
// Live outer loop (T-010) — escalation + the loop itself
// ---------------------------------------------------------------------------

/** What the outer loop does after an escalation. */
export type EscalationDecision = "continue" | "stop";

/**
 * Map an escalation `action` to an outer-loop decision: `skip_task` moves on to
 * the next task; `pause` and `abort_loop` halt the loop. (T-018 fleshes out the
 * fuller semantics: `keep_worktree` preservation, `notify` targets, and a
 * genuinely resumable `pause` vs. a hard `abort`.)
 */
export function decideEscalation(action: EscalationAction): EscalationDecision {
  return action === "skip_task" ? "continue" : "stop";
}

/** Why {@link runLoop} stopped iterating. */
export type LoopStopReason =
  | "backlog_empty"
  | "max_iterations"
  | "stop_signal"
  | "dirty_parent"
  | "escalation_pause"
  | "escalation_abort";

/** Summary of a {@link runLoop} run. */
export interface RunLoopResult {
  /** Ids of tasks whose pipeline succeeded and were marked `- [x]`, in order. */
  readonly completed: readonly string[];
  /** Ids of tasks that failed and escalated (never marked done), in order. */
  readonly escalated: readonly string[];
  /** Ids of tasks paused (resumable) by escalation, in order. Populated by T-006. */
  readonly paused: readonly string[];
  /** Ids of tasks skipped (transitively or by policy), in order. Populated by T-006. */
  readonly skipped: readonly string[];
  /** How many tasks the outer loop actually started. */
  readonly iterations: number;
  /** Which stop condition ended the loop. */
  readonly stoppedBy: LoopStopReason;
  /** Per-task metrics collected during this run (timing + usage + cost). */
  readonly metrics: RunMetrics;
  /** ISO timestamp of when the run started. */
  readonly startedAt: string;
  /** ISO timestamp of when the run finished. */
  readonly finishedAt: string;
}

/**
 * Mark a task done inside the parent mutex (T-004). Acquires the mutex (when
 * present), re-evaluates `require_clean_parent` inside the critical section,
 * then calls `markDone`. Returns `"dirty_parent"` to signal the loop should
 * halt, or `"ok"` on success.
 */
async function markDoneWithMutex(
  taskId: string,
  config: LoopyConfig,
  deps: OrchestratorDeps,
  requireCleanParent: boolean,
): Promise<"ok" | "dirty_parent"> {
  return guarded(deps.parentMutex, async () => {
    // `require_clean_parent` evaluated INSIDE the mutex (T-004): serialized
    // with merges so no TOCTOU between the check and the commit.
    if (
      requireCleanParent &&
      deps.git !== undefined &&
      !(await deps.git.isParentClean())
    ) {
      const message =
        `[require_clean_parent] parent "${config.workspace.parent_branch}" está sujo — ` +
        `interrompendo antes do mark-done de ${taskId} (commite ou limpe o working tree)`;
      deps.logger.error(message);
      deps.notify?.(message);
      return "dirty_parent";
    }
    await deps.markDone.markDone(taskId);
    return "ok";
  });
}

/**
 * The live outer loop (T-010 + T-005 pool). Builds the task DAG at load time
 * (fail-fast on orphan deps or cycles), then runs tasks through a pool of size
 * `concurrency`. Tasks whose deps are all `done` are promoted to "ready";
 * ready tasks fill the pool up to `concurrency` (tie-broken by backlog order).
 * On each task completion (`Promise.race`), the ready set is re-evaluated.
 *
 * `${iteration}` is the stable 1-based backlog index (identical to dry-run,
 * AD-4). `max_iterations` is a separate counter of "tasks actually started"
 * (skipped tasks do not count).
 *
 * With `concurrency: 1` and no `Deps:`, the loop is byte-identical to the
 * previous sequential `for...of` (backlog order, no reordering).
 *
 * Mechanics only (AD-1): order, `always`, escalation actions and stop thresholds
 * all come from `config`. This function encodes none of them as policy.
 */
export async function runLoop(
  config: LoopyConfig,
  tasks: readonly Task[],
  deps: OrchestratorDeps,
): Promise<RunLoopResult> {
  const clock = deps.now ?? Date.now;
  const startedAt = new Date(clock()).toISOString();
  const completed: string[] = [];
  const escalated: string[] = [];
  const skipped: string[] = [];
  const tasksMetrics: Record<string, TaskMetrics> = {};
  // `--concurrency N` overrides yml; `--max-iterations N` overrides yml ceiling.
  const concurrency =
    deps.flags.concurrency ?? config.concurrency;
  const maxIterations =
    deps.flags.maxIterations ?? config.stop_conditions.max_iterations;
  const stopSignalPath = join(
    deps.root,
    config.stop_conditions.stop_signal_file,
  );
  const requireCleanParent = config.policies.git.require_clean_parent;
  let tasksStarted = 0;

  const finish = (stoppedBy: LoopStopReason): RunLoopResult => {
    const finishedAt = new Date(clock()).toISOString();
    return {
      completed,
      escalated,
      paused: [],
      skipped,
      iterations: tasksStarted,
      stoppedBy,
      metrics: {
        index: 0,
        startedAt,
        finishedAt,
        stoppedBy,
        tasks: tasksMetrics,
      },
      startedAt,
      finishedAt,
    };
  };

  // --- DAG construction (fail-fast before any task runs) ---
  const graphResult = buildGraph(tasks);
  if (!graphResult.ok) {
    throw new Error(`[orchestrator] ${graphResult.error}`);
  }
  const graph: TaskGraph = graphResult.value;

  // Stable iteration index per task (1-based position in the backlog, AD-4).
  const iterationIndex = new Map<string, number>();
  for (let i = 0; i < tasks.length; i++) {
    iterationIndex.set(tasks[i]!.id, i + 1);
  }

  // Task lookup by id.
  const taskById = new Map<string, Task>();
  for (const t of tasks) taskById.set(t.id, t);

  // --- Resume reconciliation (C-0002 / C-0004 PC-based) ---
  const { checkpoint } = deps;
  let resumeMap: Map<string, ResumePoint> | undefined;
  if (checkpoint) {
    const pipelineHash = pipelineFingerprint(config.pipeline);
    const knownIds = deps.knownTaskIds ?? tasks.map((t) => t.id);
    const knownSet = new Set(knownIds);
    const stateBefore = checkpoint.read();
    for (const taskId of Object.keys(stateBefore.tasks)) {
      if (!knownSet.has(taskId)) {
        deps.logger.info(
          `[orchestrator] resume: checkpoint órfão "${taskId}" podado (task ausente do backlog)`,
        );
      }
    }
    checkpoint.pruneOrphans(knownIds);

    const state = checkpoint.read();
    const allowAborted = deps.flags.task !== undefined;
    resumeMap = new Map();
    for (const task of tasks) {
      const cp = state.tasks[task.id];
      if (cp !== undefined && cp.pipelineHash !== pipelineHash) {
        deps.logger.info(
          `[orchestrator] resume: pipeline mudou desde o checkpoint de ${task.id} — recomeçando`,
        );
      }
      const point = resumeStateFor(state, task.id, pipelineHash, { allowAborted });
      if (point) {
        resumeMap.set(task.id, point);
      }
    }
  }

  // All tasks start as "blocked"; readySet evaluates deps dynamically.
  const status = new Map<string, SchedulerTaskStatus>(
    tasks.map((t) => [t.id, "blocked"]),
  );

  // --- Pool loop ---
  /** Signal returned by each task's promise: settled task id + optional stop. */
  type TaskSignal = { readonly taskId: string; readonly stop?: LoopStopReason };
  const inFlight = new Map<string, Promise<TaskSignal>>();

  /** Check top-level stop conditions (stop signal, dirty parent). */
  const checkStopConditions = async (): Promise<LoopStopReason | null> => {
    if (existsSync(stopSignalPath)) {
      deps.logger.info(
        `[orchestrator] stop-signal "${config.stop_conditions.stop_signal_file}" presente — encerrando`,
      );
      return "stop_signal";
    }
    // `require_clean_parent` as best-effort hint before launching; authoritative
    // check lives inside markDoneWithMutex (T-004).
    if (
      requireCleanParent &&
      deps.git !== undefined &&
      !(await deps.git.isParentClean())
    ) {
      const message =
        `[require_clean_parent] parent "${config.workspace.parent_branch}" está sujo — ` +
        `interrompendo (commite ou limpe o working tree)`;
      deps.logger.error(message);
      deps.notify?.(message);
      return "dirty_parent";
    }
    return null;
  };

  /** Launch one task pipeline; the promise resolves to a structured signal. */
  const launchTask = (task: Task): void => {
    const iteration = iterationIndex.get(task.id)!;
    tasksStarted += 1;
    deps.logger.info(
      `[orchestrator] iteração ${iteration}: task ${task.id} — ${task.title}`,
    );
    status.set(task.id, "running");
    checkpoint?.setStatus(task.id, "running");
    const resumePoint = resumeMap?.get(task.id);

    const promise = (async (): Promise<TaskSignal> => {
      const { outcome, taskMetrics } = await runTaskPipeline(
        config,
        task,
        iteration,
        deps,
        resumePoint,
      );
      tasksMetrics[task.id] = taskMetrics;

      if (outcome.ok) {
        const markDoneResult = await markDoneWithMutex(
          task.id,
          config,
          deps,
          requireCleanParent,
        );
        if (markDoneResult === "dirty_parent") {
          status.set(task.id, "done");
          return { taskId: task.id, stop: "dirty_parent" };
        }
        checkpoint?.clearTask(task.id);
        completed.push(task.id);
        status.set(task.id, "done");
        deps.logger.info(
          `[orchestrator] task ${task.id} concluída e marcada [x]`,
        );
        return { taskId: task.id };
      }

      // Persistent failure → escalation.
      escalated.push(task.id);
      status.set(task.id, "escalated");
      const policy = config.policies.escalation;
      const keep = policy.keep_worktree ? " (keep_worktree)" : "";
      const message =
        `[escalonamento] task ${task.id} falhou no step "${outcome.failedStepId}": ` +
        `${outcome.reason ?? "(sem motivo)"} → ação "${policy.action}"${keep}`;
      deps.logger.error(message);
      if (policy.notify) deps.notify?.(message);

      if (decideEscalation(policy.action) === "stop") {
        checkpoint?.setStatus(
          task.id,
          policy.action === "abort_loop" ? "aborted" : "paused",
        );
        const stop: LoopStopReason = policy.action === "abort_loop"
          ? "escalation_abort"
          : "escalation_pause";
        return { taskId: task.id, stop };
      }
      // skip_task → mark descendants as skipped, clear checkpoint.
      checkpoint?.clearTask(task.id);
      for (const descId of skipDescendants(graph, task.id)) {
        if (status.get(descId) === "blocked") {
          status.set(descId, "skipped");
          skipped.push(descId);
          deps.logger.info(
            `[orchestrator] task ${descId} pulada (dependência ${task.id} falhou)`,
          );
        }
      }
      return { taskId: task.id };
    })();

    inFlight.set(task.id, promise);
  };

  // --- Main scheduling loop ---
  let stopReason: LoopStopReason | null = null;

  while (true) {
    // Fill pool with ready tasks up to concurrency.
    if (stopReason === null) {
      const ready = readySet(graph, status);
      for (const taskId of ready) {
        if (inFlight.size >= concurrency) break;
        if (tasksStarted >= maxIterations) {
          deps.logger.info(
            `[orchestrator] max_iterations (${maxIterations}) atingido — encerrando`,
          );
          stopReason = "max_iterations";
          break;
        }
        const stop = await checkStopConditions();
        if (stop !== null) {
          stopReason = stop;
          break;
        }
        const task = taskById.get(taskId)!;
        launchTask(task);
      }
    }

    // If nothing in flight, we're done.
    if (inFlight.size === 0) break;

    // Wait for the next task to complete.
    const { taskId: settledId, stop } = await Promise.race(inFlight.values());
    inFlight.delete(settledId);
    if (stop) stopReason = stop;
  }

  return finish(stopReason ?? "backlog_empty");
}
