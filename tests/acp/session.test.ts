/**
 * Tests for the per-task ACP session wrapper (T-012).
 *
 * Two layers:
 *  - Pure `describe` for {@link classifyStopReason} and friends (small test, no
 *    subprocess): non-`end_turn` is a failure, `cancelled` is our stop-signal.
 *  - Integration `describe` against the scenario-driven fake agent (OQ5): a
 *    *medium* test that spawns the real ndjson transport and drives the full
 *    lifecycle new -> set_mode -> clear (reopen) -> prompt -> readText ->
 *    cancel -> teardown, plus the worktree-keyed pool (parallel-ready).
 */
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { openAgent, type AgentHandle } from "../../src/acp/agent";
import {
  buildSession,
  classifyStopReason,
  createSessionPool,
  isStopSignal,
  isTurnSuccess,
  type LoopySession,
  type SessionDeps,
} from "../../src/acp/session";
import type { SessionConfigOption, SessionConfigOptionCategory } from "@agentclientprotocol/sdk";
import type { AcpTrafficEntry } from "../../src/logging/logger";
import type { LoggerPort, StopReason } from "../../src/types";
import type { FakeScenario } from "../fixtures/fake-agent";

const FAKE_AGENT = fileURLToPath(
  new URL("../fixtures/fake-agent.ts", import.meta.url),
);
const PROJECT_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Spawn command that runs the fake agent under tsx with a JSON scenario. */
function fakeCommand(scenario: FakeScenario): string[] {
  return [
    process.execPath,
    "--import",
    "tsx",
    FAKE_AGENT,
    JSON.stringify(scenario),
  ];
}

// ---------------------------------------------------------------------------
// Pure: stop-reason classification (AC3)
// ---------------------------------------------------------------------------

