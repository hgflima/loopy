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

/** Cache file shape — mirrors `CapabilitiesCache` from the engine. */
interface CacheEntry {
  readonly probedAt: string;
  readonly capabilities: AgentCapabilities;
}
type CapabilitiesCache = Record<string, CacheEntry>;

/**
 * Look up the cache entry for an agent command.
 * The cache is keyed by `command.join(" ")` (same as the engine).
 */
function findCacheEntry(
  cache: CapabilitiesCache,
  command: readonly string[] | undefined,
): AgentCapabilities | undefined {
  if (!command || command.length === 0) return undefined;
  const key = command.join(" ");
  return cache[key]?.capabilities;
}

/**
 * Hook that probes an agent's capabilities via the Tauri bridge.
 *
 * @param agentName   Agent name from the registry (undefined = no agent selected)
 * @param agentCommand  The agent's `command` argv (used to key the cache lookup)
 * @param dir         Project directory (for cache file and probe command)
 */
export function useAgentCapabilities(
  agentName: string | undefined,
  agentCommand: readonly string[] | undefined,
  dir: string | undefined,
): ProbeResult & { probe: () => void } {
  const [state, setState] = useState<ProbeResult>({ status: "idle" });
  const abortRef = useRef(false);
  // Track the current agent to avoid stale updates
  const agentRef = useRef(agentName);
  agentRef.current = agentName;

  const probe = useCallback(async () => {
    if (!agentName || !dir || !isTauri()) {
      setState({ status: "idle" });
      return;
    }

    setState({ status: "probing" });

    try {
      const stdout = await invoke<string>("probe_agent", {
        dir,
        agentName,
      });
      // Guard against stale response (agent changed while probing)
      if (abortRef.current || agentRef.current !== agentName) return;
      const caps = JSON.parse(stdout) as AgentCapabilities;
      setState({ status: "ok", caps });
    } catch (err) {
      if (abortRef.current || agentRef.current !== agentName) return;
      const reason = err instanceof Error ? err.message : String(err);
      setState({ status: "failed", reason });
    }
  }, [agentName, dir]);

  // Auto-load: cache first, then probe on miss
  useEffect(() => {
    abortRef.current = false;

    if (!agentName || !dir || !isTauri()) {
      setState({ status: "idle" });
      return () => { abortRef.current = true; };
    }

    async function loadFromCacheOrProbe() {
      try {
        // Step 1: try the cache (cheap — just a file read)
        const cacheJson = await invoke<string | null>(
          "read_capabilities_cache",
          { dir },
        );
        if (abortRef.current) return;

        if (cacheJson && agentCommand) {
          const cache = JSON.parse(cacheJson) as CapabilitiesCache;
          const cached = findCacheEntry(cache, agentCommand);
          if (cached) {
            setState({ status: "ok", caps: cached });
            return;
          }
        }

        // Step 2: cache miss — probe the agent (spawns the adapter)
        setState({ status: "probing" });
        const stdout = await invoke<string>("probe_agent", {
          dir,
          agentName,
        });
        if (abortRef.current) return;
        const caps = JSON.parse(stdout) as AgentCapabilities;
        setState({ status: "ok", caps });
      } catch (err) {
        if (abortRef.current) return;
        const reason = err instanceof Error ? err.message : String(err);
        setState({ status: "failed", reason });
      }
    }

    void loadFromCacheOrProbe();

    return () => {
      abortRef.current = true;
    };
  }, [agentName, agentCommand?.join(" "), dir]);

  return { ...state, probe };
}
