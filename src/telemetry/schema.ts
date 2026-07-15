/**
 * Telemetry schema bootstrap + identity hashes.
 *
 * `bootstrap` applies `schema.sql` (the single source of the DDL + views) once
 * per `.db`, guarded by `PRAGMA user_version` and made idempotent by
 * `CREATE ... IF NOT EXISTS`. The SQL is loaded through the same runtime seam as
 * the driver ({@link ./db}): read from disk on Node (npm CLI, tsx, vitest), and
 * a Bun-embedded text-import on the `bun build --compile` sidecar — where the
 * file is not on disk (`$bunfs`) but Bun embeds statically-imported text.
 *
 * The identity helpers derive the stable keys the collector writes:
 * - `promptVersion` — sha256 of the step's prompt template(s) **pre-interpolation**
 *   (the interpolated text varies per task; the template is stable per step, D11).
 * - `configId` — sha256 of the resolved `preset|model|mode|effort|prompt_version` (D11).
 * - `pipelineVersion` — reuses `pipelineFingerprint` from the resume layer (D11).
 * - `resolvedJson` — the declared `AgentDef` (env kept as `${env.KEY}` templates,
 *   never resolved secret values — D24).
 *
 * All hashes use `node:crypto`, which is available on both runtimes.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { PromptSelectable } from "../interp/resolver";
import type { AgentDef } from "../types";
import type { TelemetryDb } from "./db";

/** Reuse the resume-layer pipeline fingerprint as the telemetry pipeline version (D11). */
export { pipelineFingerprint as pipelineVersion } from "../resume/state";

/** Schema version stamped into `PRAGMA user_version` once the DDL is applied. */
export const SCHEMA_VERSION = 1;

/**
 * Load `schema.sql`. Runtime-guarded, mirroring {@link ./db}:
 * - **Bun sidecar** (`bun build --compile`): the file is not on disk, but Bun
 *   embeds the statically-referenced text-import at compile time.
 * - **Node** (npm CLI, tsx, vitest): read the sibling file from disk.
 */
async function loadSchemaSql(): Promise<string> {
  if (typeof (globalThis as { Bun?: unknown }).Bun !== "undefined") {
    return (await import("./schema.sql", { with: { type: "text" } }))
      .default as string;
  }
  return readFileSync(
    fileURLToPath(new URL("./schema.sql", import.meta.url)),
    "utf8",
  );
}

/**
 * Apply the schema to `db` (idempotent). Short-circuits when `user_version`
 * already reaches {@link SCHEMA_VERSION}; otherwise runs the DDL (every object
 * is `IF NOT EXISTS`) and stamps the version.
 */
export async function bootstrap(db: TelemetryDb): Promise<void> {
  const current =
    db.all<{ user_version: number }>("PRAGMA user_version")[0]?.user_version ??
    0;
  if (current >= SCHEMA_VERSION) return;
  db.run(await loadSchemaSql());
  db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

// ---------------------------------------------------------------------------
// Identity hashes
// ---------------------------------------------------------------------------

/** sha256 of a canonical JSON array of parts, as lowercase hex. */
function sha256Hex(parts: readonly (string | null)[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/**
 * The stable version of a step's prompt: sha256 of its **pre-interpolation**
 * template(s) — `prompt` plus `retry_prompt` (the two `selectPrompt` can pick,
 * `interp/resolver.ts`). Absent `retry_prompt` hashes as `null`, distinct from
 * an empty string, matching `selectPrompt`'s `retry_prompt ?? prompt` semantics.
 */
export function promptVersion(step: PromptSelectable): string {
  return sha256Hex([step.prompt, step.retry_prompt ?? null]);
}

/** The resolved fields that identify an agent configuration for a step (D11). */
export interface ConfigIdInput {
  readonly preset: string;
  readonly model: string;
  readonly mode: string;
  /** effort is best-effort per-agent; may be unset (no-op adapters). */
  readonly effort?: string | null;
  readonly promptVersion: string;
}

/**
 * `config_id` = sha256 of the resolved `preset|model|mode|effort|prompt_version`
 * (D11). Stable for equal inputs, distinct for any difference; a missing effort
 * hashes as `null` (distinct from a present value).
 */
export function configId(input: ConfigIdInput): string {
  return sha256Hex([
    input.preset,
    input.model,
    input.mode,
    input.effort ?? null,
    input.promptVersion,
  ]);
}

/**
 * Serialize the **declared** form of an agent for `agent_config.resolved_json`
 * (D24). The `env` block keeps its `${env.KEY}` templates — the resolution to
 * real values (`resolveAgentEnv`) happens in an ephemeral pass that is never
 * stored, so this never leaks a `process.env` secret. The literal fixes a
 * canonical key order (the `serialize.ts` principle: emit declared fields, strip
 * runtime-derived ones), and `JSON.stringify` drops the `undefined` ones — a
 * stable string per declared shape.
 */
export function resolvedJson(agent: AgentDef): string {
  return JSON.stringify({
    command: agent.command,
    env: agent.env,
    model: agent.model,
    effort: agent.effort,
    display_name: agent.display_name,
  });
}
