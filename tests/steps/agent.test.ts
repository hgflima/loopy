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
import type { StoreEvent } from "../../src/tui/store";
import { makeLogger, makeStepContext } from "./support";

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
  /** Models applied via `setModel`, in order. */
  modelCalls(): readonly string[];
  /** Effort levels applied via `setEffort`, in order. */
  effortCalls(): readonly string[];
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
  const models: string[] = [];
  const efforts: string[] = [];
  let clears = 0;
  let turn = -1; // index of the last prompt turn (readText is turn-scoped, OQ3)
  return {
    sessionId: "sess-scripted",
    setMode: async (m) => {
      modes.push(m);
    },
    setModel: async (m) => {
      models.push(m);
    },
    setEffort: async (e) => {
      efforts.push(e);
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
    drainUsage: () => null,
    readCost: () => null,
    clearCount: () => clears,
    modeCalls: () => modes,
    promptCalls: () => prompts,
    modelCalls: () => models,
    effortCalls: () => efforts,
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

/**
 * A checks runner that replays scripted reports AND fires onCheckStart/End
 * callbacks (T-005). Each report maps to a check named `check-N` so the
 * callbacks carry predictable names.
 */
function scriptedChecksWithCallbacks(reports: readonly ChecksReport[]): {
  readonly port: ChecksRunnerPort;
  callCount(): number;
} {
  let i = 0;
  return {
    callCount: () => i,
    port: {
      run: async (_checks, opts) => {
        const report = reports[i++] ?? { ok: true, results: [], text: "" };
        const name = `check-${i}`;
        opts?.onCheckStart?.(name);
        opts?.onCheckEnd?.(name, report.ok);
        return report;
      },
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
    verify: { run: "ci", max_attempts: 4 },
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
    on_fail: "escalate",
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
        verify: { run: "ci", max_attempts: 2 },
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
        verify: { run: "missing", max_attempts: 1 },
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

  it("blocks the step when the verdict is FAIL (on_fail)", async () => {
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

// ---------------------------------------------------------------------------
// Initial checksReport seeding from ctx (OQ-9 — goto re-entry carries feedback)
// ---------------------------------------------------------------------------

describe("agent step — initial checksReport seeding (OQ-9)", () => {
  it("seeds initial checksReport from ctx.resolve so re-entry via goto carries feedback", async () => {
    const seededReport = "Fix bug in line 42";
    const session = scriptedSession({ stopReasons: ["end_turn"] });
    const ctx = makeStepContext({
      step: {
        id: "implement",
        type: "agent",
        prompt: "Implement. Report: ${checks.report}",
      } as AgentStep,
      session,
      resolve: (template) => {
        if (template === "${checks.report}") return seededReport;
        if (template === "${worktree.path}") return ".worktrees/T-001";
        if (template === "${worktree.diff}") return "";
        return template;
      },
    });

    await createAgentStep().execute(ctx);

    // The first prompt must contain the seeded report from the goto carry.
    expect(session.promptCalls()[0]).toContain(seededReport);
  });

  it("checksReport is empty on a fresh run (no prior goto — regression zero)", async () => {
    const session = scriptedSession({ stopReasons: ["end_turn"] });
    const ctx = makeStepContext({
      step: {
        id: "implement",
        type: "agent",
        prompt: "Implement. Report: [${checks.report}]",
      } as AgentStep,
      session,
      resolve: (template) => {
        if (template === "${checks.report}") return "";
        if (template === "${worktree.path}") return ".worktrees/T-001";
        if (template === "${worktree.diff}") return "";
        return template;
      },
    });

    await createAgentStep().execute(ctx);

    // Empty report — no prior goto, no leak.
    expect(session.promptCalls()[0]).toContain("Report: []");
  });
});

// ---------------------------------------------------------------------------
// on_fail formatting in logs (not [object Object])
// ---------------------------------------------------------------------------

describe("agent step — on_fail formatting in logs", () => {
  it("formats on_fail: { goto } in verify-exhausted log (not [object Object])", async () => {
    const session = scriptedSession({ stopReasons: ["end_turn"] });
    const checksRunner = scriptedChecks([red("erro")]);
    const logger = makeLogger();
    const ctx = makeStepContext({
      step: verifyStep({
        verify: { run: "ci", max_attempts: 1 },
        on_fail: { goto: "implement" },
      }),
      checksConfig: CI,
      checks: checksRunner.port,
      session,
      logger,
    });

    const result = await createAgentStep().execute(ctx);

    expect(result.ok).toBe(false);
    const errorMsg = logger.errors.find((m) => m.includes("on_fail"));
    expect(errorMsg).toBeDefined();
    expect(errorMsg).toContain("goto implement");
    expect(errorMsg).not.toContain("[object Object]");
  });

  it("formats on_fail: { goto } in verdict-gate log (not [object Object])", async () => {
    const session = scriptedSession({
      stopReasons: ["end_turn"],
      texts: ["AUDIT: FAIL: something wrong"],
    });
    const logger = makeLogger();
    const ctx = makeStepContext({
      step: auditStep({ on_fail: { goto: "implement" } }),
      session,
      logger,
    });

    const result = await createAgentStep().execute(ctx);

    expect(result.ok).toBe(false);
    const errorMsg = logger.errors.find((m) => m.includes("on_fail"));
    expect(errorMsg).toBeDefined();
    expect(errorMsg).toContain("goto implement");
    expect(errorMsg).not.toContain("[object Object]");
  });
});

// ---------------------------------------------------------------------------
// Live progress events — attempt_started + check_started/finished (T-005)
// ---------------------------------------------------------------------------

describe("agent step — live progress events (T-005)", () => {
  it("emits attempt_started at the start of each verify attempt", async () => {
    const events: StoreEvent[] = [];
    const session = scriptedSession({ stopReasons: ["end_turn", "end_turn"] });
    const checks = scriptedChecksWithCallbacks([red("erro"), GREEN]);
    const ctx = makeStepContext({
      step: verifyStep({ verify: { run: "ci", max_attempts: 3 } }),
      checksConfig: CI,
      checks: checks.port,
      session,
      emit: (e) => events.push(e),
    });

    await createAgentStep().execute(ctx);

    const attempts = events.filter((e) => e.type === "attempt_started");
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toEqual({
      type: "attempt_started",
      taskId: "T-001",
      stepId: "implement",
      attempt: 1,
      maxAttempts: 3,
    });
    expect(attempts[1]).toEqual({
      type: "attempt_started",
      taskId: "T-001",
      stepId: "implement",
      attempt: 2,
      maxAttempts: 3,
    });
  });

  it("forwards check_started and check_finished from the verify checks runner", async () => {
    const events: StoreEvent[] = [];
    const session = scriptedSession({ stopReasons: ["end_turn"] });
    const checks = scriptedChecksWithCallbacks([GREEN]);
    const ctx = makeStepContext({
      step: verifyStep(),
      checksConfig: CI,
      checks: checks.port,
      session,
      emit: (e) => events.push(e),
    });

    await createAgentStep().execute(ctx);

    const checkEvents = events.filter(
      (e) => e.type === "check_started" || e.type === "check_finished",
    );
    expect(checkEvents).toHaveLength(2);
    expect(checkEvents[0]).toMatchObject({
      type: "check_started",
      taskId: "T-001",
      stepId: "implement",
    });
    expect(checkEvents[1]).toMatchObject({
      type: "check_finished",
      taskId: "T-001",
      stepId: "implement",
      ok: true,
    });
  });

  it("does not crash when emit is absent (backward compat)", async () => {
    const session = scriptedSession({ stopReasons: ["end_turn"] });
    const checks = scriptedChecks([GREEN]);
    const ctx = makeStepContext({
      step: verifyStep(),
      checksConfig: CI,
      checks: checks.port,
      session,
      // no emit
    });

    const result = await createAgentStep().execute(ctx);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// setModel / setEffort — T-005 (paridade: applied after setMode, before prompt)
// ---------------------------------------------------------------------------

/** Registry with a `codex` agent carrying model+effort defaults. */
const CODEX_AGENTS = {
  byName: {
    default: { command: ["claude-acp"] },
    codex: { command: ["codex-acp"], model: "codex-mini", effort: "low" },
  },
  default: "default",
} as const;

describe("agent step — setModel / setEffort (T-005)", () => {
  it("calls setModel then setEffort when step has model and effort", async () => {
    const session = scriptedSession({ stopReasons: ["end_turn"] });
    const ctx = makeStepContext({
      step: verifyStep({ model: "o3", effort: "high" }),
      checksConfig: CI,
      checks: scriptedChecks([GREEN]).port,
      session,
    });

    const result = await createAgentStep().execute(ctx);

    expect(result.ok).toBe(true);
    expect(session.modelCalls()).toEqual(["o3"]);
    expect(session.effortCalls()).toEqual(["high"]);
  });

  it("resolves model/effort from agent registry when step omits them", async () => {
    const session = scriptedSession({ stopReasons: ["end_turn"] });
    const ctx = makeStepContext({
      step: verifyStep({ agent: "codex" }),
      checksConfig: CI,
      checks: scriptedChecks([GREEN]).port,
      session,
      resolvedAgents: CODEX_AGENTS,
    });

    const result = await createAgentStep().execute(ctx);

    expect(result.ok).toBe(true);
    expect(session.modelCalls()).toEqual(["codex-mini"]);
    expect(session.effortCalls()).toEqual(["low"]);
  });

  it("step-level model/effort overrides agent registry defaults", async () => {
    const session = scriptedSession({ stopReasons: ["end_turn"] });
    const ctx = makeStepContext({
      step: verifyStep({ agent: "codex", model: "o3", effort: "medium" }),
      checksConfig: CI,
      checks: scriptedChecks([GREEN]).port,
      session,
      resolvedAgents: CODEX_AGENTS,
    });

    const result = await createAgentStep().execute(ctx);

    expect(result.ok).toBe(true);
    expect(session.modelCalls()).toEqual(["o3"]);
    expect(session.effortCalls()).toEqual(["medium"]);
  });

  it("does not call setModel/setEffort when neither step nor registry defines them", async () => {
    const session = scriptedSession({ stopReasons: ["end_turn"] });
    const ctx = makeStepContext({
      step: verifyStep(),
      checksConfig: CI,
      checks: scriptedChecks([GREEN]).port,
      session,
    });

    const result = await createAgentStep().execute(ctx);

    expect(result.ok).toBe(true);
    expect(session.modelCalls()).toEqual([]);
    expect(session.effortCalls()).toEqual([]);
  });

  it("applies setMode before setModel before setEffort (order)", async () => {
    const callOrder: string[] = [];
    const session = scriptedSession({ stopReasons: ["end_turn"] });
    // Wrap to capture call order
    const origSetMode = session.setMode.bind(session);
    const origSetModel = session.setModel.bind(session);
    const origSetEffort = session.setEffort.bind(session);
    session.setMode = async (m) => {
      callOrder.push("setMode");
      await origSetMode(m);
    };
    session.setModel = async (m) => {
      callOrder.push("setModel");
      await origSetModel(m);
    };
    session.setEffort = async (e) => {
      callOrder.push("setEffort");
      await origSetEffort(e);
    };
    const ctx = makeStepContext({
      step: verifyStep({ mode: "acceptEdits", model: "o3", effort: "high" }),
      checksConfig: CI,
      checks: scriptedChecks([GREEN]).port,
      session,
    });

    await createAgentStep().execute(ctx);

    expect(callOrder).toEqual(["setMode", "setModel", "setEffort"]);
  });

  it("calls setModel only (no setEffort) when only model is resolved", async () => {
    const session = scriptedSession({ stopReasons: ["end_turn"] });
    const ctx = makeStepContext({
      step: verifyStep({ model: "o3" }),
      checksConfig: CI,
      checks: scriptedChecks([GREEN]).port,
      session,
    });

    await createAgentStep().execute(ctx);

    expect(session.modelCalls()).toEqual(["o3"]);
    expect(session.effortCalls()).toEqual([]);
  });

  it("StepResult is unchanged when model/effort are omitted (parity)", async () => {
    const session = scriptedSession({
      stopReasons: ["end_turn"],
      texts: ["done"],
    });
    const checks = scriptedChecks([GREEN]);
    const ctx = makeStepContext({
      step: verifyStep(),
      checksConfig: CI,
      checks: checks.port,
      session,
    });

    const result = await createAgentStep().execute(ctx);

    expect(result).toEqual({ ok: true, output: "done" });
  });
});
