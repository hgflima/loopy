import { describe, expect, it } from "vitest";
import type { StoreEvent } from "../../src/tui/store";
import {
  type CommandFrame,
  type ControlFrame,
  createEventTransport,
  parseTransportLine,
} from "../../src/tui/transport";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect lines written to a sink. */
function collectSink(): { lines: string[]; sink: (line: string) => void } {
  const lines: string[] = [];
  return { lines, sink: (line: string) => lines.push(line) };
}

/** Round-trip a StoreEvent through serialize→parse and assert equality. */
function roundTripEvent(event: StoreEvent): void {
  const { lines, sink } = collectSink();
  const transport = createEventTransport(sink);
  transport.emit(event);
  expect(lines).toHaveLength(1);
  const result = parseTransportLine(lines[0]!);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.frame).toBe("event");
  if (result.frame !== "event") return;
  expect(result.event).toEqual(event);
}

/** Round-trip a ControlFrame through serialize→parse and assert equality. */
function roundTripControl(control: ControlFrame): void {
  const { lines, sink } = collectSink();
  const transport = createEventTransport(sink);
  transport.emitControl(control);
  expect(lines).toHaveLength(1);
  const result = parseTransportLine(lines[0]!);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.frame).toBe("control");
  if (result.frame !== "control") return;
  expect(result.control).toEqual(control);
}

/**
 * Round-trip a CommandFrame through serialize→parse and assert equality.
 *
 * Commands travel app → motor via stdin, so the transport has no `emitCommand`;
 * we hand-build the wire line (`{frame:"command", …}`) exactly as the app does.
 */
function roundTripCommand(command: CommandFrame): void {
  const line = JSON.stringify({ frame: "command", ...command });
  const result = parseTransportLine(line);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.frame).toBe("command");
  if (result.frame !== "command") return;
  expect(result.command).toEqual(command);
}

// ---------------------------------------------------------------------------
// StoreEvent round-trip (every variant)
// ---------------------------------------------------------------------------

describe("transport — StoreEvent round-trip", () => {
  it("edges_set", () => {
    roundTripEvent({
      type: "edges_set",
      edges: [
        ["T-001", "T-002"],
        ["T-002", "T-003"],
      ],
    });
  });

  it("task_registered (without status)", () => {
    roundTripEvent({
      type: "task_registered",
      taskId: "T-001",
      title: "Scaffold projeto",
    });
  });

  it("task_registered (with status)", () => {
    roundTripEvent({
      type: "task_registered",
      taskId: "T-002",
      title: "Blocked task",
      status: "blocked",
    });
  });

  it("task_started", () => {
    roundTripEvent({ type: "task_started", taskId: "T-001" });
  });

  it("step_started", () => {
    roundTripEvent({
      type: "step_started",
      taskId: "T-001",
      stepId: "impl",
      stepType: "agent",
    });
  });

  it("attempt_started", () => {
    roundTripEvent({
      type: "attempt_started",
      taskId: "T-001",
      stepId: "impl",
      attempt: 2,
      maxAttempts: 5,
    });
  });

  it("check_started", () => {
    roundTripEvent({
      type: "check_started",
      taskId: "T-001",
      stepId: "impl",
      name: "typecheck",
    });
  });

  it("check_finished (ok)", () => {
    roundTripEvent({
      type: "check_finished",
      taskId: "T-001",
      stepId: "impl",
      name: "typecheck",
      ok: true,
    });
  });

  it("check_finished (fail)", () => {
    roundTripEvent({
      type: "check_finished",
      taskId: "T-001",
      stepId: "impl",
      name: "lint",
      ok: false,
    });
  });

  it("stream_chunk (without agent)", () => {
    roundTripEvent({
      type: "stream_chunk",
      taskId: "T-001",
      text: "implementing feature...\n",
    });
  });

  it("stream_chunk (with agent)", () => {
    roundTripEvent({
      type: "stream_chunk",
      taskId: "T-001",
      text: "reviewing code...\n",
      agent: "claude",
    });
  });

  it("step_finished (ok)", () => {
    roundTripEvent({
      type: "step_finished",
      taskId: "T-001",
      stepId: "impl",
      ok: true,
    });
  });

  it("step_finished (fail with reason)", () => {
    roundTripEvent({
      type: "step_finished",
      taskId: "T-001",
      stepId: "audit",
      ok: false,
      reason: "AUDIT: FAIL — missing tests",
    });
  });

  it("task_finished (done)", () => {
    roundTripEvent({
      type: "task_finished",
      taskId: "T-001",
      status: "done",
    });
  });

  it("task_finished (escalated with reason)", () => {
    roundTripEvent({
      type: "task_finished",
      taskId: "T-001",
      status: "escalated",
      reason: "max attempts exceeded",
    });
  });

  it("task_finished (skipped)", () => {
    roundTripEvent({
      type: "task_finished",
      taskId: "T-002",
      status: "skipped",
      reason: "ancestor failed",
    });
  });

  it("task_finished (paused)", () => {
    roundTripEvent({
      type: "task_finished",
      taskId: "T-003",
      status: "paused",
    });
  });

  it("acp_traffic (send)", () => {
    roundTripEvent({
      type: "acp_traffic",
      taskId: "T-001",
      direction: "send",
      method: "session/prompt",
      summary: "prompt sent",
    });
  });

  it("acp_traffic (recv with agent)", () => {
    roundTripEvent({
      type: "acp_traffic",
      taskId: "T-001",
      direction: "recv",
      method: "session/update",
      summary: "agent_message_chunk",
      agent: "codex",
    });
  });

  it("preserves special characters in text fields", () => {
    roundTripEvent({
      type: "stream_chunk",
      taskId: "T-001",
      text: 'line1\nline2\ttab\r\n"quoted"\0null\\backslash',
    });
  });

  it("preserves unicode in text fields", () => {
    roundTripEvent({
      type: "task_registered",
      taskId: "T-001",
      title: "Implementar funcionalidade — ação 🚀",
    });
  });
});

