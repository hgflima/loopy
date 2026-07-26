/**
 * Tests for the Interview orchestrator (C-0018 T-005, ADR-0012).
 *
 * `run.ts` drives ONE phase end-to-end: emit `phase_started`, open a single
 * Session, send the envelope on turn 1 and a reminder + human answer on later
 * turns, parse each turn, and emit the control frames the GUI reacts to —
 * exiting when the Agent emits `<loopy-done/>` (exit 0), when the human cancels
 * (exit 0, no `phase_finished`), or when a turn fails (`interview_failed`,
 * exit ≠ 0).
 *
 * Two layers under test:
 *  - {@link decideTurn} — the PURE per-turn decision (AD-6), tested without ACP.
 *  - {@link runInterview} — the orchestrator, driven with a FAKE Session and a
 *    PassThrough stdin so a whole phase runs with no subprocess.
 */
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  SessionNotification,
  SessionUpdate,
} from "@agentclientprotocol/sdk";

import {
  createStreamForwarder,
  decideTurn,
  runInterview,
  type InterviewFs,
  type InterviewSession,
} from "../../src/interview/run";
import { fullEnvelope, reminder, wrapUp } from "../../src/interview/envelope";
import { parseAsk } from "../../src/interview/parse-ask";
import { phaseCommand } from "../../src/interview/phases";
import type { ControlFrame } from "../../src/tui/transport";
import type { StopReason } from "../../src/types";

// ---------------------------------------------------------------------------
// A scripted, no-subprocess Session. Records every prompt it received and the
// mode/model/effort it was configured with; yields canned turn text per turn.
// ---------------------------------------------------------------------------

interface ScriptTurn {
  /** The turn's text buffer (what `readText()` returns after this prompt). */
  readonly text: string;
  /** The stop reason this turn resolves with (default `end_turn`). */
  readonly stop?: StopReason;
}

class FakeSession implements InterviewSession {
  readonly prompts: (string | ContentBlock[])[] = [];
  readonly modes: string[] = [];
  readonly models: string[] = [];
  readonly efforts: string[] = [];
  cancelled = false;

  private turnIndex = 0;
  private current = "";

  constructor(private readonly turns: readonly ScriptTurn[]) {}

  async setMode(mode: string): Promise<void> {
    this.modes.push(mode);
  }
  async setModel(model: string): Promise<void> {
    this.models.push(model);
  }
  async setEffort(effort: string): Promise<void> {
    this.efforts.push(effort);
  }
  async prompt(text: string): Promise<StopReason> {
    return this.record(text);
  }
  async promptBlocks(blocks: ContentBlock[]): Promise<StopReason> {
    return this.record(blocks);
  }
  readText(): string {
    return this.current;
  }
  async cancel(): Promise<void> {
    this.cancelled = true;
  }

  private record(input: string | ContentBlock[]): StopReason {
    this.prompts.push(input);
    const turn = this.turns[this.turnIndex] ?? { text: "" };
    this.turnIndex += 1;
    this.current = turn.text;
    return turn.stop ?? "end_turn";
  }
}

/** Filesystem fake — the phase's change dir + files, no disk. */
function fakeFs(files: readonly string[] = ["spec.md"]): InterviewFs {
  return {
    listChanges: async () => [],
    listFiles: async () => files,
  };
}

/**
 * Drive `runInterview` with a FakeSession and a reactive transport that answers
 * each `question_asked` the way the GUI would. `respond` returns the raw command
 * object to write on stdin (or `null` to leave the question unanswered).
 */
