/**
 * Tests for T-016: ApprovalPrompt — approval_decision via stdin.
 *
 * Covers:
 * - headApproval: pure extraction of the FIFO head
 * - escalationCost: human-readable cost of rejecting
 * - dismissApproval: optimistic removal from pending queue
 * - FIFO ordering: two sequential approvals resolve in order
 * - formatApprovalPayload: NDJSON payload sent to motor stdin
 *
 * Run: `npm test -w apps/menubar -- approval`
 */

import { describe, it, expect } from "vitest";
import {
  initialBridgeState,
  applyLine,
  dismissApproval,
  type BridgeState,
} from "../state/store-bridge";
import { headApproval, escalationCost, formatApprovalPayload } from "./ApprovalPrompt";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withRunStarted(state: BridgeState): BridgeState {
  return applyLine(state, '{"frame":"control","control":"run_started"}');
}

function withApproval(
  state: BridgeState,
  requestId: string,
  taskId: string,
  stepId: string,
  summary: string,
): BridgeState {
  return applyLine(
    state,
    JSON.stringify({
      frame: "control",
      control: "approval_requested",
      requestId,
      taskId,
      stepId,
      summary,
    }),
  );
}

// ---------------------------------------------------------------------------
// headApproval
// ---------------------------------------------------------------------------

describe("headApproval", () => {
  it("returns undefined when no pending approvals", () => {
    const s = initialBridgeState();
    expect(headApproval(s.ui)).toBeUndefined();
  });

  it("returns the first pending approval", () => {
    let s = withRunStarted(initialBridgeState());
    s = withApproval(s, "req-1", "T-001", "merge", "Merge T-001?");
    const head = headApproval(s.ui);
    expect(head).toEqual({
      requestId: "req-1",
      taskId: "T-001",
      stepId: "merge",
      summary: "Merge T-001?",
    });
  });

  it("returns the first even when two approvals are queued", () => {
    let s = withRunStarted(initialBridgeState());
    s = withApproval(s, "req-1", "T-001", "merge", "Merge T-001?");
    s = withApproval(s, "req-2", "T-002", "merge", "Merge T-002?");
    expect(headApproval(s.ui)?.requestId).toBe("req-1");
  });
});

// ---------------------------------------------------------------------------
// escalationCost
// ---------------------------------------------------------------------------

describe("escalationCost", () => {
  it("returns a non-empty cost string", () => {
    const cost = escalationCost();
    expect(cost).toBeTruthy();
    expect(typeof cost).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// dismissApproval
// ---------------------------------------------------------------------------

describe("dismissApproval", () => {
  it("removes the specified approval from the queue", () => {
    let s = withRunStarted(initialBridgeState());
    s = withApproval(s, "req-1", "T-001", "merge", "Merge T-001?");
    s = withApproval(s, "req-2", "T-002", "merge", "Merge T-002?");

    s = dismissApproval(s, "req-1");
    expect(s.ui.pendingApprovals).toHaveLength(1);
    expect(s.ui.pendingApprovals[0]?.requestId).toBe("req-2");
  });

  it("returns same reference when requestId not found", () => {
    let s = withRunStarted(initialBridgeState());
    s = withApproval(s, "req-1", "T-001", "merge", "Merge T-001?");

    const next = dismissApproval(s, "req-unknown");
    expect(next).toBe(s);
  });

  it("empties the queue when last approval is dismissed", () => {
    let s = withRunStarted(initialBridgeState());
    s = withApproval(s, "req-1", "T-001", "merge", "Merge T-001?");

    s = dismissApproval(s, "req-1");
    expect(s.ui.pendingApprovals).toHaveLength(0);
  });

  it("preserves store reference (no domain mutation)", () => {
    let s = withRunStarted(initialBridgeState());
    s = withApproval(s, "req-1", "T-001", "merge", "Merge T-001?");
    const storeBefore = s.store;

    s = dismissApproval(s, "req-1");
    expect(s.store).toBe(storeBefore);
  });
});

// ---------------------------------------------------------------------------
// FIFO ordering
// ---------------------------------------------------------------------------

describe("FIFO queue behavior", () => {
  it("after dismissing head, next becomes head", () => {
    let s = withRunStarted(initialBridgeState());
    s = withApproval(s, "req-1", "T-001", "merge", "Merge T-001?");
    s = withApproval(s, "req-2", "T-002", "merge", "Merge T-002?");

    // Dismiss head
    s = dismissApproval(s, "req-1");

    const head = headApproval(s.ui);
    expect(head?.requestId).toBe("req-2");
    expect(head?.summary).toBe("Merge T-002?");
  });

  it("queue is empty after all approvals dismissed", () => {
    let s = withRunStarted(initialBridgeState());
    s = withApproval(s, "req-1", "T-001", "merge", "Merge T-001?");
    s = withApproval(s, "req-2", "T-002", "merge", "Merge T-002?");

    s = dismissApproval(s, "req-1");
    s = dismissApproval(s, "req-2");

    expect(headApproval(s.ui)).toBeUndefined();
    expect(s.ui.pendingApprovals).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// formatApprovalPayload
// ---------------------------------------------------------------------------

describe("formatApprovalPayload", () => {
  it("formats an approval as NDJSON matching motor expectations", () => {
    const payload = formatApprovalPayload("req-1", true);
    const parsed = JSON.parse(payload);
    expect(parsed).toEqual({
      type: "approval_decision",
      requestId: "req-1",
      approved: true,
    });
  });

  it("formats a rejection", () => {
    const payload = formatApprovalPayload("req-2", false);
    const parsed = JSON.parse(payload);
    expect(parsed.approved).toBe(false);
    expect(parsed.requestId).toBe("req-2");
  });

  it("produces single-line JSON (NDJSON requirement)", () => {
    const payload = formatApprovalPayload("req-3", true);
    expect(payload).not.toContain("\n");
  });
});
