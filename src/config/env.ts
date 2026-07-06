/**
 * Pure resolver for `${env.KEY}` references in `agents.*.env` — env-only scope.
 *
 * This is deliberately **not** part of `buildScopeVars` (AD-4): secrets resolve
 * only in the agent env block, never in prompts/shell/logs. A declared key that
 * is absent from `process.env` is a hard prerequisite → `ConfigError` fail-fast.
 */
import { ConfigError } from "./load";
import type { AgentDef } from "../types";

/** Regex matching `${env.KEY}` references in agent env values. */
const ENV_REF = /\$\{env\.([^}]+)\}/g;

/**
 * Resolve `${env.KEY}` references in every agent's `env` block, producing a
 * flat `Record<agentName, Record<key, resolvedValue>>` suitable for spreading
 * into `child_process.spawn({ env })`.
 *
 * - Agents without `env` produce an empty record (subscription auth — no overrides).
 * - A reference to a missing env var is a `ConfigError` (fail-fast).
 * - Pure function — no I/O, deterministic.
 */
export function resolveAgentEnv(
  agents: Readonly<Record<string, AgentDef>>,
  processEnv: NodeJS.ProcessEnv,
): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};

  for (const [agentName, def] of Object.entries(agents)) {
    const resolved: Record<string, string> = {};
    if (def.env) {
      for (const [key, template] of Object.entries(def.env)) {
        resolved[key] = resolveTemplate(template, processEnv, agentName, key);
      }
    }
    result[agentName] = resolved;
  }

  return result;
}

/**
 * Resolve a single template string: replace every `${env.VAR}` with the
 * corresponding value from `processEnv`. Missing → `ConfigError`.
 */
function resolveTemplate(
  template: string,
  processEnv: NodeJS.ProcessEnv,
  agentName: string,
  key: string,
): string {
  return template.replace(ENV_REF, (_match, envKey: string) => {
    const value = processEnv[envKey];
    if (value === undefined) {
      throw new ConfigError(
        `agents.${agentName}.env.${key}: variável de ambiente '${envKey}' não encontrada (referenciada como '\${env.${envKey}}').`,
      );
    }
    return value;
  });
}
