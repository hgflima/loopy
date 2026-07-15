/**
 * `agent` step interpreter (AD-2, T-014) — one step of the pipeline that drives
 * a turn (or a bounded series of turns) of the ACP agent. This is the *inner*
 * loop of the two-level model (SPEC): the orchestrator runs the step once; the
 * step itself owns the `verify:` retry loop.
 *
 * What it interprets, all straight from the step's config (AD-1 — no behavior
 * hardcoded here, only the mechanics of driving the session):
 *
 *  - **`clear_context`** (default `true`) → reopen the session before *each*
 *    prompt so every attempt starts from a fresh context; memory lives on disk
 *    (the worktree) and in the prompt, never in the conversation (SPEC / AD-3).
 *  - **`mode`** → applied once via `session/set_mode` (`plan` for a read-only
 *    audit, `acceptEdits` for implement/simplify). Mode is re-applied
 *    automatically after reopen, so it is set once up front.
 *  - **`model`** → applied via `setModel()` (best-effort, ADR-0006); resolved as
 *    `step.model ?? registry[agent].model`. No-op when absent.
 *  - **`effort`** → applied via `setEffort()` (best-effort, ADR-0006); resolved as
 *    `step.effort ?? registry[agent].effort`. No-op + log when the agent doesn't
 *    support reasoning effort.
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
import {
  buildScopeVars,
  formatOnFail,
  resolveAgentBinding,
} from "../loop/orchestrator";
import { classifyStopReason } from "../acp/session";
import type {
  AgentSession,
  AgentStep,
  AttemptSample,
  ChecksReport,
  StepCost,
  Step,
  StepContext,
  StepFailReason,
  StepResult,
  StepStatus,
  StopReason,
  TurnUsage,
} from "../types";
import { assertStepType } from "./guards";
import { parseVerdict } from "./verdict";

/**
 * Classify a failed `verify` report into the mechanical `fail_reason` (D5): the
 * **first** failing check's name decides it (`test`/`spec` → `test-fail`,
 * `type`/`tsc` → `type-error`, `lint`/`eslint` → `lint-fail`, `build` →
 * `build-fail`). A name that matches none yields `null` + the raw name as
 * `fail_detail` (no bucket without evidence). Pure (AD-6).
 */
function classifyCheckFailure(report: ChecksReport): {
  readonly reason: StepFailReason | null;
  readonly detail: string | null;
} {
  const failed = report.results.find((r) => !r.ok);
  if (failed === undefined) return { reason: null, detail: null };
  const name = failed.name.toLowerCase();
  if (/test|spec/.test(name)) return { reason: "test-fail", detail: null };
  if (/type|tsc/.test(name)) return { reason: "type-error", detail: null };
  if (/lint|eslint/.test(name)) return { reason: "lint-fail", detail: null };
  if (/build/.test(name)) return { reason: "build-fail", detail: null };
  return { reason: null, detail: failed.name };
}

/**
 * Map a non-`end_turn` stop reason to a `step.status` (D5): our own cancel is
 * `cancelled`; every other abnormal stop (`refusal`/`max_tokens`/
 * `max_turn_requests`) is an `error` (an infra fault). Pure (AD-6).
 */
