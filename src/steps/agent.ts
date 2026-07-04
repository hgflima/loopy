/**
 * `agent` step interpreter (AD-2, T-014) — one step of the pipeline that drives
 * a turn (or a bounded series of turns) of the ACP agent. This is the *inner*
 * loop of the two-level model (SPEC): the orchestrator runs the step once; the
 * step itself owns the `verify:` retry loop.
 *
 * What it interprets, all straight from the step's config (AD-1 — no behavior
 * hardcoded here, only the mechanics of driving the session):
 *
 *  - **`clear_context`** (default `true`) → send `/clear` before *each* prompt so
 *    every attempt starts from a fresh context; memory lives on disk (the
 *    worktree) and in the prompt, never in the conversation (SPEC / AD-3).
 *  - **`mode`** → applied once via `session/set_mode` (`plan` for a read-only
 *    audit, `acceptEdits` for implement/simplify). Mode persists on the session
 *    and is not reset by `/clear`, so it is set once up front.
 *  - **`prompt` / `retry_prompt`** → `prompt` on the first attempt, `retry_prompt`
 *    on retries (falling back to `prompt`), resolved per attempt so a retry's
 *    `${checks.report}` carries *that* attempt's failing checks.
 *  - **`verify: { run, max_attempts }`** → the inner loop: after each prompt,
 *    run the named checks list; on green, the step succeeds; on red, re-prompt
 *    with the report until `max_attempts` is spent, then fail with `on_fail`
 *    (escalate) and the last report attached for `${checks.report}`.
 *  - **`expect` + `on_fail`** → a verdict gate (the `audit` step): parse the
 *    final turn's text with {@link parseVerdict} (T-013) using the label
 *    derived from `expect`, and block the step unless the verdict is PASS
 *    (fail-closed on absence).
 *
 * Turn outcome (AC3): a prompt turn only counts as success on `end_turn`; any
 * other `stopReason` (`refusal` / `max_tokens` / `max_turn_requests` / our own
 * `cancelled`) fails the step immediately, before verify or the verdict gate
 * ever run ({@link classifyStopReason}, T-012).
 *
 * ### Re-resolving `${checks.report}` across attempts
 *
 * `ctx.resolve` is bound once by the orchestrator with `checks.report` empty and
 * `attempt = 1` — correct for the first prompt (OQ1: the 1st prompt renders an
 * empty report), but the inner loop needs a *fresh* report per retry. Since the
 * scope's `${worktree.*}` values are not on `StepContext`, the step recovers them
 * by resolving `${worktree.path}` / `${worktree.diff}` through `ctx.resolve` once,
 * then rebuilds a per-attempt resolver ({@link buildAttemptResolver}) that reuses
 * those plus `ctx.config` / `ctx.task`, overriding only `attempt` and
 * `checks.report`. That keeps every other variable identical to the orchestrator
 * scope while letting the report advance each attempt (AD-4).
 *
 * Errors as values (AD-5): a failed turn, exhausted retries and a failed verdict
 * are ordinary `ok: false` {@link StepResult}s. Exceptions are reserved for
 * genuine faults — an unknown interpolation variable, a `verify.run` naming a
 * checks list that does not exist, or being handed a step of the wrong `type`.
 */
import { createResolver, createScope, selectPrompt } from "../interp/resolver";
import { buildScopeVars, formatOnFail } from "../loop/orchestrator";
import { classifyStopReason } from "../acp/session";
import type {
  AgentStep,
  ChecksReport,
  Step,
  StepContext,
  StepResult,
  StopReason,
} from "../types";
import { assertStepType } from "./guards";
import { parseVerdict } from "./verdict";

/**
 * Build a resolver for a specific `attempt`, reusing {@link buildScopeVars} (the
 * single source of truth for the scope) so every variable matches the
 * orchestrator scope by construction; only `attempt` and `checks.report` — the
 * two the inner loop advances — differ per attempt. The `${worktree.*}` values
 * are not carried on {@link StepContext}, so the caller recovers them via
 * `ctx.resolve` and passes them in.
 */
function buildAttemptResolver(
  ctx: StepContext,
  worktree: { readonly path: string; readonly diff: string },
  attempt: number,
  checksReport: string,
): (template: string) => string {
  const vars = buildScopeVars(ctx.config, ctx.task, {
    iteration: ctx.iteration,
    attempt,
    worktreePath: worktree.path,
    diff: worktree.diff,
    checksReport,
  });
  return createResolver(createScope(vars), { stepId: ctx.step.id });
}

/**
 * Derive the verdict marker label from `expect` (`"AUDIT: PASS"` → `"AUDIT"`).
 * Keeps the token config-driven (AD-1): the engine hardcodes no `"AUDIT"`.
 */
function labelFromExpect(expect: string): string {
  const colon = expect.indexOf(":");
  const label = (colon >= 0 ? expect.slice(0, colon) : expect).trim();
  return label !== "" ? label : expect.trim();
}

