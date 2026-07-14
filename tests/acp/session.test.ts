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

  /** Build a `SessionConfigOption` with selectable values (T-006). */
  function selectOptionMulti(
    id: string,
    category: SessionConfigOptionCategory,
    values: readonly string[],
  ): SessionConfigOption {
    return {
      id,
      name: id,
      category,
      type: "select" as const,
      currentValue: values[0] ?? "",
      options: values.map((v) => ({ value: v, name: v })),
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

  /** Open a session with warning + traffic capture (T-006 test helper). */
  async function startWithCapture(scenario: FakeScenario) {
    const warnings: string[] = [];
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
      onWarning: (msg) => warnings.push(msg),
      onTraffic: (entry, sessionId) => traffic.push({ entry, sessionId }),
    };
    const session = await buildSession(deps, PROJECT_ROOT).start();
    const configSends = () =>
      traffic
        .filter((t) => t.entry.direction === "send" && t.entry.method === "session/set_config_option")
        .map((t) => t.entry.payload as Record<string, unknown>);
    return { session, warnings, configSends };
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

  it("setModel calls set_config_option when model capability is announced and value is valid", async () => {
    const { session, configSends } = await startWithCapture({
      configOptions: [selectOptionMulti("model-selector", "model", ["gpt-4", "gpt-5-codex"])],
      defaultTurn: { text: ["ok"], stopReason: "end_turn" },
    });

    await session.setModel("gpt-5-codex");

    const sends = configSends();
    expect(sends).toHaveLength(1);
    expect(sends[0]!.configId).toBe("model-selector");
    expect(sends[0]!.value).toBe("gpt-5-codex");
    session.dispose();
  });

  it("setEffort calls set_config_option when thought_level capability is announced and value is valid", async () => {
    const { session, configSends } = await startWithCapture({
      configOptions: [selectOptionMulti("thought-level", "thought_level", ["low", "medium", "high"])],
      defaultTurn: { text: ["ok"], stopReason: "end_turn" },
    });

    await session.setEffort("high");

    const sends = configSends();
    expect(sends).toHaveLength(1);
    expect(sends[0]!.configId).toBe("thought-level");
    expect(sends[0]!.value).toBe("high");
    session.dispose();
  });

  // The OpenCode shape: capabilities are DERIVED from the current model, so the
  // effort option only exists after a model with variants is selected. Parsing
  // capabilities once at `session/new` left `effortConfigId` undefined forever
  // and silently skipped every `setEffort` on that adapter.
  it("refreshes capabilities from the set_config_option response (effort derived from model)", async () => {
    const { session, warnings, configSends } = await startWithCapture({
      // `session/new`: a model select, and NO effort — exactly what a bare probe
      // of OpenCode sees on a default model without variants.
      configOptions: [selectOptionMulti("model", "model", ["big-pickle", "glm-5.2"])],
      configOptionsByModel: {
        "glm-5.2": [
          selectOptionMulti("model", "model", ["big-pickle", "glm-5.2"]),
          selectOptionMulti("effort", "thought_level", ["high", "max"]),
        ],
      },
      defaultTurn: { text: ["ok"], stopReason: "end_turn" },
    });

    expect(session.capabilities.efforts).toEqual([]);

    // The step applies model before effort (`steps/agent.ts`).
    await session.setModel("glm-5.2");
    expect(session.capabilities.efforts).toEqual(["high", "max"]);
    expect(session.capabilities.effortConfigId).toBe("effort");

    await session.setEffort("max");

    const sends = configSends();
    expect(sends).toHaveLength(2);
    expect(sends[1]!.configId).toBe("effort");
    expect(sends[1]!.value).toBe("max");
    expect(warnings).toEqual([]);
    session.dispose();
  });

  it("keeps capabilities when the set_config_option response carries no configOptions", async () => {
    const { session } = await startWithCapture({
      configOptions: [selectOptionMulti("model", "model", ["a", "b"])],
      defaultTurn: { text: ["ok"], stopReason: "end_turn" },
    });

    await session.setModel("b");
    // The fake echoes the same list; nothing is lost.
    expect(session.capabilities.models).toEqual(["a", "b"]);
    expect(session.capabilities.modelConfigId).toBe("model");
    session.dispose();
  });

  it("setModel emits onWarning when the adapter does not announce model capability", async () => {
    const { session, warnings, configSends } = await startWithCapture({
      defaultTurn: { text: ["ok"], stopReason: "end_turn" },
    });

    await session.setModel("gpt-5-codex");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("model");
    expect(warnings[0]).toContain("gpt-5-codex");
    expect(warnings[0]).toContain("ignorado");
    // No set_config_option sent.
    expect(configSends()).toHaveLength(0);
    session.dispose();
  });

  it("setEffort emits onWarning when the adapter does not announce thought_level capability", async () => {
    const { session, warnings, configSends } = await startWithCapture({});

    await session.setEffort("low");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("effort");
    expect(warnings[0]).toContain("low");
    expect(warnings[0]).toContain("ignorado");
    expect(configSends()).toHaveLength(0);
    session.dispose();
  });

  it("setModel swallows adapter errors (AD-5 — never throws)", async () => {
    const { session, logs } = await startWithLogger({
      configOptions: [selectOptionMulti("model-selector", "model", ["gpt-4", "bad-model"])],
      failSetConfigOption: true,
    });

    await expect(session.setModel("bad-model")).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes("failed") && l.includes("model"))).toBe(true);
    session.dispose();
  });

  it("setModel with effort embedded in ModelId works naturally (e.g. gpt-5-codex[high])", async () => {
    const { session, configSends } = await startWithCapture({
      configOptions: [selectOptionMulti("model-selector", "model", ["gpt-5-codex[high]"])],
    });

    await session.setModel("gpt-5-codex[high]");

    const sends = configSends();
    expect(sends).toHaveLength(1);
    // Value passed raw — the engine does NOT parse the embedded effort (AD-1).
    expect(sends[0]!.value).toBe("gpt-5-codex[high]");
    session.dispose();
  });

  // -------------------------------------------------------------------------
  // T-006: fail-closed mode validation + value validation + warnings
  // -------------------------------------------------------------------------

  it("setMode throws when modeId is not in the announced list (fail-closed)", async () => {
    const { session } = await startWithCapture({
      modes: {
        currentModeId: "default",
        availableModes: [
          { id: "default", name: "Default" },
          { id: "plan", name: "Plan" },
        ],
      },
    });

    await expect(session.setMode("acceptEdits")).rejects.toThrow(/aceita: default, plan/);
    session.dispose();
  });

  it("setMode throws for OpenCode-style: modes=null but configOptions has mode category (fail-closed D33)", async () => {
    // OpenCode: session.modes is absent/null, but configOptions announces mode.
    // Before T-006, this escaped validation because availableModeIds was [].
    const { session } = await startWithCapture({
      // No `modes` — simulates OpenCode's null modes.
      configOptions: [
        selectOptionMulti("mode", "mode", ["build", "plan"]),
      ],
    });

    // capabilities.modes should be ["build", "plan"] from configOptions.
    await expect(session.setMode("acceptEdits")).rejects.toThrow(/aceita: build, plan/);
    // Valid mode works fine.
    await session.setMode("plan");
    session.dispose();
  });

  it("setMode sends raw + warns when adapter announces no modes at all", async () => {
    // Adapter with neither modes nor configOptions mode category.
    const { session, warnings } = await startWithCapture({});

    // Should NOT throw — passes raw.
    await session.setMode("whatever");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("enviado cru");
    session.dispose();
  });

  it("setEffort rejects value not in announced list and emits onWarning (D18)", async () => {
    const { session, warnings, configSends } = await startWithCapture({
      configOptions: [
        selectOptionMulti("thought-level", "thought_level", ["low", "medium", "high", "xhigh"]),
      ],
    });

    // 'max' is Claude's effort, not Codex's — must be rejected, not clamped (D18).
    await session.setEffort("max");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("max");
    expect(warnings[0]).toContain("aceita: low, medium, high, xhigh");
    expect(warnings[0]).toContain("ignorado");
    // Must NOT have sent set_config_option.
    expect(configSends()).toHaveLength(0);

    // Valid value goes through.
    await session.setEffort("high");
    expect(configSends()).toHaveLength(1);
    expect(configSends()[0]!.value).toBe("high");

    session.dispose();
  });

  it("setModel rejects value not in announced list and emits onWarning (D18)", async () => {
    const { session, warnings, configSends } = await startWithCapture({
      configOptions: [
        selectOptionMulti("model-selector", "model", ["gpt-4", "gpt-5-codex"]),
      ],
    });

    await session.setModel("claude-opus");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("claude-opus");
    expect(warnings[0]).toContain("aceita: gpt-4, gpt-5-codex");
    expect(configSends()).toHaveLength(0);

    // Valid model works.
    await session.setModel("gpt-5-codex");
    expect(configSends()).toHaveLength(1);
    session.dispose();
  });

  it("adapter without configOptions and without modes degrades without breaking", async () => {
    // Simulates an adapter that announces nothing at all.
    const { session, warnings } = await startWithCapture({});

    // Mode: sends raw + warning.
    await session.setMode("whatever");
    expect(warnings).toHaveLength(1);

    // Model: category absent => warning.
    await session.setModel("some-model");
    expect(warnings).toHaveLength(2);
    expect(warnings[1]).toContain("model");

    // Effort: category absent => warning.
    await session.setEffort("high");
    expect(warnings).toHaveLength(3);
    expect(warnings[2]).toContain("effort");

    session.dispose();
  });

  it("mode: acceptEdits on claude continues working (regression guard)", async () => {
    // Claude announces acceptEdits — must not throw.
    const { session, warnings } = await startWithCapture({
      modes: {
        currentModeId: "default",
        availableModes: [
          { id: "default", name: "Default" },
          { id: "acceptEdits", name: "Accept edits" },
          { id: "plan", name: "Plan" },
        ],
      },
    });

    await session.setMode("acceptEdits");
    expect(warnings).toHaveLength(0);
    session.dispose();
  });

  it("capabilities are exposed on the session", async () => {
    const { session } = await startWithCapture({
      configOptions: [
        selectOptionMulti("mode", "mode", ["build", "plan"]),
        selectOptionMulti("model-selector", "model", ["gpt-4"]),
      ],
    });

    expect(session.capabilities.modes).toEqual(["build", "plan"]);
    expect(session.capabilities.models).toEqual(["gpt-4"]);
    expect(session.capabilities.efforts).toEqual([]);
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
