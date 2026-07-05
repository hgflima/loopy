/**
 * Test support for the step interpreters (`steps/*`).
 *
 * A `Step.execute(ctx)` needs a full {@link StepContext} — many handles most
 * steps never touch. This builder assembles a valid context with inert stubs
 * for every port (they satisfy the structural interface with zero-arg no-ops,
 * so an unexpected call is a type-level impossibility, not a silent pass), and
 * lets each test override only the few fields it exercises: `step`, `resolve`,
 * `worktreePath`, `config.checks`, `checks`, `logger`.
 *
 * NOT a test file (no `.test`/`.spec` suffix) — it is imported by the specs.
 */
import type {
  AgentSession,
  ChecksConfig,
  ChecksRunnerPort,
  GitPort,
  LoggerPort,
  LoopyConfig,
  RunFlags,
  StepConfig,
  StepContext,
  Task,
  UiPort,
} from "../../src/types";
import type { StoreEvent } from "../../src/tui/store";

/** A capturing logger so a test can assert on emitted lines when it wants to. */
export interface CapturingLogger extends LoggerPort {
  readonly infos: string[];
  readonly debugs: string[];
  readonly errors: string[];
}

/** Build a {@link LoggerPort} that records every line by level. */
export function makeLogger(): CapturingLogger {
  const infos: string[] = [];
  const debugs: string[] = [];
  const errors: string[] = [];
  return {
    infos,
    debugs,
    errors,
    info: (m) => infos.push(m),
    debug: (m) => debugs.push(m),
    error: (m) => errors.push(m),
  };
}

/** A representative pending task (`${task.*}` values). */
export const SAMPLE_TASK: Task = {
  id: "T-001",
  slug: "scaffold",
  title: "Scaffold do projeto",
  body: "Detalhes da task.",
  branch: "loopy/T-001",
  done: false,
  deps: [],
};

/** A minimal-but-complete {@link LoopyConfig}; `checks` is the field steps read. */
export function defaultConfig(checks: ChecksConfig = {}): LoopyConfig {
  return {
    version: "1",
    name: "test",
    workspace: {
      root: ".",
      parent_branch: "main",
      worktrees_dir: ".worktrees",
    },
    acp: {
      command: ["npx", "-y", "@agentclientprotocol/claude-agent-acp"],
      request_timeout_seconds: 1800,
      permissions: { default_mode: "acceptEdits", on_request: "allow" },
    },
    inputs: {
      spec: "SPEC.md",
      plan: "tasks/plan.md",
      todo: "tasks/todo.md",
      backlog: {
        pending_marker: "- [ ]",
        done_marker: "- [x]",
        task_id_pattern: "T-\\d+",
        body: "indented",
        mark_done_on_success: true,
      },
    },
    checks,
    pipeline: [],
    stop_conditions: { max_iterations: 25, max_step_visits: 10, stop_signal_file: ".loopy.stop" },
    concurrency: 1,
    policies: {
      escalation: { action: "pause", keep_worktree: true, notify: "stderr" },
      git: { require_clean_parent: true, on_merge_conflict: "escalate" as const },
    },
    logging: { dir: ".loopy/logs", per_task: true, capture_acp_traffic: true },
  };
}

/** Inert stubs — structurally satisfy each port; a call is a test-design error. */
const inertSession: AgentSession = {
  sessionId: "sess-1",
  setMode: async () => {},
  clear: async () => {},
  prompt: async () => "end_turn",
  readText: () => "",
  cancel: async () => {},
  drainUsage: () => null,
  readCost: () => null,
};

const inertGit: GitPort = {
  addWorktree: async () => {},
  removeWorktree: async () => {},
  merge: async () => ({ ok: true, conflict: false }),
  isParentClean: async () => true,
  isMergeInProgress: async () => false,
  rebaseOnto: async () => ({ ok: true, conflict: false }),
};

const inertChecks: ChecksRunnerPort = {
  run: async () => ({ ok: true, results: [], text: "" }),
};

const inertUi: UiPort = { requestApproval: async () => true };

const DEFAULT_FLAGS: RunFlags = {
  dryRun: false,
  yes: false,
  tui: false,
  verbose: false,
};

/** Fields a test may override; everything else falls back to a safe default. */
export interface StepContextOverrides {
  readonly step: StepConfig;
  readonly resolve?: (template: string) => string;
  readonly worktreePath?: string;
  readonly checksConfig?: ChecksConfig;
  readonly checks?: ChecksRunnerPort;
  readonly logger?: LoggerPort;
  readonly task?: Task;
  readonly flags?: Partial<RunFlags>;
  readonly iteration?: number;
  readonly attempt?: number;
  /** The human-gate port (approval step); defaults to auto-approving. */
  readonly ui?: UiPort;
  /** The ACP session (agent step); defaults to an inert, always-`end_turn` stub. */
  readonly session?: AgentSession;
  /** Event sink for TUI progress (check, attempt_started, stream_chunk events); defaults to absent. */
  readonly emit?: (event: StoreEvent) => void;
}

/** Assemble a {@link StepContext} for a step interpreter under test. */
export function makeStepContext(overrides: StepContextOverrides): StepContext {
  return {
    config: defaultConfig(overrides.checksConfig),
    flags: { ...DEFAULT_FLAGS, ...overrides.flags },
    task: overrides.task ?? SAMPLE_TASK,
    iteration: overrides.iteration ?? 1,
    attempt: overrides.attempt ?? 1,
    worktreePath: overrides.worktreePath ?? "/tmp/loopy-worktree",
    step: overrides.step,
    resolve: overrides.resolve ?? ((template) => template),
    session: overrides.session ?? inertSession,
    git: inertGit,
    checks: overrides.checks ?? inertChecks,
    ui: overrides.ui ?? inertUi,
    logger: overrides.logger ?? makeLogger(),
    emit: overrides.emit,
  };
}
