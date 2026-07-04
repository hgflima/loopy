/**
 * Core type contracts for `loopy` — the config-driven agentic loop engine.
 *
 * This module is the foundation every other module depends on (see
 * `tasks/plan.md` Dependency Graph). It is intentionally declaration-only
 * (no runtime code): its correctness is proven by `tsc --noEmit`, and it is
 * the frozen contract (`Step` / `StepContext` / `StepResult`, AD-2/AD-4/AD-5)
 * that unblocks the step interpreters to be built in parallel.
 *
 * Invariant (AD-1): these types describe the *shape* the engine interprets.
 * The engine hardcodes no loop behavior — content (prompts, commands, mode,
 * order, how many steps) always comes from `loopy.yml`.
 *
 * NOTE: the config-facing types below mirror the example `loopy.yml`. The
 * authoritative runtime validator (zod) lands in `config/schema.ts` (T-002);
 * the inferred schema type is expected to be structurally compatible with
 * `LoopyConfig` here.
 */

// ---------------------------------------------------------------------------
// Backlog
// ---------------------------------------------------------------------------

/** A single unit of work parsed from `todo.md` (`- [ ] T-NNN: title` + body). */
export interface Task {
  /** Stable id extracted via `task_id_pattern`, e.g. `"T-001"`. */
  readonly id: string;
  /** URL/branch-safe slug derived from the title. */
  readonly slug: string;
  /** Human title after the id, e.g. `"Scaffold do projeto + types.ts"`. */
  readonly title: string;
  /** Indented block beneath the checkbox (`${task.body}`); `""` when absent. */
  readonly body: string;
  /** Branch name for the task's worktree (`${task.branch}`). */
  readonly branch: string;
  /** `true` when the checkbox is already `- [x]`. */
  readonly done: boolean;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** Result of running a single named check command. */
export interface CheckResult {
  readonly name: string;
  readonly command: string;
  readonly exitCode: number;
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

/**
 * Aggregated outcome of a named checks list (runs all, no fail-fast).
 * `text` is the truncated, human-readable rendering fed to the agent as
 * `${checks.report}` (truncation strategy: OQ4, implemented in T-006).
 */
export interface ChecksReport {
  /** `true` only when every check passed. */
  readonly ok: boolean;
  readonly results: readonly CheckResult[];
  /** Aggregated + truncated report text (`${checks.report}`). */
  readonly text: string;
}

// ---------------------------------------------------------------------------
// Step results (AD-5 — errors as values at step boundaries)
// ---------------------------------------------------------------------------

/**
 * Outcome of interpreting one pipeline step. The orchestrator never relies on
 * exceptions for normal flow: it decides continuation from `ok` plus the
 * step's `always` / `on_fail` config.
 */
export interface StepResult {
  /** Whether the step succeeded. */
  readonly ok: boolean;
  /** Human-readable failure reason (pt-BR ok), set when `ok` is `false`. */
  readonly reason?: string;
  /** Checks output when the step ran checks (feeds `${checks.report}`). */
  readonly report?: ChecksReport;
  /** Free-form textual output (e.g. an agent turn's text / verdict line). */
  readonly output?: string;
}

// ---------------------------------------------------------------------------
// Step configuration — the 4 typed primitives (AD-1)
// ---------------------------------------------------------------------------

/** ACP autonomy mode applied via `session/set_mode`. Open-ended by design. */
export type AgentMode =
  "acceptEdits" | "plan" | "bypassPermissions" | "default" | (string & {});

/** Target of a goto jump — `id` must reference an existing pipeline step. */
export type GotoAction = { readonly goto: string };

/** What a step signals on failure; resolved to a policy by the orchestrator. */
export type OnFailAction = "escalate" | GotoAction;

/** What a step signals on success when overriding sequential flow. */
export type OnSuccessAction = GotoAction;

/** Inner-loop config of an `agent` step: `prompt -> checks -> retry`. */
export interface VerifyConfig {
  /** Name of a list under `checks:` to run after each prompt. */
  readonly run: string;
  /** Max prompt/verify attempts before applying the step's `on_fail`. */
  readonly max_attempts: number;
}

/** Fields shared by every pipeline step. */
export interface StepBase {
  readonly id: string;
  /** Runs even if a previous step failed (e.g. `cleanup`). Default `false`. */
  readonly always?: boolean;
  /** Override sequential flow on success: jump to the target step. */
  readonly on_success?: OnSuccessAction;
}

/** `agent` — one ACP agent turn (with optional inner verify loop + verdict). */
export interface AgentStep extends StepBase {
  readonly type: "agent";
  readonly prompt: string;
  readonly retry_prompt?: string;
  readonly mode?: AgentMode;
  /** `/clear` before the prompt (fresh context). Default `true`. */
  readonly clear_context?: boolean;
  readonly verify?: VerifyConfig;
  /** Verdict gate, e.g. `"AUDIT: PASS"`; blocks continuation if unmet. */
  readonly expect?: string;
  readonly on_fail?: OnFailAction;
}

/** `shell` — external commands via execa, in order. */
export interface ShellStep extends StepBase {
  readonly type: "shell";
  readonly run: readonly string[];
  readonly on_fail?: OnFailAction;
}

/** `checks` — runs a named list from `checks:` standalone. */
export interface ChecksStep extends StepBase {
  readonly type: "checks";
  /** Name of a list under `checks:`. */
  readonly run: string;
  readonly on_fail?: OnFailAction;
}

/** `approval` — human gate + action + on_fail handling. */
export interface ApprovalStep extends StepBase {
  readonly type: "approval";
  readonly prompt: string;
  readonly run?: readonly string[];
  readonly on_fail?: OnFailAction;
}

/** Discriminated union of the 4 step primitives (discriminant: `type`). */
export type StepConfig = AgentStep | ShellStep | ChecksStep | ApprovalStep;

/** The `type` tag of a step primitive. */
export type StepType = StepConfig["type"];

// ---------------------------------------------------------------------------
// Top-level `loopy.yml` config
// ---------------------------------------------------------------------------

export interface WorkspaceConfig {
  readonly root: string;
  /** Merge destination branch. */
  readonly parent_branch: string;
  readonly worktrees_dir: string;
}

/** How the client answers `session/request_permission`. */
export type PermissionOnRequest = "allow" | "policy";

export interface AcpPermissionsConfig {
  /** Default session mode; each `agent` step may override with `mode:`. */
  readonly default_mode: AgentMode;
  readonly on_request: PermissionOnRequest;
}

/** Mechanics of the ACP subprocess (not the loop; how the engine talks ACP). */
export interface AcpConfig {
  readonly command: readonly string[];
  readonly request_timeout_seconds: number;
  readonly permissions: AcpPermissionsConfig;
}

/** How `${task.body}` is extracted from `todo.md`. */
export type BacklogBodyMode = "indented";

export interface BacklogConfig {
  readonly pending_marker: string;
  readonly done_marker: string;
  /** Regex source used to extract the task id (e.g. `"T-\\d+"`). */
  readonly task_id_pattern: string;
  readonly body: BacklogBodyMode;
  readonly mark_done_on_success: boolean;
}

export interface InputsConfig {
  readonly spec: string;
  readonly plan: string;
  readonly todo: string;
  readonly backlog: BacklogConfig;
}

/** A single named check command. */
export interface CheckCommand {
  readonly name: string;
  readonly run: string;
}

/** Reusable named checks lists (e.g. `ci: [...]`). */
export type ChecksConfig = Readonly<Record<string, readonly CheckCommand[]>>;

export interface StopConditions {
  readonly max_iterations: number;
  /** Max executions per step per task; exceeded → escalate (fail-closed). */
  readonly max_step_visits: number;
  readonly stop_signal_file: string;
}

/** Escalation policy action when a step fails persistently or audit fails. */
export type EscalationAction = "pause" | "skip_task" | "abort_loop";

export interface EscalationPolicy {
  readonly action: EscalationAction;
  /** Preserve the worktree for inspection on escalation. */
  readonly keep_worktree: boolean;
  readonly notify: string;
}

export interface GitPolicy {
  /** Abort the next task if the parent branch is dirty at its start. */
  readonly require_clean_parent: boolean;
}

export interface Policies {
  readonly escalation: EscalationPolicy;
  readonly git: GitPolicy;
}

export interface LoggingConfig {
  readonly dir: string;
  readonly per_task: boolean;
  readonly capture_acp_traffic: boolean;
}

/** The fully-validated `loopy.yml` (defaults applied) — produced by T-002. */
export interface LoopyConfig {
  readonly version: string;
  readonly name: string;
  readonly workspace: WorkspaceConfig;
  readonly acp: AcpConfig;
  readonly inputs: InputsConfig;
  readonly checks: ChecksConfig;
  /** Ordered pipeline of typed step primitives. */
  readonly pipeline: readonly StepConfig[];
  readonly stop_conditions: StopConditions;
  readonly concurrency: number;
  readonly policies: Policies;
  readonly logging: LoggingConfig;
}

// ---------------------------------------------------------------------------
// Pipeline outcome (used by the orchestrator's outer loop)
// ---------------------------------------------------------------------------

/** Outcome of interpreting one task's whole pipeline. */
export interface PipelineOutcome {
  /** `true` only when every step that ran succeeded. */
  readonly ok: boolean;
  /** Id of the first step that failed (drives escalation attribution). */
  readonly failedStepId?: string;
  /** The first failure's reason. */
  readonly reason?: string;
  /** Set when escalation was triggered by max_step_visits exceeded. */
  readonly visitExceeded?: {
    readonly stepId: string;
    readonly visits: number;
  };
}

// ---------------------------------------------------------------------------
// Resume — step-level checkpoint state (C-0002)
// ---------------------------------------------------------------------------

/** Lifecycle status of a task's checkpoint. */
export type TaskStatus = "running" | "paused" | "aborted";

/** Persisted progress of a single task within a run. */
export interface TaskCheckpoint {
  readonly pipelineHash: string;
  readonly completedSteps: readonly string[];
  readonly status: TaskStatus;
}

/** Top-level resume state persisted to `.loopy/state.json`. */
export interface RunState {
  readonly version: 1;
  readonly tasks: Readonly<Record<string, TaskCheckpoint>>;
}

/** Port for checkpoint I/O — keeps the orchestrator testable without disk. */
export interface CheckpointPort {
  read(): RunState;
  recordStep(taskId: string, stepId: string): void;
  setStatus(taskId: string, status: TaskStatus): void;
  clearTask(taskId: string): void;
  pruneOrphans(knownTaskIds: readonly string[]): void;
}

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

/** Parsed CLI flags (see `index.ts`), passed through to `StepContext`. */
export interface RunFlags {
  /** Alternate `loopy.yml` path. */
  readonly config?: string;
  /** Plan + print the resolved pipeline, no writes/commit/merge. */
  readonly dryRun: boolean;
  /** Run only this task id (escape hatch, OQ6). */
  readonly task?: string;
  /** Override the outer-loop iteration ceiling. */
  readonly maxIterations?: number;
  /** Auto-approve `approval` gates (non-interactive / CI). */
  readonly yes: boolean;
  /** `false` when `--no-tui` or no TTY (line-log fallback). */
  readonly tui: boolean;
  /** Include ACP traffic in logs. */
  readonly verbose: boolean;
  /** `--clean [T-XXX]`: teardown worktree+branch+checkpoint and exit. */
  readonly clean?: string | boolean;
}

// ---------------------------------------------------------------------------
// Ports — external effects a step may reach for (AD-4 handles).
//
// These are minimal transport-agnostic contracts. Each is fleshed out by its
// implementing task (git T-007, checks T-006, session T-011/T-012, approval
// T-009, logging T-016); being structural TS interfaces, they extend with
// minimal churn.
// ---------------------------------------------------------------------------

/** ACP `stopReason` returned by a prompt turn. */
export type StopReason =
  "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled";

/** One ACP session bound to a task's worktree (cwd is immutable per session). */
export interface AgentSession {
  readonly sessionId: string;
  /** Apply a mode via `session/set_mode` (e.g. `plan`/`acceptEdits`). */
  setMode(modeId: string): Promise<void>;
  /** Send `/clear` (resets context, keeps the same `sessionId`). */
  clear(): Promise<void>;
  /** Send a prompt; resolves with the ACP `stopReason`. */
  prompt(text: string): Promise<StopReason>;
  /** Turn-scoped agent text (buffered per prompt, OQ3). */
  readText(): string;
  /** Cancel the current turn (`session/cancel`). */
  cancel(): Promise<void>;
}

/** Result of a merge attempt. */
export interface MergeResult {
  readonly ok: boolean;
  /** `true` when the merge hit a conflict (and was aborted). */
  readonly conflict: boolean;
}

/** Git worktree + merge operations on the workspace. */
export interface GitPort {
  addWorktree(
    path: string,
    branch: string,
    parentBranch: string,
  ): Promise<void>;
  removeWorktree(
    path: string,
    opts?: { readonly force?: boolean },
  ): Promise<void>;
  merge(
    branch: string,
    opts?: { readonly noFf?: boolean; readonly message?: string },
  ): Promise<MergeResult>;
  /** `true` when the parent branch working tree is clean. */
  isParentClean(): Promise<boolean>;
}

/** Runs check commands and aggregates a `ChecksReport`. */
export interface ChecksRunnerPort {
  run(
    checks: readonly CheckCommand[],
    opts: { readonly cwd: string },
  ): Promise<ChecksReport>;
}

/** Human interaction gate (OQ2) — TUI / readline / `--yes` all satisfy it. */
export interface UiPort {
  /** Resolve `true` to approve, `false` to reject. */
  requestApproval(prompt: string): Promise<boolean>;
}

/** Per-task structured logger. */
export interface LoggerPort {
  info(message: string): void;
  debug(message: string): void;
  error(message: string): void;
}

// ---------------------------------------------------------------------------
// Step execution contract (AD-2 / AD-4)
// ---------------------------------------------------------------------------

/**
 * Everything a step interpreter needs to run (AD-4). Interpolation is resolved
 * once per task/attempt via `resolve`; the current step's config is `step`.
 */
export interface StepContext {
  readonly config: LoopyConfig;
  readonly flags: RunFlags;
  readonly task: Task;
  /** Outer-loop iteration index (`${iteration}`). */
  readonly iteration: number;
  /** Inner-loop attempt index (`${attempt}`). */
  readonly attempt: number;
  /** Absolute path of the task's worktree (cwd for shell/checks/session). */
  readonly worktreePath: string;
  /** The config of the step currently executing. */
  readonly step: StepConfig;
  /**
   * Resolve `${...}` templates against the current scope. Unknown keys abort
   * with a clear error (OQ1); known-but-empty keys render empty.
   */
  resolve(template: string): string;
  readonly session: AgentSession;
  readonly git: GitPort;
  readonly checks: ChecksRunnerPort;
  readonly ui: UiPort;
  readonly logger: LoggerPort;
}

/**
 * A step primitive interpreter (AD-2). One interpreter per `type`, registered
 * in a `type -> interpreter` registry; the orchestrator stays agnostic to the
 * concrete type and reads `ctx.step` for this step's config.
 */
export interface Step {
  readonly type: StepType;
  execute(ctx: StepContext): Promise<StepResult>;
}
