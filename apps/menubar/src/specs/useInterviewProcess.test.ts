/**
 * Tests for useInterviewProcess — the bridge between the `loopy interview`
 * process and the Specs Interview flow (C-0018, ADR-0012, T-010).
 *
 * The invariants these tests protect (spec Acceptance):
 * - a sequence of injected NDJSON lines drives the reducer to the expected
 *   states (control frames → `advance`, T-009);
 * - a sent command has the exact `CommandFrame` shape on the wire;
 * - `interview://exit` with code 0 **after** `phase_finished` is a clean
 *   shutdown (one Phase, one process — D13), NOT an error;
 * - an exit **without** `phase_finished` surfaces as a visible failure,
 *   classified like `applySidecarExit` does for the Run.
 *
 * The Tauri surface is mocked: `isTauri()` returns true (so the listen/invoke
 * paths run), `invoke` is a spy, and `listen` captures the callbacks so the
 * test can inject `interview://line|stderr|exit` events by hand.
 *
 * Run: `npm test -w apps/menubar -- useInterviewProcess`
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { parseTransportLine, type ControlFrame } from "loopy/tui/transport";
import {
  useInterviewProcess,
  controlToInterviewEvent,
  advanceProcStatus,
  classifyInterviewExit,
  buildInterviewArgs,
} from "./useInterviewProcess";

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
const mockListen = listen as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue(undefined);
  mockListen.mockClear();
});

// ---------------------------------------------------------------------------
// Event-injection helpers — pull the captured listener and fire a payload
// ---------------------------------------------------------------------------

/** The callback the hook registered for a given `interview://…` event. */
function listenerFor(name: string): (e: { payload: unknown }) => void {
  const call = mockListen.mock.calls.find((c: unknown[]) => c[0] === name);
  if (!call) throw new Error(`no listener registered for ${name}`);
  return call[1] as (e: { payload: unknown }) => void;
}

/** Fire one wire object as an `interview://line` NDJSON payload. */
function emitLine(wire: object): void {
  act(() => listenerFor("interview://line")({ payload: JSON.stringify(wire) }));
}

/** Fire a control frame (wrapped as the transport does: `{ frame: "control", … }`). */
function emitControl(control: object): void {
  emitLine({ frame: "control", ...control });
}

/** Fire an event frame (wrapped as `{ frame: "event", … }`). */
function emitEvent(event: object): void {
  emitLine({ frame: "event", ...event });
}

function emitExit(code: number): void {
  act(() => listenerFor("interview://exit")({ payload: code }));
}

function emitStderr(line: string): void {
  act(() => listenerFor("interview://stderr")({ payload: line }));
}

