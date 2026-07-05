/**
 * Step registry (AD-2) — the `type → interpreter` map the orchestrator routes
 * every pipeline step through. The orchestrator stays agnostic to the concrete
 * step types: it looks the interpreter up by `step.type`, hands it the step's
 * {@link StepContext}, and decides continuation from the {@link StepResult}.
 *
 * The `agent` interpreter is intentionally ABSENT from the non-agent spine
 * (T-010) — it lands and gets registered in T-015. A pipeline that names a type
 * with no registered interpreter is a skipped no-op in the orchestrator, which
 * is exactly what lets the outer-loop mechanics be built and proven against
 * shell/checks/approval before the ACP agent exists (AD-2: dependency inversion,
 * not horizontal slicing).
 *
 * The registry hardcodes no loop behavior (AD-1): it only maps a primitive's
 * `type` to the code that interprets it. What runs, in what order, and how many
 * steps there are all come from `loopy.yml`.
 */
import type { Step, StepType } from "../types";
import type { Mutex } from "../loop/mutex";
import { createAgentStep } from "./agent";
import { createApprovalStep } from "./approval";
import { createChecksStep } from "./checks";
import { createShellStep, type RunShellCommand } from "./shell";

/** A `type → interpreter` lookup. `get` returns `undefined` for unknown types. */
export interface StepRegistry {
  /** The interpreter for `type`, or `undefined` when none is registered. */
  get(type: StepType): Step | undefined;
  /** Whether an interpreter is registered for `type`. */
  has(type: StepType): boolean;
}

/**
 * Build a {@link StepRegistry} from a list of interpreters, keyed by their
 * declared `type`. A later entry for the same `type` overrides an earlier one
 * (useful for injecting a fake in tests).
 */
export function createStepRegistry(steps: readonly Step[]): StepRegistry {
  const map = new Map<StepType, Step>();
  for (const step of steps) map.set(step.type, step);
  return {
    get: (type) => map.get(type),
    has: (type) => map.has(type),
  };
}

/** Injection seams shared by the `shell` and `approval` interpreters. */
export interface NonAgentRegistryOptions {
  /** Command runner for `shell`/`approval`; defaults to the real execa runner. */
  readonly runCommand?: RunShellCommand;
  /** Optional per-command timeout in ms (no timeout by default). */
  readonly timeoutMs?: number;
  /**
   * Parent mutex (T-004). When provided, non-`parallel_safe` shell/approval/checks
   * steps acquire it before running commands against the parent. Agent steps
   * (worktree-scoped) never acquire it.
   */
  readonly parentMutex?: Mutex;
}

/**
 * The non-agent spine registry (T-010): `shell` + `checks` + `approval`. The
 * `agent` type is deliberately not registered here — the orchestrator skips it —
 * so the outer loop is exercised end-to-end before the agent step exists.
 */
export function createNonAgentRegistry(
  options: NonAgentRegistryOptions = {},
): StepRegistry {
  return createStepRegistry([
    createShellStep(options),
    createChecksStep({ parentMutex: options.parentMutex }),
    createApprovalStep(options),
  ]);
}

/**
 * The full engine registry (T-015): the non-agent trio **plus** the `agent`
 * interpreter, so the orchestrator can route the whole example pipeline
 * (create-worktree → implement → simplify → audit → commit → merge → cleanup).
 * The `agent` step drives an ACP session, which the orchestrator supplies via
 * its `sessionProvider` (see `loop/orchestrator.ts`); this registry only maps
 * `type → interpreter` and hardcodes no loop behavior (AD-1).
 */
export function createFullRegistry(
  options: NonAgentRegistryOptions = {},
): StepRegistry {
  return createStepRegistry([
    createShellStep(options),
    createChecksStep({ parentMutex: options.parentMutex }),
    createApprovalStep(options),
    createAgentStep(),
  ]);
}
