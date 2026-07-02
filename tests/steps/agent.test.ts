/**
 * `agent` step interpreter (T-014) — the inner verify loop, expect gate, and
 * non-`end_turn` handling. ACP session + checks runner are doubled (AD-6): the
 * session is a scripted stub recording clears/modes/prompts and returning
 * scripted stop reasons + per-turn text (OQ3), and the checks runner returns
 * scripted reports in call order. These prove the control flow the acceptance
 * criteria pin down without touching the real Claude or spawning processes.
 */
import { describe, expect, it } from "vitest";
import { createAgentStep } from "../../src/steps/agent";
import type {
  AgentSession,
  AgentStep,
  ChecksReport,
  ChecksRunnerPort,
  StopReason,
} from "../../src/types";
import { makeStepContext } from "./support";

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

/** A scripted ACP session: records what the step drives, replays a script. */
interface ScriptedSession extends AgentSession {
  /** How many `/clear` turns the step issued. */
  clearCount(): number;
  /** Modes applied via `setMode`, in order. */
  modeCalls(): readonly string[];
  /** Prompts sent (fully interpolated), in order. */
  promptCalls(): readonly string[];
}

/** Build a scripted session; `stopReasons`/`texts` are indexed by prompt turn. */
function scriptedSession(script: {
  readonly stopReasons?: readonly StopReason[];
  readonly texts?: readonly string[];
}): ScriptedSession {
  const stopReasons = script.stopReasons ?? [];
  const texts = script.texts ?? [];
  const prompts: string[] = [];
  const modes: string[] = [];
  let clears = 0;
  let turn = -1; // index of the last prompt turn (readText is turn-scoped, OQ3)
  return {
    sessionId: "sess-scripted",
    setMode: async (m) => {
      modes.push(m);
    },
    clear: async () => {
      clears += 1;
    },
    prompt: async (text) => {
      prompts.push(text);
      turn += 1;
      return stopReasons[turn] ?? "end_turn";
    },
    readText: () => texts[turn] ?? "",
    cancel: async () => {},
    clearCount: () => clears,
    modeCalls: () => modes,
    promptCalls: () => prompts,
  };
}

/** A checks runner that replays scripted reports in call order. */
function scriptedChecks(reports: readonly ChecksReport[]): {
  readonly port: ChecksRunnerPort;
  callCount(): number;
} {
  let i = 0;
  return {
    callCount: () => i,
    port: {
      run: async () => reports[i++] ?? { ok: true, results: [], text: "" },
    },
  };
}

const GREEN: ChecksReport = { ok: true, results: [], text: "Checks: verdes." };
const red = (text: string): ChecksReport => ({ ok: false, results: [], text });

/** The named checks list the verify block references (content is irrelevant). */
const CI = { ci: [{ name: "test", run: "npm test" }] };

/** A verify-driven `agent` step (implement/simplify shape). */
function verifyStep(overrides: Partial<AgentStep> = {}): AgentStep {
  return {
    id: "implement",
    type: "agent",
    prompt: "Implemente ${task.id}.",
    retry_prompt: "Corrija.\n${checks.report}",
    verify: { run: "ci", max_attempts: 4, on_fail: "escalate" },
    ...overrides,
  };
}

