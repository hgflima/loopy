/**
 * AgentProcessPool — one ACP process per referenced Agent, spawned eagerly.
 *
 * Per AD-3 (evolved): the run spawns **one process per Agent referenced** by the
 * pipeline (the set is static — computed from `step.agent` + default). Agents in
 * the registry that are never referenced do not spawn. A spawn failure of any
 * referenced agent fails the entire Run fast (before any Task starts).
 *
 * The pool also owns a **session pool re-keyed by `${agent}::${worktree}`** so
 * that two Agents targeting the same worktree each get their own Session (AD-3:
 * cwd immutable per Session).
 *
 * Boundaries: pure lifecycle management — no loop behavior (AD-1).
 */
import type { AgentHandle } from "./agent";
import type { LoopySession, SessionDeps } from "./session";
import { buildSession } from "./session";
import type { LoggerPort } from "../types";

/** The subset of `OpenAgentOptions` that varies per-Agent in the pool. */
export interface PerAgentOptions {
  readonly command: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Factory that spawns an Agent process — injected so the pool is testable with
 * fakes (no real subprocess in unit tests).
 */
export type AgentSpawner = (
  name: string,
  opts: PerAgentOptions,
) => Promise<AgentHandle>;

/**
 * A pool of ACP processes keyed by agent name, with a composite session pool
 * keyed by `${agent}::${worktree}`.
 */
export interface AgentProcessPool {
  /** Get the handle for a named agent (must have been spawned). */
  handle(agentName: string): AgentHandle;
  /** Get (or open, once) the Session for the `(agent, worktree)` pair. */
  session(agentName: string, cwd: string): Promise<LoopySession>;
  /** Already-open Session for `(agent, worktree)`, if any. */
  peek(agentName: string, cwd: string): LoopySession | undefined;
  /** Dispose the Session for `(agent, worktree)`. */
  closeSession(agentName: string, cwd: string): void;
  /** Dispose all Sessions (but keep processes alive). */
  closeAllSessions(): void;
  /** Shutdown every process and dispose every Session. Idempotent. */
  shutdownAll(): Promise<void>;
  /** Number of agent processes in the pool. */
  readonly size: number;
}

/** Composite key for the session pool. */
function sessionKey(agentName: string, cwd: string): string {
  return `${agentName}::${cwd}`;
}

/** Build `SessionDeps` from an `AgentHandle` + optional extras. */
function depsFromHandle(
  handle: AgentHandle,
  logger?: LoggerPort,
  onReopen?: (oldSessionId: string, newSessionId: string) => void,
): SessionDeps {
  return {
    ctx: handle.ctx,
    text: handle.text,
    cost: handle.cost,
    logger,
    onReopen,
  };
}

/**
 * Build an {@link AgentProcessPool} by eagerly spawning one process per agent
 * in `agentOptions`. All spawns run concurrently; if any fails, all already-
 * spawned processes are shut down and the error propagates (fail-fast).
 */
export async function createAgentProcessPool(
  agentOptions: ReadonlyMap<string, PerAgentOptions>,
  spawner: AgentSpawner,
  logger?: LoggerPort,
  onReopen?: (oldSessionId: string, newSessionId: string) => void,
): Promise<AgentProcessPool> {
  const handles = new Map<string, AgentHandle>();

  // Eager spawn — all concurrently.
  const entries = [...agentOptions.entries()];
  const promises = entries.map(async ([name, opts]) => {
    const handle = await spawner(name, opts);
    return { name, handle };
  });

  try {
    const results = await Promise.all(promises);
    for (const { name, handle } of results) {
      handles.set(name, handle);
    }
  } catch (err) {
    // Fail-fast: shutdown any handles that did succeed before re-throwing.
    for (const h of handles.values()) {
      try {
        await h.shutdown();
      } catch {
        // best-effort cleanup
      }
    }
    throw err;
  }

  // Session pool keyed by `${agent}::${worktree}`.
  const opening = new Map<string, Promise<LoopySession>>();
  const open = new Map<string, LoopySession>();

  function disposeSessions(): void {
    for (const session of open.values()) session.dispose();
    open.clear();
    opening.clear();
  }

  function getHandle(agentName: string): AgentHandle {
    const h = handles.get(agentName);
    if (!h) {
      throw new Error(
        `AgentProcessPool: agente "${agentName}" não está no pool (referenciados: ${[...handles.keys()].join(", ")}).`,
      );
    }
    return h;
  }

  return {
    handle(agentName: string): AgentHandle {
      return getHandle(agentName);
    },

    session(agentName: string, cwd: string): Promise<LoopySession> {
      const key = sessionKey(agentName, cwd);
      const inFlight = opening.get(key);
      if (inFlight) return inFlight;

      const h = getHandle(agentName);
      const deps = depsFromHandle(h, logger, onReopen);
      const started = buildSession(deps, cwd)
        .start()
        .then((session) => {
          open.set(key, session);
          return session;
        });
      started.catch(() => {
        if (opening.get(key) === started) opening.delete(key);
      });
      opening.set(key, started);
      return started;
    },

    peek(agentName: string, cwd: string): LoopySession | undefined {
      return open.get(sessionKey(agentName, cwd));
    },

    closeSession(agentName: string, cwd: string): void {
      const key = sessionKey(agentName, cwd);
      open.get(key)?.dispose();
      open.delete(key);
      opening.delete(key);
    },

    closeAllSessions: disposeSessions,

    async shutdownAll(): Promise<void> {
      disposeSessions();

      // Shutdown all processes.
      const shutdowns = [...handles.values()].map(async (h) => {
        try {
          await h.shutdown();
        } catch {
          // best-effort
        }
      });
      await Promise.all(shutdowns);
      handles.clear();
    },

    get size(): number {
      return handles.size;
    },
  };
}
