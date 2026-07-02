/**
 * Zod schema for `loopy.yml` — validates the *shape* the engine interprets.
 *
 * This is the runtime counterpart of the frozen type contract in `src/types.ts`
 * (T-001). It validates every block of the example config and, crucially, the
 * `pipeline` as a discriminated union of the 4 step primitives so each `type`
 * only accepts its own fields. Unknown keys are rejected (`.strict()`) so config
 * typos surface as clear errors instead of being silently ignored.
 *
 * Invariant (AD-1): the schema constrains structure only. It hardcodes no loop
 * behavior — prompts, commands, mode, order and step count all come from the
 * user's yml. Defaults applied here are documented in SPEC.md / the example yml
 * (e.g. `clear_context` → true), never behavioral policy.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared leaf schemas
// ---------------------------------------------------------------------------

/** A required, non-empty string — the default for ids, paths, and commands. */
const nonEmptyString = z.string().min(1);

/** The signal a step raises on failure; the orchestrator maps it to a policy. */
const onFailSchema = z.literal("escalate");

/** An ACP autonomy mode (`acceptEdits`/`plan`/…); open-ended by design. */
const modeSchema = nonEmptyString;

// ---------------------------------------------------------------------------
// workspace / acp
// ---------------------------------------------------------------------------

const workspaceSchema = z
  .object({
    root: nonEmptyString,
    parent_branch: nonEmptyString,
    worktrees_dir: nonEmptyString,
  })
  .strict();

const acpPermissionsSchema = z
  .object({
    default_mode: modeSchema,
    on_request: z.enum(["allow", "policy"]).default("allow"),
  })
  .strict();

const acpSchema = z
  .object({
    command: z.array(z.string()).min(1),
    request_timeout_seconds: z.number().positive(),
    permissions: acpPermissionsSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// inputs / backlog
// ---------------------------------------------------------------------------

const backlogSchema = z
  .object({
    pending_marker: nonEmptyString,
    done_marker: nonEmptyString,
    task_id_pattern: nonEmptyString,
    body: z.enum(["indented"]),
    mark_done_on_success: z.boolean(),
  })
  .strict();

const inputsSchema = z
  .object({
    spec: nonEmptyString,
    plan: nonEmptyString,
    todo: nonEmptyString,
    backlog: backlogSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// checks (named, reusable lists)
// ---------------------------------------------------------------------------

const checkCommandSchema = z
  .object({
    name: nonEmptyString,
    run: nonEmptyString,
  })
  .strict();

const checksSchema = z.record(z.string(), z.array(checkCommandSchema));

// ---------------------------------------------------------------------------
// pipeline — discriminated union of the 4 step primitives (AD-1)
// ---------------------------------------------------------------------------

/** Fields every step shares (`StepBase`). */
const stepBaseShape = {
  id: nonEmptyString,
  /** Runs even after a previous step failed (e.g. `cleanup`). */
  always: z.boolean().optional(),
};

/** An ordered, non-empty list of shell commands (`shell`/`approval` `run`). */
const commandListSchema = z.array(nonEmptyString).min(1);

/** Inner-loop config of an `agent` step: `prompt -> checks -> retry`. */
const verifySchema = z
  .object({
    run: nonEmptyString,
    max_attempts: z.number().int().min(1),
    on_fail: onFailSchema,
  })
  .strict();

const agentStepSchema = z
  .object({
    ...stepBaseShape,
    type: z.literal("agent"),
    prompt: nonEmptyString,
    retry_prompt: nonEmptyString.optional(),
    mode: modeSchema.optional(),
    clear_context: z.boolean().default(true),
    verify: verifySchema.optional(),
    expect: nonEmptyString.optional(),
    on_expect_fail: onFailSchema.optional(),
  })
  .strict();

const shellStepSchema = z
  .object({
    ...stepBaseShape,
    type: z.literal("shell"),
    run: commandListSchema,
    on_fail: onFailSchema.optional(),
  })
  .strict();

const checksStepSchema = z
  .object({
    ...stepBaseShape,
    type: z.literal("checks"),
    run: nonEmptyString,
    on_fail: onFailSchema.optional(),
  })
  .strict();

const approvalStepSchema = z
  .object({
    ...stepBaseShape,
    type: z.literal("approval"),
    prompt: nonEmptyString,
    run: commandListSchema.optional(),
    on_conflict: onFailSchema.optional(),
  })
  .strict();

const stepSchema = z.discriminatedUnion("type", [
  agentStepSchema,
  shellStepSchema,
  checksStepSchema,
  approvalStepSchema,
]);

// ---------------------------------------------------------------------------
// stop_conditions / policies / logging
// ---------------------------------------------------------------------------

const stopConditionsSchema = z
  .object({
    max_iterations: z.number().int().positive(),
    stop_signal_file: nonEmptyString,
  })
  .strict();

const escalationSchema = z
  .object({
    action: z.enum(["pause", "skip_task", "abort_loop"]),
    keep_worktree: z.boolean(),
    notify: nonEmptyString,
  })
  .strict();

const gitPolicySchema = z
  .object({
    require_clean_parent: z.boolean(),
  })
  .strict();

const policiesSchema = z
  .object({
    escalation: escalationSchema,
    git: gitPolicySchema,
  })
  .strict();

const loggingSchema = z
  .object({
    dir: nonEmptyString,
    per_task: z.boolean(),
    capture_acp_traffic: z.boolean(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Top-level config
// ---------------------------------------------------------------------------

export const loopyConfigSchema = z
  .object({
    version: nonEmptyString,
    name: nonEmptyString,
    workspace: workspaceSchema,
    acp: acpSchema,
    inputs: inputsSchema,
    checks: checksSchema,
    pipeline: z.array(stepSchema).min(1),
    stop_conditions: stopConditionsSchema,
    concurrency: z.number().int().min(1).default(1),
    policies: policiesSchema,
    logging: loggingSchema,
  })
  .strict();

/** The validated, defaults-applied config as inferred from the schema. */
export type LoopyConfigParsed = z.infer<typeof loopyConfigSchema>;
