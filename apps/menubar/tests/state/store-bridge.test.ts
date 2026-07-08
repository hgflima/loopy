import { describe, it, expect } from "vitest";
import {
  applyLine,
  initialBridgeState,
} from "../../src/state/store-bridge";
import { reduce, initialState } from "loopy/tui/store";
import type { StoreEvent } from "loopy/tui/store";
import { createEventTransport } from "loopy/tui/transport";

// ── helpers ─────────────────────────────────────────────────────────────

/** Serialize events as NDJSON lines via the real transport. */
function serializeEvents(events: StoreEvent[]): string[] {
  const lines: string[] = [];
  const transport = createEventTransport((line) => lines.push(line));
  for (const e of events) transport.emit(e);
  return lines;
}

/** Apply a list of NDJSON lines to a fresh BridgeState. */
function feedLines(lines: string[]) {
  let state = initialBridgeState();
  for (const line of lines) state = applyLine(state, line);
  return state;
}

// ── fixtures ────────────────────────────────────────────────────────────

const SAMPLE_EVENTS: StoreEvent[] = [
  { type: "edges_set", edges: [["T-001", "T-002"]] },
  {
    type: "pipeline_declared",
    steps: [
      { id: "implement", type: "agent" },
      { id: "test", type: "checks" },
    ],
  },
  { type: "task_registered", taskId: "T-001", title: "Setup exports" },
  {
    type: "task_registered",
    taskId: "T-002",
    title: "Transport layer",
    status: "blocked",
  },
  { type: "task_started", taskId: "T-001" },
  {
    type: "step_started",
    taskId: "T-001",
    stepId: "implement",
    stepType: "agent",
  },
  {
    type: "attempt_started",
    taskId: "T-001",
    stepId: "implement",
    attempt: 1,
    maxAttempts: 3,
  },
  { type: "stream_chunk", taskId: "T-001", text: "Working on exports..." },
  {
    type: "step_finished",
    taskId: "T-001",
    stepId: "implement",
    ok: true,
  },
  {
    type: "step_started",
    taskId: "T-001",
    stepId: "test",
    stepType: "checks",
  },
  {
    type: "check_started",
    taskId: "T-001",
    stepId: "test",
    name: "typecheck",
  },
  {
    type: "check_finished",
    taskId: "T-001",
    stepId: "test",
    name: "typecheck",
    ok: true,
  },
  { type: "step_finished", taskId: "T-001", stepId: "test", ok: true },
  { type: "task_finished", taskId: "T-001", status: "done" },
];

// ── tests ───────────────────────────────────────────────────────────────