// ---------------------------------------------------------------------------
// Rich stream StoreEvent round-trip (C-0019 T-001 — 6 new variants)
// ---------------------------------------------------------------------------

describe("transport — rich stream event round-trip (C-0019)", () => {
  const call = {
    toolCallId: "tc-1",
    title: "Ler src/index.ts",
    kind: "read",
    status: "in_progress",
    locations: [{ path: "src/index.ts", line: 42 }],
    content: [{ kind: "text", text: "conteúdo" }],
    rawInput: { path: "src/index.ts" },
  } as const;

  it("tool_call (with stepId and agent, full ToolCallState)", () => {
    roundTripEvent({
      type: "tool_call",
      taskId: "T-001",
      stepId: "implement",
      agent: "claude",
      call,
    });
  });

  it("tool_call_update (delta round-trips content + rawOutput)", () => {
    roundTripEvent({
      type: "tool_call_update",
      taskId: "T-001",
      stepId: "implement",
      delta: {
        toolCallId: "tc-1",
        status: "completed",
        content: [{ kind: "diff", path: "a.ts", oldText: "x", newText: "y" }],
        rawOutput: "ok",
      },
    });
  });

  it("thought_chunk (with messageId and agent)", () => {
    roundTripEvent({
      type: "thought_chunk",
      taskId: "T-001",
      agent: "codex",
      text: "raciocinando…",
      messageId: "m-7",
    });
  });

  it("plan (entries round-trip priority + status)", () => {
    roundTripEvent({
      type: "plan",
      taskId: "T-001",
      entries: [
        { content: "Ler o spec", priority: "high", status: "completed" },
        { content: "Implementar", priority: "medium", status: "in_progress" },
      ],
    });
  });

  it("mode_changed", () => {
    roundTripEvent({
      type: "mode_changed",
      taskId: "T-001",
      agent: "claude",
      modeId: "acceptEdits",
    });
  });

  it("agent_update (catch-all preserves updateKind + arbitrary payload)", () => {
    roundTripEvent({
      type: "agent_update",
      taskId: "T-001",
      updateKind: "available_commands_update",
      payload: { commands: ["/a", "/b"], nested: { x: 1 } },
    });
  });

  it("stream_chunk with new stepId/messageId fields (R3, additive)", () => {
    roundTripEvent({
      type: "stream_chunk",
      taskId: "T-001",
      text: "olá\n",
      agent: "claude",
      stepId: "implement",
      messageId: "m-1",
    });
  });
});

