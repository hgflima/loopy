/**
 * `loopy` CLI entrypoint — `commander` parses `loopy [dir]` plus the run flags,
 * then dispatches to the engine. This phase (T-005) wires the `--dry-run`
 * capability end-to-end: load config → load backlog → resolve interpolation per
 * task → print the resolved pipeline, with **no** writes/commit/merge (Success
 * Criterion #8). The remaining flags are parsed and carried on {@link RunFlags}
 * for later phases even though the live loop is not yet wired here.
 *
 * `run()` is exported and takes the user args + an IO sink so it is testable
 * without touching `process`. The bottom-of-file guard invokes it only when the
 * module is executed directly (never when imported by tests).
 *
 * Errors are values at this boundary: config / backlog / interpolation failures
 * are caught and reported as a clear message + non-zero exit, never a stack
 * trace. Invalid config aborts before any effect (it is loaded first).
 */
import { realpathSync } from "node:fs";
import { relative, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { Command, CommanderError, InvalidArgumentError } from "commander";
import {
  BacklogError,
  backlogOptionsFrom,
  loadBacklog,
  pendingTasks,
} from "./backlog/todo";
import { ConfigError, loadConfig } from "./config/load";
import { InterpolationError } from "./interp/resolver";
import { formatDryRunPlan, planDryRun } from "./loop/orchestrator";
import type { LoopyConfig, RunFlags, Task } from "./types";

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

/** Load config + backlog for `dir` and dispatch on the flags. */
function execute(dir: string, flags: RunFlags, io: RunIO): number {
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

  // The live loop (worktree → agent → merge → mark-done) lands in later phases
  // (T-010/T-015). Flags are parsed and available; only --dry-run is wired now.
  io.err(
    "loopy: execucao interativa ainda não implementada nesta fase — use --dry-run.\n",
  );
  return 1;
}

/**
 * Parse `argv` (user args, no node/script), then run. Returns the process exit
 * code. Never throws for expected failures: commander usage errors and config /
 * backlog / interpolation errors become a clear message + non-zero code.
 */
export async function run(
  argv: readonly string[],
  io: RunIO = defaultIO,
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
    // `execute` is synchronous; the async signature lets later phases await the
    // live loop. A synchronous throw here is still caught below.
    return execute(dir, flags, io);
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