function statusFromStopReason(reason: StopReason): StepStatus {
  return classifyStopReason(reason) === "stop_signal" ? "cancelled" : "error";
}

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
  return ctx.checks.run(list, {
    cwd,
    onCheckStart: ctx.emit
      ? (name) =>
          ctx.emit!({
            type: "check_started",
            taskId: ctx.task.id,
            stepId: step.id,
            name,
          })
      : undefined,
    onCheckEnd: ctx.emit
      ? (name, ok) =>
          ctx.emit!({
            type: "check_finished",
            taskId: ctx.task.id,
            stepId: step.id,
            name,
            ok,
          })
      : undefined,
  });
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
 * Per-Attempt telemetry accumulator for the `agent` step (T-007 / D3). Owns the
 * opt-in gate (AD-1): with no recorder every method is a no-op and the session's
 * `drainUsage`/`readCost` are **never** touched, keeping a telemetry-off run
 * byte-identical. One sample accrues per attempt — its own tokens (drained once,
 * D3), cost delta (post − pre snapshot across the reopen, D10) and window (from
 * the recorder's injected clock) — buffered locally so the verdict gate can still
 * rewrite the last one before {@link AttemptMeter.flush} hands them off.
 */
interface AttemptMeter {
  /** After the (optional) reopen: stamp the window start, read the cost baseline (D10). */
  begin(): void;
  /** After the prompt: drain usage once and close the cost delta (D3/D10). */
  measure(): void;
  /** Buffer a sample for `attemptNo`, stamping `endedAt` at this moment. */
  record(
    attemptNo: number,
    status: StepStatus,
    failReason: StepFailReason | null,
    failDetail: string | null,
  ): void;
  /** Rewrite the last buffered sample as an `expect-fail` (post-loop verdict gate, D5). */
  rewriteLastAsExpectFail(detail: string | null): void;
  /** Hand every buffered sample to the recorder (the Visit's single write trigger). */
  flush(): void;
}

function createAttemptMeter(
  recorder: StepContext["telemetry"],
  session: AgentSession,
): AttemptMeter {
  const samples: AttemptSample[] = [];
  let startedAt = 0;
  let usage: TurnUsage | null = null;
  let costDelta: number | null = null;
  let costBefore: StepCost | null = null;

  return {
    begin(): void {
      if (recorder === undefined) return;
      startedAt = recorder.now();
      usage = null;
      costDelta = null;
      costBefore = session.readCost();
    },
    measure(): void {
      if (recorder === undefined) return;
      usage = session.drainUsage();
      const costAfter = session.readCost();
      costDelta =
        costBefore !== null && costAfter !== null
          ? costAfter.amount - costBefore.amount
          : null;
    },
    record(attemptNo, status, failReason, failDetail): void {
      if (recorder === undefined) return;
      samples.push({
        attemptNo,
        startedAt,
        endedAt: recorder.now(),
        status,
        failReason,
        failDetail,
        usage,
        costDelta,
      });
    },
    rewriteLastAsExpectFail(detail): void {
      if (samples.length === 0) return;
      const last = samples[samples.length - 1]!;
      samples[samples.length - 1] = {
        ...last,
        status: "fail",
        failReason: "expect-fail",
        failDetail: detail,
      };
    },
    flush(): void {
      if (recorder === undefined) return;
      for (const sample of samples) recorder.push(sample);
    },
  };
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

      // Resolve the agent/model/effort binding up front (pure) so mode errors can
      // name the target agent.
      const binding = resolveAgentBinding(step, ctx.config.resolvedAgents);

      // Mode is re-applied automatically after reopen, so set it once up front.
      // A rejected mode is a genuine config fault (wrong per-agent vocabulary), so
      // it fails fast with the step + agent named — not swallowed (AD-5 reserves
      // exceptions for genuine faults; the same bad mode would hit every task).
      if (step.mode !== undefined) {
        try {
          await ctx.session.setMode(step.mode);
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          throw new Error(
            `[agent:${step.id}] agente "${binding.agentName}" recusou o mode "${step.mode}": ${detail}`,
          );
        }
      }

      // Model/effort: resolved via the agent registry (step overrides registry).
      // Applied once after mode, before the first prompt (best-effort, AD-5).
      if (binding.model !== undefined) {
        await ctx.session.setModel(binding.model);
      }
      if (binding.effort !== undefined) {
        await ctx.session.setEffort(binding.effort);
      }

      let lastReport: ChecksReport | undefined;
      let checksReport = ctx.resolve("${checks.report}");
      let succeeded = false;

      // Per-Attempt telemetry (T-007 / D3): one sample per attempt, pushed to the
      // recorder at each exit point. The meter owns the opt-in gate — a no-op that
      // never touches the session when `metrics:` is off (AD-1).
      const meter = createAttemptMeter(ctx.telemetry, ctx.session);

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        ctx.emit?.({
          type: "attempt_started",
          taskId: ctx.task.id,
          stepId: step.id,
          attempt,
          maxAttempts,
        });

        if (clearContext) await ctx.session.clear();

        // Telemetry: stamp the window start and read the cost baseline AFTER the
        // clear (D10) — `costCarry` keeps `readCost()` monotonic across the reopen.
        meter.begin();

        const resolve = buildAttemptResolver(
          ctx,
          worktree,
          attempt,
          checksReport,
        );
        const promptText = resolve(selectPrompt(step, attempt));
        const stopReason = await ctx.session.prompt(promptText);

        // Drain usage ONCE per attempt, right after the prompt (D3); close the
        // cost delta against the same-session baseline (D10).
        meter.measure();

        if (classifyStopReason(stopReason) !== "success") {
          const reason = nonEndTurnReason(step.id, stopReason);
          ctx.logger.error(reason);
          meter.record(
            attempt,
            statusFromStopReason(stopReason),
            "infra",
            stopReason,
          );
          meter.flush();
          return { ok: false, reason, output: ctx.session.readText() };
        }

        if (verify === undefined) {
          meter.record(attempt, "pass", null, null);
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
          meter.record(attempt, "pass", null, null);
          succeeded = true;
          break;
        }

        const { reason: failReason, detail: failDetail } =
          classifyCheckFailure(report);
        meter.record(attempt, "fail", failReason, failDetail);
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
        meter.flush();
        return {
          ok: false,
          reason,
          report: lastReport,
          output: lastReport?.text ?? "",
        };
      }

      // The verdict gate is only known post-loop (an `expect` step): rewrite the
      // last (successful) attempt sample to fail/expect-fail before flushing —
      // the same turn passed verify but failed the expect gate (D5).
      const gateResult = applyVerdictGate(ctx, step);
      if (!gateResult.ok)
        meter.rewriteLastAsExpectFail(gateResult.reason ?? null);
      meter.flush();
      return gateResult;
    },
  };
}
