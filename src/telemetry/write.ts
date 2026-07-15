/**
 * The physical INSERT layer — the single writer of telemetry **facts**
 * (`step` rows, `agent_config` dimension rows). Insert-only: `step` is never
 * updated (D2/D3); `agent_config` is `INSERT OR IGNORE` (first write wins).
 *
 * Every write is wrapped in try/catch in the `safeEmit` style (D9): collection
 * is best-effort and **never throws into the engine** — a failed write (locked
 * db, CHECK violation, closed handle) drops the row silently rather than
 * breaking the step it was measuring. The concurrency model (WAL + one writer
 * connection per process, D8/D9) keeps these synchronous writes off the
 * `SQLITE_BUSY` path.
 *
 * `seq` is **derived in the statement** (D25): `COALESCE(MAX(seq),0)+1` scoped
 * to `task_id`. The checkpoint does not persist `seq`, so deriving it at insert
 * time is race-free (single writer) and survives resume / goto re-visits without
 * colliding on `UNIQUE(task_id, seq)` — a re-inserted row simply gets the next
 * `seq`. `step_id` is a fresh UUID per physical insert for the same reason.
 */
import { randomUUID } from "node:crypto";

import type { StepResult, StepType, VisitRecorder } from "../types";
import type { SqlParams, TelemetryDb } from "./db";

/** A row inserted into `agent_config` (INSERT OR IGNORE — the dimension, D11). */
export interface AgentConfigRow {
  readonly config_id: string;
  readonly preset: string;
  readonly model: string;
  readonly mode: string;
  /** effort is best-effort per-agent — may be a no-op adapter → NULL. */
  readonly effort: string | null;
  readonly prompt_version: string;
  readonly resolved_json: string;
  readonly first_seen_at: string;
}

/**
 * A row inserted into `step`. `seq` and `step_id` are supplied by
 * {@link insertStep}, so they are absent here (D25).
 */
export interface StepRow {
  readonly task_id: string;
  readonly change_id: string;
  readonly name: string;
  readonly kind: StepType;
  readonly visit_no: number;
  readonly attempt_no: number;
  readonly config_id: string | null;
  readonly queued_at: string | null;
  readonly started_at: string;
  readonly ended_at: string;
  readonly status:
    | "pass"
    | "fail"
    | "error"
    | "timeout"
    | "cancelled"
    | "crashed";
  readonly fail_reason: string | null;
  readonly fail_detail: string | null;
  readonly tokens_in: number;
  readonly tokens_out: number;
  readonly tokens_cache_read: number;
  readonly tokens_cache_write: number;
  readonly cost_usd: number | null;
  readonly cost_confidence: "exact" | "estimated";
  readonly price_version: string | null;
  readonly human_seconds: number | null;
}

const AGENT_CONFIG_INSERT = `
INSERT OR IGNORE INTO agent_config (
  config_id, preset, model, mode, effort, prompt_version, resolved_json, first_seen_at
) VALUES (
  :config_id, :preset, :model, :mode, :effort, :prompt_version, :resolved_json, :first_seen_at
)`;

const STEP_INSERT = `
INSERT INTO step (
  step_id, task_id, change_id, seq, name, kind, visit_no, attempt_no, config_id,
  queued_at, started_at, ended_at, status, fail_reason, fail_detail,
  tokens_in, tokens_out, tokens_cache_read, tokens_cache_write,
  cost_usd, cost_confidence, price_version, human_seconds
) VALUES (
  :step_id, :task_id, :change_id,
  COALESCE((SELECT MAX(seq) FROM step WHERE task_id = :task_id), 0) + 1,
  :name, :kind, :visit_no, :attempt_no, :config_id,
  :queued_at, :started_at, :ended_at, :status, :fail_reason, :fail_detail,
  :tokens_in, :tokens_out, :tokens_cache_read, :tokens_cache_write,
  :cost_usd, :cost_confidence, :price_version, :human_seconds
)`;

