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
import { join, resolve } from "node:path";
import { markDoneInFile, type BacklogOptions } from "../backlog/todo";
import {
  createResolver,
  createScope,
  selectPrompt,
  type ScopeVars,
} from "../interp/resolver";
import {
  clearTaskIn,
  completedStepsFor,
  loadState,
  pipelineFingerprint,
  pruneOrphansIn,
  recordStepIn,
  saveState,
  setStatusIn,
} from "../resume/state";
import type { StepRegistry } from "../steps/index";
import type {
  AgentSession,
  CheckpointPort,
  ChecksRunnerPort,
  EscalationAction,
  GitPort,
  LoggerPort,
  LoopyConfig,
  OnFailAction,
  RunFlags,
  StepConfig,
  StepContext,
  StepResult,
  StepType,
  Task,
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
const formatOnFail = (a: OnFailAction): string =>
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
 * `pipelineHash` is stamped on `recordStep` / `setStatus` so the caller never
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
    recordStep(taskId, stepId) {
      state = recordStepIn(state, taskId, stepId, options.pipelineHash);
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

/** Outcome of interpreting one task's whole pipeline. */
export interface PipelineOutcome {
  /** `true` only when every step that ran succeeded. */
  readonly ok: boolean;
  /** Id of the first step that failed (drives escalation attribution). */
  readonly failedStepId?: string;
  /** The first failure's reason. */
  readonly reason?: string;
}

/**
 * Run one task's pipeline in order (T-010). A step runs when the pipeline is
 * still healthy **or** the step is `always: true` (e.g. `cleanup`); once a step
 * fails, subsequent non-`always` steps are skipped. A step whose `type` has no
 * registered interpreter (the `agent` step until T-015) is a logged no-op that
 * does not fail the pipeline. The latest `${checks.report}` is threaded forward
 * so a later step sees the most recent checks output (AD-4).
 *
 * Errors are values (AD-5): interpreters return `ok:false` for expected
 * failures; only genuine faults throw and propagate to the caller.
 */
async function runTaskPipeline(
  config: LoopyConfig,
  task: Task,
  iteration: number,
  deps: OrchestratorDeps,
  completedSteps: ReadonlySet<string> = new Set(),
): Promise<PipelineOutcome> {
  const worktreePath = worktreePathFor(config, task);
  // One ACP session per task (AD-3), bound to the worktree's absolute cwd and
  // opened lazily on the first agent step's use (after `create-worktree`). The
  // same instance is shared by every step of this task. On the non-agent spine
  // (no provider) this is the fail-loud session — never touched by shell/checks/
  // approval, so it stays a no-op there.
  const { sessionProvider } = deps;
  const session: AgentSession =
    sessionProvider !== undefined
      ? createLazySession(() =>
          sessionProvider(resolve(deps.root, worktreePath)),
        )
      : (deps.session ?? notWiredSession);
  // The first failing step (undefined while the pipeline is still healthy).
  let firstFailure:
    { readonly stepId: string; readonly reason?: string } | undefined;
  let checksReport = "";
  // On a failed task, `keep_worktree` preserves the worktree for inspection —
  // which means the teardown (`always`) steps that would remove it must be
  // suppressed. Read once; it is config-driven, not engine policy (AD-1).
  const keepWorktree = config.policies.escalation.keep_worktree;

  for (const step of config.pipeline) {
    // Resume: skip steps already completed in a prior run (before any other
    // skip logic — a completed step is never re-evaluated).
    if (completedSteps.has(step.id)) {
      deps.logger.info(
        `[orchestrator] resume: step "${step.id}" já concluído — pulado`,
      );
      continue;
    }

    const always = step.always ?? false;
    const failed = firstFailure !== undefined;
    // After a failure, skip non-`always` steps. An `always` teardown step still
    // runs — unless `keep_worktree` is on, which suppresses it too so the failed
    // worktree survives for inspection.
    if (failed && !always) {
      deps.logger.debug(
        `[orchestrator] step "${step.id}" pulado (falha anterior; não é always)`,
      );
      continue;
    }
    if (failed && keepWorktree) {
      deps.logger.debug(
        `[orchestrator] step "${step.id}" (always) pulado: keep_worktree preserva o worktree após a falha`,
      );
      continue;
    }

    const interpreter = deps.registry.get(step.type);
    if (interpreter === undefined) {
      // No interpreter for this type yet (agent → T-015). Skip, don't fail:
      // that is what keeps the non-agent spine runnable end-to-end.
      deps.logger.info(
        `[orchestrator] step "${step.id}" (type "${step.type}") sem intérprete registrado — pulado`,
      );
      continue;
    }

    const ctx = buildTaskStepContext(
      config,
      task,
      step,
      {
        iteration,
        attempt: FIRST_ATTEMPT,
        worktreePath,
        // ${worktree.diff} is populated once the agent step lands (T-014); for
        // the non-agent spine it is a known-but-empty value.
        diff: "",
        checksReport,
      },
      deps,
      session,
    );

    const result: StepResult = await interpreter.execute(ctx);
    if (result.report !== undefined) checksReport = result.report.text;

    if (result.ok) {
      deps.checkpoint?.recordStep(task.id, step.id);
      deps.logger.debug(`[orchestrator] step "${step.id}" ok`);
      continue;
    }

    firstFailure ??= { stepId: step.id, reason: result.reason };
    deps.logger.error(
      `[orchestrator] step "${step.id}" falhou: ${result.reason ?? "(sem motivo)"}`,
    );
  }

  return firstFailure === undefined
    ? { ok: true }
    : {
        ok: false,
        failedStepId: firstFailure.stepId,
        reason: firstFailure.reason,
      };
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
  /** How many tasks the outer loop actually started. */
  readonly iterations: number;
  /** Which stop condition ended the loop. */
  readonly stoppedBy: LoopStopReason;
}

/**
 * The live outer loop (T-010). Iterate `tasks` (the already-selected pending
 * list, in order) and for each: check stop conditions, run its pipeline, and
 * either mark it done (pipeline ok) or escalate (pipeline failed — the task is
 * **never** marked). Stop conditions are checked at the top of each iteration,
 * so `stop_signal_file` "encerra após a task corrente": a file created during
 * task K is seen before task K+1 starts.
 *
 * Mechanics only (AD-1): order, `always`, escalation actions and stop thresholds
 * all come from `config`. This function encodes none of them as policy.
 */
export async function runLoop(
  config: LoopyConfig,
  tasks: readonly Task[],
  deps: OrchestratorDeps,
): Promise<RunLoopResult> {
  const completed: string[] = [];
  const escalated: string[] = [];
  // `--max-iterations N` overrides the yml ceiling when provided (T-018).
  const maxIterations =
    deps.flags.maxIterations ?? config.stop_conditions.max_iterations;
  const stopSignalPath = join(
    deps.root,
    config.stop_conditions.stop_signal_file,
  );
  const requireCleanParent = config.policies.git.require_clean_parent;
  let iterations = 0;
  // Every exit returns the same accumulators; only the stop reason differs.
  const finish = (stoppedBy: LoopStopReason): RunLoopResult => ({
    completed,
    escalated,
    iterations,
    stoppedBy,
  });

  // --- Resume reconciliation (C-0002) ---
  const { checkpoint } = deps;
  let completedStepsMap: Map<string, ReadonlySet<string>> | undefined;
  if (checkpoint) {
    const pipelineHash = pipelineFingerprint(config.pipeline);
    // Prune orphan checkpoints (tasks no longer in the backlog).
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

    // Compute completedSteps per task.
    const state = checkpoint.read();
    const allowAborted = deps.flags.task !== undefined;
    completedStepsMap = new Map();
    for (const task of tasks) {
      const cp = state.tasks[task.id];
      if (cp !== undefined && cp.pipelineHash !== pipelineHash) {
        deps.logger.info(
          `[orchestrator] resume: pipeline mudou desde o checkpoint de ${task.id} — recomeçando`,
        );
      }
      completedStepsMap.set(
        task.id,
        completedStepsFor(state, task.id, pipelineHash, { allowAborted }),
      );
    }
  }

  for (const task of tasks) {
    if (existsSync(stopSignalPath)) {
      deps.logger.info(
        `[orchestrator] stop-signal "${config.stop_conditions.stop_signal_file}" presente — encerrando`,
      );
      return finish("stop_signal");
    }
    if (iterations >= maxIterations) {
      deps.logger.info(
        `[orchestrator] max_iterations (${maxIterations}) atingido — encerrando`,
      );
      return finish("max_iterations");
    }
    // `require_clean_parent`: never proceed onto a dirty parent working tree.
    // Checked before EACH task (a merge/mark-done could dirty it mid-run), and
    // only when a git handle is wired — the CLI always wires one.
    if (
      requireCleanParent &&
      deps.git !== undefined &&
      !(await deps.git.isParentClean())
    ) {
      const message =
        `[require_clean_parent] parent "${config.workspace.parent_branch}" está sujo — ` +
        `interrompendo antes da task ${task.id} (commite ou limpe o working tree)`;
      deps.logger.error(message);
      deps.notify?.(message);
      return finish("dirty_parent");
    }

    iterations += 1;
    deps.logger.info(
      `[orchestrator] iteração ${iterations}: task ${task.id} — ${task.title}`,
    );
    checkpoint?.setStatus(task.id, "running");
    const completedSteps =
      completedStepsMap?.get(task.id) ?? new Set<string>();
    const outcome = await runTaskPipeline(
      config,
      task,
      iterations,
      deps,
      completedSteps,
    );

    if (outcome.ok) {
      await deps.markDone.markDone(task.id);
      checkpoint?.clearTask(task.id);
      completed.push(task.id);
      deps.logger.info(
        `[orchestrator] task ${task.id} concluída e marcada [x]`,
      );
      continue;
    }

    // Persistent failure → escalation. The task is NOT marked done.
    escalated.push(task.id);
    const policy = config.policies.escalation;
    const keep = policy.keep_worktree ? " (keep_worktree)" : "";
    const message =
      `[escalonamento] task ${task.id} falhou no step "${outcome.failedStepId}": ` +
      `${outcome.reason ?? "(sem motivo)"} → ação "${policy.action}"${keep}`;
    deps.logger.error(message);
    // Surface to the operator per `policies.escalation.notify` (e.g. stderr).
    if (policy.notify) deps.notify?.(message);
    if (decideEscalation(policy.action) === "stop") {
      checkpoint?.setStatus(
        task.id,
        policy.action === "abort_loop" ? "aborted" : "paused",
      );
      return finish(
        policy.action === "abort_loop"
          ? "escalation_abort"
          : "escalation_pause",
      );
    }
    // skip_task → clear the checkpoint (the task is abandoned, not resumable).
    checkpoint?.clearTask(task.id);
  }

  return finish("backlog_empty");
}
