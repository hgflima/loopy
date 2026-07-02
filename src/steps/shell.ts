/**
 * `shell` step interpreter (AD-2) — runs a step's `run:[...]` commands, in
 * order, through a real shell (execa `shell: true`).
 *
 * Why a real shell (not `parseCommandString`): the example `loopy.yml` commands
 * carry quoted arguments with spaces and special characters — e.g.
 * `git -C "${worktree.path}" commit -m "feat(${task.id}): ${task.title}"`.
 * execa's `parseCommandString` splits on whitespace and does *not* honor quotes,
 * so it would shred those arguments. Delegating the whole line to `/bin/sh -c`
 * makes the yml's quoting mean what it says. The commands are the user's own
 * config (trusted), so shell interpretation is the intended, correct behavior.
 *
 * Two behaviors the acceptance criteria (T-008) pin down:
 *
 *  - **Order + short-circuit.** Commands run in order; the step stops at the
 *    first failing command — *unless* the step is `always: true`, in which case
 *    every command is attempted best-effort (the `cleanup` step must try both
 *    `worktree remove` and `branch -D` even if the first fails). The result is
 *    still truthful: `ok` is false whenever any command that ran failed.
 *  - **Interpolation up front (OQ1).** Every command is resolved via
 *    `ctx.resolve` *before* any command executes, so an unknown-variable
 *    interpolation aborts fail-fast — before a single side effect — rather than
 *    after a prefix of the list has already run.
 *
 * Errors as values (AD-5): a non-zero exit / spawn failure / timeout is a normal
 * {@link StepResult} with `ok: false`, never a thrown exception. Exceptions are
 * reserved for genuine faults (an unknown interpolation var; being handed a step
 * of the wrong `type`).
 *
 * The concrete execa runner is injectable ({@link RunShellCommand}) so the
 * order/short-circuit/interpolation logic is unit-testable without spawning
 * processes — mirroring the seam in `checks/runner.ts`.
 */
import { execa } from "execa";
import type { Step, StepContext, StepResult } from "../types";
import { assertStepType } from "./guards";

/** Outcome of running a single shell command (errors captured, never thrown). */
export interface ShellCommandResult {
  /** The resolved command line that was executed. */
  readonly command: string;
  readonly exitCode: number;
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs one command line; injectable so the step logic is unit-testable. */
export type RunShellCommand = (
  command: string,
  ctx: { readonly cwd: string; readonly timeoutMs?: number },
) => Promise<ShellCommandResult>;

/** Coerce execa's stream field (a string under default options) to a string. */
function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Run one command line via execa in `ctx.cwd` through a shell, never throwing:
 * a non-zero exit, a spawn failure and a timeout all resolve to a
 * {@link ShellCommandResult} with `ok: false`. `shell: true` hands the whole
 * line to `/bin/sh -c`, so the yml's quoting is honored.
 */
export const runShellCommandWithExeca: RunShellCommand = async (
  command,
  ctx,
) => {
  const result = await execa(command, {
    cwd: ctx.cwd,
    shell: true,
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

  return { command, exitCode, ok, stdout, stderr };
};

/** Options for {@link createShellStep}. */
export interface CreateShellStepOptions {
  /** Injection seam for tests; defaults to {@link runShellCommandWithExeca}. */
  readonly runCommand?: RunShellCommand;
  /** Optional per-command timeout in ms (no timeout by default). */
  readonly timeoutMs?: number;
}

/** Non-empty stdout+stderr of one command, for the aggregated step `output`. */
function commandText(result: ShellCommandResult): string {
  return [result.stdout, result.stderr]
    .map((s) => s.trimEnd())
    .filter((s) => s !== "")
    .join("\n");
}

/** Human failure reason: which command failed, its exit code, and its output. */
function failureReason(stepId: string, failure: ShellCommandResult): string {
  const detail = failure.stderr.trim() || failure.stdout.trim();
  const head = `[shell:${stepId}] comando falhou (exit ${failure.exitCode}): ${failure.command}`;
  return detail === "" ? head : `${head}\n${detail}`;
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

      // Resolve ALL commands up front: an unknown-var interpolation must abort
      // before any command runs (OQ1 — fail-fast, no partial side effects).
      const commands = step.run.map((raw) => ctx.resolve(raw));

      const ran: ShellCommandResult[] = [];
      let firstFailure: ShellCommandResult | undefined;

      for (const command of commands) {
        const result = await runCommand(command, {
          cwd: ctx.worktreePath,
          timeoutMs,
        });
        ran.push(result);

        if (result.ok) {
          ctx.logger.debug(`[shell:${step.id}] ok: ${command}`);
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
