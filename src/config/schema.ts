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

/** Target of a goto jump — `id` must reference an existing pipeline step. */
const gotoSchema = z.object({ goto: nonEmptyString }).strict();

/** The signal a step raises on failure; the orchestrator maps it to a policy. */
const onFailSchema = z.union([z.literal("escalate"), gotoSchema]);

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
    command: z.array(z.string()).min(1).optional(),
    default_agent: nonEmptyString.optional(),
    request_timeout_seconds: z.number().positive(),
    permissions: acpPermissionsSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// agents (named registry, C-0008)
// ---------------------------------------------------------------------------

/** A single agent definition: `{ command, env?, model?, effort? }`. */
const agentDefSchema = z
  .object({
    command: z.array(z.string()).min(1),
    env: z.record(z.string(), z.string()).optional(),
    model: nonEmptyString.optional(),
    effort: nonEmptyString.optional(),
  })
  .strict();

/** Optional top-level `agents:` registry (`name → AgentDef`). */
const agentsSchema = z.record(nonEmptyString, agentDefSchema);

// ---------------------------------------------------------------------------
// inputs / backlog
// ---------------------------------------------------------------------------

const backlogSchema = z
  .object({
    pending_marker: nonEmptyString,
    done_marker: nonEmptyString,
    task_id_pattern: nonEmptyString,
    deps_pattern: nonEmptyString.optional(),
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
  /** Override sequential flow on success: jump to the target step. */
  on_success: gotoSchema.optional(),
  /** Step can run outside the parent mutex (e.g. worktree-scoped commands). Default `false`. */
  parallel_safe: z.boolean().default(false),
};

/** An ordered, non-empty list of shell commands (`shell`/`approval` `run`). */
const commandListSchema = z.array(nonEmptyString).min(1);

/** Inner-loop config of an `agent` step: `prompt -> checks -> retry`. */
const verifySchema = z
  .object({
    run: nonEmptyString,
    max_attempts: z.number().int().min(1),
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
    on_fail: onFailSchema.optional(),
    agent: nonEmptyString.optional(),
    model: nonEmptyString.optional(),
    effort: nonEmptyString.optional(),
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
    on_fail: onFailSchema.optional(),
  })
  .strict();

const stepSchema = z.discriminatedUnion("type", [
  agentStepSchema,
  shellStepSchema,
  checksStepSchema,
  approvalStepSchema,
]);

/**
 * Pipeline-level refinements (superRefine ×3):
 *   1. `id` único no pipeline (alvo de salto exige unicidade).
 *   2. Todo `on_fail.goto`/`on_success.goto` referencia id existente.
 *   3. Guard do agente generalizado (OQ-7 + goto): `on_fail` em `agent`
 *      (escalate ou goto) exige `verify` ou `expect`.
 */
const pipelineSchema = z
  .array(stepSchema)
  .min(1)
  .superRefine((steps, ctx) => {
    // --- (1) id único no pipeline ----------------------------------------
    const idIndices = new Map<string, number[]>();
    for (let i = 0; i < steps.length; i++) {
      const id = steps[i]!.id;
      const indices = idIndices.get(id);
      if (indices) indices.push(i);
      else idIndices.set(id, [i]);
    }
    for (const [id, indices] of idIndices) {
      if (indices.length > 1) {
        for (const idx of indices) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `'id' duplicado no pipeline: "${id}" aparece ${indices.length} vezes.`,
            path: [idx, "id"],
          });
        }
      }
    }

    // Set de ids válidos para checagem de alvos de goto
    const validIds = new Set(steps.map((s) => s.id));

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;

      // --- (2) goto targets must reference existing ids ------------------
      if (step.on_success) {
        const target = step.on_success.goto;
        if (!validIds.has(target)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `step "${step.id}": 'on_success.goto' referencia "${target}", que não existe no pipeline.`,
            path: [i, "on_success", "goto"],
          });
        }
      }

      if (step.on_fail && typeof step.on_fail === "object") {
        const target = step.on_fail.goto;
        if (!validIds.has(target)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `step "${step.id}": 'on_fail.goto' referencia "${target}", que não existe no pipeline.`,
            path: [i, "on_fail", "goto"],
          });
        }
      }

      // --- (3) guard do agente generalizado (OQ-7 + goto) ---------------
      if (
        step.type === "agent" &&
        step.on_fail &&
        !step.verify &&
        !step.expect
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "'on_fail' exige 'verify' ou 'expect' — sem nenhum dos dois não há modo de falha para governar.",
          path: [i, "on_fail"],
        });
      }
    }
  });

