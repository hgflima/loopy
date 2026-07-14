/**
 * useAgentCapabilities — probe bridge for the StepEditor (T-010, D30/D31/D32).
 *
 * Given an agent name, returns its capabilities (modes/models/efforts) by:
 * 1. Reading the cache first (`.loopy/capabilities.json` — cheap file read)
 * 2. Probing on demand via `loopy probe-agent <name> --json` (spawns the adapter)
 *
 * **Never blocks editing** (D31): the probe is async; while it runs the editor
 * stays fully usable with free-text fields. If the probe fails, the status
 * degrades to "failed" with a reason — the StepEditor falls back to TextFields.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { isTauri, invoke } from "@tauri-apps/api/core";
import type { AgentCapabilities } from "loopy/acp/capabilities";

// Re-export for consumers (StepEditor needs this type).
export type { AgentCapabilities };

/** Status of a capabilities probe for a single agent. */
export interface ProbeResult {
  status: "idle" | "probing" | "ok" | "failed";
  caps?: AgentCapabilities;
  reason?: string;
}

/**
 * Um resultado **carimbado com a pergunta que o produziu**.
 *
 * A sondagem é assíncrona: entre trocar o preset e o adapter novo responder,
 * existe uma janela em que o único resultado em mãos é o do adapter ANTERIOR.
 * Sem o carimbo, o hook o entregava como se fosse a resposta corrente — e o
 * `ConfigPane`, que semeia `model`/`effort` com o default sondado, gravava no
 * yml o default do adapter que o usuário acabou de descartar.
 */
interface KeyedProbe {
  readonly key: string;
  readonly result: ProbeResult;
}

/** Cache file shape — mirrors `CapabilitiesCache` from the engine. */
interface CacheEntry {
  readonly probedAt: string;
  readonly capabilities: AgentCapabilities;
}
type CapabilitiesCache = Record<string, CacheEntry>;

/**
 * Look up the cache entry for an agent command **probed with `model`**.
 *
 * Mirrors the engine's `cacheKey`: `argv` alone, or `argv::model` when the probe
 * applied a model. The model is part of the key because capabilities are not
 * always static — OpenCode announces `thought_level` only when the current
 * model has variants, and the effort values change with it.
 *
 * A bare-argv entry is **not** an acceptable answer for a model-specific
 * question: falling back to it would resurrect the very bug this fixes (the
 * bare probe of OpenCode reports no effort). A miss re-probes.
 */
function findCacheEntry(
  cache: CapabilitiesCache,
  command: readonly string[] | undefined,
  model: string | undefined,
): AgentCapabilities | undefined {
  if (!command || command.length === 0) return undefined;
  const argv = command.join(" ");
  const key = model ? `${argv}::${model}` : argv;
  const caps = cache[key]?.capabilities;
  return caps && isStale(caps) ? undefined : caps;
}

/**
 * True for caches written before the probe captured the agent's own defaults
 * (`currentValue`). Such an entry lists values but can't name the inherited
 * default, so the editor would show "default do agente" with no value.
 * Treating it as a miss re-probes once and heals the cache.
 *
 * An agent that announces *no* select at all legitimately has no defaults — it
 * also has no values, so it is not mistaken for stale (and never re-probed).
 */
function isStale(caps: AgentCapabilities): boolean {
  const announcesSomething =
    caps.modes.length > 0 || caps.models.length > 0 || caps.efforts.length > 0;
  const hasAnyDefault =
    caps.defaultMode !== undefined ||
    caps.defaultModel !== undefined ||
    caps.defaultEffort !== undefined;
  return announcesSomething && !hasAnyDefault;
}

/**
 * Hook that probes an agent's capabilities via the Tauri bridge.
 *
 * @param agentName   Agent name from the registry (undefined = no agent selected)
 * @param agentCommand  The agent's `command` argv (used to key the cache lookup)
 * @param dir         Project directory (for cache file and probe command)
 * @param model       The model in effect for what is being edited (step override
 *   or registry entry). Probing **with** it is what makes effort discoverable on
 *   adapters that derive it from the model — probe bare and OpenCode answers
 *   "no effort" even for a model that has `[high, max]`. Changing it re-probes.
 * @param env         The agent's `env` (draft values), forwarded so an adapter
 *   that authenticates by API key can still be probed.
 *
 * **The probe goes by argv, not by name** (D-0011): the editor works on a draft,
 * and `probe-agent <nome>` resolves the name against the **saved** yml. Switching
 * an agent's preset would then probe the adapter it *used to be* — and answer,
 * without failing, with the wrong capabilities.
 */