describe("store-bridge", () => {
  describe("parity — serialized applyLine ≡ in-process reduce", () => {
    it("produces the same StoreState from a full event sequence", () => {
      // In-process path: reduce directly
      let directState = initialState();
      for (const e of SAMPLE_EVENTS) directState = reduce(directState, e);

      // Serialized path: NDJSON round-trip via applyLine
      const lines = serializeEvents(SAMPLE_EVENTS);
      const bridge = feedLines(lines);

      expect(bridge.store).toEqual(directState);
    });

    it("preserves structural sharing on no-op events", () => {
      // Event for an unregistered task → no-op in both paths
      const noop: StoreEvent = {
        type: "task_started",
        taskId: "NONEXISTENT",
      };
      const line = serializeEvents([noop])[0]!;

      const state = initialBridgeState();
      const next = applyLine(state, line);

      // Same reference — no spurious copy
      expect(next).toBe(state);
    });
  });

  describe("control frames update only UI state", () => {
    it("run_started sets runStatus to running", () => {
      const line = JSON.stringify({
        frame: "control",
        control: "run_started",
      });
      const state = applyLine(initialBridgeState(), line);

      expect(state.ui.runStatus).toBe("running");
      expect(state.store).toEqual(initialBridgeState().store);
    });

    it("run_finished sets runStatus and runResult", () => {
      let state = initialBridgeState();
      state = applyLine(
        state,
        JSON.stringify({ frame: "control", control: "run_started" }),
      );
      state = applyLine(
        state,
        JSON.stringify({
          frame: "control",
          control: "run_finished",
          result: { success: true },
        }),
      );

      expect(state.ui.runStatus).toBe("finished");
      expect(state.ui.runResult).toEqual({ success: true });
      expect(state.store).toEqual(initialBridgeState().store);
    });

    it("approval_requested adds to pendingApprovals", () => {
      const line = JSON.stringify({
        frame: "control",
        control: "approval_requested",
        requestId: "req-1",
        taskId: "T-001",
        stepId: "approve",
        summary: "Merge T-001?",
      });
      const state = applyLine(initialBridgeState(), line);

      expect(state.ui.pendingApprovals).toHaveLength(1);
      expect(state.ui.pendingApprovals[0]).toEqual({
        requestId: "req-1",
        taskId: "T-001",
        stepId: "approve",
        summary: "Merge T-001?",
      });
      expect(state.store).toEqual(initialBridgeState().store);
    });

    it("multiple approvals accumulate", () => {
      const mkApproval = (id: string) =>
        JSON.stringify({
          frame: "control",
          control: "approval_requested",
          requestId: id,
          taskId: "T-001",
          stepId: "approve",
          summary: `Approve ${id}`,
        });

      let state = initialBridgeState();
      state = applyLine(state, mkApproval("req-1"));
      state = applyLine(state, mkApproval("req-2"));

      expect(state.ui.pendingApprovals).toHaveLength(2);
      expect(state.ui.pendingApprovals[0]!.requestId).toBe("req-1");
      expect(state.ui.pendingApprovals[1]!.requestId).toBe("req-2");
    });
  });

  describe("malformed lines are silently ignored", () => {
    it("empty line → same reference", () => {
      const state = initialBridgeState();
      expect(applyLine(state, "")).toBe(state);
    });

    it("whitespace-only → same reference", () => {
      const state = initialBridgeState();
      expect(applyLine(state, "   \t  ")).toBe(state);
    });

    it("invalid JSON → same reference", () => {
      const state = initialBridgeState();
      expect(applyLine(state, "{not json}")).toBe(state);
    });

    it("missing frame field → same reference", () => {
      const state = initialBridgeState();
      expect(applyLine(state, '{"type":"task_started"}')).toBe(state);
    });

    it("unknown frame type → same reference", () => {
      const state = initialBridgeState();
      expect(applyLine(state, '{"frame":"bogus"}')).toBe(state);
    });

    it("JSON array → same reference", () => {
      const state = initialBridgeState();
      expect(applyLine(state, "[1,2,3]")).toBe(state);
    });
  });

  describe("command frames are no-op (app→motor direction)", () => {
    it("returns same reference", () => {
      const state = initialBridgeState();
      const line = JSON.stringify({
        frame: "command",
        command: "approval_decision",
        requestId: "req-1",
        approved: true,
      });
      expect(applyLine(state, line)).toBe(state);
    });
  });

  describe("mixed sequence (events + control interleaved)", () => {
    it("events populate store while control updates UI independently", () => {
      const lines = [
        JSON.stringify({ frame: "control", control: "run_started" }),
        ...serializeEvents([
          {
            type: "task_registered",
            taskId: "T-001",
            title: "First task",
          },
          { type: "task_started", taskId: "T-001" },
        ]),
        JSON.stringify({
          frame: "control",
          control: "approval_requested",
          requestId: "req-1",
          taskId: "T-001",
          stepId: "merge",
          summary: "Merge?",
        }),
        ...serializeEvents([
          { type: "task_finished", taskId: "T-001", status: "done" },
        ]),
        JSON.stringify({
          frame: "control",
          control: "run_finished",
          result: { ok: true },
        }),
      ];

      const bridge = feedLines(lines);

      // Store reflects domain events
      expect(bridge.store.tasks).toHaveLength(1);
      expect(bridge.store.tasks[0]!.status).toBe("done");

      // UI reflects control frames
      expect(bridge.ui.runStatus).toBe("finished");
      expect(bridge.ui.runResult).toEqual({ ok: true });
      expect(bridge.ui.pendingApprovals).toHaveLength(1);
    });
  });

  describe("transcript accumulation (append-only, cross-step)", () => {
    it("accumulates stream_chunks tagged by currentStepId", () => {
      const lines = serializeEvents([
        { type: "task_registered", taskId: "T-001", title: "A" },
        { type: "task_started", taskId: "T-001" },
        {
          type: "step_started",
          taskId: "T-001",
          stepId: "implement",
          stepType: "agent",
        },
        { type: "stream_chunk", taskId: "T-001", text: "hello " },
        { type: "stream_chunk", taskId: "T-001", text: "world" },
      ]);

      const bridge = feedLines(lines);

      expect(bridge.transcript["T-001"]).toEqual([
        { stepId: "implement", text: "hello " },
        { stepId: "implement", text: "world" },
      ]);
    });

    it("tags chunks with the new stepId after step_started", () => {
      const lines = serializeEvents([
        { type: "task_registered", taskId: "T-001", title: "A" },
        { type: "task_started", taskId: "T-001" },
        {
          type: "step_started",
          taskId: "T-001",
          stepId: "implement",
          stepType: "agent",
        },
        { type: "stream_chunk", taskId: "T-001", text: "code" },
        {
          type: "step_finished",
          taskId: "T-001",
          stepId: "implement",
          ok: true,
        },
        {
          type: "step_started",
          taskId: "T-001",
          stepId: "simplify",
          stepType: "agent",
        },
        { type: "stream_chunk", taskId: "T-001", text: "clean" },
      ]);

      const bridge = feedLines(lines);

      expect(bridge.transcript["T-001"]).toEqual([
        { stepId: "implement", text: "code" },
        { stepId: "simplify", text: "clean" },
      ]);
    });

    it("transcript persists after task_finished (≠ store.stream)", () => {
      const lines = serializeEvents([
        { type: "task_registered", taskId: "T-001", title: "A" },
        { type: "task_started", taskId: "T-001" },
        {
          type: "step_started",
          taskId: "T-001",
          stepId: "implement",
          stepType: "agent",
        },
        { type: "stream_chunk", taskId: "T-001", text: "work" },
        {
          type: "step_finished",
          taskId: "T-001",
          stepId: "implement",
          ok: true,
        },
        { type: "task_finished", taskId: "T-001", status: "done" },
      ]);

      const bridge = feedLines(lines);

      // store.stream is empty (cleared by step_started / task lifecycle)
      // but transcript survives
      expect(bridge.transcript["T-001"]).toEqual([
        { stepId: "implement", text: "work" },
      ]);
    });

    it("no transcript entry for unregistered task (same ref)", () => {
      const state = initialBridgeState();
      const line = serializeEvents([
        { type: "stream_chunk", taskId: "GHOST", text: "boo" },
      ])[0]!;

      const next = applyLine(state, line);
      expect(next).toBe(state);
      expect(next.transcript).toEqual({});
    });

    it("applyLine never throws on stream_chunk (AD-5)", () => {
      const state = initialBridgeState();
      // malformed, missing fields, etc. — all no-op
      expect(() => applyLine(state, "")).not.toThrow();
      expect(() => applyLine(state, '{"frame":"event"}')).not.toThrow();
      expect(() =>
        applyLine(
          state,
          JSON.stringify({
            frame: "event",
            type: "stream_chunk",
            taskId: "T-X",
            text: "x",
          }),
        ),
      ).not.toThrow();
    });
  });
});