// ---------------------------------------------------------------------------
// stop_conditions / policies / logging
// ---------------------------------------------------------------------------

const stopConditionsSchema = z
  .object({
    max_iterations: z.number().int().positive(),
    max_step_visits: z.number().int().positive().default(10),
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
    on_merge_conflict: z.enum(["escalate", "rebase"]).default("escalate"),
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
// metrics (opt-in — C-0005)
// ---------------------------------------------------------------------------

const metricsReportSchema = z
  .object({
    index: nonEmptyString,
  })
  .strict();

const metricsSchema = z
  .object({
    report: metricsReportSchema.optional(),
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
    agents: agentsSchema.optional(),
    acp: acpSchema,
    inputs: inputsSchema,
    checks: checksSchema,
    pipeline: pipelineSchema,
    stop_conditions: stopConditionsSchema,
    concurrency: z.number().int().min(1).default(1),
    policies: policiesSchema,
    logging: loggingSchema,
    metrics: metricsSchema.optional(),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    const hasAgents = cfg.agents !== undefined && Object.keys(cfg.agents).length > 0;
    const hasLegacyCommand = cfg.acp.command !== undefined;

    // (a) agents: and acp.command are mutually exclusive
    if (hasAgents && hasLegacyCommand) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "'agents' e 'acp.command' são mutuamente exclusivos — use um ou outro.",
        path: ["agents"],
      });
      return; // short-circuit: remaining checks need a single source
    }

    // (d) at least one resolvable agent
    if (!hasAgents && !hasLegacyCommand) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Nenhum agente resolvível: defina 'agents' ou 'acp.command'.",
        path: ["acp"],
      });
      return;
    }

    // When using legacy command, no agent-level validations needed
    if (!hasAgents) return;

    const agentNames = new Set(Object.keys(cfg.agents!));
    const namesList = [...agentNames].join(", ");

    // (c) default_agent (if set) must exist in registry
    if (cfg.acp.default_agent !== undefined && !agentNames.has(cfg.acp.default_agent)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `'acp.default_agent' referencia "${cfg.acp.default_agent}", que não existe em 'agents' (disponíveis: ${namesList}).`,
        path: ["acp", "default_agent"],
      });
      return;
    }

    // Determine the default agent name
    const defaultAgent =
      cfg.acp.default_agent ??
      (agentNames.size === 1 ? [...agentNames][0]! : undefined);

    // (b)+(e) validate agent references on agent steps
    for (let i = 0; i < cfg.pipeline.length; i++) {
      const step = cfg.pipeline[i]!;
      if (step.type !== "agent") continue;

      if (step.agent !== undefined && !agentNames.has(step.agent)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `step "${step.id}": 'agent' referencia "${step.agent}", que não existe em 'agents' (disponíveis: ${namesList}).`,
          path: ["pipeline", i, "agent"],
        });
      } else if (step.agent === undefined && defaultAgent === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `step "${step.id}": 'agent' é obrigatório quando há >1 agente sem 'acp.default_agent' (disponíveis: ${namesList}).`,
          path: ["pipeline", i, "agent"],
        });
      }
    }
  });

/** The validated, defaults-applied config as inferred from the schema. */
export type LoopyConfigParsed = z.infer<typeof loopyConfigSchema>;