/**
 * Prepare and run one write, swallowing any failure (D9): a locked db, CHECK
 * violation, or closed handle drops the row silently rather than throwing into
 * the engine. The single place the best-effort policy lives.
 */
function safeRun(db: TelemetryDb, sql: string, params: SqlParams): void {
  try {
    db.prepare(sql).run(params);
  } catch {
    // Best-effort: telemetry never throws into the engine (D9).
  }
}

/**
 * Insert an `agent_config` dimension row (INSERT OR IGNORE — first write wins,
 * D11). Must run **before** any `step` row that references its `config_id`, so
 * the `step.config_id → agent_config` FK resolves. Best-effort, never throws.
 */
export function insertAgentConfig(db: TelemetryDb, row: AgentConfigRow): void {
  safeRun(db, AGENT_CONFIG_INSERT, { ...row });
}

/**
 * Insert one `step` fact row, deriving `seq` and `step_id` (D25). Best-effort:
 * a locked db, CHECK violation, or closed handle drops the row silently.
 */
export function insertStep(db: TelemetryDb, row: StepRow): void {
  safeRun(db, STEP_INSERT, { step_id: randomUUID(), ...row });
}

/** The immutable per-Visit facts a {@link VisitRecorder} is closed over. */
export interface VisitContext {
  /** Telemetry task id, e.g. `"C-0017/T-004"` (`<change_id>/<task.id>`, D26). */
  readonly taskId: string;
  /** Telemetry change id, e.g. `"C-0017"` (the `C-\d+` prefix, D26). */
  readonly changeId: string;
  /** Pipeline step id (`step.name`). */
  readonly stepName: string;
  readonly kind: StepType;
  /** PC entry number into this step (`visits[step.id]`; 2+ = post-goto/fix-loop). */
  readonly visitNo: number;
  /**
   * Resolved agent `config_id` — set only for agent steps whose per-attempt rows
   * (T-007) reference it. Non-agent steps have no config (`config_id` NULL).
   */
  readonly configId?: string;
  /** Injected clock (ms since epoch); stamps `started_at`/`ended_at` (AD-4). */
  readonly now: () => number;
}

/**
 * Build the per-Visit recorder the orchestrator attaches to a step's context.
 * It stamps `started_at` at construction (right before the interpreter runs) and
 * `ended_at` at {@link VisitRecorder.finalize}.
 *
 * `finalize` is the **single write trigger**. For a non-agent step it inserts
 * one Visit row (`attempt_no=1`, `config_id`/`cost_usd` NULL, zeroed tokens,
 * `status` from `result.ok`). Agent steps push per-attempt samples and emit N
 * rows in T-007; until then an agent Visit records nothing here (so T-004 writes
 * exactly the non-agent Visit rows the acceptance calls for).
 */
export function createVisitRecorder(
  db: TelemetryDb,
  ctx: VisitContext,
): VisitRecorder {
  const startedAtMs = ctx.now();
  return {
    finalize(result: StepResult): void {
      try {
        // Agent per-attempt instrumentation is T-007; non-agent Visits (shell /
        // checks / approval) each produce a single row here.
        if (ctx.kind === "agent") return;
        insertStep(db, {
          task_id: ctx.taskId,
          change_id: ctx.changeId,
          name: ctx.stepName,
          kind: ctx.kind,
          visit_no: ctx.visitNo,
          attempt_no: 1,
          config_id: null,
          queued_at: null,
          started_at: new Date(startedAtMs).toISOString(),
          ended_at: new Date(ctx.now()).toISOString(),
          status: result.ok ? "pass" : "fail",
          fail_reason: null,
          fail_detail: null,
          tokens_in: 0,
          tokens_out: 0,
          tokens_cache_read: 0,
          tokens_cache_write: 0,
          cost_usd: null,
          cost_confidence: "exact",
          price_version: null,
          human_seconds: null,
        });
      } catch {
        // Best-effort: telemetry never throws into the engine (D9).
      }
    },
  };
}
