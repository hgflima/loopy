/**
 * `checks` step interpreter (AD-2) — runs one *named* checks list standalone.
 *
 * A `checks` step's `run` is the *name* of a list declared under `checks:` in
 * `loopy.yml` (e.g. `ci`). This interpreter looks that list up, delegates the
 * actual execution + aggregation to the {@link ChecksRunnerPort} already wired
 * into the context (the T-006 runner: no fail-fast, truncated report), and wraps
 * the resulting {@link ChecksReport} into a {@link StepResult}.
 *
 * The report is carried on the result (`report`) whether the checks pass or
 * fail, so the orchestrator can feed its `text` back as `${checks.report}` — the
 * same aggregated output the `agent` verify loop re-prompts with (SPEC / AD-4).
 *
 * Errors as values (AD-5): failing checks are a normal `ok: false` result, not
 * an exception. The one thrown case is a genuine misconfiguration — a step
 * naming a list that does not exist under `checks:` (the schema validates the
 * lists' shape but cannot cross-check this reference) — which halts with a clear
 * message rather than silently running nothing. Being handed a step of the wrong
 * `type` is likewise an engine bug, not normal flow.
 */
import type { Step, StepContext, StepResult } from "../types";
import type { Mutex } from "../loop/mutex";
import { guarded } from "../loop/mutex";
import { assertStepType } from "./guards";

/** Options for {@link createChecksStep}. */
export interface CreateChecksStepOptions {
  /**
   * Parent mutex (T-004). When present and the step is NOT `parallel_safe`,
   * the checks execution runs inside the critical section. Standalone checks
   * that run against the parent (e.g. lint at root) are serialized; checks
   * with `parallel_safe: true` (e.g. per-worktree tests) bypass it.
   */
  readonly parentMutex?: Mutex;
}

/**
 * Build the `checks` {@link Step} interpreter. Reads the current step from
 * `ctx.step`, the named list from `ctx.config.checks`, and runs it via
 * `ctx.checks` in the task's worktree (`ctx.worktreePath`).
 */
export function createChecksStep(options: CreateChecksStepOptions = {}): Step {
  const parentMutex = options.parentMutex;

  return {
    type: "checks",
    async execute(ctx: StepContext): Promise<StepResult> {
      const step = ctx.step;
      assertStepType(step, "checks");

      const listName = step.run;
      const list = ctx.config.checks[listName];
      if (list === undefined) {
        throw new Error(
          `O step "${step.id}" referencia a lista de checks "${listName}", ` +
            `que não existe em checks:.`,
        );
      }

      // Mutex (T-004): checks against the parent run inside; `parallel_safe` bypasses.
      const mutex = (step.parallel_safe ?? false) ? undefined : parentMutex;

      return guarded(mutex, async () => {
        const report = await ctx.checks.run(list, { cwd: ctx.worktreePath });
        ctx.logger.info(
          `[checks:${step.id}] lista "${listName}": ${report.ok ? "verde" : "vermelho"}`,
        );

        if (report.ok) {
          return { ok: true, report, output: report.text };
        }
        return {
          ok: false,
          reason: `[checks:${step.id}] a lista "${listName}" falhou.`,
          report,
          output: report.text,
        };
      });
    },
  };
}