/** The single `send_interview_command` payload, parsed back into an object. */
function lastCommand(): unknown {
  const call = [...mockInvoke.mock.calls]
    .reverse()
    .find((c: unknown[]) => c[0] === "send_interview_command");
  if (!call) throw new Error("no send_interview_command invoked");
  return JSON.parse((call[1] as { payload: string }).payload);
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("controlToInterviewEvent", () => {
  it("maps phase_started (carrying changeDir when present)", () => {
    expect(
      controlToInterviewEvent({
        control: "phase_started",
        phase: "spec",
        command: "/devy:spec auth",
        changeDir: ".harn/devy/changes/C-1-auth",
      }),
    ).toEqual({
      kind: "phase_started",
      phase: "spec",
      command: "/devy:spec auth",
      changeDir: ".harn/devy/changes/C-1-auth",
    });
  });

  it("maps change_resolved", () => {
    expect(
      controlToInterviewEvent({ control: "change_resolved", changeDir: "d" }),
    ).toEqual({ kind: "change_resolved", changeDir: "d" });
  });

  it("nests question_asked into the reducer's `question`", () => {
    expect(
      controlToInterviewEvent({
        control: "question_asked",
        questionId: "obj",
        phase: "spec",
        prompt: "Qual o objetivo?",
        options: [{ label: "A", recommended: true, why: "porque" }],
        otherLabel: "Escrever…",
        finding: "achei X",
        source: "src/a.ts:1",
      }),
    ).toEqual({
      kind: "question_asked",
      question: {
        questionId: "obj",
        phase: "spec",
        prompt: "Qual o objetivo?",
        options: [{ label: "A", recommended: true, why: "porque" }],
        otherLabel: "Escrever…",
        finding: "achei X",
        source: "src/a.ts:1",
      },
    });
  });

  it("maps agent_activity → activity", () => {
    expect(
      controlToInterviewEvent({
        control: "agent_activity",
        phase: "spec",
        text: "lendo src/auth.ts",
      }),
    ).toEqual({ kind: "activity", text: "lendo src/auth.ts" });
  });

  it("maps agent_stream → agent_stream, carrying the StreamUpdate verbatim (R7b)", () => {
    const update = {
      kind: "tool_call" as const,
      call: {
        toolCallId: "t1",
        title: "Lendo src/auth.ts",
        kind: "read" as const,
        status: "in_progress" as const,
        locations: [],
        content: [],
      },
    };
    expect(
      controlToInterviewEvent({
        control: "agent_stream",
        phase: "spec",
        update,
      }),
    ).toEqual({ kind: "agent_stream", update });
  });

  it("maps phase_finished", () => {
    expect(
      controlToInterviewEvent({
        control: "phase_finished",
        phase: "plan",
        changeDir: "d",
        files: ["plan.md", "todo.md"],
      }),
    ).toEqual({
      kind: "phase_finished",
      phase: "plan",
      changeDir: "d",
      files: ["plan.md", "todo.md"],
    });
  });

  it("maps interview_failed → failed", () => {
    expect(
      controlToInterviewEvent({ control: "interview_failed", reason: "boom" }),
    ).toEqual({ kind: "failed", reason: "boom" });
  });

  it("ignores Run-direction controls (returns null)", () => {
    expect(
      controlToInterviewEvent({ control: "run_started" } as ControlFrame),
    ).toBeNull();
    expect(
      controlToInterviewEvent({
        control: "run_finished",
        result: {},
      } as ControlFrame),
    ).toBeNull();
    expect(
      controlToInterviewEvent({
        control: "approval_requested",
        requestId: "r",
        taskId: "",
        stepId: "",
        summary: "",
      } as ControlFrame),
    ).toBeNull();
  });
});

describe("classifyInterviewExit", () => {
  it("finished → clean (null), regardless of exit code", () => {
    expect(classifyInterviewExit("finished", 0)).toBeNull();
    expect(classifyInterviewExit("finished", 1)).toBeNull();
  });

  it("idle → failure (start-fail), code in the reason", () => {
    const reason = classifyInterviewExit("idle", 2);
    expect(reason).toBeTruthy();
    expect(reason).toContain("2");
  });

  it("running → failure (death-mid-run), even on code 0", () => {
    const reason = classifyInterviewExit("running", 0);
    expect(reason).toBeTruthy();
    expect(reason).toContain("0");
  });
});

describe("advanceProcStatus", () => {
  const control = (frame: object) =>
    parseTransportLine(JSON.stringify({ frame: "control", ...frame }));

  it("phase_started opens the Phase (running)", () => {
    expect(
      advanceProcStatus(
        "idle",
        control({ control: "phase_started", phase: "spec", command: "x" }),
      ),
    ).toBe("running");
  });

  it("phase_finished closes the Phase (finished)", () => {
    expect(
      advanceProcStatus(
        "running",
        control({
          control: "phase_finished",
          phase: "spec",
          changeDir: "d",
          files: ["spec.md"],
        }),
      ),
    ).toBe("finished");
  });

  it("leaves the status unchanged for any other or malformed frame", () => {
    expect(
      advanceProcStatus(
        "running",
        control({ control: "agent_activity", phase: "spec", text: "x" }),
      ),
    ).toBe("running");
    expect(advanceProcStatus("idle", parseTransportLine("not json {{{"))).toBe(
      "idle",
    );
  });
});

describe("buildInterviewArgs", () => {
  it("dir only → no flags (Rust prepends interview/dir/--emit-events)", () => {
    expect(buildInterviewArgs({ dir: "/p" })).toEqual([]);
  });

  it("orders change, phase, agent, model, effort", () => {
    expect(
      buildInterviewArgs({
        dir: "/p",
        change: "C-1",
        phase: "plan",
        agent: "claude",
        model: "opus",
        effort: "low",
      }),
    ).toEqual([
      "--change",
      "C-1",
      "--phase",
      "plan",
      "--agent",
      "claude",
      "--model",
      "opus",
      "--effort",
      "low",
    ]);
  });

  it("appends --demand last (the spec-phase turn-1 seed)", () => {
    expect(
      buildInterviewArgs({
        dir: "/p",
        phase: "spec",
        agent: "claude",
        demand: "um editor visual de specs",
      }),
    ).toEqual([
      "--phase",
      "spec",
      "--agent",
      "claude",
      "--demand",
      "um editor visual de specs",
    ]);
  });

  it("omits --demand when the demand is empty (bare /devy:spec)", () => {
    expect(
      buildInterviewArgs({ dir: "/p", phase: "spec", demand: "" }),
    ).toEqual(["--phase", "spec"]);
  });
});

// ---------------------------------------------------------------------------
// The hook — injected NDJSON lines produce the expected states
// ---------------------------------------------------------------------------

describe("useInterviewProcess — a sequence of NDJSON lines drives the reducer", () => {
  it("phase_started → change_resolved → activity → question_asked → answer → phase_finished", () => {
    const { result } = renderHook(() => useInterviewProcess());

    emitControl({
      control: "phase_started",
      phase: "spec",
      command: "/devy:spec autenticação",
    });
    expect(result.current.state.stage).toBe("phase");
    expect(result.current.state.phase).toBe("spec");
    expect(result.current.state.command).toBe("/devy:spec autenticação");
    expect(result.current.state.activity).toBe("running");

    emitControl({
      control: "change_resolved",
      changeDir: ".harn/devy/changes/C-9-auth",
    });
    expect(result.current.state.changeDir).toBe(".harn/devy/changes/C-9-auth");

    emitControl({
      control: "agent_activity",
      phase: "spec",
      text: "lendo src/auth.ts",
    });
    expect(result.current.state.activityLine).toBe("lendo src/auth.ts");

    emitControl({
      control: "question_asked",
      questionId: "objetivo",
      phase: "spec",
      prompt: "Qual o objetivo?",
      options: [{ label: "OAuth", recommended: true, why: "padrão" }],
      finding: "achei um authService",
      source: "src/auth.ts:12",
    });
    expect(result.current.state.activity).toBe("asking");
    expect(result.current.state.pending).toMatchObject({
      questionId: "objetivo",
      phase: "spec",
      prompt: "Qual o objetivo?",
      finding: "achei um authService",
      source: "src/auth.ts:12",
    });

    act(() => result.current.answer("objetivo", "autenticar via OAuth"));
    expect(result.current.state.pending).toBeNull();
    expect(result.current.state.activity).toBe("running");
    expect(result.current.state.answers).toEqual([
      {
        questionId: "objetivo",
        text: "autenticar via OAuth",
        attachments: undefined,
      },
    ]);

    emitControl({
      control: "phase_finished",
      phase: "spec",
      changeDir: ".harn/devy/changes/C-9-auth",
      files: ["spec.md"],
    });
    // spec/refine hand control to the human gate (D12).
    expect(result.current.state.stage).toBe("gate");
    expect(result.current.state.files).toEqual(["spec.md"]);
  });

  it("an agent_stream frame accumulates into the live timeline (T-014)", () => {
    const { result } = renderHook(() => useInterviewProcess());

    emitControl({
      control: "phase_started",
      phase: "spec",
      command: "/devy:spec x",
    });

    emitControl({
      control: "agent_stream",
      phase: "spec",
      update: {
        kind: "tool_call",
        call: {
          toolCallId: "t1",
          title: "Lendo src/auth.ts",
          kind: "read",
          status: "in_progress",
          locations: [],
          content: [],
        },
      },
    });
    expect(result.current.state.transcript.map((it) => it.item)).toEqual([
      "tool",
    ]);

    // The turn's prose arrives at end of turn (agent_activity) — a text item
    // AFTER the tool that streamed before it.
    emitControl({ control: "agent_activity", phase: "spec", text: "Li tudo." });
    expect(result.current.state.transcript.map((it) => it.item)).toEqual([
      "tool",
      "text",
    ]);
  });

  it("ignores a malformed line without throwing (same reference)", () => {
    const { result } = renderHook(() => useInterviewProcess());
    const before = result.current.state;
    act(() => listenerFor("interview://line")({ payload: "not json {{{" }));
    expect(result.current.state).toBe(before);
  });

  it("routes a `warning` event frame into the reducer's warnings (D25)", () => {
    const { result } = renderHook(() => useInterviewProcess());
    emitEvent({ type: "warning", message: "dois blocos ask; usei o primeiro" });
    expect(result.current.state.warnings).toContain(
      "dois blocos ask; usei o primeiro",
    );
  });
});

// ---------------------------------------------------------------------------
// Commands — the exact CommandFrame shape reaches send_interview_command
// ---------------------------------------------------------------------------

describe("useInterviewProcess — sent commands have the CommandFrame shape", () => {
  it("answer sends question_answer with attachments when present", () => {
    const { result } = renderHook(() => useInterviewProcess());
    emitControl({
      control: "question_asked",
      questionId: "q1",
      phase: "spec",
      prompt: "?",
    });

    act(() =>
      result.current.answer("q1", "resposta", [
        ".loopy/attachments/20260725-143012-erro.png",
      ]),
    );

    expect(lastCommand()).toEqual({
      command: "question_answer",
      questionId: "q1",
      text: "resposta",
      attachments: [".loopy/attachments/20260725-143012-erro.png"],
    });
    expect(mockInvoke).toHaveBeenCalledWith("send_interview_command", {
      payload: expect.any(String),
    });
  });

  it("answer without attachments omits the field (matches the Rust formatter)", () => {
    const { result } = renderHook(() => useInterviewProcess());
    emitControl({
      control: "question_asked",
      questionId: "q1",
      phase: "spec",
      prompt: "?",
    });

    act(() => result.current.answer("q1", "resposta"));

    const payload = lastCommand();
    expect(payload).toEqual({
      command: "question_answer",
      questionId: "q1",
      text: "resposta",
    });
    expect(payload).not.toHaveProperty("attachments");
  });

  it("wrapUp sends phase_wrap_up (D17)", () => {
    const { result } = renderHook(() => useInterviewProcess());
    emitControl({ control: "phase_started", phase: "spec", command: "x" });

    act(() => result.current.wrapUp());

    expect(lastCommand()).toEqual({ command: "phase_wrap_up" });
    expect(result.current.state.wrappingUp).toBe(true);
  });

  it("cancel sends interview_cancel and stops the flow without erasing answers (D25)", () => {
    const { result } = renderHook(() => useInterviewProcess());
    emitControl({
      control: "question_asked",
      questionId: "q1",
      phase: "spec",
      prompt: "?",
    });
    act(() => result.current.answer("q1", "kept"));

    act(() => result.current.cancel());

    expect(lastCommand()).toEqual({ command: "interview_cancel" });
    expect(result.current.state.stage).toBe("cancelled");
    // Cancel erases nothing (D25): the recorded answer survives.
    expect(result.current.state.answers).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Exit classification — one Phase, one process (D13)
// ---------------------------------------------------------------------------

describe("useInterviewProcess — exit classification (D13)", () => {
  it("exit 0 after phase_finished is NOT an error", () => {
    const { result } = renderHook(() => useInterviewProcess());
    emitControl({
      control: "phase_started",
      phase: "plan",
      command: "/devy:plan",
    });
    emitControl({
      control: "phase_finished",
      phase: "plan",
      changeDir: ".harn/devy/changes/C-1",
      files: ["plan.md", "todo.md"],
    });
    // The plan Phase completing is the "saved" screen.
    expect(result.current.state.stage).toBe("saved");

    emitExit(0);

    expect(result.current.state.stage).toBe("saved");
    expect(result.current.state.failure).toBeNull();
  });

  it("exit without phase_finished becomes a visible failure (death-mid-run)", () => {
    const { result } = renderHook(() => useInterviewProcess());
    emitControl({
      control: "phase_started",
      phase: "spec",
      command: "/devy:spec",
    });

    emitExit(1);

    expect(result.current.state.stage).toBe("failed");
    expect(result.current.state.failure).toBeTruthy();
    expect(result.current.state.failure).toContain("1");
  });

  it("exit before any phase_started is a visible failure (start-fail)", () => {
    const { result } = renderHook(() => useInterviewProcess());

    emitExit(2);

    expect(result.current.state.stage).toBe("failed");
    expect(result.current.state.failure).toBeTruthy();
  });

  it("a non-zero exit after cancel does not overwrite the cancelled stage", () => {
    const { result } = renderHook(() => useInterviewProcess());
    emitControl({ control: "phase_started", phase: "spec", command: "x" });
    act(() => result.current.cancel());
    expect(result.current.state.stage).toBe("cancelled");

    // SIGTERM from the cancel path exits non-zero, but cancel is terminal.
    emitExit(143);

    expect(result.current.state.stage).toBe("cancelled");
    expect(result.current.state.failure).toBeNull();
  });

  it("accumulates stderr lines (surfaced alongside a failure)", () => {
    const { result } = renderHook(() => useInterviewProcess());
    emitStderr("Error: adapter not found");
    expect(result.current.stderrTail).toContain("Error: adapter not found");
  });
});

// ---------------------------------------------------------------------------
// start() — spawns via start_interview with dir + phase flags
// ---------------------------------------------------------------------------

describe("useInterviewProcess — start()", () => {
  it("spawns via start_interview with the dir and the built flags", async () => {
    const { result } = renderHook(() => useInterviewProcess());

    await act(async () => {
      await result.current.start({
        dir: "/proj",
        change: "C-0018",
        phase: "refine",
        agent: "claude",
        model: "opus",
        effort: "high",
      });
    });

    expect(mockInvoke).toHaveBeenCalledWith("start_interview", {
      dir: "/proj",
      args: [
        "--change",
        "C-0018",
        "--phase",
        "refine",
        "--agent",
        "claude",
        "--model",
        "opus",
        "--effort",
        "high",
      ],
    });
  });

  it("a spawn rejection feeds the start-fail path (visible failure)", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("EACCES"));
    const { result } = renderHook(() => useInterviewProcess());

    await act(async () => {
      await result.current.start({ dir: "/proj" });
    });

    expect(result.current.state.stage).toBe("failed");
    expect(result.current.state.failure).toBeTruthy();
    expect(result.current.stderrTail).toContain("EACCES");
  });
});
