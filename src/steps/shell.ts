/**
 * `shell` step interpreter (AD-2) — runs a step's `run:[...]` commands, in
 * order, as direct subprocesses (execa with an argv[], NO shell).
 *
 * Why argv, not `/bin/sh -c` (the security fix). The example `loopy.yml` commands
 * carry quoted arguments with spaces and interpolated data — e.g.
 * `git -C "${worktree.path}" commit -m "feat(${task.id}): ${task.title}"`. An
 * earlier version handed the fully-resolved line to `/bin/sh -c` (`shell: true`)
 * to honor the yml's quoting. But that let the shell perform a SECOND round of
 * `$`-expansion on the interpolated DATA: a task titled `... ${...}` produced a
 * literal `${...}` in the command, which `/bin/sh` failed to expand
 * (`bad substitution`), and a title like `$(rm -rf ~)` would have been a silent
 * command injection. Instead we {@link tokenizeCommand} the RAW template (which
 * honors the quotes so quoted args survive) and resolve `${...}` *per token*,
 * then run the argv directly — the interpolated data is never re-interpreted by
 * a shell. This mirrors the argv model `git.commitPaths` already uses.
 *
 * Trade: without a shell there are no pipelines/redirection inside a single
 * command (each `run:` entry is one command); that matches how loopy configs are
 * written and is the intended, safer behavior.
 *
 * Two behaviors the acceptance criteria (T-008) pin down:
 *
 *  - **Order + short-circuit.** Commands run in order; the step stops at the
 *    first failing command — *unless* the step is `always: true`, in which case
 *    every command is attempted best-effort (the `cleanup` step must try both
 *    `worktree remove` and `branch -D` even if the first fails). The result is
 *    still truthful: `ok` is false whenever any command that ran failed.
 *  - **Interpolation up front (OQ1).** Every command is tokenized and resolved
 *    via `ctx.resolve` *before* any command executes, so an unknown-variable
 *    interpolation (or a malformed quote) aborts fail-fast — before a single
 *    side effect — rather than after a prefix of the list has already run.
 *
 * Errors as values (AD-5): a non-zero exit / spawn failure / timeout is a normal
 * {@link StepResult} with `ok: false`, never a thrown exception. Exceptions are
 * reserved for genuine faults (an unknown interpolation var; a malformed command
 * line; being handed a step of the wrong `type`).
 *
 * The concrete execa runner is injectable ({@link RunShellCommand}) so the
 * order/short-circuit/interpolation logic is unit-testable without spawning
 * processes — mirroring the seam in `checks/runner.ts`.
 */
import { execa } from "execa";
import type { Step, StepContext, StepResult } from "../types";
import { assertStepType } from "./guards";
import { displayCommand, tokenizeCommand } from "./tokenize";

