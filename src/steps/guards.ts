/**
 * Shared guard for the step interpreters. The orchestrator routes each step to
 * the interpreter matching its `type`, so being handed a step of the wrong type
 * is a genuine engine bug — not normal flow (AD-5) — and throws. Doubles as a
 * TypeScript assertion, narrowing `step` to its concrete variant for the caller.
 */
import type { StepConfig, StepType } from "../types";

/** Throw (and narrow) unless `step.type` is `expected`. */
export function assertStepType<T extends StepType>(
  step: StepConfig,
  expected: T,
): asserts step is Extract<StepConfig, { type: T }> {
  if (step.type !== expected) {
    throw new Error(
      `Intérprete "${expected}" recebeu um step "${step.type}" (id "${step.id}").`,
    );
  }
}
