/**
 * Tests for T-018: Sidecar failure banners.
 *
 * Covers:
 * - applySidecarStderr: stderr line accumulation + tail cap
 * - applySidecarExit: start-fail vs death-mid-run vs clean exit
 * - bannerInfo: pure data extraction for the Banner component
 *
 * Run: `npm test -w apps/menubar -- banner`
 */

import { describe, it, expect } from "vitest";
import {
  initialBridgeState,
  applyLine,
  applySidecarStderr,
  applySidecarExit,
  STDERR_TAIL_CAP,
  type BridgeState,
} from "../state/store-bridge";
import { bannerInfo } from "./Banner";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Advance state to "running" by applying a run_started control frame. */
function withRunStarted(state: BridgeState): BridgeState {
  return applyLine(state, '{"frame":"control","control":"run_started"}');
}

/** Advance state to "finished" by applying run_started + run_finished. */
function withRunFinished(state: BridgeState): BridgeState {
  let s = withRunStarted(state);
  s = applyLine(
    s,
    '{"frame":"control","control":"run_finished","result":{"success":true}}',
  );
  return s;
}

// ---------------------------------------------------------------------------
// applySidecarStderr
// ---------------------------------------------------------------------------

describe("applySidecarStderr", () => {
  it("accumulates stderr lines in order", () => {
    let s = initialBridgeState();
    s = applySidecarStderr(s, "line-1");
    s = applySidecarStderr(s, "line-2");
    s = applySidecarStderr(s, "line-3");
    expect(s.ui.stderrTail).toEqual(["line-1", "line-2", "line-3"]);
  });

  it("returns same store reference (no domain mutation)", () => {
    const s = initialBridgeState();
    const next = applySidecarStderr(s, "err");
    expect(next.store).toBe(s.store);
  });

  it("caps at STDERR_TAIL_CAP, dropping oldest lines", () => {
    let s = initialBridgeState();
    for (let i = 0; i < STDERR_TAIL_CAP + 10; i++) {
      s = applySidecarStderr(s, `line-${i}`);
    }
    expect(s.ui.stderrTail).toHaveLength(STDERR_TAIL_CAP);
    // oldest 10 lines were dropped
    expect(s.ui.stderrTail[0]).toBe("line-10");
    expect(s.ui.stderrTail[STDERR_TAIL_CAP - 1]).toBe(
      `line-${STDERR_TAIL_CAP + 9}`,
    );
  });
});

// ---------------------------------------------------------------------------
// applySidecarExit
// ---------------------------------------------------------------------------

describe("applySidecarExit", () => {
  it("start-fail: exit before run_started → type 'start-fail'", () => {
    const s = initialBridgeState();
    const next = applySidecarExit(s, 1);
    expect(next.ui.sidecarFailure).toEqual({ type: "start-fail", exitCode: 1 });
  });

  it("death-mid-run: exit after run_started → type 'death-mid-run'", () => {
    const s = withRunStarted(initialBridgeState());
    const next = applySidecarExit(s, 137);
    expect(next.ui.sidecarFailure).toEqual({
      type: "death-mid-run",
      exitCode: 137,
    });
  });

  it("clean exit: exit after run_finished → no failure (same reference)", () => {
    const s = withRunFinished(initialBridgeState());
    const next = applySidecarExit(s, 0);
    expect(next).toBe(s);
    expect(next.ui.sidecarFailure).toBeUndefined();
  });

  it("preserves accumulated stderr in UI state", () => {
    let s = initialBridgeState();
    s = applySidecarStderr(s, "error: something broke");
    s = applySidecarExit(s, 1);
    expect(s.ui.stderrTail).toEqual(["error: something broke"]);
    expect(s.ui.sidecarFailure?.type).toBe("start-fail");
  });

  it("freezes store state on death-mid-run (no further mutations)", () => {
    let s = withRunStarted(initialBridgeState());
    // Apply some domain events to populate store
    s = applyLine(
      s,
      '{"frame":"event","type":"task_registered","taskId":"T-001","title":"Setup"}',
    );
    const frozenStore = s.store;

    // Sidecar dies
    s = applySidecarExit(s, 9);
    expect(s.ui.sidecarFailure?.type).toBe("death-mid-run");

    // Store should still be the same reference (no mutation from exit)
    expect(s.store).toBe(frozenStore);
  });
});

// ---------------------------------------------------------------------------
// bannerInfo (pure extraction)
// ---------------------------------------------------------------------------

describe("bannerInfo", () => {
  it("returns null when no sidecar failure", () => {
    const s = initialBridgeState();
    expect(bannerInfo(s.ui)).toBeNull();
  });

  it("returns null for clean finished state", () => {
    const s = withRunFinished(initialBridgeState());
    expect(bannerInfo(s.ui)).toBeNull();
  });

  it("returns start-fail banner data", () => {
    let s = initialBridgeState();
    s = applySidecarStderr(s, "loopy: command not found");
    s = applySidecarExit(s, 127);

    const info = bannerInfo(s.ui);
    expect(info).not.toBeNull();
    expect(info!.type).toBe("start-fail");
    expect(info!.exitCode).toBe(127);
    expect(info!.headline).toBe("Run não iniciou (exit 127)");
    expect(info!.stderrTail).toEqual(["loopy: command not found"]);
  });

  it("returns death-mid-run banner data with stderr tail", () => {
    let s = withRunStarted(initialBridgeState());
    s = applySidecarStderr(s, "panic: unexpected state");
    s = applySidecarStderr(s, "stack trace here");
    s = applySidecarExit(s, 1);

    const info = bannerInfo(s.ui);
    expect(info).not.toBeNull();
    expect(info!.type).toBe("death-mid-run");
    expect(info!.exitCode).toBe(1);
    expect(info!.headline).toBe("Run encerrado (exit 1)");
    expect(info!.stderrTail).toEqual([
      "panic: unexpected state",
      "stack trace here",
    ]);
  });

  it("returns empty stderrTail when no stderr was received", () => {
    const s = applySidecarExit(initialBridgeState(), 1);
    const info = bannerInfo(s.ui);
    expect(info!.stderrTail).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Integration: app never crashes on sidecar death
// ---------------------------------------------------------------------------

describe("app resilience", () => {
  it("applying lines after sidecar exit does not throw", () => {
    let s = withRunStarted(initialBridgeState());
    s = applySidecarExit(s, 9);

    // Further NDJSON lines arrive (buffered in pipe) — must not throw
    expect(() => {
      s = applyLine(
        s,
        '{"frame":"event","type":"stream_chunk","taskId":"T-001","text":"late chunk"}',
      );
    }).not.toThrow();
  });

  it("applying stderr after exit does not throw", () => {
    let s = applySidecarExit(initialBridgeState(), 1);
    expect(() => {
      s = applySidecarStderr(s, "late stderr line");
    }).not.toThrow();
  });
});
