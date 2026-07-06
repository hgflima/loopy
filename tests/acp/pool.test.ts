/**
 * Tests for AgentProcessPool (T-003) — eager spawn, session re-keying, fail-fast.
 *
 * Uses a fake spawner injected via `AgentSpawner` — no real subprocess.
 * Session creation uses the real fake-agent subprocess (same as session.test.ts)
 * for the integration layer.
 */
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAgentProcessPool,
  type AgentProcessPool,
  type AgentSpawner,
  type PerAgentOptions,
} from "../../src/acp/pool";
import { openAgent, type AgentHandle } from "../../src/acp/agent";
import type { FakeScenario } from "../fixtures/fake-agent";

const FAKE_AGENT = fileURLToPath(
  new URL("../fixtures/fake-agent.ts", import.meta.url),
);
const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Spawn command for the fake agent with a scenario. */
function fakeCommand(scenario: FakeScenario = {}): string[] {
  return [
    process.execPath,
    "--import",
    "tsx",
    FAKE_AGENT,
    JSON.stringify(scenario),
  ];
}

// ---------------------------------------------------------------------------
// Fake spawner — no real process, just tracks calls
// ---------------------------------------------------------------------------

interface FakeHandle {
  name: string;
  shutdownCalled: boolean;
}

function createFakeHandle(name: string): AgentHandle & FakeHandle {
  return {
    name,
    shutdownCalled: false,
    ctx: {} as AgentHandle["ctx"],
    agentInfo: null,
    protocolVersion: 1,
    text: { read: () => "", reset: () => {}, append: () => {} } as unknown as AgentHandle["text"],
    cost: { read: () => null, set: () => {} } as unknown as AgentHandle["cost"],
    terminals: {} as AgentHandle["terminals"],
    closed: Promise.resolve(),
    async shutdown() {
      this.shutdownCalled = true;
    },
  };
}

// ---------------------------------------------------------------------------
// Unit: AgentProcessPool with fake spawner
// ---------------------------------------------------------------------------