export function useAgentCapabilities(
  agentName: string | undefined,
  agentCommand: readonly string[] | undefined,
  dir: string | undefined,
  model?: string,
  env?: Readonly<Record<string, string>>,
): ProbeResult & { probe: () => void } {
  // What is being edited *right now* — an answer for anything else is stale.
  // The argv is part of it: switching a preset changes the adapter, and the
  // in-flight probe of the old one must not paint the new one's fields.
  const key = `${agentName ?? ""}|${agentCommand?.join(" ") ?? ""}|${model ?? ""}|${envKey(env)}`;
  const keyRef = useRef(key);
  keyRef.current = key;

  const [state, setState] = useState<KeyedProbe>({
    key,
    result: { status: "idle" },
  });

  // Unmount, e **só** unmount. Um ref zerado a cada troca de deps não protegia
  // nada: o effect novo o reabria, e a resposta atrasada do argv antigo passava
  // por cima da do corrente. Quem decide isso agora é a key.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Publica um resultado só se ele ainda responde à pergunta corrente. */
  const settle = useCallback((mine: string, result: ProbeResult) => {
    if (!mountedRef.current || keyRef.current !== mine) return;
    setState({ key: mine, result });
  }, []);

  const probe = useCallback(async () => {
    const mine = key;
    if (!agentName || !dir || !isTauri()) {
      settle(mine, { status: "idle" });
      return;
    }

    settle(mine, { status: "probing" });

    try {
      const caps = await invokeProbe(dir, agentName, agentCommand, model, env);
      settle(mine, { status: "ok", caps });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      settle(mine, { status: "failed", reason });
    }
  }, [agentName, agentCommand?.join(" "), dir, model, envKey(env), settle]);

  // Auto-load: cache first, then probe on miss
  useEffect(() => {
    const mine = key;

    if (!agentName || !dir || !isTauri()) {
      settle(mine, { status: "idle" });
      return;
    }

    async function loadFromCacheOrProbe() {
      try {
        // Step 1: try the cache (cheap — just a file read)
        const cacheJson = await invoke<string | null>(
          "read_capabilities_cache",
          { dir },
        );

        if (cacheJson && agentCommand) {
          const cache = JSON.parse(cacheJson) as CapabilitiesCache;
          const cached = findCacheEntry(cache, agentCommand, model);
          if (cached) {
            settle(mine, { status: "ok", caps: cached });
            return;
          }
        }

        // Step 2: cache miss — probe the agent (spawns the adapter)
        settle(mine, { status: "probing" });
        const caps = await invokeProbe(
          dir!,
          agentName!,
          agentCommand,
          model,
          env,
        );
        settle(mine, { status: "ok", caps });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        settle(mine, { status: "failed", reason });
      }
    }

    void loadFromCacheOrProbe();
  }, [agentName, agentCommand?.join(" "), dir, model, envKey(env), settle]);

  /**
   * Enquanto a sondagem do argv corrente não responde, o resultado carimbado é
   * de outra pergunta — e a resposta honesta é "ainda não sei", não a do adapter
   * anterior. Derivado no render, de propósito: um effect para limpar o state
   * ainda deixaria um commit inteiro com o valor velho na tela (e o `ConfigPane`
   * semeia num effect — ele veria o valor velho).
   */
  const result: ProbeResult =
    state.key === key
      ? state.result
      : agentName && dir && isTauri()
        ? { status: "probing" }
        : { status: "idle" };

  return { ...result, probe };
}

/** Stable dependency for an `env` record (object identity changes every render). */
function envKey(env: Readonly<Record<string, string>> | undefined): string {
  if (!env) return "";
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join(" ");
}

/**
 * Run `probe-agent` through the Tauri bridge, **by argv** whenever we have one
 * (D-0011). The name is sent as a fallback for agents with no resolvable argv.
 */
async function invokeProbe(
  dir: string,
  agentName: string,
  agentCommand: readonly string[] | undefined,
  model: string | undefined,
  env: Readonly<Record<string, string>> | undefined,
): Promise<AgentCapabilities> {
  const stdout = await invoke<string>("probe_agent", {
    dir,
    agentName,
    model,
    command: agentCommand ? [...agentCommand] : undefined,
    env: env
      ? Object.entries(env).map(([k, v]) => `${k}=${v}`)
      : undefined,
  });
  return JSON.parse(stdout) as AgentCapabilities;
}