/** Resolve and run the verify checks list in the worktree; throws if unknown. */
async function runVerifyChecks(
  ctx: StepContext,
  step: AgentStep,
  listName: string,
  cwd: string,
): Promise<ChecksReport> {
  const list = ctx.config.checks[listName];
  if (list === undefined) {
    throw new Error(
      `O step "${step.id}" referencia a lista de checks "${listName}", ` +
        `que não existe em checks:.`,
    );
  }
  return ctx.checks.run(list, { cwd });
}

/** Human reason for a turn that did not end in `end_turn` (AC3). */
function nonEndTurnReason(stepId: string, reason: StopReason): string {
  const cancelled = classifyStopReason(reason) === "stop_signal";
  const detail = cancelled
    ? "o turno foi cancelado"
    : 'o turno terminou fora de "end_turn"';
  return `[agent:${stepId}] ${detail} (stopReason "${reason}") — tratado como falha.`;
}

/**
 * Verdict gate (audit): when `expect` is set, block the step unless the agent's
 * final turn yields the expected PASS (T-013, fail-closed on absence). With no
 * `expect`, the step simply succeeds carrying the final turn's text.
 */
function applyVerdictGate(ctx: StepContext, step: AgentStep): StepResult {
  const text = ctx.session.readText();
  if (step.expect === undefined) {
    return { ok: true, output: text };
  }

  const expected = ctx.resolve(step.expect);
  const verdict = parseVerdict(text, { label: labelFromExpect(expected) });
  if (!verdict.pass) {
    const onFail = step.on_fail ?? "escalate";
    const reason =
      `[agent:${step.id}] veredito esperado "${expected}" não satisfeito: ` +
      `${verdict.reason ?? "sem PASS"}. on_fail: ${formatOnFail(onFail)}.`;
    ctx.logger.error(reason);
    return { ok: false, reason, output: text };
  }

  ctx.logger.info(`[agent:${step.id}] veredito "${expected}" satisfeito.`);
  return { ok: true, output: text };
}

/**
 * Build the `agent` {@link Step} interpreter. It reads the current step from
 * `ctx.step` (the orchestrator only routes `agent` steps here) and drives
 * `ctx.session` / `ctx.checks`; it holds no per-run state, so one instance is
 * safely reused across tasks.
 */
export function createAgentStep(): Step {
  return {
    type: "agent",
    async execute(ctx: StepContext): Promise<StepResult> {
      const step = ctx.step;
      assertStepType(step, "agent");

      const clearContext = step.clear_context ?? true;
      const verify = step.verify;
      const maxAttempts = verify?.max_attempts ?? 1;

      // Recover the ${worktree.*} scope values once (not carried on the context);
      // they are constant across the inner attempts (AD-4).
      const worktree = {
        path: ctx.resolve("${worktree.path}"),
        diff: ctx.resolve("${worktree.diff}"),
      };

      // Mode persists on the session and survives /clear, so set it once up front.
      if (step.mode !== undefined) {
        await ctx.session.setMode(step.mode);
      }

      let lastReport: ChecksReport | undefined;
      let checksReport = ctx.resolve("${checks.report}");
      let succeeded = false;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (clearContext) await ctx.session.clear();

        const resolve = buildAttemptResolver(
          ctx,
          worktree,
          attempt,
          checksReport,
        );
        const promptText = resolve(selectPrompt(step, attempt));
        const stopReason = await ctx.session.prompt(promptText);

        if (classifyStopReason(stopReason) !== "success") {
          const reason = nonEndTurnReason(step.id, stopReason);
          ctx.logger.error(reason);
          return { ok: false, reason, output: ctx.session.readText() };
        }

        if (verify === undefined) {
          succeeded = true;
          break;
        }

        const report = await runVerifyChecks(
          ctx,
          step,
          verify.run,
          worktree.path,
        );
        lastReport = report;
        if (report.ok) {
          ctx.logger.info(
            `[agent:${step.id}] verify "${verify.run}" verde na tentativa ${attempt}/${maxAttempts}.`,
          );
          succeeded = true;
          break;
        }

        checksReport = report.text;
        ctx.logger.info(
          `[agent:${step.id}] verify "${verify.run}" falhou (tentativa ${attempt}/${maxAttempts}).`,
        );
      }

      if (!succeeded && verify !== undefined) {
        const onFail = step.on_fail ?? "escalate";
        const reason =
          `[agent:${step.id}] verify "${verify.run}" falhou após ` +
          `${maxAttempts} tentativa(s); aplicando on_fail: ${formatOnFail(onFail)}.`;
        ctx.logger.error(reason);
        return {
          ok: false,
          reason,
          report: lastReport,
          output: lastReport?.text ?? "",
        };
      }

      return applyVerdictGate(ctx, step);
    },
  };
}
