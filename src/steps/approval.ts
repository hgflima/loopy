/**
 * `approval` step interpreter (AD-2) — a human gate in front of a side-effecting
 * action (canonically the merge into `parent_branch`, see the example
 * `loopy.yml`). Three moving parts, exactly as the spec's primitive table lists:
 * `prompt` (what the human is asked), `run:[...]` (the action, run only once
 * approved), and `on_conflict` (how a failed action escalates).
 *
 * The human decision comes through the transport-agnostic {@link UiPort}
 * (`ctx.ui.requestApproval`) — Ink's `ApprovalPrompt`, a `readline` fallback, or
 * a test stub all satisfy it, so this interpreter never imports the TUI and is
 * fully mockable (OQ2). One flag it *does* honor directly: `--yes` short-circuits
 * the gate to auto-approve (non-interactive / CI), never consulting the port.
 * That keeps the engine agnostic to the transport while still making `--yes` a
 * step-level behavior (SPEC: "auto-aprova gates").
 *
 * Control flow the T-009 acceptance criteria pin down:
 *
 *  - **Gate before action.** The `run:[...]` commands execute *only* after
 *    approval. A rejection runs nothing and returns `ok: false`, which the
 *    orchestrator reads (together with `on_conflict`) to escalate — the merge
 *    gate "pausa e só integra após aprovação (ou --yes)" (Success Criterion #5).
 *  - **Action failure = conflict → escalate.** The canonical action is a merge;
 *    when it fails (a content conflict, most often) the step returns `ok: false`
 *    with the failing command and the configured `on_conflict` action woven into
 *    the reason, so escalation is observable at the step boundary (Q5). The
 *    worktree is preserved by the escalation policy, not torn down here.
 *  - **Interpolation up front (OQ1).** The prompt *and* every action command are
 *    resolved via `ctx.resolve` before the human is prompted, so an unknown-var
 *    template aborts fail-fast — before any effect (not after asking the human,
 *    then crashing).
 *
 * Errors as values (AD-5): a rejected gate and a failed action are ordinary
 * {@link StepResult}s with `ok: false`, never thrown. Exceptions are reserved for
 * genuine faults (an unknown interpolation var; a step of the wrong `type`). The
 * action is run through the same injectable execa seam as the `shell` step
 * ({@link RunShellCommand}), so the gate logic is unit-testable without spawning
 * processes and the yml's quoting is honored identically.
 */
import type { Step, StepContext, StepResult } from "../types";
import { assertStepType } from "./guards";
import {
  commandText,
  runShellCommandWithExeca,
  withCommandDetail,
  type RunShellCommand,
  type ShellCommandResult,
} from "./shell";
import { tokenizeCommand } from "./tokenize";

/** Options for {@link createApprovalStep}. */
export interface CreateApprovalStepOptions {
  /** Injection seam for tests; defaults to {@link runShellCommandWithExeca}. */
  readonly runCommand?: RunShellCommand;
  /** Optional per-command timeout in ms (no timeout by default). */
  readonly timeoutMs?: number;
}

/**
 * Build the `approval` {@link Step} interpreter. Reads the current step from
 * `ctx.step` (the orchestrator only routes `approval` steps here), the decision
 * from `ctx.flags.yes` / `ctx.ui`, and runs the action in the task's worktree.
 */
export function createApprovalStep(
  options: CreateApprovalStepOptions = {},
): Step {
  const runCommand = options.runCommand ?? runShellCommandWithExeca;
  const timeoutMs = options.timeoutMs;

  return {
    type: "approval",
    async execute(ctx: StepContext): Promise<StepResult> {
      const step = ctx.step;
      assertStepType(step, "approval");

      // Resolve the prompt AND every action command up front: a malformed quote
      // or an unknown-var interpolation must abort before the human is prompted
      // or anything runs (OQ1 — fail-fast, no partial side effects, no wasted
      // human decision). Each command is tokenized and `${...}` resolved *per
      // token*, so interpolated data is never re-expanded by a shell.
      const promptText = ctx.resolve(step.prompt);
      const commands = (step.run ?? []).map((raw) =>
        tokenizeCommand(raw).map((token) => ctx.resolve(token)),
      );

      // Decide: --yes short-circuits the gate; otherwise ask via the port.
      let approved: boolean;
      if (ctx.flags.yes) {
        ctx.logger.info(`[approval:${step.id}] auto-aprovado (--yes)`);
        approved = true;
      } else {
        approved = await ctx.ui.requestApproval(promptText);
      }

      if (!approved) {
        const reason = `[approval:${step.id}] rejeitado pelo gate humano; escalonando.`;
        ctx.logger.info(reason);
        // The action never runs; ok:false lets the orchestrator escalate.
        return { ok: false, reason };
      }

      // Approved — run the action commands in order, stopping at the first
      // failure (a failed merge leaves nothing useful for later commands).
      const ran: ShellCommandResult[] = [];
      let failure: ShellCommandResult | undefined;

      for (const argv of commands) {
        const result = await runCommand(argv, {
          cwd: ctx.worktreePath,
          timeoutMs,
        });
        ran.push(result);
        if (result.ok) {
          ctx.logger.debug(`[approval:${step.id}] ok: ${result.command}`);
          continue;
        }
        failure = result;
        break;
      }

      const output = ran
        .map(commandText)
        .filter((s) => s !== "")
        .join("\n");

      if (failure !== undefined) {
        // A failed action is treated as a conflict: report it with the
        // configured on_conflict action so escalation is attributable (Q5).
        const onConflict = step.on_conflict ?? "escalate";
        const head =
          `[approval:${step.id}] a ação falhou (exit ${failure.exitCode}): ` +
          `${failure.command}. on_conflict: ${onConflict}.`;
        const reason = withCommandDetail(head, failure);
        ctx.logger.error(reason);
        return { ok: false, reason, output };
      }

      return { ok: true, output };
    },
  };
}