async function runPhase(opts: {
  readonly session: FakeSession;
  readonly fs?: InterviewFs;
  readonly respond?: (
    frame: Extract<ControlFrame, { control: "question_asked" }>,
  ) => object | null;
  readonly demand?: string;
  readonly changeDir?: string;
  readonly attachments?: readonly string[];
  readonly model?: string;
  readonly effort?: string;
  readonly phase?: "spec" | "refine" | "plan";
}): Promise<{ readonly frames: ControlFrame[]; readonly exitCode: number }> {
  const frames: ControlFrame[] = [];
  const input = new PassThrough();

  const transport = {
    emitControl(control: ControlFrame): void {
      frames.push(control);
      if (control.control === "question_asked") {
        const command = opts.respond?.(control) ?? null;
        if (command !== null) input.write(JSON.stringify(command) + "\n");
      }
    },
  };

  const exitCode = await runInterview({
    dir: "/tmp/proj",
    phase: opts.phase ?? "spec",
    demand: opts.demand,
    changeDir: opts.changeDir,
    attachments: opts.attachments,
    agent: "claude",
    command: ["claude", "acp"],
    model: opts.model,
    effort: opts.effort,
    transport,
    input,
    fs: opts.fs ?? fakeFs(),
    openSession: async () => ({
      session: opts.session,
      dispose: async () => {},
    }),
  });

  return { frames, exitCode };
}

/** Answer a `question_asked` with a `question_answer` for its own id. */
function answerWith(text: string) {
  return (frame: Extract<ControlFrame, { control: "question_asked" }>) => ({
    command: "question_answer",
    questionId: frame.questionId,
    text,
  });
}

const controls = (frames: readonly ControlFrame[]): string[] =>
  frames.map((f) => f.control);

// ---------------------------------------------------------------------------
// decideTurn — the pure per-turn decision (AD-6)
// ---------------------------------------------------------------------------

describe("decideTurn — pure per-turn decision (AD-6)", () => {
  it("an ask turn yields a question_asked frame and awaits its answer", () => {
    const parsed = parseAsk(
      '<loopy-ask>{"id":"objetivo","prompt":"Qual o objetivo?","options":[{"label":"A","recommended":true,"why":"pq"}],"otherLabel":"outra…"}</loopy-ask>',
    );
    const decision = decideTurn(parsed, "spec", 0);

    expect(decision.flow).toEqual({
      kind: "await_answer",
      questionId: "objetivo",
    });
    expect(decision.frames).toHaveLength(1);
    const frame = decision.frames[0]!;
    expect(frame).toMatchObject({
      control: "question_asked",
      questionId: "objetivo",
      phase: "spec",
      prompt: "Qual o objetivo?",
      otherLabel: "outra…",
    });
    if (frame.control !== "question_asked") throw new Error("unreachable");
    expect(frame.options).toEqual([
      { label: "A", recommended: true, why: "pq" },
    ]);
  });

  it("carries finding + source from an ask block (D10 / SC14)", () => {
    const parsed = parseAsk(
      '<loopy-ask>{"id":"q","prompt":"P?","finding":"achei X","source":"a.ts:10"}</loopy-ask>',
    );
    const decision = decideTurn(parsed, "spec", 0);
    expect(decision.frames[0]).toMatchObject({
      finding: "achei X",
      source: "a.ts:10",
    });
  });

  it("narration before an ask emits agent_activity then question_asked", () => {
    const parsed = parseAsk(
      'Estou explorando o código.\n<loopy-ask>{"id":"q","prompt":"P?"}</loopy-ask>',
    );
    const decision = decideTurn(parsed, "spec", 0);
    expect(controls(decision.frames)).toEqual([
      "agent_activity",
      "question_asked",
    ]);
    expect(decision.frames[0]).toMatchObject({
      control: "agent_activity",
      phase: "spec",
      text: "Estou explorando o código.",
    });
  });

  it("a bare-prose turn becomes an OPEN question, not agent_activity (D3)", () => {
    const parsed = parseAsk("Me conte mais sobre o objetivo, por favor.");
    const decision = decideTurn(parsed, "refine", 3);

    // No agent_activity — the prose IS the prompt; emitting both would duplicate.
    expect(controls(decision.frames)).toEqual(["question_asked"]);
    const frame = decision.frames[0]!;
    expect(frame).toMatchObject({
      control: "question_asked",
      questionId: "open-3",
      phase: "refine",
      prompt: "Me conte mais sobre o objetivo, por favor.",
    });
    if (frame.control !== "question_asked") throw new Error("unreachable");
    expect(frame.options).toBeUndefined();
    expect(decision.flow).toEqual({
      kind: "await_answer",
      questionId: "open-3",
    });
  });

  it("a change report emits change_resolved before the directive", () => {
    const parsed = parseAsk(
      '<loopy-change dir=".harn/devy/changes/C-0018-x"/>\n<loopy-ask>{"id":"q","prompt":"P?"}</loopy-ask>',
    );
    const decision = decideTurn(parsed, "spec", 0);
    expect(controls(decision.frames)).toEqual([
      "change_resolved",
      "question_asked",
    ]);
    expect(decision.frames[0]).toEqual({
      control: "change_resolved",
      changeDir: ".harn/devy/changes/C-0018-x",
    });
  });

  it("a done turn finishes (no question_asked frame)", () => {
    const parsed = parseAsk("Gravei os arquivos.\n<loopy-done/>");
    const decision = decideTurn(parsed, "plan", 5);
    expect(decision.flow).toEqual({ kind: "finish" });
    // Prose before done still surfaces as activity.
    expect(controls(decision.frames)).toEqual(["agent_activity"]);
  });
});

