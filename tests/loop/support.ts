/**
 * Shared test builders for `tests/loop/*.test.ts`.
 *
 * Every builder assembles a minimal-but-complete value with safe defaults;
 * each test overrides only the few fields it exercises (DAMP, not DRY).
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStepRegistry } from "../../src/steps/index";
import {
  clearTaskIn,
  emptyState,
  pipelineFingerprint,
  pruneOrphansIn,
  recordStepIn,
  setStatusIn,
} from "../../src/resume/state";
import type { MarkDonePort, OrchestratorDeps } from "../../src/loop/orchestrator";
import type {
  CheckpointPort,
  ChecksRunnerPort,
  EscalationPolicy,
  LoggerPort,
  LoopyConfig,
  RunFlags,
  RunState,
  Step,
  StepConfig,
  StepContext,
  StepResult,
  StepType,
  StopConditions,
  Task,
  UiPort,
} from "../../src/types";
import { defaultConfig, makeLogger } from "../steps/support";

// ---------------------------------------------------------------------------
// Constants + simple stubs
// ---------------------------------------------------------------------------

export const DEFAULT_FLAGS: RunFlags = {
  dryRun: false,
  yes: false,
  tui: false,
  verbose: false,
};

export const passingChecks: ChecksRunnerPort = {
  run: async () => ({ ok: true, results: [], text: "" }),
};

export const approvingUi: UiPort = { requestApproval: async () => true };

// ---------------------------------------------------------------------------
// Step-config constructors
// ---------------------------------------------------------------------------

export const shell = (id: string, over: Partial<StepConfig> = {}): StepConfig =>
  ({ id, type: "shell", run: [], ...over }) as StepConfig;

export const checks = (id: string, run = "ci"): StepConfig => ({
  id,
  type: "checks",
  run,
});

export const approval = (id: string): StepConfig => ({
  id,
  type: "approval",
  prompt: "ok?",
});

export const agent = (id: string): StepConfig => ({
  id,
  type: "agent",
  prompt: "do it",
});

// ---------------------------------------------------------------------------
// Builder helpers
// ---------------------------------------------------------------------------

/** A pending task with the fields the loop reads. */
export function makeTask(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    slug: id.toLowerCase(),
    title: `Task ${id}`,
    body: "",
    branch: `loopy/${id}`,
    done: false,
    ...over,
  };
}

/** A `LoopyConfig` with a custom pipeline + optional stop/escalation overrides. */
export function makeConfig(
  pipeline: StepConfig[],
  over: {
    readonly checks?: LoopyConfig["checks"];
    readonly stop?: StopConditions;
    readonly escalation?: EscalationPolicy;
  } = {},
): LoopyConfig {
  const base = defaultConfig(over.checks ?? {});
  return {
    ...base,
    pipeline,
    stop_conditions: over.stop ?? base.stop_conditions,
    policies: {
      ...base.policies,
      escalation: over.escalation ?? base.policies.escalation,
    },
  };
}

/** A `MarkDonePort` that records ids and can fire a side effect on each mark. */
export function recordingMarkDone(onMark?: (id: string) => void): {
  readonly port: MarkDonePort;
  readonly marked: string[];
} {
  const marked: string[] = [];
  return {
    marked,
    port: {
      async markDone(id) {
        marked.push(id);
        onMark?.(id);
      },
    },
  };
}

/** Records execution order as `${task.id}:${step.id}`, in the order steps ran. */
export interface Recorder {
  readonly order: string[];
}

/**
 * A registry of scripted interpreters for shell/checks/approval (agent absent).
 * Each records that it ran, then returns the scripted result — a per-(task,step)
 * entry wins over a per-step one, defaulting to success.
 */
export function scriptedRegistry(
  rec: Recorder,
  script: Record<string, StepResult> = {},
) {
  const make = (type: StepType): Step => ({
    type,
    async execute(ctx: StepContext): Promise<StepResult> {
      const key = `${ctx.task.id}:${ctx.step.id}`;
      rec.order.push(key);
      return script[key] ?? script[ctx.step.id] ?? { ok: true };
    },
  });
  return createStepRegistry([make("shell"), make("checks"), make("approval")]);
}

/** Assemble `OrchestratorDeps`, defaulting every port a mechanics test ignores. */
export function makeDeps(parts: {
  readonly registry: OrchestratorDeps["registry"];
  readonly markDone: MarkDonePort;
  readonly root?: string;
  readonly flags?: Partial<RunFlags>;
  readonly checks?: ChecksRunnerPort;
  readonly ui?: UiPort;
  readonly logger?: LoggerPort;
}): OrchestratorDeps {
  return {
    root: parts.root ?? join(tmpdir(), "loopy-fake-root-that-does-not-exist"),
    flags: { ...DEFAULT_FLAGS, ...parts.flags },
    registry: parts.registry,
    checks: parts.checks ?? passingChecks,
    ui: parts.ui ?? approvingUi,
    logger: parts.logger ?? makeLogger(),
    markDone: parts.markDone,
  };
}

// ---------------------------------------------------------------------------
// Fake CheckpointPort (in-memory, no disk)
// ---------------------------------------------------------------------------

/**
 * A fake `CheckpointPort` that holds state in memory (no disk) and records
 * every call for assertions. Uses the same pure transitions from `state.ts`.
 */
export function fakeCheckpoint(
  pipeline: readonly StepConfig[],
  initial: RunState = emptyState(),
): {
  readonly port: CheckpointPort;
  readonly calls: string[];
  state(): RunState;
} {
  const hash = pipelineFingerprint(pipeline);
  let state = initial;
  const calls: string[] = [];
  return {
    calls,
    state: () => state,
    port: {
      read: () => state,
      recordStep(taskId, stepId) {
        calls.push(`recordStep:${taskId}:${stepId}`);
        state = recordStepIn(state, taskId, stepId, hash);
      },
      setStatus(taskId, status) {
        calls.push(`setStatus:${taskId}:${status}`);
        state = setStatusIn(state, taskId, status, hash);
      },
      clearTask(taskId) {
        calls.push(`clearTask:${taskId}`);
        state = clearTaskIn(state, taskId);
      },
      pruneOrphans(knownTaskIds) {
        calls.push(`pruneOrphans:[${knownTaskIds.join(",")}]`);
        state = pruneOrphansIn(state, knownTaskIds);
      },
    },
  };
}
