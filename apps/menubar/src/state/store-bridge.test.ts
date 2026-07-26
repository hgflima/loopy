/**
 * Integration regression test for the C-0011 #5 raia usage (RC-B1).
 *
 * The bug: `applyLine` stamps `step.used` onto a transcript entry only at
 * `stream_chunk` time, but the `usage_sample` (from the ACP `usage_update`)
 * arrives at the END of a turn — AFTER the step's chunks. So the transcript
 * snapshot froze `usedTokens: undefined`, the segment showed the agent but no
 * usage, and the raia was `IMPLEMENT → CLAUDE` with no `(used / %)`.
 *
 * These tests drive the **real event order** through the bridge and assert the
 * end-to-end raia string is repaired by `overlayStepUsage` (live-step overlay),
 * while documenting that the raw transcript snapshot still misses it.
 */
import { describe, it, expect } from "vitest";
import { applyLine, initialBridgeState, applyTimeline } from "./store-bridge";
import { segmentsFor, overlayStepUsage, TIMELINE_CAP } from "./stream-history";
import { formatUsage } from "../ui/context-window";
import type { StoreEvent, StoreState, ToolCallState } from "loopy/tui/store";

/** Serialize one StoreEvent as an NDJSON transport line (`{frame:"event",…}`). */
function ev(event: Record<string, unknown>): string {
  return JSON.stringify({ frame: "event", ...event });
}

/** Feed a sequence of transport lines through `applyLine`. */
function feed(lines: readonly string[]) {
  return lines.reduce((s, line) => applyLine(s, line), initialBridgeState());
}

const TASK = "T-013";
const STEP = "implement";

/** The exact order seen in loopy.log: agent step, chunks, THEN usage_sample. */
const REAL_ORDER: readonly string[] = [
  ev({ type: "task_registered", taskId: TASK, title: "do the thing" }),
  ev({ type: "task_started", taskId: TASK }),
  ev({
    type: "step_started",
    taskId: TASK,
    stepId: STEP,
    stepType: "agent",
    agentName: "Claude",
    model: "claude-opus-4-8",
  }),
  ev({ type: "stream_chunk", taskId: TASK, text: "verificando o ESLint" }),
  ev({ type: "stream_chunk", taskId: TASK, text: " (v9)…" }),
  // usage_update lands last (flushSessionUpdates barrier) — NO chunk after it.
  ev({ type: "usage_sample", taskId: TASK, stepId: STEP, used: 34_421, size: 1_000_000 }),
];

describe("store-bridge — usage_sample after chunks (C-0011 #5, RC-B1)", () => {
  it("reduces usage_sample into the live store step", () => {
    const s = feed(REAL_ORDER);
    const step = s.store.tasks.find((t) => t.id === TASK)?.steps.find((st) => st.id === STEP);
    expect(step).toMatchObject({ used: 34_421, size: 1_000_000, agentName: "Claude" });
  });

  it("the raw transcript snapshot MISSES the usage (documents the bug)", () => {
    const s = feed(REAL_ORDER);
    const segs = segmentsFor(TASK, s.transcript);
    // Agent survives (set at step_started, before chunks); usage does not.
    expect(segs.at(-1)).toMatchObject({ agent: "Claude", usedTokens: undefined });
  });

  it("overlayStepUsage repairs the raia end-to-end (the fix)", () => {
    const s = feed(REAL_ORDER);
    const task = s.store.tasks.find((t) => t.id === TASK)!;
    const segs = overlayStepUsage(segmentsFor(TASK, s.transcript), task.steps);
    const seg = segs.at(-1)!;
    expect(seg).toMatchObject({ agent: "Claude", usedTokens: 34_421, size: 1_000_000 });
    // The exact string the StepDivider renders in the raia.
    expect(formatUsage(seg.usedTokens, seg.size, seg.model)).toBe("(34k / 3%)");
  });
});

// ---------------------------------------------------------------------------
// store-bridge — warning event propagation (T-007)
// ---------------------------------------------------------------------------