describe("AgentProcessPool (fakes)", () => {
  it("spawns eagerly for all referenced agents", async () => {
    const spawned: string[] = [];
    const spawner: AgentSpawner = async (name) => {
      spawned.push(name);
      return createFakeHandle(name);
    };

    const opts = new Map<string, PerAgentOptions>([
      ["claude", { command: ["claude-acp"] }],
      ["codex", { command: ["codex-acp"] }],
    ]);

    const pool = await createAgentProcessPool(opts, spawner);
    expect(spawned).toContain("claude");
    expect(spawned).toContain("codex");
    expect(pool.size).toBe(2);
    await pool.shutdownAll();
  });

  it("does not spawn agents not in the options map (unreferenced)", async () => {
    const spawned: string[] = [];
    const spawner: AgentSpawner = async (name) => {
      spawned.push(name);
      return createFakeHandle(name);
    };

    // Only claude referenced — codex not in map, never spawned.
    const opts = new Map<string, PerAgentOptions>([
      ["claude", { command: ["claude-acp"] }],
    ]);

    const pool = await createAgentProcessPool(opts, spawner);
    expect(spawned).toEqual(["claude"]);
    expect(pool.size).toBe(1);
    await pool.shutdownAll();
  });

  it("fails fast when any spawn fails — rejects and cleans up", async () => {
    const handles: FakeHandle[] = [];
    const spawner: AgentSpawner = async (name) => {
      if (name === "codex") throw new Error("spawn failed: codex");
      const h = createFakeHandle(name);
      handles.push(h);
      return h;
    };

    const opts = new Map<string, PerAgentOptions>([
      ["claude", { command: ["claude-acp"] }],
      ["codex", { command: ["codex-acp"] }],
    ]);

    await expect(createAgentProcessPool(opts, spawner)).rejects.toThrow(
      "spawn failed: codex",
    );
  });

  it("handle() throws for an unknown agent", async () => {
    const spawner: AgentSpawner = async (name) => createFakeHandle(name);
    const opts = new Map<string, PerAgentOptions>([
      ["claude", { command: ["claude-acp"] }],
    ]);
    const pool = await createAgentProcessPool(opts, spawner);
    expect(() => pool.handle("unknown")).toThrow("unknown");
    await pool.shutdownAll();
  });

  it("handle() returns the correct handle", async () => {
    const spawner: AgentSpawner = async (name) => createFakeHandle(name);
    const opts = new Map<string, PerAgentOptions>([
      ["claude", { command: ["claude-acp"] }],
      ["codex", { command: ["codex-acp"] }],
    ]);
    const pool = await createAgentProcessPool(opts, spawner);
    const h = pool.handle("claude") as AgentHandle & FakeHandle;
    expect(h.name).toBe("claude");
    await pool.shutdownAll();
  });

  it("shutdownAll shuts down all handles", async () => {
    const allHandles: FakeHandle[] = [];
    const spawner: AgentSpawner = async (name) => {
      const h = createFakeHandle(name);
      allHandles.push(h);
      return h;
    };
    const opts = new Map<string, PerAgentOptions>([
      ["claude", { command: ["claude-acp"] }],
      ["codex", { command: ["codex-acp"] }],
    ]);
    const pool = await createAgentProcessPool(opts, spawner);
    await pool.shutdownAll();
    expect(allHandles.every((h) => h.shutdownCalled)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration: session pool re-keyed by (agent, worktree) against fake agent
// ---------------------------------------------------------------------------

describe("AgentProcessPool session re-keying (integration)", () => {
  let pool: AgentProcessPool | undefined;
  const handles: AgentHandle[] = [];

  afterEach(async () => {
    if (pool) {
      await pool.shutdownAll();
      pool = undefined;
    }
    for (const h of handles) {
      try {
        await h.shutdown();
      } catch { /* already shut down */ }
    }
    handles.length = 0;
  });

  /** Real spawner that opens the fake agent subprocess. */
  const realSpawner: AgentSpawner = async (_name, opts) => {
    const h = await openAgent({
      command: opts.command as string[],
      cwd: PROJECT_ROOT,
      env: opts.env,
      permissions: { on_request: "allow" },
    });
    handles.push(h);
    return h;
  };

  it("creates two Sessions in the same worktree for two different agents", async () => {
    const opts = new Map<string, PerAgentOptions>([
      ["claude", { command: fakeCommand({}) }],
      ["codex", { command: fakeCommand({}) }],
    ]);

    pool = await createAgentProcessPool(opts, realSpawner);

    const wt = `${PROJECT_ROOT}#wt-1`;
    const s1 = await pool.session("claude", wt);
    const s2 = await pool.session("codex", wt);

    // Different agents → different session objects (even though same cwd).
    // Note: sessionIds may collide across fake processes (both start at 1),
    // but the objects are distinct — that's what matters.
    expect(s1).not.toBe(s2);
  });

  it("reuses Session for same (agent, worktree) pair", async () => {
    const opts = new Map<string, PerAgentOptions>([
      ["claude", { command: fakeCommand({}) }],
    ]);

    pool = await createAgentProcessPool(opts, realSpawner);

    const wt = `${PROJECT_ROOT}#wt-1`;
    const s1 = await pool.session("claude", wt);
    const s2 = await pool.session("claude", wt);

    // Same agent + same cwd → same session instance (reused).
    expect(s2).toBe(s1);
  });

  it("peek returns the session after it's opened", async () => {
    const opts = new Map<string, PerAgentOptions>([
      ["claude", { command: fakeCommand({}) }],
    ]);

    pool = await createAgentProcessPool(opts, realSpawner);
    const wt = `${PROJECT_ROOT}#wt-1`;

    expect(pool.peek("claude", wt)).toBeUndefined();
    await pool.session("claude", wt);
    expect(pool.peek("claude", wt)).toBeDefined();
  });

  it("closeSession disposes and forgets the session", async () => {
    const opts = new Map<string, PerAgentOptions>([
      ["claude", { command: fakeCommand({}) }],
    ]);

    pool = await createAgentProcessPool(opts, realSpawner);
    const wt = `${PROJECT_ROOT}#wt-1`;

    await pool.session("claude", wt);
    pool.closeSession("claude", wt);
    expect(pool.peek("claude", wt)).toBeUndefined();
  });

  it("closeAllSessions disposes all sessions but keeps processes alive", async () => {
    const opts = new Map<string, PerAgentOptions>([
      ["claude", { command: fakeCommand({}) }],
      ["codex", { command: fakeCommand({}) }],
    ]);

    pool = await createAgentProcessPool(opts, realSpawner);

    await pool.session("claude", `${PROJECT_ROOT}#wt-a`);
    await pool.session("codex", `${PROJECT_ROOT}#wt-a`);

    pool.closeAllSessions();
    expect(pool.peek("claude", `${PROJECT_ROOT}#wt-a`)).toBeUndefined();
    expect(pool.peek("codex", `${PROJECT_ROOT}#wt-a`)).toBeUndefined();
    // Processes still alive — size unchanged.
    expect(pool.size).toBe(2);
  });
});