/** Outcome of running a single command (errors captured, never thrown). */
export interface ShellCommandResult {
  /** A readable rendering of the argv that ran (for logs/reasons, not re-exec). */
  readonly command: string;
  readonly exitCode: number;
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs one command given its resolved `argv` (argv[0] is the program); injectable
 * so the step logic is unit-testable without spawning processes.
 */
export type RunShellCommand = (
  argv: readonly string[],
  ctx: { readonly cwd: string; readonly timeoutMs?: number },
) => Promise<ShellCommandResult>;

/** Coerce execa's stream field (a string under default options) to a string. */
function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Run one command via execa in `ctx.cwd` as a direct subprocess (argv, NO
 * shell), never throwing: a non-zero exit, a spawn failure and a timeout all
 * resolve to a {@link ShellCommandResult} with `ok: false`. Because the program
 * and its arguments are passed as an argv array, no `$`/backtick/glob/quote
 * interpretation is applied to the interpolated data.
 */
export const runShellCommandWithExeca: RunShellCommand = async (argv, ctx) => {
  const display = displayCommand(argv);
  const [file, ...args] = argv;
  if (file === undefined) {
    // An empty argv means a `run:` entry tokenized to nothing (e.g. blank line).
    return {
      command: display,
      exitCode: -1,
      ok: false,
      stdout: "",
      stderr: "comando vazio",
    };
  }

  const result = await execa(file, args, {
    cwd: ctx.cwd,
    reject: false,
    stripFinalNewline: true,
    timeout: ctx.timeoutMs,
  });

  const ok = !result.failed;
  const fallbackExit = ok ? 0 : -1;
  const exitCode =
    typeof result.exitCode === "number" ? result.exitCode : fallbackExit;
  const stdout = asString(result.stdout);
  let stderr = asString(result.stderr);

  if (!ok) {
    const shortMessage =
      typeof result.shortMessage === "string" ? result.shortMessage : "";
    if (stderr.trim() === "" && shortMessage !== "") stderr = shortMessage;
    if (result.timedOut) {
      const note = "Comando excedeu o tempo limite.";
      stderr = stderr.trim() === "" ? note : `${note}\n${stderr}`;
    }
  }

  return { command: display, exitCode, ok, stdout, stderr };
};

/** Options for {@link createShellStep}. */
export interface CreateShellStepOptions {
  /** Injection seam for tests; defaults to {@link runShellCommandWithExeca}. */
  readonly runCommand?: RunShellCommand;
  /** Optional per-command timeout in ms (no timeout by default). */
  readonly timeoutMs?: number;
}

/** Non-empty stdout+stderr of one command, for the aggregated step `output`. */
export function commandText(result: ShellCommandResult): string {
  return [result.stdout, result.stderr]
    .map((s) => s.trimEnd())
    .filter((s) => s !== "")
    .join("\n");
}

/**
 * Append a failed command's detail (stderr, falling back to stdout) to a reason
 * headline, on its own line — or return the headline unchanged when empty.
 */
export function withCommandDetail(
  head: string,
  failure: ShellCommandResult,
): string {
  const detail = failure.stderr.trim() || failure.stdout.trim();
  return detail === "" ? head : `${head}\n${detail}`;
}

/** Human failure reason: which command failed, its exit code, and its output. */
function failureReason(stepId: string, failure: ShellCommandResult): string {
  const head = `[shell:${stepId}] comando falhou (exit ${failure.exitCode}): ${failure.command}`;
  return withCommandDetail(head, failure);
}

/**
 * Build the `shell` {@link Step} interpreter. The returned interpreter reads the
 * current step from `ctx.step` (the orchestrator only routes `shell` steps here)
 * and never mutates the context.
 */
export function createShellStep(options: CreateShellStepOptions = {}): Step {
  const runCommand = options.runCommand ?? runShellCommandWithExeca;
  const timeoutMs = options.timeoutMs;

  return {
    type: "shell",
    async execute(ctx: StepContext): Promise<StepResult> {
      const step = ctx.step;
      assertStepType(step, "shell");
      const always = step.always ?? false;

      // Tokenize + resolve ALL commands up front: a malformed quote or an
      // unknown-var interpolation must abort before any command runs (OQ1 —
      // fail-fast, no partial side effects). `${...}` is resolved *per token*,
      // so interpolated data never reaches a shell for a second expansion.
      const commands = step.run.map((raw) =>
        tokenizeCommand(raw).map((token) => ctx.resolve(token)),
      );

      const ran: ShellCommandResult[] = [];
      let firstFailure: ShellCommandResult | undefined;

      for (const argv of commands) {
        const result = await runCommand(argv, {
          cwd: ctx.worktreePath,
          timeoutMs,
        });
        ran.push(result);

        if (result.ok) {
          ctx.logger.debug(`[shell:${step.id}] ok: ${result.command}`);
          continue;
        }

        ctx.logger.error(failureReason(step.id, result));
        if (firstFailure === undefined) firstFailure = result;
        // Stop at the first failure unless the step is best-effort (`always`).
        if (!always) break;
      }

      const output = ran
        .map(commandText)
        .filter((s) => s !== "")
        .join("\n");

      if (firstFailure !== undefined) {
        return {
          ok: false,
          reason: failureReason(step.id, firstFailure),
          output,
        };
      }
      return { ok: true, output };
    },
  };
}
