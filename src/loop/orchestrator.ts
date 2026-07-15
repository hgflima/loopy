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
import { buildGraph, readySet, resolveConcurrency, skipDescendants, topoLayers } from "../scheduler/index";
import type { ConcurrencyResolution } from "../scheduler/index";
import type { SchedulerTaskStatus, TaskGraph } from "../scheduler/types";
import {
  createResolver,
  createScope,
  selectPrompt,
  type ScopeVars,
} from "../interp/resolver";
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
import type { TelemetryDb } from "../telemetry/db";
import { createVisitRecorder, insertChange } from "../telemetry/write";
import type { StoreEvent } from "../tui/store";
import type { Mutex } from "./mutex";
import { guarded } from "./mutex";
import type {
  AgentDef,
  AgentSession,
  CheckpointPort,
  ChecksRunnerPort,
  EscalationAction,
  GitPort,
  LoggerPort,
  LoopyConfig,
  OnFailAction,
  PipelineOutcome,
  ResolvedAgents,
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
 * The telemetry `change_id` (C-0017 / D26): the `C-\d+` prefix of the change
 * dir's basename, so `task_id` (`<change_id>/<task.id>`) matches the CLI's
 * `--task C-0016/T-002`. Falls back to {@link deriveChange}'s id (the full slug
 * or `config.name`) when there is no such prefix. Pure (AD-6).
 */
export function telemetryChangeId(config: LoopyConfig): string {
  const { id } = deriveChange(config);
  return /^(C-\d+)/.exec(id)?.[1] ?? id;
}

/** The telemetry `task_id`: `<change_id>/<task.id>`, e.g. `C-0017/T-004` (D26). */
export function telemetryTaskId(config: LoopyConfig, task: Task): string {
  return `${telemetryChangeId(config)}/${task.id}`;
}

/**
 * The telemetry `change.repo` (C-0017 / D26): the basename of the `origin`
 * remote URL, with any `.git` suffix stripped (so both
 * `git@host:group/repo.git` and `https://host/group/repo.git` yield `repo`).
 * Falls back to the workspace dir's basename when there is no origin — the
 * greenfield / no-remote case. Pure (AD-6); `repo` is NOT NULL in the schema, so
 * this always returns a non-empty string.
 */
