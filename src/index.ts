/**
 * `loopy` CLI entrypoint — `commander` parses `loopy [dir]` plus the run flags,
 * then dispatches to the engine. Two capabilities are wired here:
 *
 *  - **`--dry-run`** (T-005): load config → load backlog → resolve interpolation
 *    per task → print the resolved pipeline, with **no** writes/commit/merge
 *    (Success Criterion #8).
 *  - **live run** (T-018): first-run git setup behind approval, `--task`
 *    selection with the OQ6 non-blocking warning, flag threading
 *    (`--config`/`--max-iterations`/`--verbose`/`--yes`), then the outer loop
 *    (`runLoop`) over the selected tasks driving the ACP agent.
 *
 * `run()` is exported and takes the user args, an IO sink, and optional
 * {@link RunHooks} so the live path is fully testable without spawning an agent
 * (the ACP composition is the only untested glue — validated manually / by the
 * `e2e-agent` test). The bottom-of-file guard invokes it only when the module is
 * executed directly (never when imported by tests).
 *
 * Errors are values at this boundary: config / backlog / interpolation failures
 * and live-run infra faults become a clear message + non-zero exit, never a
 * stack trace. Invalid config aborts before any effect (it is loaded first).
 */
import { existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, relative, resolve as resolvePath } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { Command, CommanderError, InvalidArgumentError } from "commander";
import { execa } from "execa";
import pkg from "../package.json" with { type: "json" };
import { openAgent, type AgentHandle } from "./acp/agent";
import type { AgentCapabilities } from "./acp/capabilities";
import { cacheKey, readCache, writeCache } from "./acp/capabilities-cache";
import { buildSession } from "./acp/session";
import { acpTrafficSummary, agentChunkText, usageUpdateUsed } from "./acp/client";
import {
  createAgentProcessPool,
  type PerAgentOptions,
} from "./acp/pool";
import { resolveAgentEnv } from "./config/env";
import { referencedAgents } from "./config/warnings";
import {
  BacklogError,
  backlogOptionsFrom,
  loadBacklog,
  pendingTasks,
  selectTask,
} from "./backlog/todo";
import { runChecks } from "./checks/runner";
import { ConfigError, loadConfig } from "./config/load";
import {
  collectDeprecationWarnings,
  collectPipelineWarnings,
  formatWarnings,
} from "./config/warnings";
import {
  createGit,
  initGitRepo,
  isGitRepo,
  type InitGitRepoOptions,
} from "./git/worktree";
import { InterpolationError } from "./interp/resolver";
import { createLogFactory, type AcpTrafficEntry } from "./logging/logger";
import {
  createCheckpointPort,
  createMarkDonePort,
  formatDryRunPlan,
  planDryRun,
  resolveAgentBinding,
  runLoop,
  telemetryChangeId,
  worktreePathFor,
  type OrchestratorDeps,
  type PlanDryRunOptions,
  type RunLoopResult,
} from "./loop/orchestrator";
import {
  clearTaskIn,
  loadState,
  pipelineFingerprint,
  saveState,
} from "./resume/state";
import { createMutex } from "./loop/mutex";
import { createFullRegistry } from "./steps/index";
import {
  addBug,
  clearVerdict,
  setChangeStatus,
  setVerdict,
  type BugSeverity,
  type Verdict,
} from "./telemetry/annotate";
import { openDb, type TelemetryDb } from "./telemetry/db";
import { bootstrap } from "./telemetry/schema";
import { markChangeMerged } from "./telemetry/write";
import { mountApp } from "./tui/mount";
import { startUi } from "./tui/start";
import type {
  AgentDef,
  ChecksRunnerPort,
  LoggerPort,
  LoopyConfig,
  ResolvedAgents,
  RunFlags,
  RunState,
  StepConfig,
  Task,
} from "./types";

/**
 * Single source of truth: the version comes from `package.json` rather than a
 * hardcoded string (which silently drifts every release). A static JSON import
 * is embedded by every bundler we ship through — tsx reads it directly, tsup
 * inlines it into `dist/`, and `bun --compile` embeds it into the sidecar's
 * virtual filesystem (a runtime `createRequire("../package.json")` cannot find
 * it there, since the file does not sit beside the single-file binary).
 */
const VERSION = (pkg as { version: string }).version;

/** Raw output sink (no implicit newline), so commander and our prints share it. */
export interface RunIO {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

const defaultIO: RunIO = {
  out: (text) => void process.stdout.write(text),
  err: (text) => void process.stderr.write(text),
};

/** Everything the live executor needs to run the outer loop over `tasks`. */
export interface RunLiveArgs {
  readonly config: LoopyConfig;
  /** The already-selected tasks (pending list, or the single `--task`). */
  readonly tasks: readonly Task[];
  readonly flags: RunFlags;
  /** Absolute workspace root. */
  readonly root: string;
  /** Absolute path of the loaded `loopy.yml`. */
  readonly configPath: string;
  /** Absolute path of the backlog (`todo.md`). */
  readonly todoPath: string;
  /** All known task ids from the backlog (pending + done) for orphan pruning. */
  readonly knownTaskIds: readonly string[];
  readonly io: RunIO;
}

/** Runs the outer loop for real (spawns the ACP agent, wires git/checks/UI). */
export type RunLive = (args: RunLiveArgs) => Promise<RunLoopResult>;

/**
 * Injectable seams for the live path, so the CLI logic (git-init gate, `--task`
 * selection + warning, flag threading, exit codes) is testable without an agent.
 * Every hook defaults to its real implementation.
 */
export interface RunHooks {
  /** Whether `root` is already a git repo (default: real `isGitRepo`). */
  readonly isGitRepo?: (root: string) => Promise<boolean> | boolean;
  /** Initialize a fresh repo (default: real `initGitRepo`). */
  readonly initGitRepo?: (opts: InitGitRepoOptions) => Promise<void>;
  /** Human approval for the git-init gate (default: a readline y/N prompt). */
  readonly approve?: (prompt: string) => Promise<boolean>;
  /** The live outer-loop executor (default: {@link defaultRunLive}). */
  readonly runLive?: RunLive;
}

/** Parse a `--max-iterations` value as a positive integer (commander hook). */
function parsePositiveInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError("deve ser um inteiro positivo.");
  }
  return parsed;
}

/** Parse `--concurrency` accepting `"auto"` or a positive integer (commander hook). */
function parseConcurrency(value: string): number | "auto" {
  if (value === "auto") return "auto";
  return parsePositiveInt(value);
}

/** Build the commander program, routing all output through `io`. */
export function buildProgram(io: RunIO): Command {
  return new Command()
    .name("loopy")
    .description("Motor de loop agentico config-driven via ACP")
    .version(VERSION, "-V, --version", "mostra a versao")
    .argument("[dir]", "diretorio do projeto-alvo", ".")
    .option("-c, --config <path>", "caminho alternativo do loopy.yml")
    .option(
      "--dry-run",
      "planeja e imprime o pipeline resolvido, sem escrita/commit/merge",
      false,
    )
    .option("-t, --task <id>", "roda apenas a task com este id (ex.: T-004)")
    .option(
      "--max-iterations <n>",
      "sobrescreve o teto do loop externo",
      parsePositiveInt,
    )
    .option(
      "-y, --yes",
      "auto-aprova gates de aprovacao (nao-interativo / CI)",
      false,
    )
    .option(
      "--clean [id]",
      "teardown (worktree+branch+checkpoint) e sai; sem id usa a task com checkpoint pausado/em-progresso",
    )
    .option(
      "--concurrency <n>",
      "sobrescreve o pool de tasks paralelas (default: config; 'auto' = largura do DAG)",
      parseConcurrency,
    )
    .option("--no-tui", "forca logs de linha (sem Ink)")
    .option(
      "--emit-events",
      "emite eventos NDJSON no stdout (fan-out dispatch para Native UI)",
      false,
    )
    .option("--verbose", "inclui trafego ACP no log", false)
    .allowExcessArguments(false)
    .enablePositionalOptions()
    .exitOverride()
    .configureOutput({
      writeOut: (str) => io.out(str),
      writeErr: (str) => io.err(str),
    });
}

