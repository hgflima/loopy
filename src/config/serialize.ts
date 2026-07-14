/**
 * Pure serialization / deserialization of `loopy.yml` configs.
 *
 * Browser-safe: no `node:fs` or I/O — only `yaml` library calls.
 * Used by the config editor (C-0014) to read/write YAML strings.
 *
 * - `serializeConfig` — emits YAML in canonical key order (matching the
 *   `loopyConfigSchema` declaration), stripping runtime-derived fields.
 * - `parseConfigSource` — raw YAML parse (no zod), browser-safe counterpart
 *   of `serializeConfig` for obtaining the unvalidated object.
 * - `initialConfigTemplate` — minimal valid `LoopyConfigParsed` owned by the
 *   engine, used as a starting point for new configs in the editor.
 */
import { stringify, parse } from "yaml";
import type { LoopyConfigParsed } from "./schema";

/**
 * Canonical top-level key order — mirrors the declaration order in
 * `loopyConfigSchema` and `examples/loopy.yml`.
 */
const CANONICAL_KEYS = [
  "version",
  "name",
  "workspace",
  "agents",
  "acp",
  "inputs",
  "checks",
  "pipeline",
  "stop_conditions",
  "concurrency",
  "max_concurrency",
  "policies",
  "logging",
  "metrics",
] as const;

/**
 * Runtime-only fields that must NOT appear in the serialized YAML.
 * These are added by `loadConfig` / `parseConfig` after validation.
 */
const RUNTIME_FIELDS = new Set(["resolvedAgents"]);

/**
 * Serialize a validated config to YAML in canonical key order.
 *
 * - Strips runtime-derived fields (`resolvedAgents`).
 * - Omits keys whose value is `undefined` (e.g. optional `agents`, `metrics`).
 * - Does NOT preserve comments (accepted trade-off — mitigated by backup).
 */
export function serializeConfig(config: LoopyConfigParsed): string {
  const ordered: Record<string, unknown> = {};

  for (const key of CANONICAL_KEYS) {
    const value = (config as Record<string, unknown>)[key];
    if (value !== undefined) {
      ordered[key] = value;
    }
  }

  // Safety: include any non-canonical, non-runtime keys that might exist
  // (future-proofing — shouldn't happen with strict schema, but defensive).
  for (const key of Object.keys(config)) {
    if (!RUNTIME_FIELDS.has(key) && !(key in ordered)) {
      ordered[key] = (config as Record<string, unknown>)[key];
    }
  }

  return stringify(ordered);
}

/**
 * Parse a YAML source string into a raw object — **no zod validation**.
 *
 * This is the browser-safe read counterpart of `serializeConfig`. The caller
 * (typically the config editor) gets the raw object before deciding whether
 * to validate it against the schema.
 *
 * Throws on YAML **syntax** errors (malformed YAML). Does NOT throw on
 * schema-invalid content (that's the caller's responsibility via zod).
 */
export function parseConfigSource(source: string): unknown {
  return parse(source);
}

/**
 * Minimal valid `LoopyConfigParsed` — the engine's canonical starting template.
 *
 * Satisfies all required fields with plausible defaults:
 * - 1 agent via `acp.command` (legacy path — simplest valid config).
 * - Pipeline with 1 agent step.
 * - All required sections filled with sensible values.
 */
export const initialConfigTemplate: LoopyConfigParsed = {
  version: "1",
  name: "my-loop",
  workspace: {
    root: ".",
    parent_branch: "main",
    worktrees_dir: ".worktrees",
  },
  acp: {
    command: ["npx", "-y", "@agentclientprotocol/claude-agent-acp"],
    request_timeout_seconds: 1800,
    permissions: {
      default_mode: "acceptEdits",
      on_request: "allow",
    },
  },
  inputs: {
    spec: "spec.md",
    plan: "plan.md",
    todo: "todo.md",
    backlog: {
      pending_marker: "- [ ]",
      done_marker: "- [x]",
      task_id_pattern: "T-\\d+",
      body: "indented",
      mark_done_on_success: true,
    },
  },
  checks: {
    ci: [
      { name: "typecheck", run: "npm run typecheck" },
      { name: "test", run: "npm test" },
    ],
  },
  pipeline: [
    {
      id: "implement",
      type: "agent" as const,
      prompt: "Implement the current task.",
      clear_context: true,
      parallel_safe: false,
      verify: { run: "ci", max_attempts: 3 },
    },
  ],
  stop_conditions: {
    max_iterations: 25,
    max_step_visits: 10,
    stop_signal_file: ".loopy.stop",
  },
  concurrency: 1,
  max_concurrency: 4,
  policies: {
    escalation: {
      action: "pause",
      keep_worktree: true,
      notify: "stderr",
    },
    git: {
      require_clean_parent: true,
      on_merge_conflict: "escalate",
    },
  },
  logging: {
    dir: ".loopy/logs",
    per_task: true,
    capture_acp_traffic: false,
  },
};