export function repoNameFrom(originUrl: string | null, root: string): string {
  if (originUrl) {
    const trimmed = originUrl.replace(/[/\\]+$/, "").replace(/\.git$/, "");
    const base = trimmed.split(/[/\\:]/).pop();
    if (base) return base;
  }
  return basename(root);
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
// Agent binding resolution (AD-6, pure — shared by orchestrator, step, dry-run)
// ---------------------------------------------------------------------------

/**
 * Resolve which agent runs a step and with what model/effort. Pure (AD-6),
 * reused by: (a) the orchestrator (session routing per step), (b) the agent
 * step interpreter (apply `setModel`/`setEffort`), (c) the dry-run planner
 * (print resolved bindings).
 *
 * Resolution: `agentName = step.agent ?? default`; `model = step.model ??
 * agentDef.model`; `effort = step.effort ?? agentDef.effort`. Non-agent steps
 * resolve to the default agent (their session is never actually used).
 */
export function resolveAgentBinding(
  step: StepConfig,
  resolvedAgents: ResolvedAgents,
): { readonly agentName: string; readonly model?: string; readonly effort?: string } {
  if (step.type !== "agent") {
    return { agentName: resolvedAgents.default };
  }
  const agentName = step.agent ?? resolvedAgents.default;
  const agentDef = resolvedAgents.byName[agentName];
  return {
    agentName,
    model: step.model ?? agentDef?.model,
    effort: step.effort ?? agentDef?.effort,
  };
}

/**
 * Resolve the human-readable label for an agent: `display_name` from the
 * registry wins; otherwise capitalize the key. Pure helper (AD-6).
 */
export function resolveAgentLabel(
  key: string,
  agentDef: AgentDef | undefined,
): string {
  if (agentDef?.display_name) return agentDef.display_name;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

type AgentLabel = { readonly agentName: string; readonly model?: string };

/**
 * Build the `{ agentName, model }` payload for `step_started` events.
 * Returns `undefined` for non-agent steps (they carry no agent metadata).
 */
function buildAgentLabel(
  step: StepConfig,
  binding: ReturnType<typeof resolveAgentBinding>,
  resolvedAgents: ResolvedAgents,
): AgentLabel | undefined {
  if (step.type !== "agent") return undefined;
  return {
    agentName: resolveAgentLabel(binding.agentName, resolvedAgents.byName[binding.agentName]),
    model: binding.model,
  };
}

// ---------------------------------------------------------------------------
// DAG helpers (shared by dry-run + live loop)
// ---------------------------------------------------------------------------

/**
 * Strip deps that are already satisfied (done tasks in `knownTaskIds` but
 * not in `tasks`). Deps referencing unknown ids are kept so `buildGraph`
 * catches them as orphans (fail-fast).
 */
function stripDoneDeps(
  tasks: readonly Task[],
  knownTaskIds?: readonly string[],
): readonly Task[] {
  const pendingIds = new Set(tasks.map((t) => t.id));
  const knownIdSet = new Set(knownTaskIds ?? tasks.map((t) => t.id));
  return tasks.map((t) => {
    const liveDeps = t.deps.filter((d) => pendingIds.has(d) || !knownIdSet.has(d));
    return liveDeps.length === t.deps.length ? t : { ...t, deps: liveDeps };
  });
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

/** The full `--dry-run` result: every task with its resolved pipeline + DAG. */
export interface DryRunPlan {
  readonly tasks: readonly ResolvedTaskPlan[];
  /** Topological layers of the DAG (each layer can run in parallel). */
  readonly layers: readonly (readonly string[])[];
  /** Effective concurrency for this run (resolved — the dry-run needs the justification). */
  readonly concurrency: ConcurrencyResolution;
  /** Predicted merge order (flattened topo layers, backlog order within). */
  readonly mergeOrder: readonly string[];
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
 *
 * `resolvedAgents` is used to show the resolved agent binding (agent/model/
 * effort) for `agent` steps in the dry-run output (T-004).
 */
function resolveStep(
  step: StepConfig,
  resolve: (template: string) => string,
  resolvedAgents: ResolvedAgents,
): ResolvedStep {
  const fields: ResolvedField[] = [];

  switch (step.type) {
    case "agent": {
      // T-004: show resolved agent binding before the step's own fields.
      const binding = resolveAgentBinding(step, resolvedAgents);
      fields.push(setting("agent", binding.agentName));
      if (binding.model) fields.push(setting("model", binding.model));
      if (binding.effort) fields.push(setting("effort", binding.effort));

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

/** Options for {@link planDryRun}. */
export interface PlanDryRunOptions {
  /** All known task ids (pending + done) for stripping already-satisfied deps. */
  readonly knownTaskIds?: readonly string[];
  /** Override concurrency (`flags.concurrency ?? config.concurrency`). */
  readonly concurrency?: number | "auto";
}

/**
 * Build the `--dry-run` plan: for each task (in the given order), resolve the
 * whole pipeline against that task's scope. Purely functional — no I/O, no git,
 * no ACP (Success Criterion #8). Fails fast with an `InterpolationError` if any
 * template references an unknown variable (OQ1), before returning any output.
 *
 * Also builds the task DAG (T-011): topological layers, effective concurrency,
 * and predicted merge order — same graph logic as `runLoop`, so dry-run and
 * live run see the same DAG. `${iteration}` = stable 1-based backlog index
 * (AD-4), identical between dry-run and live run.
 */
export function planDryRun(
  config: LoopyConfig,
  tasks: readonly Task[],
  options?: PlanDryRunOptions,
): DryRunPlan {
  // --- DAG construction (shared logic with runLoop, AD-4) ---
  const graphResult = buildGraph(stripDoneDeps(tasks, options?.knownTaskIds));
  if (!graphResult.ok) {
    throw new Error(graphResult.error);
  }
  const layers = topoLayers(graphResult.value);
  const mergeOrder = layers.flat();

  // Resolve concurrency via the scheduler (single source of truth).
  const concurrency = resolveConcurrency({
    flag: options?.concurrency,
    declared: config.concurrency,
    maxConcurrency: config.max_concurrency,
    graph: graphResult.value,
  });

  // --- Per-task resolved pipeline ---
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
      resolveStep(step, createResolver(scope, { stepId: step.id }), config.resolvedAgents),
    );
    return { task, iteration, worktreePath, steps };
  });

  return { tasks: plans, layers, concurrency, mergeOrder };
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

/** Render the DAG summary section (T-011). */
function renderDag(plan: DryRunPlan): string {
  const { auto, value, widestLayer, cap } = plan.concurrency;
  // Numeric = byte-identical to previous format; auto = value + justification (D9).
  const concLabel = auto
    ? `${value} (auto — camada mais larga: ${widestLayer.join(", ")}; teto: ${cap})`
    : `${value}`;
  const lines = [
    "--- DAG ---",
    `  concorrência efetiva: ${concLabel}`,
    "  camadas topológicas:",
  ];
  for (let i = 0; i < plan.layers.length; i++) {
    lines.push(`    camada ${i + 1}: ${plan.layers[i]!.join(", ")}`);
  }
  lines.push(`  ordem de merge prevista: ${plan.mergeOrder.join(" → ")}`);
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
  const dag = renderDag(plan);
  const tasks = plan.tasks.map(renderTaskPlan).join("\n\n");
  return `${dag}\n\n${tasks}`;
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
  setModel: notWired("session.setModel"),
  setEffort: notWired("session.setEffort"),
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
  isMergeInProgress: notWired("git.isMergeInProgress"),
  rebaseOnto: notWired("git.rebaseOnto"),
  revParseHead: notWired("git.revParseHead"),
  remoteOriginUrl: notWired("git.remoteOriginUrl"),
};

/**
 * Opens (or reuses) the ACP session bound to an agent + worktree pair (AD-3
 * evolved: one session per `(agent, worktree)`). Called with the agent name
 * and the worktree's absolute path the first time an agent step of that agent
 * reaches for the session — i.e. *after* `create-worktree` has made the
 * directory exist.
 */
export type SessionProvider = (agentName: string, worktreeCwd: string) => Promise<AgentSession>;

/**
 * Wrap a {@link SessionProvider} in an {@link AgentSession} that opens the real
 * session lazily and at most once per (agent, worktree) pair (AD-3 evolved,
 * ADR-0006). The open is deferred to the first `setMode`/`clear`/`prompt`, so a
 * task with no agent step never opens a session at all; `readText`/`sessionId`
 * read from the resolved session (safe because the agent step always awaits a
 * prompt turn before reading its text). This keeps the orchestrator agnostic to
 * step type (AD-2): any step may reach for `ctx.session`, but the cost is only
 * paid when one actually does.
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
    setModel: async (modelId) => (await ensure()).setModel(modelId),
    setEffort: async (level) => (await ensure()).setEffort(level),
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

// ---------------------------------------------------------------------------
// Abort port — hard-stop cancellation of in-flight tasks (T-007)
// ---------------------------------------------------------------------------

/** Default timeout (ms) for cooperative cancel before falling back to kill. */
export const CANCEL_TIMEOUT_MS = 5_000;

/**
 * Port for the `abort_loop` hard stop (T-007). When a task escalates with
 * `abort_loop`, the orchestrator calls {@link cancelSession} on each in-flight
 * sibling's worktree cwd (cooperative, sibling-safe via `session/cancel`),
 * then waits for them to settle within {@link CANCEL_TIMEOUT_MS}. On timeout
 * the fallback {@link killAgent} terminates the ACP process and any shell
 * children. `killAgent` is NEVER used to abort a single task — only as a
 * last-resort for whole-run shutdown.
 */
export interface AbortPort {
  /** Cancel a session by its worktree cwd (cooperative, no-op if not open). */
  cancelSession(cwd: string): Promise<void>;
  /** Kill the agent process + in-flight shell children (hard fallback). */
  killAgent(): void;
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
   * Injectable clock that stamps the run's `startedAt`/`finishedAt` (default
   * `Date.now`). Returns milliseconds since epoch. Tests inject for determinism.
   */
  readonly now?: () => number;
  /**
   * Parent mutex (T-004). Serializes all parent-branch mutations (non-agent
   * step commands, commitPaths, isParentClean) behind a single FIFO lock.
   * When absent (tests without parallelism), no serialization occurs.
   */
  readonly parentMutex?: Mutex;
  /**
   * Hard-stop port for `abort_loop` (T-007). When present and `abort_loop`
   * fires, the orchestrator cancels in-flight sibling sessions cooperatively
   * and, on timeout, falls back to `killAgent()`. When absent (non-agent
   * spine / unit tests), `abort_loop` still stops the run but without
   * cooperative cancellation (tasks settle naturally).
   */
  readonly abort?: AbortPort;
  /**
   * Best-effort TUI event sink (T-004 C-0007). Synchronous; the orchestrator
   * wraps every call in a try-catch so a throwing `emit` never disrupts the
   * engine. Absent → no events emitted (motor byte-identical, AD-1).
   */
  readonly emit?: (event: StoreEvent) => void;
  /**
   * Telemetry writer connection (C-0017 / ADR-0011). Present only when the
   * `metrics:` gate opened a `.db` (wired by `index.ts`). The orchestrator uses
   * it in {@link buildTaskStepContext} to build a per-Visit {@link VisitRecorder}
   * for each step. Absent → `ctx.telemetry` undefined → collection is a no-op,
   * no `.db`, `RunLoopResult` byte-identical (AD-1).
   */
  readonly telemetry?: TelemetryDb;
}

/**
 * Strip the `Deps:` line from a task body, preserving everything else
 * (including `Files:` lines). Returns the body with the `Deps:` line removed
 * and leading/trailing whitespace trimmed. Empty body → `undefined`.
 *
 * Pure helper (AD-6), exported for testing.
 */
export function stripDepsLine(body: string): string | undefined {
  const filtered = body
    .split("\n")
    .filter((line) => !line.trim().toLowerCase().startsWith("deps:"))
    .join("\n")
    .trim();
  return filtered || undefined;
}

/** Best-effort emit: swallows any exception so the engine is never disrupted. */
function safeEmit(deps: OrchestratorDeps, event: StoreEvent): void {
  try {
    deps.emit?.(event);
  } catch {
    // Best-effort — never block/throw into the engine (AD-1).
  }
}

/**
 * INSERT OR IGNORE the `change` dimension at the start of a run (C-0017 / D2,
 * D26). No-op unless `metrics:` opened a `.db` (`deps.telemetry` set) — the
 * opt-in gate keeps `RunLoopResult` byte-identical (AD-1), and returning before
 * touching the clock means telemetry-off runs consume no `deps.now` tick.
 *
 * The row lands "in progress" (`status`/`ended_at` NULL) so it naturally sits
 * out of the merged baseline until `index.ts` marks it merged at end-of-change.
 * `base_sha`/`repo` come from git best-effort (NULL / dir-name fallback); the
 * whole thing is wrapped so a git or DB fault never throws into the engine (D9).
 */
async function insertChangeDimension(
  config: LoopyConfig,
  deps: OrchestratorDeps,
): Promise<void> {
  const db = deps.telemetry;
  if (db === undefined) return;
  try {
    const baseSha = (await deps.git?.revParseHead()) ?? null;
    const origin = (await deps.git?.remoteOriginUrl()) ?? null;
    insertChange(db, {
      change_id: telemetryChangeId(config),
      name: deriveChange(config).id,
      repo: repoNameFrom(origin, deps.root),
      base_sha: baseSha,
      pipeline_version: pipelineFingerprint(config.pipeline),
      created_at: new Date((deps.now ?? Date.now)()).toISOString(),
    });
  } catch {
    // Best-effort: telemetry never throws into the engine (D9).
  }
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
  visitNo: number,
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
    emit: deps.emit,
    // Per-Visit telemetry recorder (C-0017) — only when `metrics:` opened a
    // `.db`. Closed over the immutable Visit facts (D3/D26); `finalize` (called
    // in `executeStep`) is the single write trigger.
    telemetry: deps.telemetry
      ? createVisitRecorder(deps.telemetry, {
          taskId: telemetryTaskId(config, task),
          changeId: telemetryChangeId(config),
          stepName: step.id,
          kind: step.type,
          visitNo,
          now: deps.now ?? Date.now,
        })
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Live outer loop (T-010) — per-task pipeline
// ---------------------------------------------------------------------------

export type { PipelineOutcome };

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
): Promise<PipelineOutcome> {
  const { pipeline, stop_conditions, policies } = config;
  const maxStepVisits = stop_conditions.max_step_visits;
  const worktreePath = worktreePathFor(config, task);

  // On a failed task, `keep_worktree` preserves the worktree for inspection —
  // which means the teardown (`always`) steps that would remove it must be
  // suppressed. Read once; it is config-driven, not engine policy (AD-1).
  const keepWorktree = policies.escalation.keep_worktree;

  // Per-agent lazy sessions (AD-3 evolved): one session per (agent, worktree).
  // A task with Steps from two agents gets two sessions, both with the same cwd.
  const { sessionProvider } = deps;
  const sessionsByAgent = new Map<string, AgentSession>();
  const getSession = (agentName: string): AgentSession => {
    let s = sessionsByAgent.get(agentName);
    if (s === undefined) {
      s = sessionProvider !== undefined
        ? createLazySession(() =>
            sessionProvider(agentName, resolve(deps.root, worktreePath)),
          )
        : (deps.session ?? notWiredSession);
      sessionsByAgent.set(agentName, s);
    }
    return s;
  };

  /** Execute a step: emit start/finish around the interpreter. */
  const executeStep = async (
    interpreter: { execute(ctx: StepContext): Promise<StepResult> },
    ctx: StepContext,
    agentLabel?: AgentLabel,
  ): Promise<StepResult> => {
    safeEmit(deps, {
      type: "step_started",
      taskId: task.id,
      stepId: ctx.step.id,
      stepType: ctx.step.type,
      ...(agentLabel && { agentName: agentLabel.agentName, model: agentLabel.model }),
    });
    const result = await interpreter.execute(ctx);
    // Telemetry write trigger (C-0017): finalize the Visit. Best-effort — the
    // recorder never throws (D9). No-op when `metrics:` is off (ctx.telemetry
    // undefined). Agent per-attempt rows land in T-007.
    ctx.telemetry?.finalize(result);
    safeEmit(deps, {
      type: "step_finished",
      taskId: task.id,
      stepId: ctx.step.id,
      ok: result.ok,
      reason: result.ok ? undefined : result.reason,
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

  /** Resolve the next PC (on_success goto or sequential), save checkpoint. */
  const resolveNextPc = (step: StepConfig): number => {
    const next = step.on_success
      ? (stepIndex.get(step.on_success.goto) ?? pc + 1)
      : pc + 1;
    const nextStep = pipeline[next];
    if (nextStep !== undefined) {
      deps.checkpoint?.saveProgress(task.id, nextStep.id, visits, checksReport);
    }
    return next;
  };

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

    // Resolve agent binding and get the session for this step's agent.
    const binding = resolveAgentBinding(step, config.resolvedAgents);
    const stepSession = getSession(binding.agentName);

    // Build context and execute. `visits[step.id]` is the current Visit number
    // (incremented by the entry guard above) — the telemetry `visit_no` (D3).
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
      stepSession,
      visits[step.id]!,
    );
    const result: StepResult = await executeStep(
      interpreter, ctx, buildAgentLabel(step, binding, config.resolvedAgents),
    );
    executedSteps.add(step.id);

    if (result.ok) {
      // Thread checks report (normal flow — only from result.report).
      if (result.report !== undefined) checksReport = result.report.text;
      deps.logger.debug(`[orchestrator] step "${step.id}" ok`);
      pc = resolveNextPc(step);
      continue;
    }

    // Step failed.
    deps.logger.error(
      `[orchestrator] step "${step.id}" falhou: ${result.reason ?? "(sem motivo)"}`,
    );

    // --- Merge-conflict recovery (T-008) ---
    // When the git policy is `rebase` and a merge is in progress on the parent
    // (MERGE_HEAD present), the engine aborts the conflict, rebases the task
    // branch onto the parent, and retries the merge once — all inside the mutex.
    // If the rebase or retry fails, control falls through to the normal on_fail.
    if (
      config.policies.git.on_merge_conflict === "rebase" &&
      deps.git !== undefined &&
      (await deps.git.isMergeInProgress())
    ) {
      const recovered = await guarded(deps.parentMutex, async () => {
        const rebase = await deps.git!.rebaseOnto(
          worktreePath,
          config.workspace.parent_branch,
        );
        if (!rebase.ok) {
          deps.logger.error(
            `[orchestrator] rebase de "${task.branch}" em "${config.workspace.parent_branch}" falhou — escalando`,
          );
          return false;
        }
        deps.logger.info(
          `[orchestrator] rebase ok — re-tentando merge de "${task.branch}"`,
        );
        const retry = await deps.git!.merge(task.branch, {
          message: `merge(${task.id}): ${task.title}`,
        });
        if (retry.ok) return true;
        deps.logger.error(
          `[orchestrator] retry merge de "${task.branch}" falhou — escalando`,
        );
        return false;
      });

      if (recovered) {
        deps.logger.info(
          `[orchestrator] step "${step.id}" recuperado via rebase`,
        );
        pc = resolveNextPc(step);
        continue;
      }
    }

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
        const teardownBinding = resolveAgentBinding(step, config.resolvedAgents);
        const teardownSession = getSession(teardownBinding.agentName);
        // Teardown steps never entered the PC loop → this is their first (only)
        // Visit (`visit_no=1`); fall back only when the guard never touched them.
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
          teardownSession,
          visits[step.id] ?? 1,
        );
        const result = await executeStep(
          interpreter, ctx, buildAgentLabel(step, teardownBinding, config.resolvedAgents),
        );
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

  return terminal;
}

// ---------------------------------------------------------------------------
// Live outer loop (T-010) — escalation + the loop itself
// ---------------------------------------------------------------------------

/** What the outer loop does after an escalation. */
export type EscalationDecision = "continue" | "stop";

/**
 * Map an escalation `action` to an outer-loop decision: only `abort_loop`
 * halts the Run. `pause` (checkpoint preserved, resumable) and `skip_task`
 * (checkpoint abandoned) both **continue draining** reachable tasks (T-006).
 */
export function decideEscalation(action: EscalationAction): EscalationDecision {
  return action === "abort_loop" ? "stop" : "continue";
}

/** Why {@link runLoop} stopped iterating. */
export type LoopStopReason =
  | "backlog_empty"
  | "max_iterations"
  | "stop_signal"
  | "dirty_parent"
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
 * Cancel in-flight sibling sessions, await settle with timeout, then drain
 * (T-007). Extracted from the main loop for readability.
 *
 * 1. Mark every in-flight task as cancelled (so `launchTask` preserves its
 *    checkpoint on settle).
 * 2. If `deps.abort` is wired, call `cancelSession(cwd)` on each sibling
 *    (cooperative, sibling-safe) and race the settle against a timeout.
 * 3. On timeout, `killAgent()` terminates the process.
 * 4. Drain all remaining promises (best-effort).
 */
async function cancelAndDrainInFlight(
  inFlight: Map<string, Promise<{ readonly taskId: string }>>,
  cancelledTasks: Set<string>,
  taskById: Map<string, Task>,
  config: LoopyConfig,
  deps: OrchestratorDeps,
): Promise<void> {
  for (const taskId of inFlight.keys()) {
    cancelledTasks.add(taskId);
  }

  if (deps.abort) {
    const cancelPromises = [...inFlight.keys()].map((taskId) => {
      const cwd = resolve(deps.root, worktreePathFor(config, taskById.get(taskId)!));
      return deps.abort!.cancelSession(cwd).catch(() => {});
    });
    await Promise.all(cancelPromises);

    const settleAll = Promise.all(inFlight.values()).then(() => "settled" as const);
    const timeout = new Promise<"timeout">((r) =>
      setTimeout(() => r("timeout"), CANCEL_TIMEOUT_MS),
    );
    if ((await Promise.race([settleAll, timeout])) === "timeout") {
      deps.logger.error(
        `[orchestrator] cancel cooperativo expirou (${CANCEL_TIMEOUT_MS}ms) — killAgent`,
      );
      deps.abort.killAgent();
    }
  }

  for (const [taskId, promise] of [...inFlight]) {
    try { await promise; } catch { /* killed mid-flight */ }
    inFlight.delete(taskId);
  }
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
  const paused: string[] = [];
  const skipped: string[] = [];
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
      paused,
      skipped,
      iterations: tasksStarted,
      stoppedBy,
      startedAt,
      finishedAt,
    };
  };

  // --- DAG construction (fail-fast before any task runs) ---
  const graphResult = buildGraph(stripDoneDeps(tasks, deps.knownTaskIds));
  if (!graphResult.ok) {
    throw new Error(`[orchestrator] ${graphResult.error}`);
  }
  const graph: TaskGraph = graphResult.value;

  // `--concurrency N|auto` overrides yml; resolve through the scheduler so
  // `auto` is a number before the pool uses it (D8 — resolved once at Run start).
  const concurrency = resolveConcurrency({
    flag: deps.flags.concurrency,
    declared: config.concurrency,
    maxConcurrency: config.max_concurrency,
    graph,
  }).value;

  // --- Emit DAG topology + pipeline declaration + task registrations (C-0007 T-004, C-0009 T-003) ---
  safeEmit(deps, { type: "edges_set", edges: graph.edges as [string, string][] });
  safeEmit(deps, {
    type: "pipeline_declared",
    steps: config.pipeline.map((s) => ({ id: s.id, type: s.type })),
  });
  for (const t of tasks) {
    const description = stripDepsLine(t.body);
    safeEmit(deps, {
      type: "task_registered",
      taskId: t.id,
      title: t.title,
      status: t.deps.length > 0 ? "blocked" : "ready",
      ...(description !== undefined && { description }),
      ...(t.deps.length > 0 && { deps: t.deps }),
    });
  }

  // C-0017 (D2/D26): register the `change` dimension (INSERT OR IGNORE) before
  // any task runs, so `task.change_id` (T-006) resolves. No-op when `metrics:`
  // is off; best-effort otherwise. Marked `merged` at end-of-change by index.ts.
  await insertChangeDimension(config, deps);

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

  // T-007: tasks whose sessions were cancelled by an abort_loop hard stop.
  // Checked inside launchTask to preserve checkpoint (resumable, OQ13).
  const cancelledTasks = new Set<string>();

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
    safeEmit(deps, { type: "task_started", taskId: task.id });
    checkpoint?.setStatus(task.id, "running");
    const resumePoint = resumeMap?.get(task.id);

    const promise = (async (): Promise<TaskSignal> => {
      const outcome = await runTaskPipeline(
        config,
        task,
        iteration,
        deps,
        resumePoint,
      );

      if (outcome.ok) {
        const markDoneResult = await markDoneWithMutex(
          task.id,
          config,
          deps,
          requireCleanParent,
        );
        if (markDoneResult === "dirty_parent") {
          status.set(task.id, "done");
          safeEmit(deps, { type: "task_finished", taskId: task.id, status: "done" });
          return { taskId: task.id, stop: "dirty_parent" };
        }
        checkpoint?.clearTask(task.id);
        completed.push(task.id);
        status.set(task.id, "done");
        safeEmit(deps, { type: "task_finished", taskId: task.id, status: "done" });
        deps.logger.info(
          `[orchestrator] task ${task.id} concluída e marcada [x]`,
        );
        return { taskId: task.id };
      }

      // T-007: if this task was cancelled by abort_loop, preserve its
      // checkpoint for resume (OQ13) — don't escalate or modify checkpoint.
      if (cancelledTasks.has(task.id)) {
        deps.logger.info(
          `[orchestrator] task ${task.id} cancelada por abort_loop — checkpoint preservado`,
        );
        status.set(task.id, "paused");
        safeEmit(deps, { type: "task_finished", taskId: task.id, status: "paused" });
        return { taskId: task.id };
      }

      // Persistent failure → escalation (T-006: draining semantics).
      const policy = config.policies.escalation;
      const keep = policy.keep_worktree ? " (keep_worktree)" : "";
      const message =
        `[escalonamento] task ${task.id} falhou no step "${outcome.failedStepId}": ` +
        `${outcome.reason ?? "(sem motivo)"} → ação "${policy.action}"${keep}`;
      deps.logger.error(message);
      if (policy.notify) deps.notify?.(message);

      // abort_loop → hard stop (T-007 adds cancellation of in-flight).
      if (decideEscalation(policy.action) === "stop") {
        escalated.push(task.id);
        status.set(task.id, "escalated");
        safeEmit(deps, {
          type: "task_finished", taskId: task.id,
          status: "escalated", reason: outcome.reason,
        });
        checkpoint?.setStatus(task.id, "aborted");
        return { taskId: task.id, stop: "escalation_abort" };
      }

      // pause → checkpoint preserved (resumable); skip_task → checkpoint abandoned.
      if (policy.action === "pause") {
        paused.push(task.id);
        status.set(task.id, "paused");
        safeEmit(deps, {
          type: "task_finished", taskId: task.id,
          status: "paused", reason: outcome.reason,
        });
        checkpoint?.setStatus(task.id, "paused");
      } else {
        // skip_task
        escalated.push(task.id);
        status.set(task.id, "escalated");
        safeEmit(deps, {
          type: "task_finished", taskId: task.id,
          status: "escalated", reason: outcome.reason,
        });
        checkpoint?.clearTask(task.id);
      }

      // Both pause and skip_task: mark the transitive closure of descendants
      // as skipped and continue draining reachable tasks.
      for (const descId of skipDescendants(graph, task.id)) {
        if (status.get(descId) === "blocked") {
          status.set(descId, "skipped");
          skipped.push(descId);
          safeEmit(deps, {
            type: "task_finished", taskId: descId,
            status: "skipped", reason: `dependência ${task.id} falhou`,
          });
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

    // T-007: abort_loop hard stop — cancel siblings, await settle, drain.
    if (stop === "escalation_abort" && inFlight.size > 0) {
      await cancelAndDrainInFlight(
        inFlight,
        cancelledTasks,
        taskById,
        config,
        deps,
      );
    }
  }

  return finish(stopReason ?? "backlog_empty");
}