describe("store-bridge — warning event propagation (T-007)", () => {
  it("propagates warning into store.warnings via reduce", () => {
    const s = feed([
      ev({ type: "warning", message: "effort not supported", agentName: "Claude" }),
    ]);
    expect(s.store.warnings).toHaveLength(1);
    expect(s.store.warnings[0]).toMatchObject({
      agentName: "Claude",
      message: "effort not supported",
    });
  });

  it("warning with taskId/stepId marks step.warned via reduce", () => {
    const s = feed([
      ev({ type: "task_registered", taskId: "T-001", title: "t" }),
      ev({ type: "step_started", taskId: "T-001", stepId: "impl", stepType: "agent" }),
      ev({ type: "warning", taskId: "T-001", stepId: "impl", message: "no effort" }),
    ]);
    const step = s.store.tasks.find((t) => t.id === "T-001")?.steps.find((st) => st.id === "impl");
    expect(step?.warned).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// store-bridge — interview controls are ignored (C-0018 T-001)
// ---------------------------------------------------------------------------

/** Serialize one interview ControlFrame as an NDJSON transport line. */
function ctrl(control: Record<string, unknown>): string {
  return JSON.stringify({ frame: "control", ...control });
}

describe("store-bridge — interview controls are ignored (same reference)", () => {
  // The Interview runs in a separate process; its control frames do not belong
  // to the Run's BridgeState. Each must be a no-op returning the SAME reference.
  const cases: Record<string, Record<string, unknown>> = {
    phase_started: { control: "phase_started", phase: "spec", command: "/devy:spec" },
    change_resolved: { control: "change_resolved", changeDir: ".harn/devy/changes/C-0019" },
    question_asked: { control: "question_asked", questionId: "q-1", phase: "spec", prompt: "?" },
    agent_activity: { control: "agent_activity", phase: "refine", text: "trabalhando…" },
    phase_finished: {
      control: "phase_finished",
      phase: "plan",
      changeDir: ".harn/devy/changes/C-0019",
      files: ["spec.md"],
    },
    interview_failed: { control: "interview_failed", reason: "sem <loopy-done/>" },
  };

  for (const [name, control] of Object.entries(cases)) {
    it(`${name} returns the same BridgeState reference`, () => {
      const state = initialBridgeState();
      const next = applyLine(state, ctrl(control));
      expect(next).toBe(state);
    });
  }

  it("a real run control still produces a new state (run_started)", () => {
    const state = initialBridgeState();
    const next = applyLine(state, ctrl({ control: "run_started" }));
    expect(next).not.toBe(state);
    expect(next.ui.runStatus).toBe("running");
  });
});

// ---------------------------------------------------------------------------
// store-bridge — applyTimeline: the transcript's own reducer (C-0019 T-006)
// ---------------------------------------------------------------------------

/** A registered, running task sitting on step STEP — so `currentStepId` = STEP. */
const REGISTERED: readonly string[] = [
  ev({ type: "task_registered", taskId: TASK, title: "do the thing" }),
  ev({ type: "task_started", taskId: TASK }),
  ev({
    type: "step_started",
    taskId: TASK,
    stepId: STEP,
    stepType: "agent",
    agentName: "Claude",
    model: "claude-opus-4-8",
  }),
];

/** A full {@link ToolCallState} fixture (every required field), overridable. */
function toolCallState(
  id: string,
  over: Partial<ToolCallState> = {},
): ToolCallState {
  return {
    toolCallId: id,
    title: "Edit file",
    kind: "edit",
    status: "pending",
    locations: [],
    content: [],
    ...over,
  };
}

describe("store-bridge — applyLine grows the transcript via applyTimeline (T-006)", () => {
  it("a tool_call for a registered task grows the transcript even though reduce is a no-op (THE trap)", () => {
    const base = feed(REGISTERED);
    const next = applyLine(
      base,
      ev({ type: "tool_call", taskId: TASK, stepId: STEP, call: toolCallState("tc-1") }),
    );

    // `reduce` returns the SAME store for the six rich events (R4)…
    expect(next.store).toBe(base.store);
    // …but the transcript MUST grow — the whole reason T-006 exists.
    expect(next).not.toBe(base);
    const entries = next.transcript[TASK] ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]!.item).toEqual({ item: "tool", call: toolCallState("tc-1") });
    expect(entries[0]!.stepId).toBe(STEP);
  });

  it("a timeline event for an UNregistered task returns the same BridgeState (fail-closed)", () => {
    const base = feed(REGISTERED);
    const next = applyLine(
      base,
      ev({ type: "tool_call", taskId: "GHOST", call: toolCallState("tc-x") }),
    );
    expect(next).toBe(base);
  });

  it("a non-timeline event (check_started) leaves the transcript untouched", () => {
    const base = feed(REGISTERED);
    const next = applyLine(
      base,
      ev({ type: "check_started", taskId: TASK, stepId: STEP, name: "ci" }),
    );
    // The store changed (a check was upserted)…
    expect(next.store).not.toBe(base.store);
    // …but the transcript is the same reference (structural sharing).
    expect(next.transcript).toBe(base.transcript);
  });

  it("a stream_chunk without a stepId falls back to the task's currentStepId", () => {
    const base = feed(REGISTERED);
    const next = applyLine(base, ev({ type: "stream_chunk", taskId: TASK, text: "hi" }));
    expect(next.transcript[TASK]?.at(-1)?.stepId).toBe(STEP);
  });

  it("a stream_chunk carries the event's own stepId over currentStepId", () => {
    // A second step becomes current, but a late chunk still targets STEP.
    const base = feed([
      ...REGISTERED,
      ev({ type: "step_started", taskId: TASK, stepId: "simplify", stepType: "agent" }),
    ]);
    const next = applyLine(
      base,
      ev({ type: "stream_chunk", taskId: TASK, stepId: STEP, text: "late" }),
    );
    expect(next.transcript[TASK]?.at(-1)?.stepId).toBe(STEP);
  });

  it("routes each rich event to its StreamItem kind", () => {
    let s = feed(REGISTERED);
    s = applyLine(s, ev({ type: "thought_chunk", taskId: TASK, text: "hmm" }));
    s = applyLine(s, ev({
      type: "plan",
      taskId: TASK,
      entries: [{ content: "x", priority: "high", status: "pending" }],
    }));
    s = applyLine(s, ev({ type: "mode_changed", taskId: TASK, modeId: "plan" }));
    s = applyLine(s, ev({
      type: "agent_update",
      taskId: TASK,
      updateKind: "available_commands_update",
      payload: { a: 1 },
    }));
    const kinds = (s.transcript[TASK] ?? []).map((e) => e.item.item);
    expect(kinds).toEqual(["thought", "plan", "mode", "raw"]);
  });

  it("a tool_call_update merges into its card by id, interleaved with text (not a new entry)", () => {
    let s = feed(REGISTERED);
    s = applyLine(s, ev({ type: "tool_call", taskId: TASK, stepId: STEP, call: toolCallState("tc") }));
    s = applyLine(s, ev({ type: "stream_chunk", taskId: TASK, stepId: STEP, text: "working…" }));
    s = applyLine(s, ev({
      type: "tool_call_update",
      taskId: TASK,
      stepId: STEP,
      delta: { toolCallId: "tc", status: "completed" },
    }));

    const items = (s.transcript[TASK] ?? []).map((e) => e.item);
    expect(items).toHaveLength(2); // the update merged in place; no 3rd entry
    const tool = items.find((i) => i.item === "tool");
    expect(tool).toMatchObject({ item: "tool", call: { toolCallId: "tc", status: "completed" } });
  });

  it("consecutive text chunks sharing a messageId concatenate into one entry", () => {
    let s = feed(REGISTERED);
    s = applyLine(s, ev({ type: "stream_chunk", taskId: TASK, stepId: STEP, text: "Hello", messageId: "m1" }));
    s = applyLine(s, ev({ type: "stream_chunk", taskId: TASK, stepId: STEP, text: " world", messageId: "m1" }));
    const entries = s.transcript[TASK] ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]!.item).toEqual({ item: "text", text: "Hello world", messageId: "m1" });
  });

  it("a command frame and a malformed line both return the same reference", () => {
    const base = feed(REGISTERED);
    const cmd = JSON.stringify({
      frame: "command",
      command: "approval_decision",
      requestId: "r",
      approved: true,
    });
    expect(applyLine(base, cmd)).toBe(base);
    expect(applyLine(base, "}{ not json")).toBe(base);
  });

  it("a tool_call whose stepId was never started returns the same BridgeState (fail-closed step)", () => {
    // Task IS registered, but the event carries a step that never emitted
    // `step_started` — so it is absent from `task.steps`. Fabricating an entry
    // would leak a ghost segment with no telemetry; fail-closed instead.
    const base = feed(REGISTERED);
    const next = applyLine(
      base,
      ev({ type: "tool_call", taskId: TASK, stepId: "never-started", call: toolCallState("tc-g") }),
    );
    expect(next).toBe(base);
  });

  it("the elided ring marker joins the first surviving segment, not the current step", () => {
    // Fill STEP up to (almost) the cap with distinct-messageId text items (no
    // concatenation), switch to a second step, then overflow so the OLDEST
    // (STEP) items drop and an `elided` marker is minted at the head.
    const onStep = 250;
    const onSimplify = TIMELINE_CAP - onStep + 20; // total renderable > cap → a cut
    const lines: string[] = [...REGISTERED];
    for (let i = 0; i < onStep; i++) {
      lines.push(ev({ type: "stream_chunk", taskId: TASK, stepId: STEP, text: `a${i}`, messageId: `s${i}` }));
    }
    lines.push(ev({ type: "step_started", taskId: TASK, stepId: "simplify", stepType: "agent" }));
    for (let i = 0; i < onSimplify; i++) {
      lines.push(ev({ type: "stream_chunk", taskId: TASK, stepId: "simplify", text: `b${i}`, messageId: `p${i}` }));
    }
    const s = feed(lines);

    const entries = s.transcript[TASK]!;
    // A cut happened — the head is the elided marker…
    expect(entries[0]!.item.item).toBe("elided");
    // …and it inherits the FIRST SURVIVOR's step (STEP, oldest still standing),
    // NOT the current step (simplify). Otherwise segmentsFor splits the timeline
    // as `simplify (marker) → STEP → simplify`.
    expect(entries[0]!.stepId).toBe(STEP);

    const segs = segmentsFor(TASK, s.transcript);
    expect(segs.map((seg) => seg.stepId)).toEqual([STEP, "simplify"]);
    expect(segs[0]!.items[0]!.item).toBe("elided");
  });
});

