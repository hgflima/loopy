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
import { realpathSync } from "node:fs";
import { relative, resolve as resolvePath } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { Command, CommanderError, InvalidArgumentError } from "commander";
import { openAgent } from "./acp/agent";
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
import {
  createGit,
  initGitRepo,
  isGitRepo,
  type InitGitRepoOptions,
} from "./git/worktree";
import { InterpolationError } from "./interp/resolver";
import { createLogFactory } from "./logging/logger";
import {
  createMarkDonePort,
  formatDryRunPlan,
  planDryRun,
  runLoop,
  type OrchestratorDeps,
  type RunLoopResult,
} from "./loop/orchestrator";
import { createFullRegistry } from "./steps/index";
import { startUi } from "./tui/start";
import type {
  ChecksRunnerPort,
  LoggerPort,
  LoopyConfig,
  RunFlags,
  Task,
} from "./types";

const VERSION = "0.1.0";

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
  };
}

/** Print the resolved pipeline for the pending tasks. No side effects. */
function printDryRun(
  config: LoopyConfig,
  pending: readonly Task[],
  paths: { readonly configPath: string; readonly todoPath: string },
  io: RunIO,
): number {
  // Build the plan first: an unknown-variable error (OQ1) surfaces before any
  // output is emitted, keeping the failure clean.
  const plan = planDryRun(config, pending);

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
  const { config, tasks, flags, root, todoPath, io } = args;
  const backlogOptions = backlogOptionsFrom(config.inputs.backlog);

  const logFactory = createLogFactory({
    config: config.logging,
    root,
    verbose: flags.verbose,
  });
  const logger = teeLogger(logFactory.forTask("loopy"), io, flags.verbose);
  const ui = startUi({ flags });

  const agent = await openAgent({
    command: config.acp.command,
    cwd: root,
    permissions: { on_request: config.acp.permissions.on_request },
    logger,
  });
  const pool = createSessionPool({ ctx: agent.ctx, text: agent.text, logger });
  const git = createGit({ root });
  const checks: ChecksRunnerPort = {
    run: (list, opts) => runChecks(list, { cwd: resolvePath(root, opts.cwd) }),
  };

  const deps: OrchestratorDeps = {
    root,
    flags,
    registry: createFullRegistry(),
    checks,
    ui: ui.ui,
    logger,
    markDone: createMarkDonePort({
      todoPath,
      commit: git.commitPaths,
      backlogOptions,
    }),
    git,
    notify: (message) => io.err(`${message}\n`),
    sessionProvider: (cwd) => pool.session(cwd),
  };

  try {
    return await runLoop(config, tasks, deps);
  } finally {
    pool.closeAll();
    await agent.shutdown();
    ui.stop();
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
  let tasks: readonly Task[] = pending;
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
      flags,
      root,
      configPath: paths.configPath,
      todoPath: paths.todoPath,
      io,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    io.err(`loopy: falha na execução: ${reason}\n`);
    return 1;
  }

  // 4) Summary + exit code.
  io.out(
    `loopy: fim — ${result.completed.length} concluída(s), ` +
      `${result.escalated.length} escalada(s); parada: ${result.stoppedBy}.\n`,
  );
  const problem =
    result.escalated.length > 0 || result.stoppedBy === "dirty_parent";
  return problem ? 1 : 0;
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
  // Config is loaded first, so an invalid config aborts before any effect.
  const config = loadConfig(configPath);

  const todoPath = resolvePath(dir, config.inputs.todo);
  const pending = pendingTasks(
    loadBacklog(todoPath, backlogOptionsFrom(config.inputs.backlog)),
  );

  if (flags.dryRun) {
    return printDryRun(config, pending, { configPath, todoPath }, io);
  }

  return runLiveFlow(
    dir,
    config,
    { configPath, todoPath },
    pending,
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
