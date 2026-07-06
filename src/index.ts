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
import { realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, normalize, relative, resolve as resolvePath } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { Command, CommanderError, InvalidArgumentError } from "commander";
import { openAgent } from "./acp/agent";
import { acpTrafficSummary, agentChunkText } from "./acp/client";
import { createSessionPool } from "./acp/session";
import {
  BacklogError,
  backlogOptionsFrom,
  loadBacklog,
  pendingTasks,
  selectTask,
} from "./backlog/todo";
import { runChecks } from "./checks/runner";
import { ConfigError, loadConfig } from "./config/load";
import { collectPipelineWarnings, formatWarnings } from "./config/warnings";
import {
  createGit,
  initGitRepo,
  isGitRepo,
  type InitGitRepoOptions,
} from "./git/worktree";
import {
  InterpolationError,
  resolve as resolveInterp,
  type Scope,
} from "./interp/resolver";
import { createLogFactory, type AcpTrafficEntry } from "./logging/logger";
import {
  createCheckpointPort,
  createMarkDonePort,
  deriveChange,
  formatDryRunPlan,
  planDryRun,
  runLoop,
  worktreePathFor,
  type OrchestratorDeps,
  type PlanDryRunOptions,
  type RunLoopResult,
} from "./loop/orchestrator";
import {
  loadMetrics,
  mergeRun,
  persistChangeReport,
  renderRunReport,
  saveMetrics,
} from "./metrics/index";
import {
  clearTaskIn,
  loadState,
  pipelineFingerprint,
  saveState,
} from "./resume/state";
import { createMutex } from "./loop/mutex";
import { createFullRegistry } from "./steps/index";
import { mountApp } from "./tui/mount";
import { startUi } from "./tui/start";
import type {
  ChecksRunnerPort,
  LoggerPort,
  LoopyConfig,
  RunFlags,
  RunState,
  Task,
} from "./types";

/**
 * Single source of truth: read the version from `package.json` at runtime rather
 * than hardcoding it (a hardcoded string silently drifts every release). Works in
 * both `dist/index.js` and `src/index.ts` (tsx) since each sits one level below
 * the package root, so `../package.json` resolves the same way.
 */
const VERSION = (
  createRequire(import.meta.url)("../package.json") as { version: string }
).version;

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
      "sobrescreve o pool de tasks paralelas (default: config)",
      parsePositiveInt,
    )
    .option("--no-tui", "forca logs de linha (sem Ink)")
    .option("--verbose", "inclui trafego ACP no log", false)
    .allowExcessArguments(false)
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
    verbose: opts.verbose === true,
    clean:
      typeof opts.clean === "string"
        ? opts.clean
        : opts.clean === true
          ? true
          : undefined,
    concurrency:
      typeof opts.concurrency === "number" ? opts.concurrency : undefined,
  };
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
  return 0;
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