/** An audit-shaped `agent` step: read-only, verdict-gated, no verify loop. */
function auditStep(overrides: Partial<AgentStep> = {}): AgentStep {
  return {
    id: "audit",
    type: "agent",
    mode: "plan",
    prompt: "Audite ${task.id}. Responda AUDIT: PASS ou AUDIT: FAIL.",
    expect: "AUDIT: PASS",
    on_expect_fail: "escalate",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Inner verify loop
// ---------------------------------------------------------------------------

describe("agent step — inner verify loop", () => {
  it("succeeds on the first attempt when the checks pass", async () => {
    const session = scriptedSession({ stopReasons: ["end_turn"] });
    const checks = scriptedChecks([GREEN]);
    const ctx = makeStepContext({
      step: verifyStep(),
      checksConfig: CI,
      checks: checks.port,
      session,
    });

    const result = await createAgentStep().execute(ctx);

    expect(result.ok).toBe(true);
    expect(session.promptCalls()).toHaveLength(1);
    expect(checks.callCount()).toBe(1);
    // clear_context defaults to true → one /clear before the single prompt.
    expect(session.clearCount()).toBe(1);
  });

  it("re-prompts with ${checks.report} until the checks pass", async () => {
    const session = scriptedSession({ stopReasons: ["end_turn", "end_turn"] });
    const checks = scriptedChecks([red("LINT QUEBROU: no-unused-vars"), GREEN]);
    const ctx = makeStepContext({
      step: verifyStep(),
      checksConfig: CI,
      checks: checks.port,
      session,
    });

    const result = await createAgentStep().execute(ctx);

    expect(result.ok).toBe(true);
    const prompts = session.promptCalls();
    expect(prompts).toHaveLength(2);
    // First attempt uses `prompt`; the failed-checks report is empty there.
    expect(prompts[0]).toContain("Implemente T-001.");
    expect(prompts[0]).not.toContain("LINT QUEBROU");
    // The retry uses `retry_prompt` carrying the failing report (${checks.report}).
    expect(prompts[1]).toContain("Corrija.");
    expect(prompts[1]).toContain("LINT QUEBROU: no-unused-vars");
    // One /clear per attempt (fresh context each prompt).
    expect(session.clearCount()).toBe(2);
  });

  it("stops after max_attempts and fails with the checks report + on_fail", async () => {
    const session = scriptedSession({ stopReasons: ["end_turn", "end_turn"] });
    const checks = scriptedChecks([red("erro A"), red("erro B")]);
    const ctx = makeStepContext({
      step: verifyStep({
        verify: { run: "ci", max_attempts: 2, on_fail: "escalate" },
      }),
      checksConfig: CI,
      checks: checks.port,
      session,
    });

    const result = await createAgentStep().execute(ctx);

    expect(result.ok).toBe(false);
    expect(session.promptCalls()).toHaveLength(2);
    expect(checks.callCount()).toBe(2);
    // The failing report is carried for ${checks.report} / escalation visibility.
    expect(result.report?.text).toBe("erro B");
    expect(result.reason).toContain("escalate");
  });

  it("throws on a verify list that does not exist under checks:", async () => {
    const session = scriptedSession({ stopReasons: ["end_turn"] });
    const ctx = makeStepContext({
      step: verifyStep({
        verify: { run: "missing", max_attempts: 1, on_fail: "escalate" },
      }),
      checksConfig: CI,
      checks: scriptedChecks([GREEN]).port,
      session,
    });

    await expect(createAgentStep().execute(ctx)).rejects.toThrow(/missing/);
  });
});

// ---------------------------------------------------------------------------
// Expect (verdict) gate
// ---------------------------------------------------------------------------

describe("agent step — expect gate", () => {
  it("passes the step when the verdict matches expect (AUDIT: PASS)", async () => {
    const session = scriptedSession({
      stopReasons: ["end_turn"],
      texts: ["Revisei tudo.\nAUDIT: PASS"],
    });
    const ctx = makeStepContext({ step: auditStep(), session });

    const result = await createAgentStep().execute(ctx);

    expect(result.ok).toBe(true);
    // mode is applied (read-only audit).
    expect(session.modeCalls()).toContain("plan");
  });

  it("blocks the step when the verdict is FAIL (on_expect_fail)", async () => {
    const session = scriptedSession({
      stopReasons: ["end_turn"],
      texts: ["Analisei.\nAUDIT: FAIL: faltou tratar o caso vazio"],
    });
    const ctx = makeStepContext({ step: auditStep(), session });

    const result = await createAgentStep().execute(ctx);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("faltou tratar o caso vazio");
  });

  it("blocks the step when no verdict is present (fail-closed)", async () => {
    const session = scriptedSession({
      stopReasons: ["end_turn"],
      texts: ["Um resumo sem veredito nenhum."],
    });
    const ctx = makeStepContext({ step: auditStep(), session });

    const result = await createAgentStep().execute(ctx);

    expect(result.ok).toBe(false);
  });

  it("derives the verdict label from expect (config-driven, AD-1)", async () => {
    const session = scriptedSession({
      stopReasons: ["end_turn"],
      texts: ["REVIEW: PASS"],
    });
    const ctx = makeStepContext({
      step: auditStep({ expect: "REVIEW: PASS" }),
      session,
    });

    const result = await createAgentStep().execute(ctx);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stop reasons + clear_context + mode
// ---------------------------------------------------------------------------

describe("agent step — stop reasons and knobs", () => {
  it("treats a non-end_turn stop reason as a step failure (before checks)", async () => {
    const session = scriptedSession({ stopReasons: ["refusal"] });
    const checks = scriptedChecks([GREEN]);
    const ctx = makeStepContext({
      step: verifyStep(),
      checksConfig: CI,
      checks: checks.port,
      session,
    });

    const result = await createAgentStep().execute(ctx);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("refusal");
    // A failed turn short-circuits before verify ever runs.
    expect(checks.callCount()).toBe(0);
  });

  it("does not send /clear when clear_context is false", async () => {
    const session = scriptedSession({ stopReasons: ["end_turn"] });
    const ctx = makeStepContext({
      step: verifyStep({ clear_context: false }),
      checksConfig: CI,
      checks: scriptedChecks([GREEN]).port,
      session,
    });

    await createAgentStep().execute(ctx);
    expect(session.clearCount()).toBe(0);
  });

  it("runs a single prompt for a plain agent step (no verify, no expect)", async () => {
    const session = scriptedSession({ stopReasons: ["end_turn"] });
    const ctx = makeStepContext({
      step: { id: "note", type: "agent", prompt: "Anote ${task.id}." },
      session,
    });

    const result = await createAgentStep().execute(ctx);
    expect(result.ok).toBe(true);
    expect(session.promptCalls()).toEqual(["Anote T-001."]);
  });

  it('exposes the agent step under type "agent"', () => {
    expect(createAgentStep().type).toBe("agent");
  });
});
