/**
 * Tests for the per-task ACP session wrapper (T-012).
 *
 * Two layers:
 *  - Pure `describe` for {@link classifyStopReason} and friends (small test, no
 *    subprocess): non-`end_turn` is a failure, `cancelled` is our stop-signal.
 *  - Integration `describe` against the scenario-driven fake agent (OQ5): a
 *    *medium* test that spawns the real ndjson transport and drives the full
 *    lifecycle new -> set_mode -> /clear -> prompt -> readText -> cancel ->
 *    teardown, plus the worktree-keyed pool (parallel-ready).
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
import type { AcpTrafficEntry } from "../../src/logging/logger";
import type { StopReason } from "../../src/types";
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

  it("setMode and /clear keep the same sessionId", async () => {
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

    await session.clear();
    expect(session.sessionId).toBe(id);

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

  it("runs the full lifecycle: new -> set_mode -> /clear -> prompt -> readText -> cancel -> teardown", async () => {
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
    await session.setMode("acceptEdits");
    await session.clear();
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

  it("/clear returns zeros and is innocuous for drainUsage", async () => {
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
    // /clear sends a special prompt that returns stopReason: end_turn with no usage
    await session.clear();

    const usage = session.drainUsage();
    expect(usage).not.toBeNull();
    // Only the real turn's tokens are counted; /clear adds nothing.
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
