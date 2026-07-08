/**
 * Tests for T-017: notification policy — signal discipline (refino #8).
 *
 * Covers:
 * - 4 positive triggers: approval_requested, run_finished, escalated, paused
 * - Negative: done (critical invariant), skipped, run_started, non-task_finished
 * - Edge: escalated/paused without reason → default body
 *
 * Run: `npm test -w apps/menubar -- notify`
 */

import { describe, it, expect } from "vitest";
import { shouldNotify } from "./notify";
import type { ControlFrame } from "loopy/tui/transport";
import type { StoreEvent } from "loopy/tui/store";

// ---------------------------------------------------------------------------
// Positive triggers (exactly 4)
// ---------------------------------------------------------------------------

describe("shouldNotify — positive triggers", () => {
  it("notifies on approval_requested (always)", () => {
    const input: ControlFrame = {
      control: "approval_requested",
      requestId: "req-1",
      taskId: "T-001",
      stepId: "merge",
      summary: "Merge T-001 into main?",
    };
    const result = shouldNotify(input);
    expect(result).not.toBeNull();
    expect(result!.title).toContain("T-001");
    expect(result!.body).toBe("Merge T-001 into main?");
  });

  it("notifies on run_finished", () => {
    const input: ControlFrame = {
      control: "run_finished",
      result: { success: true, tasksCompleted: 3 },
    };
    const result = shouldNotify(input);
    expect(result).not.toBeNull();
    expect(result!.title).toBeTruthy();
    expect(result!.body).toBeTruthy();
  });

  it("notifies on task escalated with reason", () => {
    const input: StoreEvent = {
      type: "task_finished",
      taskId: "T-003",
      status: "escalated",
      reason: "step implement failed 3×",
    };
    const result = shouldNotify(input);
    expect(result).not.toBeNull();
    expect(result!.title).toContain("T-003");
    expect(result!.body).toContain("step implement failed 3×");
  });

  it("notifies on task paused with reason", () => {
    const input: StoreEvent = {
      type: "task_finished",
      taskId: "T-004",
      status: "paused",
      reason: "merge conflict — rebase needed",
    };
    const result = shouldNotify(input);
    expect(result).not.toBeNull();
    expect(result!.title).toContain("T-004");
    expect(result!.body).toContain("merge conflict");
  });
});

// ---------------------------------------------------------------------------
// Default body (no reason provided)
// ---------------------------------------------------------------------------

describe("shouldNotify — default body when reason omitted", () => {
  it("escalated without reason → default body", () => {
    const input: StoreEvent = {
      type: "task_finished",
      taskId: "T-005",
      status: "escalated",
    };
    const result = shouldNotify(input);
    expect(result).not.toBeNull();
    expect(result!.body).toBeTruthy();
  });

  it("paused without reason → default body", () => {
    const input: StoreEvent = {
      type: "task_finished",
      taskId: "T-006",
      status: "paused",
    };
    const result = shouldNotify(input);
    expect(result).not.toBeNull();
    expect(result!.body).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Negative cases (no notification)
// ---------------------------------------------------------------------------

describe("shouldNotify — never notifies on", () => {
  it("task done (signal discipline — no per-task-done noise)", () => {
    const input: StoreEvent = {
      type: "task_finished",
      taskId: "T-001",
      status: "done",
    };
    expect(shouldNotify(input)).toBeNull();
  });

  it("task skipped (transitive, not actionable)", () => {
    const input: StoreEvent = {
      type: "task_finished",
      taskId: "T-002",
      status: "skipped",
    };
    expect(shouldNotify(input)).toBeNull();
  });

  it("run_started (no signal)", () => {
    const input: ControlFrame = { control: "run_started" };
    expect(shouldNotify(input)).toBeNull();
  });

  it("task_started (non-task_finished event)", () => {
    const input: StoreEvent = { type: "task_started", taskId: "T-001" };
    expect(shouldNotify(input)).toBeNull();
  });

  it("stream_chunk (non-task_finished event)", () => {
    const input: StoreEvent = {
      type: "stream_chunk",
      taskId: "T-001",
      text: "implementing...",
    };
    expect(shouldNotify(input)).toBeNull();
  });

  it("step_finished (non-task_finished event)", () => {
    const input: StoreEvent = {
      type: "step_finished",
      taskId: "T-001",
      stepId: "implement",
      ok: true,
    };
    expect(shouldNotify(input)).toBeNull();
  });
});