/** Resolve `metrics.report.index` template against run-level scope vars. */
function resolveReportIndex(
  template: string,
  change: { readonly id: string; readonly dir: string },
  config: LoopyConfig,
  root: string,
): string {
  const map = new Map<string, string>([
    ["change.id", change.id],
    ["change.dir", change.dir],
    ["inputs.spec", config.inputs.spec],
    ["inputs.plan", config.inputs.plan],
    ["inputs.todo", config.inputs.todo],
    ["workspace.root", config.workspace.root],
    ["workspace.parent_branch", config.workspace.parent_branch],
    ["workspace.worktrees_dir", config.workspace.worktrees_dir],
  ]);
  const scope: Scope = {
    lookup: (k) => map.get(k),
    keys: () => [...map.keys()].sort(),
  };
  return resolvePath(root, normalize(resolveInterp(template, scope)));
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
 * The real live executor: spawn the single ACP agent for the run, wire git +
 * checks + the full step registry + the UI/approval transport, run the outer
 * loop over `tasks`, then tear everything down. This is thin composition over
 * already-tested building blocks; it hardcodes no loop behavior (AD-1).
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
  // stdout as before.
  const logger: LoggerPort = ui.tui
    ? fileLogger
    : teeLogger(fileLogger, io, flags.verbose);

  // Buffered notify for TUI mode: escalation/dirty-parent messages are held
  // and drained to stderr AFTER ui.stop() so they don't corrupt the frame.
  const notifyBuffer: string[] = [];
  const notify = ui.tui
    ? (message: string) => { notifyBuffer.push(message); }
    : (message: string) => io.err(`${message}\n`);

  // sessionId→taskId map: populated by the sessionProvider wrapper; read by
  // onUpdate/onTraffic to stamp the correct taskId on ACP callbacks.
  const sessionToTask = new Map<string, string>();

  // Gate ACP capture by --verbose / capture_acp_traffic.
  const captureAcp = flags.verbose || config.logging.capture_acp_traffic;

  /** Resolve sessionId to taskId (falls back to sessionId when not yet mapped). */
  const taskFor = (sessionId: string): string =>
    sessionToTask.get(sessionId) ?? sessionId;

  /** Dispatch one ACP traffic event to the store and log it to file. */
  const logTraffic = (taskId: string, entry: AcpTrafficEntry, summary: string): void => {
    ui.dispatch({ type: "acp_traffic", taskId, direction: entry.direction, method: entry.method, summary });
    fileLogger.acp(entry);
  };

  const defaultAgent = config.resolvedAgents.byName[config.resolvedAgents.default]!;
  const agent = await openAgent({
    command: defaultAgent.command,
    cwd: root,
    permissions: { on_request: config.acp.permissions.on_request },
    logger,
    onUpdate: (notification) => {
      // Agent stream → stream_chunk only; session/update as ACP traffic is
      // already captured by onTraffic (client.ts calls recv() before onUpdate).
      const text = agentChunkText(notification.update);
      if (text !== undefined) {
        ui.dispatch({ type: "stream_chunk", taskId: taskFor(notification.sessionId), text });
      }
    },
    onTraffic: captureAcp
      ? (entry, sessionId) => {
          logTraffic(taskFor(sessionId), entry, acpTrafficSummary(entry));
        }
      : undefined,
  });
  const pool = createSessionPool({ ctx: agent.ctx, text: agent.text, cost: agent.cost, logger });
  const git = createGit({ root });
  const checks: ChecksRunnerPort = {
    run: (list, opts) => runChecks(list, { cwd: resolvePath(root, opts.cwd) }),
  };

  const statePath = resolvePath(root, ".loopy/state.json");
  const pipelineHash = pipelineFingerprint(config.pipeline);

  // T-004: one mutex per Run serializes all parent-branch mutations.
  const parentMutex = createMutex();

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
    // Wrap sessionProvider to register sessionId→taskId when a session opens.
    sessionProvider: async (cwd) => {
      const session = await pool.session(cwd);
      sessionToTask.set(session.sessionId, basename(cwd));
      return session;
    },
    checkpoint: createCheckpointPort({ statePath, pipelineHash }),
    knownTaskIds,
    parentMutex,
    emit: ui.dispatch,
  };

  try {
    return await runLoop(config, tasks, deps);
  } finally {
    pool.closeAll();
    await agent.shutdown();
    ui.stop();
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
    io.out(`loopy: repositório git inicializado em "${root}".\n`);
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
    io.out("loopy: nenhuma task pendente no backlog — nada a fazer.\n");
    return 0;
  }

  // 3) Run the live outer loop.
  io.out(`loopy: iniciando ${tasks.length} task(s)…\n`);
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
      io,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    io.err(`loopy: falha na execução: ${reason}\n`);
    return 1;
  }

  // 4) Metrics — gated by config.metrics presence.
  if (config.metrics) {
    const change = deriveChange(config);
    const metricsPath = resolvePath(root, ".loopy/metrics.json");
    const existing = loadMetrics(metricsPath);
    const merged = mergeRun(existing, result.metrics, change);
    saveMetrics(metricsPath, merged);

    // Run report → stderr (after the TUI stopped in defaultRunLive's finally).
    io.err(renderRunReport(result.metrics, merged).join("\n") + "\n");

    // Change report — persist index.md when backlog is 100% [x] (T-006).
    // Trigger: re-parse todo.md (never stoppedBy) + report.index configured.
    if (config.metrics.report?.index) {
      const bo = backlogOptionsFrom(config.inputs.backlog);
      const current = loadBacklog(paths.todoPath, bo);
      if (pendingTasks(current).length === 0) {
        const indexPath = resolveReportIndex(
          config.metrics.report.index,
          change,
          config,
          root,
        );
        persistChangeReport(indexPath, change.id, merged);
      }
    }
  }

  // 5) Summary + exit code.
  io.out(
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

  // Non-blocking warnings (cycles, always+goto) — printed to stderr, never fatal.
  const warnings = collectPipelineWarnings(config.pipeline, config.resolvedAgents);
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
    const effectiveConcurrency = flags.concurrency ?? config.concurrency;
    return printDryRun(config, pending, { configPath, todoPath }, io, {
      knownTaskIds,
      concurrency: effectiveConcurrency,
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
 * Parse `argv` (user args, no node/script), then run. Returns the process exit
 * code. Never throws for expected failures: commander usage errors and config /
 * backlog / interpolation errors become a clear message + non-zero code.
 */
export async function run(
  argv: readonly string[],
  io: RunIO = defaultIO,
  hooks: RunHooks = {},
): Promise<number> {
  const program = buildProgram(io);

  try {
    program.parse([...argv], { from: "user" });
  } catch (err) {
    // exitOverride turns help/version/usage exits into throws; help & version
    // carry exitCode 0, usage errors a non-zero code. The message (if any) was
    // already written through configureOutput.
    if (err instanceof CommanderError) return err.exitCode;
    throw err;
  }

  const flags = toFlags(program.opts());
  const dir = (program.args[0] as string | undefined) ?? ".";

  try {
    return await execute(dir, flags, io, hooks);
  } catch (err) {
    if (
      err instanceof ConfigError ||
      err instanceof BacklogError ||
      err instanceof InterpolationError
    ) {
      io.err(`loopy: ${err.message}\n`);
      return 1;
    }
    throw err;
  }
}

/** `true` when this module is the process entrypoint (not an import). */
function isEntrypoint(): boolean {
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