// ---------------------------------------------------------------------------
// agent_stream control frame round-trip (C-0019 T-001 / R7b) — the Interview's
// live rich stream, carrying a StreamUpdate (not a StreamItem).
// ---------------------------------------------------------------------------

describe("transport — agent_stream control frame (C-0019 R7b)", () => {
  it("carries a text StreamUpdate", () => {
    roundTripControl({
      control: "agent_stream",
      phase: "spec",
      update: { kind: "text", text: "escrevendo…", messageId: "m1" },
    });
  });

  it("carries a tool_call StreamUpdate with a full ToolCallState", () => {
    roundTripControl({
      control: "agent_stream",
      phase: "refine",
      update: {
        kind: "tool_call",
        call: {
          toolCallId: "tc-1",
          title: "Buscar",
          kind: "search",
          status: "pending",
          locations: [],
          content: [],
        },
      },
    });
  });

  it("carries a tool_delta StreamUpdate", () => {
    roundTripControl({
      control: "agent_stream",
      phase: "plan",
      update: {
        kind: "tool_delta",
        delta: { toolCallId: "tc-1", status: "completed" },
      },
    });
  });

  it("carries a raw catch-all StreamUpdate (D3 — nothing vanishes)", () => {
    roundTripControl({
      control: "agent_stream",
      phase: "spec",
      update: {
        kind: "raw",
        updateKind: "session_info_update",
        payload: { title: "x" },
      },
    });
  });

  it("an old parser does not throw on the new frame (generic control parse)", () => {
    const line = JSON.stringify({
      frame: "control",
      control: "agent_stream",
      phase: "refine",
      update: { kind: "mode", modeId: "plan" },
    });
    const result = parseTransportLine(line);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Control frame round-trip
// ---------------------------------------------------------------------------

describe("transport — control frame round-trip", () => {
  it("run_started", () => {
    roundTripControl({ control: "run_started" });
  });

  it("run_finished (with result object)", () => {
    roundTripControl({
      control: "run_finished",
      result: { ok: true, tasksCompleted: 3, tasksFailed: 0 },
    });
  });

  it("run_finished (with null result)", () => {
    roundTripControl({ control: "run_finished", result: null });
  });

  it("approval_requested", () => {
    roundTripControl({
      control: "approval_requested",
      requestId: "req-42",
      taskId: "T-001",
      stepId: "merge-gate",
      summary: "Approve merge of T-001 into main?",
    });
  });
});

// ---------------------------------------------------------------------------
// Interview control frame round-trip (C-0018 T-001 — 6 new variants)
// ---------------------------------------------------------------------------

describe("transport — interview control frame round-trip", () => {
  it("phase_started (without changeDir — spec phase, D10)", () => {
    roundTripControl({
      control: "phase_started",
      phase: "spec",
      command: "/devy:spec",
    });
  });

  it("phase_started (with changeDir — refine/plan phase)", () => {
    roundTripControl({
      control: "phase_started",
      phase: "refine",
      command: "/devy:refine",
      changeDir: ".harn/devy/changes/C-0018-specs-authoring",
    });
  });

  it("change_resolved", () => {
    roundTripControl({
      control: "change_resolved",
      changeDir: ".harn/devy/changes/C-0019-nova-change",
    });
  });

  it("question_asked (minimal — no options)", () => {
    roundTripControl({
      control: "question_asked",
      questionId: "q-1",
      phase: "spec",
      prompt: "Qual é o escopo da change?",
    });
  });

  it("question_asked (full — options, otherLabel, finding, source)", () => {
    roundTripControl({
      control: "question_asked",
      questionId: "q-2",
      phase: "plan",
      prompt: "Qual estratégia de implementação?",
      options: [
        {
          label: "Incremental",
          detail: "task por task",
          recommended: true,
          why: "menor risco",
        },
        { label: "Big bang" },
      ],
      otherLabel: "Outro…",
      finding: "o motor já interpreta o yml",
      source: "src/index.ts:12",
    });
  });

  it("agent_activity", () => {
    roundTripControl({
      control: "agent_activity",
      phase: "refine",
      text: "analisando o repositório…",
    });
  });

  it("phase_finished", () => {
    roundTripControl({
      control: "phase_finished",
      phase: "plan",
      changeDir: ".harn/devy/changes/C-0018-specs-authoring",
      files: ["spec.md", "plan.md", "todo.md"],
    });
  });

  it("interview_failed", () => {
    roundTripControl({
      control: "interview_failed",
      reason: "agente encerrou sem <loopy-done/>",
    });
  });

  it("questionId and phase are always present (not the empty-string D-0005 trap)", () => {
    const { lines, sink } = collectSink();
    const transport = createEventTransport(sink);
    transport.emitControl({
      control: "question_asked",
      questionId: "q-42",
      phase: "spec",
      prompt: "?",
    });
    const wire = JSON.parse(lines[0]!.trim());
    expect(wire.questionId).toBe("q-42");
    expect(wire.phase).toBe("spec");
  });
});

// ---------------------------------------------------------------------------
// Command frame round-trip (parse-only — commands come from stdin)
// ---------------------------------------------------------------------------

describe("transport — command frame parse", () => {
  it("approval_decision (approved)", () => {
    roundTripCommand({
      command: "approval_decision",
      requestId: "req-42",
      approved: true,
    });
  });

  it("approval_decision (rejected)", () => {
    roundTripCommand({
      command: "approval_decision",
      requestId: "req-99",
      approved: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Interview command frame round-trip (C-0018 T-001 — 3 new variants)
// ---------------------------------------------------------------------------

describe("transport — interview command frame round-trip", () => {
  it("question_answer (minimal — no attachments)", () => {
    roundTripCommand({
      command: "question_answer",
      questionId: "q-1",
      text: "escopo enxuto, só a aba Specs",
    });
  });

  it("question_answer (with attachments)", () => {
    roundTripCommand({
      command: "question_answer",
      questionId: "q-2",
      text: "veja o print do erro",
      attachments: [".loopy/attachments/20260725-143012-erro.png"],
    });
  });

  it("phase_wrap_up", () => {
    roundTripCommand({ command: "phase_wrap_up" });
  });

  it("interview_cancel", () => {
    roundTripCommand({ command: "interview_cancel" });
  });
});

// ---------------------------------------------------------------------------
// Error handling — malformed input
// ---------------------------------------------------------------------------

describe("transport — malformed input", () => {
  it("empty string returns error", () => {
    const result = parseTransportLine("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("empty line");
  });

  it("whitespace-only returns error", () => {
    const result = parseTransportLine("   \t  ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("empty line");
  });

  it("invalid JSON returns error", () => {
    const result = parseTransportLine("{broken json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid JSON/);
  });

  it("non-object JSON (string) returns error", () => {
    const result = parseTransportLine('"just a string"');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not a JSON object");
  });

  it("non-object JSON (array) returns error", () => {
    const result = parseTransportLine("[1, 2, 3]");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not a JSON object");
  });

  it("non-object JSON (number) returns error", () => {
    const result = parseTransportLine("42");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not a JSON object");
  });

  it("null JSON returns error", () => {
    const result = parseTransportLine("null");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not a JSON object");
  });

  it("missing frame field returns error", () => {
    const result = parseTransportLine('{"type": "task_started", "taskId": "T-1"}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/unknown frame type/);
  });

  it("unknown frame type returns error", () => {
    const result = parseTransportLine('{"frame": "unknown_type"}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/unknown frame type.*unknown_type/);
  });

  it("line with trailing newline is parsed correctly", () => {
    const line =
      JSON.stringify({ frame: "event", type: "task_started", taskId: "T-001" }) +
      "\n";
    const result = parseTransportLine(line);
    expect(result.ok).toBe(true);
  });

  it("line with surrounding whitespace is parsed correctly", () => {
    const line =
      "  " +
      JSON.stringify({ frame: "event", type: "task_started", taskId: "T-001" }) +
      "  \n";
    const result = parseTransportLine(line);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sink error handling — best-effort (AD-1)
// ---------------------------------------------------------------------------

describe("transport — sink error swallowing", () => {
  it("emit swallows sink exception", () => {
    const throwingSink = (): void => {
      throw new Error("sink is broken");
    };
    const transport = createEventTransport(throwingSink);
    // Must not throw
    expect(() =>
      transport.emit({ type: "task_started", taskId: "T-001" }),
    ).not.toThrow();
  });

  it("emitControl swallows sink exception", () => {
    const throwingSink = (): void => {
      throw new Error("sink is broken");
    };
    const transport = createEventTransport(throwingSink);
    expect(() =>
      transport.emitControl({ control: "run_started" }),
    ).not.toThrow();
  });

  it("sink receives exactly one line per emit (terminated by newline)", () => {
    const { lines, sink } = collectSink();
    const transport = createEventTransport(sink);
    transport.emit({ type: "task_started", taskId: "T-001" });
    transport.emitControl({ control: "run_started" });
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.endsWith("\n")).toBe(true);
      // Exactly one newline at the end
      expect(line.slice(0, -1)).not.toContain("\n");
    }
  });

  it("continues emitting after a sink failure", () => {
    let callCount = 0;
    const collected: string[] = [];
    const flakySink = (line: string): void => {
      callCount++;
      if (callCount === 1) throw new Error("transient failure");
      collected.push(line);
    };
    const transport = createEventTransport(flakySink);
    transport.emit({ type: "task_started", taskId: "T-001" }); // throws internally
    transport.emit({ type: "task_started", taskId: "T-002" }); // succeeds
    expect(collected).toHaveLength(1);
    const result = parseTransportLine(collected[0]!);
    expect(result.ok).toBe(true);
    if (result.ok && result.frame === "event") {
      expect(result.event.type).toBe("task_started");
    }
  });
});

// ---------------------------------------------------------------------------
// Wire format — structural guarantees
// ---------------------------------------------------------------------------

describe("transport — wire format", () => {
  it("event frame has frame:'event' plus all event fields", () => {
    const { lines, sink } = collectSink();
    const transport = createEventTransport(sink);
    transport.emit({
      type: "step_started",
      taskId: "T-001",
      stepId: "impl",
      stepType: "agent",
    });
    const wire = JSON.parse(lines[0]!.trim());
    expect(wire.frame).toBe("event");
    expect(wire.type).toBe("step_started");
    expect(wire.taskId).toBe("T-001");
    expect(wire.stepId).toBe("impl");
    expect(wire.stepType).toBe("agent");
  });

  it("control frame has frame:'control' plus control fields", () => {
    const { lines, sink } = collectSink();
    const transport = createEventTransport(sink);
    transport.emitControl({
      control: "approval_requested",
      requestId: "r1",
      taskId: "T-001",
      stepId: "gate",
      summary: "Approve?",
    });
    const wire = JSON.parse(lines[0]!.trim());
    expect(wire.frame).toBe("control");
    expect(wire.control).toBe("approval_requested");
    expect(wire.requestId).toBe("r1");
    expect(wire.taskId).toBe("T-001");
    expect(wire.stepId).toBe("gate");
    expect(wire.summary).toBe("Approve?");
  });

  it("each line is valid JSON (single line, no embedded newlines)", () => {
    const { lines, sink } = collectSink();
    const transport = createEventTransport(sink);
    transport.emit({
      type: "stream_chunk",
      taskId: "T-001",
      text: "multi\nline\ncontent",
    });
    // The line (minus trailing \n) should be valid JSON with no raw newlines
    const raw = lines[0]!.slice(0, -1); // strip trailing \n
    expect(raw).not.toContain("\n");
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});