// ---------------------------------------------------------------------------
// runInterview — the orchestrator, driven with a fake Session
// ---------------------------------------------------------------------------

describe("runInterview — one phase, end to end", () => {
  it("a complete phase emits phase_started → (activity|question)* → phase_finished, exit 0", async () => {
    const session = new FakeSession([
      // Turn 1: report the change, narrate, then ask.
      {
        text:
          '<loopy-change dir=".harn/devy/changes/C-0018-x"/>\n' +
          "Analisando o repo.\n" +
          '<loopy-ask>{"id":"objetivo","prompt":"Qual o objetivo?","options":[{"label":"A","recommended":true,"why":"pq"}]}</loopy-ask>',
      },
      // Turn 2 (after the answer): finish.
      { text: "Gravei a spec.\n<loopy-done/>" },
    ]);

    const { frames, exitCode } = await runPhase({
      session,
      demand: "um widget de busca",
      respond: answerWith("A"),
    });

    expect(exitCode).toBe(0);
    expect(controls(frames)).toEqual([
      "phase_started",
      "change_resolved",
      "agent_activity",
      "question_asked",
      "agent_activity",
      "phase_finished",
    ]);

    // phase_started carries the devy command and, for the spec phase, NO changeDir (D10).
    expect(frames[0]).toEqual({
      control: "phase_started",
      phase: "spec",
      command: phaseCommand("spec", "um widget de busca"),
    });

    // phase_finished carries the resolved change dir + the phase's files.
    expect(frames.at(-1)).toEqual({
      control: "phase_finished",
      phase: "spec",
      changeDir: ".harn/devy/changes/C-0018-x",
      files: ["spec.md"],
    });

    // Mode is acceptEdits (the Interview must write .md — plan is read-only).
    expect(session.modes).toEqual(["acceptEdits"]);
  });

  it("turn 1 sends the full envelope + devy command; later turns send reminder + answer", async () => {
    const session = new FakeSession([
      { text: '<loopy-ask>{"id":"q","prompt":"P?"}</loopy-ask>' },
      { text: "<loopy-done/>" },
    ]);

    await runPhase({
      session,
      demand: "algo",
      respond: answerWith("minha resposta"),
    });

    expect(session.prompts).toHaveLength(2);
    // Turn 1: envelope + command (a plain string — no attachments).
    const first = session.prompts[0];
    expect(typeof first).toBe("string");
    expect(first).toContain(fullEnvelope("spec"));
    expect(first).toContain(phaseCommand("spec", "algo"));
    // Turn 2: reminder + the human answer.
    const second = session.prompts[1];
    expect(typeof second).toBe("string");
    expect(second).toContain(reminder());
    expect(second).toContain("minha resposta");
  });

  it("turn 1 with attachments is sent as prompt blocks (text + resource_links)", async () => {
    const session = new FakeSession([{ text: "<loopy-done/>" }]);

    await runPhase({
      session,
      demand: "x",
      attachments: ["/tmp/proj/.loopy/attachments/20260725-000000-erro.png"],
    });

    const first = session.prompts[0];
    expect(Array.isArray(first)).toBe(true);
    const blocks = first as ContentBlock[];
    expect(blocks[0]).toMatchObject({ type: "text" });
    expect(blocks[1]).toMatchObject({
      type: "resource_link",
      name: "20260725-000000-erro.png",
    });
  });

  it("an open-question turn (no block) keeps the flow going (D3)", async () => {
    const session = new FakeSession([
      { text: "Preciso de mais contexto: qual o público?" },
      { text: "<loopy-done/>" },
    ]);

    const { frames, exitCode } = await runPhase({
      session,
      respond: answerWith("devs internos"),
    });

    expect(exitCode).toBe(0);
    const asked = frames.find((f) => f.control === "question_asked");
    expect(asked).toBeDefined();
    expect(asked).toMatchObject({
      control: "question_asked",
      prompt: "Preciso de mais contexto: qual o público?",
    });
    expect(controls(frames)).toContain("phase_finished");
  });

  it("phase_wrap_up makes the NEXT turn the wrap-up turn (D17)", async () => {
    const session = new FakeSession([
      { text: '<loopy-ask>{"id":"q","prompt":"P?"}</loopy-ask>' },
      { text: "<loopy-done/>" },
    ]);

    const { frames, exitCode } = await runPhase({
      session,
      respond: () => ({ command: "phase_wrap_up" }),
    });

    expect(exitCode).toBe(0);
    // The turn after the question is the wrap-up prompt, verbatim.
    expect(session.prompts[1]).toBe(wrapUp());
    expect(controls(frames)).toContain("phase_finished");
  });

  it("interview_cancel ends WITHOUT emitting phase_finished (D25), exit 0", async () => {
    const session = new FakeSession([
      { text: '<loopy-ask>{"id":"q","prompt":"P?"}</loopy-ask>' },
      { text: "<loopy-done/>" }, // never reached
    ]);

    const { frames, exitCode } = await runPhase({
      session,
      respond: () => ({ command: "interview_cancel" }),
    });

    expect(exitCode).toBe(0);
    expect(controls(frames)).not.toContain("phase_finished");
    // No second prompt — the phase stopped at the first question.
    expect(session.prompts).toHaveLength(1);
  });

  it("a non-end_turn stop reason emits interview_failed and exits ≠ 0 (AD-5)", async () => {
    const session = new FakeSession([{ text: "", stop: "refusal" }]);

    const { frames, exitCode } = await runPhase({ session });

    expect(exitCode).not.toBe(0);
    expect(controls(frames)).toContain("interview_failed");
    expect(controls(frames)).not.toContain("phase_finished");
    const failed = frames.find((f) => f.control === "interview_failed");
    expect(failed).toMatchObject({ control: "interview_failed" });
  });

  it("a spawn failure (openSession throws) emits interview_failed and exits ≠ 0 (AD-5)", async () => {
    const frames: ControlFrame[] = [];
    const exitCode = await runInterview({
      dir: "/tmp/proj",
      phase: "spec",
      agent: "claude",
      command: ["claude", "acp"],
      transport: { emitControl: (c) => frames.push(c) },
      input: new PassThrough(),
      fs: fakeFs(),
      openSession: async () => {
        throw new Error("spawn ENOENT: claude");
      },
    });

    expect(exitCode).not.toBe(0);
    const failed = frames.find((f) => f.control === "interview_failed");
    expect(failed).toBeDefined();
    expect(failed).toMatchObject({ control: "interview_failed" });
    if (failed?.control !== "interview_failed") throw new Error("unreachable");
    expect(failed.reason).toContain("spawn ENOENT");
  });

  it("applies model then effort (best-effort), in that order, after acceptEdits", async () => {
    const session = new FakeSession([{ text: "<loopy-done/>" }]);
    await runPhase({ session, model: "opus", effort: "high" });
    expect(session.modes).toEqual(["acceptEdits"]);
    expect(session.models).toEqual(["opus"]);
    expect(session.efforts).toEqual(["high"]);
  });

  it("refine/plan phase_started carries the known changeDir (D10)", async () => {
    const session = new FakeSession([{ text: "<loopy-done/>" }]);
    const { frames } = await runPhase({
      session,
      phase: "refine",
      changeDir: ".harn/devy/changes/C-0018-x",
    });
    expect(frames[0]).toMatchObject({
      control: "phase_started",
      phase: "refine",
      changeDir: ".harn/devy/changes/C-0018-x",
    });
  });
});

