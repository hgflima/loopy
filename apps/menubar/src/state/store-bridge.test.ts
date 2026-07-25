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
import { applyLine, initialBridgeState } from "./store-bridge";
import { segmentsFor, overlayStepUsage } from "./stream-history";
import { formatUsage } from "../ui/context-window";

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