describe("applyTimeline — pure, tested in isolation (T-006)", () => {
  const store: StoreState = feed(REGISTERED).store;

  it("returns the same transcript for a non-timeline event", () => {
    const tx = {};
    const event: StoreEvent = { type: "check_started", taskId: TASK, stepId: STEP, name: "ci" };
    expect(applyTimeline(tx, event, store)).toBe(tx);
  });

  it("is fail-closed: an event whose task is absent from the store returns the same transcript", () => {
    const tx = {};
    const event: StoreEvent = { type: "tool_call", taskId: "GHOST", call: toolCallState("tc") };
    expect(applyTimeline(tx, event, store)).toBe(tx);
  });

  it("is fail-closed: an event whose step has no step_started returns the same transcript", () => {
    // The task exists, but this stepId is absent from `task.steps` (the
    // inherited-by-accident validation the old guard had for a step without
    // `step_started`). No ghost segment; same reference.
    const tx = {};
    const event: StoreEvent = {
      type: "tool_call",
      taskId: TASK,
      stepId: "never-started",
      call: toolCallState("tc"),
    };
    expect(applyTimeline(tx, event, store)).toBe(tx);
  });

  it("drops an orphan tool_call_update — no card fabricated (same transcript)", () => {
    const tx = {};
    const event: StoreEvent = {
      type: "tool_call_update",
      taskId: TASK,
      stepId: STEP,
      delta: { toolCallId: "never-seen" },
    };
    expect(applyTimeline(tx, event, store)).toBe(tx);
  });

  it("derives per-entry telemetry from the step in the passed store", () => {
    const withUsage: StoreState = feed([
      ...REGISTERED,
      ev({ type: "usage_sample", taskId: TASK, stepId: STEP, used: 1234, size: 200_000 }),
    ]).store;
    const event: StoreEvent = { type: "tool_call", taskId: TASK, stepId: STEP, call: toolCallState("tc") };
    const tx = applyTimeline({}, event, withUsage);
    expect(tx[TASK]![0]).toMatchObject({
      agent: "Claude",
      model: "claude-opus-4-8",
      usedTokens: 1234,
      size: 200_000,
    });
  });
});
