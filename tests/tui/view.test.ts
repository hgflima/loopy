import { describe, expect, it } from "vitest";
import {
  attemptLabel,
  checkText,
  COLORS,
  pulseFrame,
  streamTail,
  SYMBOLS,
} from "../../src/tui/view";
import type { CheckState } from "../../src/tui/store";

// ---------------------------------------------------------------------------
// attemptLabel — the `try k/max` display fed by the store's attempt fields
// ---------------------------------------------------------------------------

describe("attemptLabel", () => {
  it("renders `try k/max` when both attempt and max are set", () => {
    expect(attemptLabel({ attempt: 2, maxAttempts: 4 })).toBe("try 2/4");
  });

  it("renders `try k` when only the attempt is known (no verify ceiling)", () => {
    expect(attemptLabel({ attempt: 1, maxAttempts: undefined })).toBe("try 1");
  });

  it("is empty before any attempt has started", () => {
    expect(attemptLabel({ attempt: undefined, maxAttempts: undefined })).toBe(
      "",
    );
  });
});

// ---------------------------------------------------------------------------
// checkText — per-check status line (symbol + name)
// ---------------------------------------------------------------------------

describe("checkText", () => {
  const check = (status: CheckState["status"]): CheckState => ({
    name: "typecheck",
    status,
  });

  it("pairs the passed symbol with the name", () => {
    expect(checkText(check("passed"))).toBe(
      `${SYMBOLS.check.passed} typecheck`,
    );
  });

  it("pairs the failed symbol with the name", () => {
    expect(checkText(check("failed"))).toBe(
      `${SYMBOLS.check.failed} typecheck`,
    );
  });

  it("pairs the running symbol with the name", () => {
    expect(checkText(check("running"))).toBe(
      `${SYMBOLS.check.running} typecheck`,
    );
  });
});

// ---------------------------------------------------------------------------
// streamTail — the last N lines of accumulated agent stream text
// ---------------------------------------------------------------------------

describe("streamTail", () => {
  it("returns an empty array for empty text", () => {
    expect(streamTail("", 8)).toEqual([]);
  });

  it("keeps only the last `maxLines` lines", () => {
    expect(streamTail("a\nb\nc\nd", 2)).toEqual(["c", "d"]);
  });

  it("returns every line when under the limit", () => {
    expect(streamTail("a\nb", 8)).toEqual(["a", "b"]);
  });

  it("drops trailing blank lines so a fresh newline is not a phantom row", () => {
    expect(streamTail("x\n\n", 8)).toEqual(["x"]);
  });

  it("preserves interior blank lines", () => {
    expect(streamTail("a\n\nb", 8)).toEqual(["a", "", "b"]);
  });
});

// ---------------------------------------------------------------------------
// Symbol / color tables — one entry per status, keyed by the store's unions
// ---------------------------------------------------------------------------

describe("SYMBOLS / COLORS", () => {
  it("covers every task status with a symbol and a color", () => {
    for (const status of [
      "pending", "blocked", "running", "done",
      "escalated", "skipped", "paused",
    ] as const) {
      expect(SYMBOLS.task[status]).toBeTruthy();
      expect(COLORS.task[status]).toBeTruthy();
    }
  });

  it("maps amarelo=aguardando (pending/blocked yellow)", () => {
    expect(COLORS.task.pending).toBe("yellow");
    expect(COLORS.task.blocked).toBe("yellow");
  });

  it("maps vermelho=falhou (escalated red)", () => {
    expect(COLORS.task.escalated).toBe("red");
  });

  it("keeps running=cyan and done=green", () => {
    expect(COLORS.task.running).toBe("cyan");
    expect(COLORS.task.done).toBe("green");
  });

  it("maps skipped→gray and paused→magenta", () => {
    expect(COLORS.task.skipped).toBe("gray");
    expect(COLORS.task.paused).toBe("magenta");
  });

  it("keeps SYMBOLS.task unchanged", () => {
    expect(SYMBOLS.task).toEqual({
      pending: "•", blocked: "◦", running: "▶", done: "✔",
      escalated: "✖", skipped: "⊘", paused: "⏸",
    });
  });

  it("covers every check status with a symbol and a color", () => {
    for (const status of ["running", "passed", "failed"] as const) {
      expect(SYMBOLS.check[status]).toBeTruthy();
      expect(COLORS.check[status]).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// pulseFrame — deterministic on/off alternation per tick
// ---------------------------------------------------------------------------

describe("pulseFrame", () => {
  it("returns 'on' for even ticks", () => {
    expect(pulseFrame(0)).toBe("on");
    expect(pulseFrame(2)).toBe("on");
    expect(pulseFrame(100)).toBe("on");
  });

  it("returns 'off' for odd ticks", () => {
    expect(pulseFrame(1)).toBe("off");
    expect(pulseFrame(3)).toBe("off");
    expect(pulseFrame(99)).toBe("off");
  });
});