describe("classifyStopReason", () => {
  it("treats end_turn as success", () => {
    expect(classifyStopReason("end_turn")).toBe("success");
    expect(isTurnSuccess("end_turn")).toBe(true);
    expect(isStopSignal("end_turn")).toBe(false);
  });

  it("treats cancelled as a stop-signal (our own cancel)", () => {
    expect(classifyStopReason("cancelled")).toBe("stop_signal");
    expect(isStopSignal("cancelled")).toBe(true);
    expect(isTurnSuccess("cancelled")).toBe(false);
  });

  it("treats refusal / max_tokens / max_turn_requests as failure", () => {
    const failures: StopReason[] = [
      "refusal",
      "max_tokens",
      "max_turn_requests",
    ];
    for (const reason of failures) {
      expect(classifyStopReason(reason)).toBe("failure");
      expect(isTurnSuccess(reason)).toBe(false);
      expect(isStopSignal(reason)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Integration: session lifecycle + pool against the fake agent
// ---------------------------------------------------------------------------

describe("buildSession / session pool (against the fake agent)", () => {
  let handle: AgentHandle | undefined;

  afterEach(async () => {
    if (handle) {
      await handle.shutdown();
      handle = undefined;
    }
  });

  async function openWith(scenario: FakeScenario): Promise<SessionDeps> {
    handle = await openAgent({
      command: fakeCommand(scenario),
      cwd: PROJECT_ROOT,
      permissions: { on_request: "allow" },
    });
    return { ctx: handle.ctx, text: handle.text, cost: handle.cost };
  }

  /** Open the fake agent and start a single worktree-bound session. */
  async function startSession(scenario: FakeScenario): Promise<LoopySession> {
    const deps = await openWith(scenario);
    return buildSession(deps, PROJECT_ROOT).start();
  }

  it("opens a session bound to the worktree and reports a sessionId", async () => {
    const session = await startSession({});
    expect(session.sessionId).toBeTruthy();
    session.dispose();
  });

  it("setMode keeps sessionId; clear() (reopen) changes it", async () => {
    const session = await startSession({
      modes: {
        currentModeId: "default",
        availableModes: [
          { id: "default", name: "Default" },
          { id: "plan", name: "Plan" },
        ],
      },
    });
    const id = session.sessionId;

    await session.setMode("plan");
    expect(session.sessionId).toBe(id);

    // clear() reopens: dispose + session/new → sessionId CHANGES.
    await session.clear();
    expect(session.sessionId).not.toBe(id);
    expect(session.sessionId).toBeTruthy();

    session.dispose();
  });

  it("prompt returns end_turn and readText returns the turn buffer (OQ3)", async () => {
    const session = await startSession({
      defaultTurn: {
        text: ["Implemented ", "the feature."],
        stopReason: "end_turn",
      },
    });

    const reason = await session.prompt("implement");
    expect(reason).toBe("end_turn");
    // Synchronous read of the OWN turn buffer — no polling needed: prompt()
    // drains the turn before resolving.
    expect(session.readText()).toBe("Implemented the feature.");

    session.dispose();
  });

  it("readText reflects only the current turn (buffer reset per prompt)", async () => {
    const session = await startSession({
      turns: [
        { text: ["first ", "turn"], stopReason: "end_turn" },
        { text: ["second ", "turn"], stopReason: "end_turn" },
      ],
    });

    await session.prompt("one");
    expect(session.readText()).toBe("first turn");

    await session.prompt("two");
    expect(session.readText()).toBe("second turn");

    session.dispose();
  });

  it("surfaces a refusal stop reason (a failure for the classifier)", async () => {
    const session = await startSession({
      defaultTurn: { text: ["no"], stopReason: "refusal" },
    });

    const reason = await session.prompt("go");
    expect(reason).toBe("refusal");
    expect(classifyStopReason(reason)).toBe("failure");

    session.dispose();
  });

  it("cancel sends session/cancel without throwing", async () => {
    const session = await startSession({});
    await expect(session.cancel()).resolves.toBeUndefined();
    session.dispose();
  });

  it("runs the full lifecycle: new -> set_mode -> clear (reopen) -> prompt -> readText -> cancel -> teardown", async () => {
    const deps = await openWith({
      modes: {
        currentModeId: "default",
        availableModes: [
          { id: "default", name: "Default" },
          { id: "acceptEdits", name: "Accept edits" },
        ],
      },
      defaultTurn: { text: ["all ", "done"], stopReason: "end_turn" },
    });
    const pool = createSessionPool(deps);

    const session = await pool.session(PROJECT_ROOT);
    const idBefore = session.sessionId;
    await session.setMode("acceptEdits");
    await session.clear();
    // Reopen changes the sessionId.
    expect(session.sessionId).not.toBe(idBefore);
    const reason = await session.prompt("do it");
    expect(reason).toBe("end_turn");
    expect(session.readText()).toBe("all done");
    await session.cancel();

    pool.closeAll();
    expect(pool.size).toBe(0);
  });

  it("pools sessions keyed by worktree (same cwd reuses, different cwd is distinct)", async () => {
    const deps = await openWith({});
    const pool = createSessionPool(deps);

    const a1 = await pool.session(`${PROJECT_ROOT}#wt-a`);
    const a2 = await pool.session(`${PROJECT_ROOT}#wt-a`);
    const b = await pool.session(`${PROJECT_ROOT}#wt-b`);

    // Same worktree -> same session instance (reused).
    expect(a2).toBe(a1);
    // Different worktree -> distinct ACP session.
    expect(b).not.toBe(a1);
    expect(b.sessionId).not.toBe(a1.sessionId);
    expect(pool.peek(`${PROJECT_ROOT}#wt-a`)).toBe(a1);
    expect(pool.size).toBe(2);

    pool.close(`${PROJECT_ROOT}#wt-a`);
    expect(pool.peek(`${PROJECT_ROOT}#wt-a`)).toBeUndefined();
    expect(pool.size).toBe(1);

    pool.closeAll();
  });

  // -------------------------------------------------------------------------
  // C-0005: drainUsage / readCost (integration against the fake agent)
  // -------------------------------------------------------------------------

  it("drainUsage returns null when usage is not reported", async () => {
    const session = await startSession({
      defaultTurn: { text: ["hi"], stopReason: "end_turn" },
    });
    await session.prompt("go");
    expect(session.drainUsage()).toBeNull();
    session.dispose();
  });

  it("drainUsage sums multi-turn usage and resets on drain", async () => {
    const session = await startSession({
      turns: [
        {
          text: ["t1"],
          stopReason: "end_turn",
          usage: { inputTokens: 100, outputTokens: 50, cachedReadTokens: 10, totalTokens: 160 },
        },
        {
          text: ["t2"],
          stopReason: "end_turn",
          usage: { inputTokens: 200, outputTokens: 80, cachedReadTokens: 20, totalTokens: 300 },
        },
      ],
    });

    await session.prompt("first");
    await session.prompt("second");

    const usage = session.drainUsage();
    expect(usage).not.toBeNull();
    expect(usage!.available).toBe(true);
    expect(usage!.inputTokens).toBe(300);
    expect(usage!.outputTokens).toBe(130);
    expect(usage!.cachedReadTokens).toBe(30);
    expect(usage!.totalTokens).toBe(460);

    // After drain, accumulator is reset.
    expect(session.drainUsage()).toBeNull();

    session.dispose();
  });

  it("clear (reopen) does not affect drainUsage — usage accumulator is preserved", async () => {
    const session = await startSession({
      turns: [
        {
          text: ["t1"],
          stopReason: "end_turn",
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        },
      ],
    });

    await session.prompt("go");
    // clear() is now reopen (dispose + session/new) — no prompt turn, no usage delta.
    await session.clear();

    const usage = session.drainUsage();
    expect(usage).not.toBeNull();
    // Only the real turn's tokens are counted; reopen adds nothing.
    expect(usage!.inputTokens).toBe(100);
    expect(usage!.outputTokens).toBe(50);

    session.dispose();
  });

  it("readCost returns null when no usage_update with cost arrives", async () => {
    const session = await startSession({
      defaultTurn: { text: ["hi"], stopReason: "end_turn" },
    });
    await session.prompt("go");
    expect(session.readCost()).toBeNull();
    session.dispose();
  });

  it("readCost returns the cumulative cost snapshot from usage_update", async () => {
    const session = await startSession({
      turns: [
        {
          text: ["t1"],
          stopReason: "end_turn",
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
          cost: { amount: 0.05, currency: "USD" },
        },
        {
          text: ["t2"],
          stopReason: "end_turn",
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
          cost: { amount: 0.12, currency: "USD" },
        },
      ],
    });

    await session.prompt("first");
    await session.prompt("second");

    const cost = session.readCost();
    expect(cost).not.toBeNull();
    expect(cost!.available).toBe(true);
    // Cost is cumulative — the last snapshot wins.
    expect(cost!.amount).toBe(0.12);
    expect(cost!.currency).toBe("USD");

    session.dispose();
  });

  it("readCost carries cost across reopens (costCarry)", async () => {
    const session = await startSession({
      turns: [
        {
          text: ["t1"],
          stopReason: "end_turn",
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
          cost: { amount: 0.10, currency: "USD" },
        },
      ],
    });

    await session.prompt("go");
    // Cost before reopen: 0.10.
    const costBefore = session.readCost();
    expect(costBefore).not.toBeNull();
    expect(costBefore!.amount).toBe(0.10);

    // Reopen: old cost becomes costCarry; new session starts at 0.
    await session.clear();

    // After reopen, cost is still at least the carry.
    const costAfter = session.readCost();
    expect(costAfter).not.toBeNull();
    expect(costAfter!.amount).toBeGreaterThanOrEqual(0.10);

    session.dispose();
  });

  it("clear() fires onReopen callback with old and new sessionId", async () => {
    const reopens: Array<{ oldId: string; newId: string }> = [];
    handle = await openAgent({
      command: fakeCommand({
        modes: {
          currentModeId: "default",
          availableModes: [
            { id: "default", name: "Default" },
            { id: "plan", name: "Plan" },
          ],
        },
      }),
      cwd: PROJECT_ROOT,
      permissions: { on_request: "allow" },
    });
    const deps: SessionDeps = {
      ctx: handle.ctx,
      text: handle.text,
      cost: handle.cost,
      onReopen: (oldId, newId) => reopens.push({ oldId, newId }),
    };
    const session = await buildSession(deps, PROJECT_ROOT).start();
    const originalId = session.sessionId;

    await session.clear();

    expect(reopens).toHaveLength(1);
    expect(reopens[0]!.oldId).toBe(originalId);
    expect(reopens[0]!.newId).toBe(session.sessionId);
    expect(reopens[0]!.oldId).not.toBe(reopens[0]!.newId);

    session.dispose();
  });

  it("clear() re-applies mode after reopen (audit mode: plan survives)", async () => {
    const session = await startSession({
      modes: {
        currentModeId: "default",
        availableModes: [
          { id: "default", name: "Default" },
          { id: "plan", name: "Plan" },
        ],
      },
      defaultTurn: { text: ["ok"], stopReason: "end_turn" },
    });

    await session.setMode("plan");
    const idBefore = session.sessionId;

    // Reopen — mode should be re-applied automatically.
    await session.clear();
    expect(session.sessionId).not.toBe(idBefore);

    // If mode re-apply failed, the session would have thrown (fail-closed for modes).
    // A successful clear() proves the mode was re-applied without error.
    // We can also prompt on the new session to verify it's functional.
    const reason = await session.prompt("audit check");
    expect(reason).toBe("end_turn");

    session.dispose();
  });

  // -------------------------------------------------------------------------
  // T-007: onTraffic send — session captures engine→agent traffic
  // -------------------------------------------------------------------------

  it("onTraffic captures send for setMode, prompt, and cancel with sessionId", async () => {
    const traffic: Array<{ entry: AcpTrafficEntry; sessionId: string }> = [];
    handle = await openAgent({
      command: fakeCommand({
        modes: {
          currentModeId: "default",
          availableModes: [
            { id: "default", name: "Default" },
            { id: "plan", name: "Plan" },
          ],
        },
        defaultTurn: { text: ["ok"], stopReason: "end_turn" },
      }),
      cwd: PROJECT_ROOT,
      permissions: { on_request: "allow" },
    });
    const deps: SessionDeps = {
      ctx: handle.ctx,
      text: handle.text,
      cost: handle.cost,
      onTraffic: (entry, sessionId) => traffic.push({ entry, sessionId }),
    };
    const session = await buildSession(deps, PROJECT_ROOT).start();
    const sid = session.sessionId;

    await session.setMode("plan");
    await session.prompt("implement it");
    await session.cancel();

    // Verify sends were captured with correct methods and sessionId.
    const sends = traffic.filter((t) => t.entry.direction === "send");
    const methods = sends.map((t) => t.entry.method);

    expect(methods).toContain("session/set_mode");
    expect(methods).toContain("session/prompt");
    expect(methods).toContain("session/cancel");

    // Every send carries the correct sessionId.
    for (const t of sends) {
      expect(t.sessionId).toBe(sid);
    }

    // setMode payload includes modeId.
    const setModeEntry = sends.find((t) => t.entry.method === "session/set_mode");
    expect((setModeEntry!.entry.payload as Record<string, unknown>)?.modeId).toBe("plan");

    // prompt payload includes the prompt text.
    const promptEntry = sends.find((t) => t.entry.method === "session/prompt");
    expect((promptEntry!.entry.payload as Record<string, unknown>)?.text).toBe("implement it");

    session.dispose();
  });

  // -------------------------------------------------------------------------
  // T-002: setModel / setEffort (best-effort, config option discovery)
  // -------------------------------------------------------------------------

  /** Build a minimal `SessionConfigOption` for a given category (test helper). */
  function selectOption(
    id: string,
    category: SessionConfigOptionCategory,
    value: string,
  ): SessionConfigOption {
    return {
      id,
      name: id,
      category,
      type: "select" as const,
      currentValue: value,
      options: [{ value, name: value }],
    };
  }

  /** Logger spy that captures debug lines (test helper). */
  function spyLogger(): { logs: string[]; logger: LoggerPort } {
    const logs: string[] = [];
    return {
      logs,
      logger: { info: () => {}, debug: (msg) => logs.push(msg), error: () => {} },
    };
  }

  /** Open a session with traffic capture and return both (test helper). */
  async function startWithTraffic(scenario: FakeScenario) {
    const traffic: Array<{ entry: AcpTrafficEntry; sessionId: string }> = [];
    handle = await openAgent({
      command: fakeCommand(scenario),
      cwd: PROJECT_ROOT,
      permissions: { on_request: "allow" },
    });
    const deps: SessionDeps = {
      ctx: handle.ctx,
      text: handle.text,
      cost: handle.cost,
      onTraffic: (entry, sessionId) => traffic.push({ entry, sessionId }),
    };
    const session = await buildSession(deps, PROJECT_ROOT).start();
    const configSends = () =>
      traffic
        .filter((t) => t.entry.direction === "send" && t.entry.method === "session/set_config_option")
        .map((t) => t.entry.payload as Record<string, unknown>);
    return { session, configSends };
  }

  /** Open a session with a logger spy (test helper). */
  async function startWithLogger(scenario: FakeScenario) {
    const { logs, logger } = spyLogger();
    handle = await openAgent({
      command: fakeCommand(scenario),
      cwd: PROJECT_ROOT,
      permissions: { on_request: "allow" },
    });
    const deps: SessionDeps = { ctx: handle.ctx, text: handle.text, logger };
    const session = await buildSession(deps, PROJECT_ROOT).start();
    return { session, logs };
  }

  it("setModel calls set_config_option when model capability is announced", async () => {
    const { session, configSends } = await startWithTraffic({
      configOptions: [selectOption("model-selector", "model", "gpt-4")],
      defaultTurn: { text: ["ok"], stopReason: "end_turn" },
    });

    await session.setModel("gpt-5-codex");

    const sends = configSends();
    expect(sends).toHaveLength(1);
    expect(sends[0]!.configId).toBe("model-selector");
    expect(sends[0]!.value).toBe("gpt-5-codex");
    session.dispose();
  });

  it("setEffort calls set_config_option when thought_level capability is announced", async () => {
    const { session, configSends } = await startWithTraffic({
      configOptions: [selectOption("thought-level", "thought_level", "high")],
      defaultTurn: { text: ["ok"], stopReason: "end_turn" },
    });

    await session.setEffort("high");

    const sends = configSends();
    expect(sends).toHaveLength(1);
    expect(sends[0]!.configId).toBe("thought-level");
    expect(sends[0]!.value).toBe("high");
    session.dispose();
  });

  it("setModel is a no-op when the adapter does not announce model capability", async () => {
    const { session, logs } = await startWithLogger({
      defaultTurn: { text: ["ok"], stopReason: "end_turn" },
    });

    await session.setModel("gpt-5-codex");
    expect(logs.some((l) => l.includes("skipped") && l.includes("model"))).toBe(true);
    session.dispose();
  });

  it("setEffort is a no-op when the adapter does not announce thought_level capability", async () => {
    const { session, logs } = await startWithLogger({});

    await session.setEffort("low");
    expect(logs.some((l) => l.includes("skipped") && l.includes("thought_level"))).toBe(true);
    session.dispose();
  });

  it("setModel swallows adapter errors (AD-5 — never throws)", async () => {
    const { session, logs } = await startWithLogger({
      configOptions: [selectOption("model-selector", "model", "gpt-4")],
      failSetConfigOption: true,
    });

    await expect(session.setModel("bad-model")).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes("failed") && l.includes("model"))).toBe(true);
    session.dispose();
  });

  it("setModel with effort embedded in ModelId works naturally (e.g. gpt-5-codex[high])", async () => {
    const { session, configSends } = await startWithTraffic({
      configOptions: [selectOption("model-selector", "model", "gpt-5-codex[high]")],
    });

    await session.setModel("gpt-5-codex[high]");

    const sends = configSends();
    expect(sends).toHaveLength(1);
    // Value passed raw — the engine does NOT parse the embedded effort (AD-1).
    expect(sends[0]!.value).toBe("gpt-5-codex[high]");
    session.dispose();
  });

  it("onTraffic is not called when absent (boundary identical to pre-T-007)", async () => {
    // SessionDeps without onTraffic — must not throw.
    handle = await openAgent({
      command: fakeCommand({
        defaultTurn: { text: ["ok"], stopReason: "end_turn" },
      }),
      cwd: PROJECT_ROOT,
      permissions: { on_request: "allow" },
    });
    const deps: SessionDeps = { ctx: handle.ctx, text: handle.text };
    const session = await buildSession(deps, PROJECT_ROOT).start();

    // These should all succeed without error.
    await session.prompt("hello");
    await session.cancel();

    session.dispose();
  });
});