/** Map commander's parsed options onto the typed {@link RunFlags}. */
function toFlags(opts: Record<string, unknown>): RunFlags {
  return {
    config: typeof opts.config === "string" ? opts.config : undefined,
    dryRun: opts.dryRun === true,
    task: typeof opts.task === "string" ? opts.task : undefined,
    maxIterations:
      typeof opts.maxIterations === "number" ? opts.maxIterations : undefined,
    yes: opts.yes === true,
    // `--no-tui` flips this to false; default (unset) is true.
    tui: opts.tui !== false,
    emitEvents: opts.emitEvents === true,
    verbose: opts.verbose === true,
    clean:
      typeof opts.clean === "string"
        ? opts.clean
        : opts.clean === true
          ? true
          : undefined,
    concurrency:
      typeof opts.concurrency === "number" || opts.concurrency === "auto"
        ? opts.concurrency
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// Capability validation (pure — shared by eager + dry-run, T-009 D36/D37)
// ---------------------------------------------------------------------------

type CheckStatus = "pass" | "fail" | "unknown";

/** A single capability check result against an agent's announced capabilities. */
export interface CapabilityCheck {
  readonly stepId: string;
  readonly agentName: string;
  readonly field: "mode" | "model" | "effort";
  readonly value: string;
  readonly accepted: readonly string[];
  readonly status: CheckStatus;
}

/** Result of validating pipeline steps against agent capabilities. */
export interface CapabilityValidation {
  /** Mode mismatches — fatal, abort the Run. */
  readonly errors: readonly CapabilityCheck[];
  /** Model/effort mismatches — warn only, do not abort. */
  readonly warnings: readonly CapabilityCheck[];
}

/**
 * Walk every `agent` step and classify each mode/model/effort against the
 * capabilities map. Pure (AD-6) — no I/O.
 *
 * - `mode`: always checked (unknown when agent doesn't announce).
 * - `model`/`effort`: checked only when the agent announces that category.
 */
function checkPipelineCapabilities(
  pipeline: readonly StepConfig[],
  resolvedAgents: ResolvedAgents,
  capsByAgent: ReadonlyMap<string, AgentCapabilities>,
): CapabilityCheck[] {
  const results: CapabilityCheck[] = [];
  for (const step of pipeline) {
    if (step.type !== "agent") continue;
    const binding = resolveAgentBinding(step, resolvedAgents);
    const caps = capsByAgent.get(binding.agentName);
    if (!caps) continue;

    const classify = (
      field: CapabilityCheck["field"],
      value: string | undefined,
      accepted: readonly string[],
    ): void => {
      if (!value) return;
      const status: CheckStatus =
        accepted.length === 0 ? "unknown" : accepted.includes(value) ? "pass" : "fail";
      results.push({ stepId: step.id, agentName: binding.agentName, field, value, accepted, status });
    };

    classify("mode", step.mode, caps.modes);
    if (caps.models.length > 0) classify("model", binding.model, caps.models);
    if (caps.efforts.length > 0) classify("effort", binding.effort, caps.efforts);
  }
  return results;
}

/**
 * Validate every `agent` step's mode/model/effort. Pure (AD-6).
 * Mode mismatch → error (abort). Model/effort mismatch → warning (best-effort).
 */
export function validatePipelineCapabilities(
  pipeline: readonly StepConfig[],
  resolvedAgents: ResolvedAgents,
  capsByAgent: ReadonlyMap<string, AgentCapabilities>,
): CapabilityValidation {
  const all = checkPipelineCapabilities(pipeline, resolvedAgents, capsByAgent);
  return {
    errors: all.filter((c) => c.field === "mode" && c.status === "fail"),
    warnings: all.filter((c) => c.field !== "mode" && c.status === "fail"),
  };
}

/** Format a diagnostic for the eager path (warning/error messages). */
function formatDiagnosticLine(d: CapabilityCheck): string {
  return `${d.stepId}: ${d.field} '${d.value}' não é aceito por '${d.agentName}' (aceita: ${d.accepted.join(", ")})`;
}

/** Format a single capability check as a ✓/✗/? display line for dry-run. */
function formatCheckLine(c: CapabilityCheck): string {
  const icon = c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : "?";
  const prefix = `  ${icon} ${c.stepId}: ${c.field} '${c.value}'`;

  if (c.status === "pass") return `${prefix} ok (${c.agentName})`;
  if (c.status === "unknown") return `${prefix} — ${c.agentName} não anuncia ${c.field}s`;

  if (c.field === "mode") {
    return `${prefix} não é aceito por '${c.agentName}' (aceita: ${c.accepted.join(", ")})`;
  }
  const items =
    c.field === "model" && c.accepted.length > 5
      ? `${c.accepted.slice(0, 5).join(", ")}, …`
      : c.accepted.join(", ");
  return `${prefix} não encontrado em '${c.agentName}' (disponíveis: ${items})`;
}

/** Build ✓/✗ report for `--dry-run` using cached capabilities. */
function formatCapabilityReport(
  pipeline: readonly StepConfig[],
  resolvedAgents: ResolvedAgents,
  capsByAgent: ReadonlyMap<string, AgentCapabilities>,
): { lines: string[]; hasErrors: boolean } {
  const all = checkPipelineCapabilities(pipeline, resolvedAgents, capsByAgent);
  return {
    lines: all.map(formatCheckLine),
    hasErrors: all.some((c) => c.field === "mode" && c.status === "fail"),
  };
}

/**
 * Load cached capabilities for all referenced agents. Returns `null` when the
 * cache file is absent or has no entries for referenced agents.
 */
function loadCachedCapabilities(
  config: LoopyConfig,
  cacheRoot: string,
): Map<string, AgentCapabilities> | null {
  const cache = readCache(cacheRoot);
  if (Object.keys(cache).length === 0) return null;

  const refs = referencedAgents(config.pipeline, config.resolvedAgents.default);
  const result = new Map<string, AgentCapabilities>();

  for (const name of refs) {
    const def = config.resolvedAgents.byName[name];
    if (!def) continue;
    // Prefer the entry probed with this agent's model (capabilities can depend
    // on it — see `cacheKey`); fall back to the bare-argv entry.
    const entry =
      (def.model ? cache[cacheKey(def.command, def.model)] : undefined) ??
      cache[cacheKey(def.command)];
    if (entry) {
      result.set(name, entry.capabilities);
    }
  }

  return result.size > 0 ? result : null;
}

/** Print the resolved pipeline for the pending tasks. No side effects. */
function printDryRun(
  config: LoopyConfig,
  pending: readonly Task[],
  paths: { readonly configPath: string; readonly todoPath: string },
  io: RunIO,
  options?: PlanDryRunOptions,
): number {
  // Build the plan first: an unknown-variable error (OQ1) surfaces before any
  // output is emitted, keeping the failure clean.
  const plan = planDryRun(config, pending, options);

  const cwd = process.cwd();
  // Show each path relative to cwd, falling back to the path when it *is* cwd.
  const displayPath = (path: string): string => relative(cwd, path) || path;
  io.out("loopy — dry-run (nenhuma escrita/commit/merge)\n");
  io.out(`config:  ${displayPath(paths.configPath)}\n`);
  io.out(`backlog: ${displayPath(paths.todoPath)}\n`);
  io.out(`tasks pendentes: ${pending.length}\n`);
  io.out("\n");

  if (pending.length === 0) {
    io.out("Nenhuma task pendente no backlog.\n");
    return 0;
  }

  io.out(`${formatDryRunPlan(plan)}\n`);

  // --- T-009 (D37): dry-run validates via cache — zero process, by contract. ---
  const cacheRoot = dirname(paths.configPath);
  const cached = loadCachedCapabilities(config, cacheRoot);

  if (!cached) {
    io.out("\ncapabilities: não verificadas (rode 'loopy probe-agent')\n");
    return 0;
  }

  const report = formatCapabilityReport(
    config.pipeline,
    config.resolvedAgents,
    cached,
  );

  if (report.lines.length > 0) {
    io.out(`\ncapabilities (cache):\n${report.lines.join("\n")}\n`);
  }

  // Mode mismatch against cache → exit ≠ 0 (cache may be stale — the eager
  // validation against the live adapter is the authority).
  return report.hasErrors ? 1 : 0;
}

/** `.gitignore` lines for a first-run init, derived from config (AD-1). */
function gitignoreLinesFor(config: LoopyConfig): string[] {
  const worktrees = `${config.workspace.worktrees_dir.replace(/[/\\]+$/, "")}/`;
  // The logging dir's top segment (`.loopy/logs` → `.loopy/`).
  const loopyDir = `${config.logging.dir.split(/[/\\]/)[0]}/`;
  const stop = config.stop_conditions.stop_signal_file;
  // De-duplicate while preserving order.
  return [...new Set([worktrees, loopyDir, stop])];
}

/** A readline y/N approval prompt on stderr — the default git-init gate. */
async function defaultApprove(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = (await rl.question(`${prompt} [y/N] `)).trim().toLowerCase();
    return ["y", "yes", "s", "sim"].includes(answer);
  } finally {
    rl.close();
  }
}

/** A logger that writes to the per-run log file AND echoes progress to the CLI. */
function teeLogger(file: LoggerPort, io: RunIO, verbose: boolean): LoggerPort {
  return {
    info: (m) => {
      file.info(m);
      io.out(`${m}\n`);
    },
    debug: (m) => {
      file.debug(m);
      if (verbose) io.out(`${m}\n`);
    },
    error: (m) => {
      file.error(m);
      io.err(`${m}\n`);
    },
  };
}

/**
 * The real live executor: spawn one ACP process per referenced Agent (AD-3
 * evolved), wire git + checks + the full step registry + the UI/approval
 * transport, run the outer loop over `tasks`, then tear everything down.
 * This is thin composition over already-tested building blocks; it hardcodes
 * no loop behavior (AD-1).
 */
async function defaultRunLive(args: RunLiveArgs): Promise<RunLoopResult> {
  const { config, tasks, flags, root, todoPath, knownTaskIds, io } = args;
  const backlogOptions = backlogOptionsFrom(config.inputs.backlog);

  const logFactory = createLogFactory({
    config: config.logging,
    root,
    verbose: flags.verbose,
  });
  const fileLogger = logFactory.forTask("loopy");

  // T-008: mount Ink + emit=dispatch + sessionId→taskId + logs arquivo-only.
  const ui = startUi({ flags, mount: mountApp });

  // In TUI mode the Ink frame owns stdout — motor logs go file-only so they
  // don't corrupt the frame (OQ16). In fallback mode the teeLogger echoes to
  // the caller's IO (which runLiveFlow already redirects to stderr when
  // --emit-events, so stdout stays NDJSON-only).
  const logger: LoggerPort = ui.tui
    ? fileLogger
    : teeLogger(fileLogger, io, flags.verbose);

  // Buffered notify for TUI mode: escalation/dirty-parent messages are held
  // and drained to stderr AFTER ui.stop() so they don't corrupt the frame.
  const notifyBuffer: string[] = [];
  const notify = ui.tui
    ? (message: string) => { notifyBuffer.push(message); }
    : (message: string) => io.err(`${message}\n`);

  // sessionId→{taskId,agent} map: populated by the sessionProvider wrapper;
  // read by onUpdate/onTraffic to stamp the correct taskId on ACP callbacks.
  // The `agent` field is carried for T-008 (TUI prefixing by agent when >1).
  const sessionToTask = new Map<string, { taskId: string; agent: string }>();

  // taskId→currentStepId: derived from the event stream (step_started /
  // step_finished) so `onUpdate` can stamp `usage_sample` with the right stepId
  // without reaching into the store (T-007). Lightweight — one entry per running task.
  const taskCurrentStep = new Map<string, string>();

  // Gate ACP capture by --verbose / capture_acp_traffic.
  const captureAcp = flags.verbose || config.logging.capture_acp_traffic;

  /** Resolve sessionId to {taskId, agent} (falls back when not yet mapped). */
  const infoFor = (sessionId: string): { taskId: string; agent: string | undefined } => {
    const entry = sessionToTask.get(sessionId);
    return { taskId: entry?.taskId ?? sessionId, agent: entry?.agent };
  };

  /** Dispatch one ACP traffic event to the store and log it to file. */
  const logTraffic = (taskId: string, agent: string | undefined, entry: AcpTrafficEntry, summary: string): void => {
    ui.dispatch({ type: "acp_traffic", taskId, direction: entry.direction, method: entry.method, summary, agent });
    fileLogger.acp(entry);
  };

  // Build per-agent options from referenced agents only (AD-3 evolved).
  const refs = referencedAgents(config.pipeline, config.resolvedAgents.default);
  const resolvedEnv = resolveAgentEnv(config.resolvedAgents.byName, process.env);
  const agentOptions = new Map<string, PerAgentOptions>();
  for (const name of refs) {
    const def = config.resolvedAgents.byName[name]!;
    const envOverrides = resolvedEnv[name];
    agentOptions.set(name, {
      command: def.command,
      env: envOverrides && Object.keys(envOverrides).length > 0
        ? { ...process.env, ...envOverrides }
        : undefined,
    });
  }

  // Eager spawn — one process per referenced agent; spawn-fail = Run fail-fast.
  const pool = await createAgentProcessPool(
    agentOptions,
    async (agentName, opts) =>
      openAgent({
        command: opts.command,
        cwd: root,
        env: opts.env,
        permissions: { on_request: config.acp.permissions.on_request },
        logger,
        onUpdate: (notification) => {
          const { update, sessionId } = notification;
          const text = agentChunkText(update);
          if (text !== undefined) {
            const info = infoFor(sessionId);
            ui.dispatch({ type: "stream_chunk", taskId: info.taskId, text, agent: info.agent ?? agentName });
          }
          // T-007: live context-window occupancy (usage_sample).
          const sample = usageUpdateUsed(update);
          if (sample) {
            const { taskId } = infoFor(sessionId);
            const stepId = taskCurrentStep.get(taskId);
            if (stepId) {
              ui.dispatch({ type: "usage_sample", taskId, stepId, ...sample });
            }
          }
        },
        onTraffic: captureAcp
          ? (entry, sessionId) => {
              const info = infoFor(sessionId);
              logTraffic(info.taskId, info.agent ?? agentName, entry, acpTrafficSummary(entry));
            }
          : undefined,
      }),
    logger,
    // Re-register sessionToTask when clear() reopens a session (sessionId changes).
    (oldSessionId, newSessionId) => {
      const entry = sessionToTask.get(oldSessionId);
      if (entry) {
        sessionToTask.delete(oldSessionId);
        sessionToTask.set(newSessionId, entry);
      }
    },
    // T-006: surface best-effort config warnings (D18/D28/D33) via StoreEvent.
    (message) => {
      ui.dispatch({ type: "warning", message });
    },
  );

  // --- T-009 (D36): eager capability validation — before any worktree. ---
  // Open a disposable session per referenced agent on workspace.root, read
  // capabilities, cache them (T-008, free), close, then validate ALL agent
  // steps. Mode mismatch → abort; effort/model mismatch → warning.
  const capsByAgent = new Map<string, AgentCapabilities>();
  for (const name of refs) {
    const session = await pool.session(name, root);
    capsByAgent.set(name, session.capabilities);

    const def = config.resolvedAgents.byName[name]!;
    writeCache(dirname(args.configPath), def.command, session.capabilities);

    pool.closeSession(name, root);
  }

  const validation = validatePipelineCapabilities(
    config.pipeline,
    config.resolvedAgents,
    capsByAgent,
  );

  // Emit warnings for best-effort fields (model/effort).
  for (const w of validation.warnings) {
    const msg = `[capabilities] warning: ${formatDiagnosticLine(w)}`;
    ui.dispatch({ type: "warning", message: msg });
    logger.debug(msg);
  }

  // Mode errors are fatal — abort the Run with a grouped message.
  if (validation.errors.length > 0) {
    const lines = validation.errors.map((e) => `  ✗ ${formatDiagnosticLine(e)}`);
    throw new Error(
      `validação eager de capabilities falhou:\n${lines.join("\n")}`,
    );
  }

  const git = createGit({ root });
  const checks: ChecksRunnerPort = {
    run: (list, opts) => runChecks(list, { cwd: resolvePath(root, opts.cwd) }),
  };

  const statePath = resolvePath(root, ".loopy/state.json");
  const pipelineHash = pipelineFingerprint(config.pipeline);

  // T-004: one mutex per Run serializes all parent-branch mutations.
  const parentMutex = createMutex();

  // C-0017 (ADR-0011): open the telemetry `.db` only when `metrics:` is present
  // — the opt-in gate (AD-1). Absent → `telemetry` stays undefined, the
  // orchestrator wires no recorder, and no `.db` is ever created. SQLite creates
  // the file but not its parent dir, so ensure `.db/` exists first. Best-effort:
  // a bootstrap failure must not abort the Run (collection is non-essential).
  let telemetry: TelemetryDb | undefined;
  if (config.metrics) {
    try {
      const dbPath = telemetryDbPath(root);
      mkdirSync(dirname(dbPath), { recursive: true });
      telemetry = await openDb(dbPath);
      await bootstrap(telemetry);
    } catch (err) {
      logger.error(`[telemetry] falha ao abrir o .db — coleta desativada: ${err}`);
      telemetry?.close();
      telemetry = undefined;
    }
  }

  const deps: OrchestratorDeps = {
    root,
    flags,
    registry: createFullRegistry({ parentMutex }),
    checks,
    ui: ui.ui,
    logger,
    markDone: createMarkDonePort({
      todoPath,
      commit: git.commitPaths,
      backlogOptions,
    }),
    git,
    notify,
    // Wrap sessionProvider to route to the correct Process and register
    // sessionId→{taskId,agent} when a session opens.
    sessionProvider: async (agentName, cwd) => {
      const session = await pool.session(agentName, cwd);
      sessionToTask.set(session.sessionId, { taskId: basename(cwd), agent: agentName });
      return session;
    },
    checkpoint: createCheckpointPort({ statePath, pipelineHash }),
    knownTaskIds,
    parentMutex,
    telemetry,
    emit: (event) => {
      // Track currentStepId per task for usage_sample stamping (T-007).
      if (event.type === "step_started") {
        taskCurrentStep.set(event.taskId, event.stepId);
      } else if (event.type === "step_finished") {
        taskCurrentStep.delete(event.taskId);
      }
      ui.dispatch(event);
    },
  };

  try {
    // T-006: emit run_started before the loop when --emit-events is active.
    ui.transport?.emitControl({ control: "run_started" });

    const result = await runLoop(config, tasks, deps);

    // T-006: emit run_finished after the loop when --emit-events is active.
    ui.transport?.emitControl({ control: "run_finished", result });

    return result;
  } finally {
    await pool.shutdownAll();
    ui.stop();
    // Close the telemetry connection so WAL flushes to the main `.db` file.
    telemetry?.close();
    // Drain buffered notify messages to stderr after the TUI is unmounted.
    for (const msg of notifyBuffer) {
      io.err(`${msg}\n`);
    }
  }
}

/**
 * The live path (no `--dry-run`): first-run git setup behind approval, `--task`
 * selection + OQ6 warning, then the outer loop. Returns the process exit code:
 * `1` when a task escalated or the parent was dirty, `0` otherwise.
 */
async function runLiveFlow(
  dir: string,
  config: LoopyConfig,
  paths: { readonly configPath: string; readonly todoPath: string },
  pending: readonly Task[],
  knownTaskIds: readonly string[],
  flags: RunFlags,
  io: RunIO,
  hooks: RunHooks,
): Promise<number> {
  const root = resolvePath(dir);
  const repoPresent = hooks.isGitRepo ?? isGitRepo;
  const doInit = hooks.initGitRepo ?? initGitRepo;
  const approve = hooks.approve ?? defaultApprove;
  const live = hooks.runLive ?? defaultRunLive;

  // T-006: when --emit-events, stdout is the NDJSON channel.
  // All text output (status messages, git-init, summary) goes to stderr instead.
  const print = flags.emitEvents ? io.err : io.out;

  // 1) First-run git setup — behind a human approval gate (auto under --yes).
  if (!(await repoPresent(root))) {
    const prompt = `O diretório "${root}" não é um repositório git. Inicializar (git init + .gitignore + commit inicial)?`;
    const approved = flags.yes || (await approve(prompt));
    if (!approved) {
      io.err(
        "loopy: inicialização recusada — loopy requer um repositório git. Abortando.\n",
      );
      return 1;
    }
    await doInit({
      root,
      defaultBranch: config.workspace.parent_branch,
      ignore: gitignoreLinesFor(config),
    });
    print(`loopy: repositório git inicializado em "${root}".\n`);
  }

  // 2) Task selection — `--task` runs one task (OQ6: warn, don't block).
  //    T-011: forces concurrency=1 and warns about non-done deps.
  let tasks: readonly Task[] = pending;
  let effectiveFlags = flags;
  if (flags.task !== undefined) {
    const selection = selectTask(pending, flags.task);
    if (selection.task === undefined) {
      io.err(
        `loopy: task "${flags.task}" não encontrada entre as pendentes.\n`,
      );
      return 1;
    }
    if (selection.priorPending.length > 0) {
      const ids = selection.priorPending.map((t) => t.id).join(", ");
      io.err(
        `loopy: aviso — tasks pendentes anteriores a ${flags.task}: ${ids} ` +
          `(rodando ${flags.task} isolada mesmo assim).\n`,
      );
    }
    // T-011: warn if the task has non-done deps.
    const pendingIds = new Set(pending.map((t) => t.id));
    const nonDoneDeps = selection.task.deps.filter((d) => pendingIds.has(d));
    if (nonDoneDeps.length > 0) {
      io.err(
        `loopy: aviso — task ${flags.task} depende de ${nonDoneDeps.join(", ")} ` +
          `(não concluídas); rodando isolada com concurrency=1 mesmo assim.\n`,
      );
    }
    // T-011: --task forces concurrency = 1.
    effectiveFlags = { ...flags, concurrency: 1 };
    tasks = [selection.task];
  }

  if (tasks.length === 0) {
    print("loopy: nenhuma task pendente no backlog — nada a fazer.\n");
    return 0;
  }

  // 3) Run the live outer loop.
  print(`loopy: iniciando ${tasks.length} task(s)…\n`);
  // When --emit-events, pass stderr-redirected IO to the live executor so its
  // internal logger never writes to stdout (the NDJSON channel).
  const liveIO: RunIO = flags.emitEvents ? { out: io.err, err: io.err } : io;
  let result: RunLoopResult;
  try {
    result = await live({
      config,
      tasks,
      flags: effectiveFlags,
      root,
      configPath: paths.configPath,
      todoPath: paths.todoPath,
      knownTaskIds,
      io: liveIO,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    io.err(`loopy: falha na execução: ${reason}\n`);
    return 1;
  }

  // 4) End-of-change gate (C-0017 / D2): when `metrics:` is on and the backlog
  //    re-parses to zero pending, the change is complete — mark it `merged`.
  //    Replaces the metrics.json / index.md persistence T-003 removed (the same
  //    trigger: a full `- [x]` backlog). Best-effort, never fatal.
  if (config.metrics) {
    await markChangeMergedIfComplete(config, paths.todoPath, root);
  }

  // 5) Summary + exit code.
  print(
    `loopy: fim — ${result.completed.length} concluída(s), ` +
      `${result.escalated.length} escalada(s), ` +
      `${result.paused.length} pausada(s), ` +
      `${result.skipped.length} pulada(s); parada: ${result.stoppedBy}.\n`,
  );
  const problem =
    result.escalated.length > 0 ||
    result.paused.length > 0 ||
    result.stoppedBy === "dirty_parent";
  return problem ? 1 : 0;
}

/**
 * Path of the telemetry `.db` under a workspace `root` (C-0017). Single source
 * so the run's writer (`defaultRunLive`) and the end-of-change reader
 * ({@link markChangeMergedIfComplete}) can never drift to different files.
 */
function telemetryDbPath(root: string): string {
  return resolvePath(root, ".db/telemetry.db");
}

/**
 * End-of-change gate (C-0017 / D2): if re-parsing the backlog shows zero pending
 * tasks — the same trigger the change report used before T-003 — close the
 * change dimension as `merged`. Opens a fresh telemetry connection because the
 * run's own handle was closed in `defaultRunLive`'s `finally` (so WAL flushed);
 * only when the `.db` already exists (never creates one just to mark merged).
 * Best-effort: a missing db, a still-pending backlog, or any fault is a no-op.
 */
async function markChangeMergedIfComplete(
  config: LoopyConfig,
  todoPath: string,
  root: string,
): Promise<void> {
  const backlogOptions = backlogOptionsFrom(config.inputs.backlog);
  const current = loadBacklog(todoPath, backlogOptions);
  if (pendingTasks(current).length > 0) return;

  const dbPath = telemetryDbPath(root);
  if (!existsSync(dbPath)) return;

  let db: TelemetryDb | undefined;
  try {
    db = await openDb(dbPath);
    markChangeMerged(db, telemetryChangeId(config), new Date().toISOString());
  } catch {
    // Best-effort: closing the change never fails the run (D9).
  } finally {
    db?.close();
  }
}

// ---------------------------------------------------------------------------
// Telemetry annotation subcommands (T-008 / C-0017): the write surface the GUI
// drives one-shot (D6/D20), mirroring `probe-agent`. Each opens the existing
// `.db` under `[dir]`, applies one mutation via `src/telemetry/annotate`, and
// turns the typed result into a message + exit code.
// ---------------------------------------------------------------------------

/**
 * Open the telemetry `.db` under `dir` for a one-shot annotation, run `fn`, and
 * always close (so WAL flushes). The `.db` must already exist — annotations
 * target a change/task the run recorded and never create an empty database
 * (mirrors {@link markChangeMergedIfComplete}). Missing `.db` → actionable
 * error, exit 1.
 */
async function withTelemetryDb(
  dir: string,
  io: RunIO,
  fn: (db: TelemetryDb) => number,
): Promise<number> {
  const dbPath = telemetryDbPath(resolvePath(dir));
  if (!existsSync(dbPath)) {
    io.err(
      `loopy: sem telemetria em ${dbPath} — rode uma change com 'metrics:' ligado antes de anotar.\n`,
    );
    return 1;
  }
  let db: TelemetryDb | undefined;
  try {
    db = await openDb(dbPath);
    await bootstrap(db);
    return fn(db);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    io.err(`loopy: falha ao acessar a telemetria: ${reason}\n`);
    return 1;
  } finally {
    db?.close();
  }
}

/**
 * Resolve the `--by` author of a verdict: the explicit flag, else
 * `git config user.name`, else `$USER` (best-effort — a bare `unknown` is the
 * last resort, never a failure).
 */
async function resolveVerdictAuthor(
  explicit: string | undefined,
  dir: string,
): Promise<string> {
  const given = explicit?.trim();
  if (given) return given;
  try {
    const res = await execa("git", ["config", "user.name"], {
      cwd: resolvePath(dir),
      reject: false,
      stripFinalNewline: true,
    });
    if (res.exitCode === 0 && res.stdout.trim()) return res.stdout.trim();
  } catch {
    // Fall through to $USER when git is absent or has no user.name.
  }
  return process.env.USER?.trim() || "unknown";
}

const BUG_SEVERITIES: readonly BugSeverity[] = ["low", "medium", "high", "critical"];

function isBugSeverity(value: string): value is BugSeverity {
  return (BUG_SEVERITIES as readonly string[]).includes(value);
}

/** `verdict set` — upsert a task's human verdict (D20). */
async function executeVerdictSet(
  opts: {
    task?: string;
    pass?: boolean;
    fail?: boolean;
    note?: string;
    by?: string;
  },
  dir: string,
  io: RunIO,
): Promise<number> {
  if (!opts.task) {
    io.err("loopy: verdict set exige --task <id>.\n");
    return 1;
  }
  if (!opts.pass && !opts.fail) {
    io.err("loopy: verdict set exige um de --pass ou --fail.\n");
    return 1;
  }
  if (opts.pass && opts.fail) {
    io.err("loopy: verdict set aceita --pass OU --fail, não os dois.\n");
    return 1;
  }
  const taskId = opts.task;
  const verdict: Verdict = opts.pass ? "pass" : "fail";
  const by = await resolveVerdictAuthor(opts.by, dir);
  return withTelemetryDb(dir, io, (db) => {
    const res = setVerdict(db, {
      taskId,
      verdict,
      note: opts.note ?? null,
      by,
      at: new Date().toISOString(),
    });
    if (!res.ok) {
      io.err(`loopy: task "${taskId}" não encontrada na telemetria.\n`);
      return 1;
    }
    io.out(`loopy: veredito ${verdict} registrado para ${taskId} (por ${by}).\n`);
    return 0;
  });
}

/** `verdict clear` — delete a task's verdict (tri-state → NULL, D20). Idempotent. */
async function executeVerdictClear(
  opts: { task?: string },
  dir: string,
  io: RunIO,
): Promise<number> {
  if (!opts.task) {
    io.err("loopy: verdict clear exige --task <id>.\n");
    return 1;
  }
  const taskId = opts.task;
  return withTelemetryDb(dir, io, (db) => {
    const { removed } = clearVerdict(db, taskId);
    io.out(
      removed
        ? `loopy: veredito de ${taskId} removido (volta a não avaliada).\n`
        : `loopy: ${taskId} já estava sem veredito.\n`,
    );
    return 0;
  });
}

/** `bug add` — insert a bug linked to a task (FK, no change restriction, D14). */
async function executeBugAdd(
  opts: {
    task?: string;
    severity?: string;
    title?: string;
    detail?: string;
    foundIn?: string;
  },
  dir: string,
  io: RunIO,
): Promise<number> {
  if (!opts.task) {
    io.err("loopy: bug add exige --task <id>.\n");
    return 1;
  }
  if (!opts.severity) {
    io.err("loopy: bug add exige --severity <low|medium|high|critical>.\n");
    return 1;
  }
  if (!isBugSeverity(opts.severity)) {
    io.err(
      `loopy: severidade "${opts.severity}" inválida (use low|medium|high|critical).\n`,
    );
    return 1;
  }
  if (!opts.title) {
    io.err("loopy: bug add exige --title <texto>.\n");
    return 1;
  }
  const taskId = opts.task;
  const title = opts.title;
  const severity = opts.severity;
  return withTelemetryDb(dir, io, (db) => {
    const res = addBug(db, {
      taskId,
      severity,
      title,
      detail: opts.detail ?? null,
      foundInChange: opts.foundIn ?? null,
      reportedAt: new Date().toISOString(),
    });
    if (!res.ok) {
      io.err(
        res.reason === "unknown-task"
          ? `loopy: task "${taskId}" não encontrada na telemetria.\n`
          : `loopy: change "${opts.foundIn}" (--found-in) não encontrada na telemetria.\n`,
      );
      return 1;
    }
    io.out(
      `loopy: bug registrado em ${taskId} (severidade ${severity}, id ${res.bugId}).\n`,
    );
    return 0;
  });
}

/** `change --abandoned|--failed` — close the change dimension (D2/D20). */
async function executeChangeStatus(
  opts: { abandoned?: boolean; failed?: boolean; change?: string },
  dir: string,
  io: RunIO,
): Promise<number> {
  if (!opts.abandoned && !opts.failed) {
    io.err("loopy: change exige um de --abandoned ou --failed.\n");
    return 1;
  }
  if (opts.abandoned && opts.failed) {
    io.err("loopy: change aceita --abandoned OU --failed, não os dois.\n");
    return 1;
  }
  const status = opts.abandoned ? "abandoned" : "failed";
  return withTelemetryDb(dir, io, (db) => {
    const res = setChangeStatus(db, status, new Date().toISOString(), opts.change);
    if (!res.ok) {
      switch (res.reason) {
        case "unknown-change":
          io.err(`loopy: change "${res.changeId}" não encontrada na telemetria.\n`);
          break;
        case "already-closed":
          io.err(
            `loopy: change "${res.changeId}" já está fechada (status ${res.status}).\n`,
          );
          break;
        case "no-open-change":
          io.err("loopy: nenhuma change aberta na telemetria; passe --change <id>.\n");
          break;
        case "ambiguous":
          io.err(
            `loopy: múltiplas changes abertas (${res.candidates.join(", ")}); passe --change <id>.\n`,
          );
          break;
      }
      return 1;
    }
    io.out(`loopy: change ${res.changeId} fechada como ${status}.\n`);
    return 0;
  });
}

/**
 * Register the `verdict` / `bug` / `change` annotation subcommands on `program`,
 * routing usage output through `io` and reporting each action's exit code via
 * `setExit` (the same seam `probe-agent` uses in {@link run}).
 */
function registerAnnotateCommands(
  program: Command,
  io: RunIO,
  setExit: (code: number) => void,
): void {
  const withIoConfig = (cmd: Command): Command =>
    cmd.exitOverride().configureOutput({
      writeOut: (str) => io.out(str),
      writeErr: (str) => io.err(str),
    });

  const verdict = withIoConfig(program.command("verdict")).description(
    "anota o veredito humano de uma task na telemetria (C-0017)",
  );
  withIoConfig(verdict.command("set"))
    .description("registra pass/fail para uma task (upsert)")
    .option("--task <id>", "id da task na telemetria (ex.: C-0016/T-002)")
    .option("--pass", "marca a task como aprovada")
    .option("--fail", "marca a task como reprovada")
    .option("--note <texto>", "nota livre do veredito")
    .option("--by <autor>", "autor (default: git config user.name → $USER)")
    .argument("[dir]", "diretorio do projeto-alvo", ".")
    .action(async (dir: string, opts) => setExit(await executeVerdictSet(opts, dir, io)));
  withIoConfig(verdict.command("clear"))
    .description("apaga o veredito de uma task (volta ao tri-estado não avaliada)")
    .option("--task <id>", "id da task na telemetria (ex.: C-0016/T-002)")
    .argument("[dir]", "diretorio do projeto-alvo", ".")
    .action(async (dir: string, opts) => setExit(await executeVerdictClear(opts, dir, io)));

  const bug = withIoConfig(program.command("bug")).description(
    "anota bugs na telemetria (C-0017)",
  );
  withIoConfig(bug.command("add"))
    .description("registra um bug ligado a uma task (FK; bug de change anterior é normal)")
    .option("--task <id>", "id da task na telemetria (ex.: C-0016/T-002)")
    .option("--severity <nivel>", "low|medium|high|critical")
    .option("--title <texto>", "título curto do bug")
    .option("--detail <texto>", "descrição opcional")
    .option("--found-in <change>", "change onde o bug foi encontrado (id, ex.: C-0017)")
    .argument("[dir]", "diretorio do projeto-alvo", ".")
    .action(async (dir: string, opts) => setExit(await executeBugAdd(opts, dir, io)));

  withIoConfig(program.command("change"))
    .description(
      "fecha a dimensão change fora do caminho merged (--abandoned|--failed) (C-0017)",
    )
    .option("--abandoned", "fecha a change como abandonada")
    .option("--failed", "fecha a change como falha")
    .option("--change <id>", "id da change (default: a única change aberta)")
    .argument("[dir]", "diretorio do projeto-alvo", ".")
    .action(async (dir: string, opts) => setExit(await executeChangeStatus(opts, dir, io)));
}

/**
 * Pick the `--clean` target: explicit id, or the single paused/running entry.
 * Returns the task id on success, or an error message on ambiguity/absence.
 */
function resolveCleanTarget(
  state: RunState,
  clean: string | boolean,
): { id: string } | { error: string } {
  if (typeof clean === "string") return { id: clean };
  const resumable = Object.entries(state.tasks).filter(
    ([, cp]) => cp.status === "paused" || cp.status === "running",
  );
  if (resumable.length === 0) {
    return { error: "nenhum checkpoint pausado/em-progresso encontrado. Passe o id explicitamente." };
  }
  if (resumable.length > 1) {
    const ids = resumable.map(([id]) => id).join(", ");
    return { error: `múltiplos checkpoints (${ids}). Passe o id explicitamente.` };
  }
  return { id: resumable[0]![0] };
}

/** Run `op` and log success; on failure log fallback (best-effort git teardown). */
async function tryRemove(
  op: () => Promise<void>,
  label: string,
  detail: string,
  io: RunIO,
): Promise<void> {
  try {
    await op();
    io.out(`loopy: ${label} removido: ${detail}\n`);
  } catch {
    io.out(`loopy: ${label} já ausente: ${detail}\n`);
  }
}

/**
 * `--clean [id]` teardown: remove worktree + branch + checkpoint entry and exit.
 * Best-effort: tolerates missing worktree/branch (logs instead of failing).
 */
async function cleanFlow(
  dir: string,
  config: LoopyConfig,
  backlog: readonly Task[],
  clean: string | boolean,
  io: RunIO,
): Promise<number> {
  const root = resolvePath(dir);
  const statePath = resolvePath(root, ".loopy/state.json");
  const state = loadState(statePath);

  const target = resolveCleanTarget(state, clean);
  if ("error" in target) {
    io.err(`loopy: --clean: ${target.error}\n`);
    return 1;
  }

  const task = backlog.find((t) => t.id === target.id);
  if (task === undefined) {
    io.err(`loopy: --clean: task "${target.id}" não encontrada no backlog.\n`);
    return 1;
  }

  const wtPath = resolvePath(root, worktreePathFor(config, task));
  const git = createGit({ root });
  await tryRemove(() => git.removeWorktree(wtPath, { force: true }), "worktree", wtPath, io);
  await tryRemove(() => git.deleteBranch(task.branch), "branch", task.branch, io);

  saveState(statePath, clearTaskIn(state, target.id));
  io.out(`loopy: checkpoint limpo para ${target.id}.\n`);
  return 0;
}

/** `true` iff `path` exists and is a regular file (missing path → `false`). */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Print capabilities in human-readable form (no `--json`). */
function formatCapabilities(caps: AgentCapabilities, io: RunIO): void {
  const line = (label: string, items: readonly string[]): string =>
    items.length > 0 ? `${label}: ${items.join(", ")}` : `${label}: —`;

  const models = caps.models.length > 0
    ? `models: ${caps.models.length} (${caps.models.slice(0, 3).join(", ")}${caps.models.length > 3 ? ", …" : ""})`
    : "models: —";

  io.out(`${line("modes", caps.modes)}\n${models}\n${line("efforts", caps.efforts)}\n`);
}

/**
 * `probe-agent <nome>` subcommand (T-008, D30/D32): spawn a single agent
 * process, open a disposable session, read `session.capabilities`, print,
 * cache to `.loopy/capabilities.json`, then shut everything down. Zero
 * worktree, zero tokens.
 *
 * **Probed with a model applied** (`--model`, defaulting to the agent's `model`
 * in the registry). Capabilities are not always static: OpenCode announces
 * `thought_level` only when the *current* model has variants, so a bare probe
 * reads the adapter's own default model and reports "no effort" for an agent
 * that does support it. The model is part of the cache key.
 *
 * **Two ways to say *which* agent** (D-0011):
 *  - `<nome>` — resolved against the registry of the **saved** `loopy.yml`;
 *  - `--command <argv...>` (+ `--env K=V`) — the argv **verbatim**, no registry.
 *
 * The argv form exists because the GUI edits a *draft*: an agent whose preset was
 * just changed (or that was just created) does not exist on disk yet, and probing
 * it by name would silently answer for the **saved** definition — the old adapter.
 * Everything else in this feature is already keyed by argv (the cache included),
 * so the name was the last thing tying a probe to the file.
 */
/**
 * Load the config, tolerating its absence/invalidity. Only used by the `--command`
 * form of `probe-agent`, where the argv is self-sufficient and the config is a
 * nicety (permission policy) — a project whose yml was never saved must still be
 * probeable.
 */
function tryLoadConfig(configPath: string): LoopyConfig | undefined {
  try {
    return loadConfig(configPath);
  } catch {
    return undefined;
  }
}

/** Parse `--env K=V` pairs into an env record (a value may contain `=`). */
function parseEnvPairs(pairs: readonly string[] | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const pair of pairs ?? []) {
    const eq = pair.indexOf("=");
    if (eq > 0) env[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return env;
}

/**
 * The definition the probe runs against: the literal argv (`--command`) when
 * given, otherwise the registry entry for `<nome>` (D-0011). `undefined` = the
 * name is not in the registry.
 */
function agentDefForProbe(
  nome: string | undefined,
  command: readonly string[] | undefined,
  envPairs: readonly string[] | undefined,
  config: LoopyConfig | undefined,
): AgentDef | undefined {
  if (command && command.length > 0) {
    const env = parseEnvPairs(envPairs);
    return {
      command: [...command],
      ...(Object.keys(env).length > 0 ? { env } : {}),
    };
  }
  return nome ? config?.resolvedAgents.byName[nome] : undefined;
}

async function executeProbeAgent(
  nome: string | undefined,
  opts: {
    config?: string;
    json: boolean;
    model?: string;
    command?: string[];
    env?: string[];
  },
  io: RunIO,
): Promise<number> {
  const configPath = opts.config
    ? resolvePath(opts.config)
    : resolvePath("loopy.yml");

  // With an explicit argv the config is optional (the draft may not be on disk
  // yet) — it is only consulted for the permission policy.
  const config = opts.command ? tryLoadConfig(configPath) : loadConfig(configPath);

  const agentDef = agentDefForProbe(nome, opts.command, opts.env, config);
  if (!agentDef) {
    const available = Object.keys(config?.resolvedAgents.byName ?? {}).join(", ");
    io.err(
      `loopy: agente "${nome}" não encontrado no registry (disponíveis: ${available}).\n`,
    );
    return 1;
  }
  const label = nome ?? agentDef.command.join(" ");

  // Agent process and session cwd — always the working directory (like execute(dir)).
  const root = resolvePath(".");
  // Cache location — next to the config file (same as the project root when --config is omitted).
  const cacheRoot = dirname(configPath);
  const resolvedEnv = resolveAgentEnv({ [label]: agentDef }, process.env);
  const envOverrides = resolvedEnv[label];

  let handle: AgentHandle;
  try {
    handle = await openAgent({
      command: agentDef.command,
      cwd: root,
      env:
        envOverrides && Object.keys(envOverrides).length > 0
          ? { ...process.env, ...envOverrides }
          : undefined,
      permissions: {
        on_request: config?.acp.permissions.on_request ?? "allow",
      },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    io.err(`loopy: falha ao iniciar o agente "${label}": ${reason}\n`);
    return 1;
  }

  // The model the probe runs under: explicit flag wins over the registry.
  const model = opts.model ?? agentDef.model;

  try {
    const session = await buildSession(
      { ctx: handle.ctx, text: handle.text, cost: handle.cost },
      root,
    ).start();

    // Apply the model first — on adapters that derive effort from the model
    // (OpenCode), this is what makes `thought_level` appear at all. Best-effort:
    // a model the agent doesn't announce is skipped, and the probe still
    // reports whatever the session/new capabilities were.
    if (model !== undefined) {
      await session.setModel(model);
    }

    const caps = session.capabilities;

    if (opts.json) {
      io.out(JSON.stringify(caps) + "\n");
    } else {
      formatCapabilities(caps, io);
    }

    writeCache(cacheRoot, agentDef.command, caps, model);
    session.dispose();
    return 0;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    io.err(`loopy: falha ao sondar o agente "${label}": ${reason}\n`);
    return 1;
  } finally {
    await handle.shutdown();
  }
}

/** Load config + backlog for `dir` and dispatch on the flags. */
async function execute(
  dir: string,
  flags: RunFlags,
  io: RunIO,
  hooks: RunHooks,
): Promise<number> {
  const configPath = flags.config
    ? resolvePath(flags.config)
    : resolvePath(dir, "loopy.yml");
  // The positional arg is the target DIRECTORY (we look for `<dir>/loopy.yml`).
  // A common slip is passing the config file itself, which turns the join into
  // `<file>/loopy.yml` and fails with a cryptic ENOTDIR — catch it with a hint.
  if (!flags.config && isFile(resolvePath(dir))) {
    throw new ConfigError(
      `"${dir}" é um arquivo, mas o argumento posicional é o diretório do ` +
        `projeto-alvo (procuro "<dir>/loopy.yml"). Para apontar um config ` +
        `específico, use --config ${dir}.`,
    );
  }
  // Config is loaded first, so an invalid config aborts before any effect.
  const config = loadConfig(configPath);

  // Non-blocking warnings (cycles, always+goto, deprecations) — stderr, never fatal.
  const warnings = [
    ...collectPipelineWarnings(config.pipeline, config.resolvedAgents),
    ...collectDeprecationWarnings(config),
  ];
  if (warnings.length > 0) {
    io.err(`loopy: ${formatWarnings(warnings, configPath)}\n`);
  }

  const todoPath = resolvePath(dir, config.inputs.todo);
  const backlogOptions = backlogOptionsFrom(config.inputs.backlog);
  const backlog = loadBacklog(todoPath, backlogOptions);
  const knownTaskIds = backlog.map((t) => t.id);
  const pending = pendingTasks(backlog);

  if (flags.clean) {
    // `--clean` sem id anexado + `-t <id>` → usa o id da task (mesma intenção
    // que `--clean <id>`); caso contrário respeita o id anexado ao próprio flag.
    const target = flags.clean === true && flags.task ? flags.task : flags.clean;
    return cleanFlow(dir, config, backlog, target, io);
  }

  if (flags.dryRun) {
    return printDryRun(config, pending, { configPath, todoPath }, io, {
      knownTaskIds,
      concurrency: flags.concurrency,
    });
  }

  return runLiveFlow(
    dir,
    config,
    { configPath, todoPath },
    pending,
    knownTaskIds,
    flags,
    io,
    hooks,
  );
}

/**
 * Fatia o `--command` do `probe-agent`, que consome **o resto da linha, cru**.
 *
 * O parser do Commander encerra um option variádico no primeiro token que
 * *parece* uma flag (`maybeOption()`: começa com `-`), e então tenta resolvê-lo
 * contra as opções do subcomando. Logo `--command npx -y <pkg>` morria com
 * `error: unknown option '-y'` — e `npx -y …` é o argv de todo preset npm do
 * Catálogo (ADR-0010), o que deixava a Sondagem por argv da GUI (D-0011)
 * quebrada justamente para Claude e Codex.
 *
 * O argv de um adapter é **opaco** para o motor: pode carregar qualquer flag, e
 * nenhuma delas é nossa. Por isso ele não passa pelo parser — o que vem depois
 * de `--command` é fatiado aqui e só o prefixo segue para o Commander. Puro
 * (AD-6): a declaração da option sobrevive apenas para o `--help`.
 */
function splitAgentCommand(argv: readonly string[]): {
  readonly head: readonly string[];
  readonly command?: readonly string[];
} {
  if (argv[0] !== "probe-agent") return { head: argv };

  const at = argv.findIndex(
    (arg) => arg === "--command" || arg.startsWith("--command="),
  );
  if (at < 0) return { head: argv };

  const inline = argv[at]!.startsWith("--command=")
    ? [argv[at]!.slice("--command=".length)]
    : [];
  return {
    head: argv.slice(0, at),
    command: [...inline, ...argv.slice(at + 1)],
  };
}

/**
 * Parse `argv` (user args, no node/script), then run. Returns the process exit
 * code. Never throws for expected failures: commander usage errors and config /
 * backlog / interpolation errors become a clear message + non-zero code.
 *
 * T-008: now uses `parseAsync` + `.action()` so the `probe-agent` subcommand
 * coexists with the root `[dir]` positional without ambiguity — Commander
 * matches subcommands before optional arguments.
 */
export async function run(
  argv: readonly string[],
  io: RunIO = defaultIO,
  hooks: RunHooks = {},
): Promise<number> {
  const program = buildProgram(io);
  let exitCode = 0;

  // O argv do adapter (`probe-agent --command …`) é fatiado antes do parser:
  // ele pode conter flags que não são nossas (`-y`). Ver `splitAgentCommand`.
  const { head, command: adapterArgv } = splitAgentCommand(argv);

  // Root command action — the default flow (loopy [dir]).
  program.action(async (dir: string) => {
    const flags = toFlags(program.opts());
    try {
      exitCode = await execute(dir, flags, io, hooks);
    } catch (err) {
      if (
        err instanceof ConfigError ||
        err instanceof BacklogError ||
        err instanceof InterpolationError
      ) {
        io.err(`loopy: ${err.message}\n`);
        exitCode = 1;
        return;
      }
      throw err;
    }
  });

  // T-008: probe-agent subcommand (D30/D32).
  program
    .command("probe-agent")
    .description("Sonda as capabilities de um agente ACP e grava o cache")
    .argument(
      "[nome]",
      "nome do agente no registry (agents: do loopy.yml); dispensável com --command",
    )
    .option("-c, --config <path>", "caminho alternativo do loopy.yml")
    .option("--json", "imprime o objeto AgentCapabilities cru em JSON", false)
    .option(
      "--model <id>",
      "sonda COM este model aplicado (default: o model do agente no registry) — " +
        "adapters como o OpenCode só anunciam effort a partir do model corrente",
    )
    .option(
      "--command <argv...>",
      "argv literal do adapter — sonda sem passar pelo registry (nem pelo yml salvo). " +
        "DEVE vir por último: consome o resto da linha, inclusive as flags do próprio " +
        "adapter (ex.: --command npx -y @agentclientprotocol/codex-acp)",
    )
    .option(
      "--env <pair>",
      "env do adapter no formato K=V (repetível); só com --command",
      (pair: string, acc: string[]) => [...acc, pair],
      [] as string[],
    )
    .exitOverride()
    .configureOutput({
      writeOut: (str) => io.out(str),
      writeErr: (str) => io.err(str),
    })
    .action(
      async (
        nome: string | undefined,
        opts: {
          config?: string;
          json: boolean;
          model?: string;
          command?: string[];
          env?: string[];
        },
      ) => {
        // O argv veio do fatiamento, não do parser (`splitAgentCommand`).
        const command = adapterArgv ? [...adapterArgv] : undefined;
        if (command && command.length === 0) {
          io.err(
            "loopy: --command exige o argv do adapter (ex.: --command npx -y <pacote>).\n",
          );
          exitCode = 1;
          return;
        }
        if (!nome && !command) {
          io.err("loopy: informe o <nome> do agente ou --command <argv...>.\n");
          exitCode = 1;
          return;
        }
        try {
          exitCode = await executeProbeAgent(nome, { ...opts, command }, io);
        } catch (err) {
          if (err instanceof ConfigError) {
            io.err(`loopy: ${err.message}\n`);
            exitCode = 1;
            return;
          }
          throw err;
        }
      },
    );

  // T-008 (C-0017): telemetry annotation subcommands (verdict/bug/change).
  registerAnnotateCommands(program, io, (code) => {
    exitCode = code;
  });

  try {
    await program.parseAsync([...head], { from: "user" });
  } catch (err) {
    // exitOverride turns help/version/usage exits into throws; help & version
    // carry exitCode 0, usage errors a non-zero code. The message (if any) was
    // already written through configureOutput.
    if (err instanceof CommanderError) return err.exitCode;
    throw err;
  }

  return exitCode;
}

/** `true` when this module is the process entrypoint (not an import). */
function isEntrypoint(): boolean {
  // A `bun --compile` sidecar lives in the virtual `$bunfs` while argv[1] is the
  // on-disk binary, so the realpath comparison below never matches. `import.meta.main`
  // is the reliable entrypoint signal there (and on Node ≥24); it stays false when
  // the module is imported (tests), so it only ever adds the missing true case.
  if ((import.meta as ImportMeta & { main?: boolean }).main) return true;
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(invoked)).href;
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  void run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
