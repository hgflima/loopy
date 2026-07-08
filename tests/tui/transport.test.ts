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
// Command frame round-trip (parse-only — commands come from stdin)
// ---------------------------------------------------------------------------

describe("transport — command frame parse", () => {
  it("approval_decision (approved)", () => {
    const line = JSON.stringify({
      frame: "command",
      command: "approval_decision",
      requestId: "req-42",
      approved: true,
    });
    const result = parseTransportLine(line);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frame).toBe("command");
    if (result.frame !== "command") return;
    const cmd: CommandFrame = {
      command: "approval_decision",
      requestId: "req-42",
      approved: true,
    };
    expect(result.command).toEqual(cmd);
  });

  it("approval_decision (rejected)", () => {
    const line = JSON.stringify({
      frame: "command",
      command: "approval_decision",
      requestId: "req-99",
      approved: false,
    });
    const result = parseTransportLine(line);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frame).toBe("command");
    if (result.frame !== "command") return;
    expect(result.command).toEqual({
      command: "approval_decision",
      requestId: "req-99",
      approved: false,
    });
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