// ---------------------------------------------------------------------------
// createStreamForwarder — the Interview's filtered live stream (R1)
// ---------------------------------------------------------------------------

describe("createStreamForwarder — the filtered live stream (R1)", () => {
  const notif = (update: SessionUpdate): SessionNotification => ({
    sessionId: "s1",
    update,
  });

  /** A forwarder over a frame-collecting transport. */
  function forwarder(phase: "spec" | "refine" | "plan" = "spec") {
    const frames: ControlFrame[] = [];
    const forward = createStreamForwarder(
      { emitControl: (c) => frames.push(c) },
      phase,
    );
    return { frames, forward };
  }

  /** The `update.kind` of each frame, in order (labels non-stream frames). */
  const streamKinds = (frames: readonly ControlFrame[]): string[] =>
    frames.map((f) =>
      f.control === "agent_stream" ? f.update.kind : `not-stream:${f.control}`,
    );

  it("DISCARDS agent_message_chunk — the prose never streams live", () => {
    const { frames, forward } = forwarder();
    forward(
      notif({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "prosa e <loopy-ask>{...}</loopy-ask>" },
      }),
    );
    expect(frames).toHaveLength(0);
  });

  it("emits agent_stream for thought / tool / plan / mode / raw", () => {
    const { frames, forward } = forwarder();
    forward(
      notif({
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "pensando" },
      }),
    );
    forward(
      notif({
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        title: "Read a.ts",
        kind: "read",
        status: "pending",
      }),
    );
    forward(
      notif({
        sessionUpdate: "tool_call_update",
        toolCallId: "t1",
        status: "completed",
      }),
    );
    forward(
      notif({
        sessionUpdate: "plan",
        entries: [{ content: "passo", priority: "medium", status: "pending" }],
      }),
    );
    forward(
      notif({ sessionUpdate: "current_mode_update", currentModeId: "plan" }),
    );
    // user_message_chunk is our Envelope coming back — it survives as `raw` (D3).
    forward(
      notif({
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "<loopy-answer>…</loopy-answer>" },
      }),
    );

    expect(streamKinds(frames)).toEqual([
      "thought",
      "tool_call",
      "tool_delta",
      "plan",
      "mode",
      "raw",
    ]);
    // Every emitted frame is an agent_stream carrying the phase.
    expect(
      frames.every((f) => f.control === "agent_stream" && f.phase === "spec"),
    ).toBe(true);
  });

  it("carries the translated StreamUpdate verbatim, stamped with the phase", () => {
    const { frames, forward } = forwarder("refine");
    forward(
      notif({ sessionUpdate: "current_mode_update", currentModeId: "plan" }),
    );
    expect(frames).toEqual<ControlFrame[]>([
      {
        control: "agent_stream",
        phase: "refine",
        update: { kind: "mode", modeId: "plan" },
      },
    ]);
  });

  it("NO agent_stream ever carries a `text` update, even mixed with a thought", () => {
    const { frames, forward } = forwarder();
    forward(
      notif({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "prosa" },
      }),
    );
    forward(
      notif({
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "pensando" },
      }),
    );
    // The thought streamed; the prose did not.
    expect(streamKinds(frames)).toEqual(["thought"]);
    expect(
      frames.some(
        (f) => f.control === "agent_stream" && f.update.kind === "text",
      ),
    ).toBe(false);
  });

  it("usage_update emits nothing (it has its own path — not a discard)", () => {
    const { frames, forward } = forwarder();
    forward(notif({ sessionUpdate: "usage_update", used: 100, size: 1000 }));
    expect(frames).toHaveLength(0);
  });
});
