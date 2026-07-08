import { describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import {
  createApprovalController,
  createAutoApproval,
  createReadlineApproval,
  createStdinApproval,
  parseApprovalAnswer,
  parseApprovalDecision,
} from "../../src/tui/approval";

// ---------------------------------------------------------------------------
// parseApprovalAnswer — the y/n parsing shared by the readline fallback
// ---------------------------------------------------------------------------

describe("parseApprovalAnswer", () => {
  it.each(["y", "Y", "yes", "YES", "s", "sim", " y ", "Sim"])(
    "treats %j as approval",
    (raw) => {
      expect(parseApprovalAnswer(raw)).toBe(true);
    },
  );

  it.each(["", "n", "no", "não", "nope", "x", "\n"])(
    "treats %j as rejection",
    (raw) => {
      expect(parseApprovalAnswer(raw)).toBe(false);
    },
  );
});

// ---------------------------------------------------------------------------
// createAutoApproval — the `--yes` / non-interactive short-circuit
// ---------------------------------------------------------------------------

describe("createAutoApproval", () => {
  it("resolves true without any interaction", async () => {
    await expect(createAutoApproval().requestApproval("merge?")).resolves.toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// createReadlineApproval — the no-TTY / --no-tui fallback (injected `ask`)
// ---------------------------------------------------------------------------

describe("createReadlineApproval", () => {
  it("asks the human and approves on an affirmative answer", async () => {
    const ask = vi.fn<(question: string) => Promise<string>>(async () => "y");
    const ui = createReadlineApproval({ ask });

    await expect(ui.requestApproval("merge T-001?")).resolves.toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0]?.[0]).toContain("merge T-001?");
  });

  it("rejects on a negative (or empty) answer", async () => {
    const ui = createReadlineApproval({ ask: async () => "" });
    await expect(ui.requestApproval("merge?")).resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createApprovalController — the Ink transport (OQ2): a pending request the
// ApprovalPrompt renders + answers, satisfying UiPort for the interpreter.
// ---------------------------------------------------------------------------

describe("createApprovalController", () => {
  it("has no pending request until one is requested", () => {
    expect(createApprovalController().pending()).toBeUndefined();
  });

  it("exposes the pending prompt and resolves when answered true", async () => {
    const controller = createApprovalController();
    const decision = controller.requestApproval("Aprovar merge de T-001?");

    const pending = controller.pending();
    expect(pending?.prompt).toBe("Aprovar merge de T-001?");

    controller.answer(true);
    await expect(decision).resolves.toBe(true);
    expect(controller.pending()).toBeUndefined();
  });

  it("resolves false when answered via the request handle", async () => {
    const controller = createApprovalController();
    const decision = controller.requestApproval("merge?");

    controller.pending()?.answer(false);
    await expect(decision).resolves.toBe(false);
  });

  it("returns a stable pending reference between reads (snapshot safe)", () => {
    const controller = createApprovalController();
    void controller.requestApproval("merge?");
    expect(controller.pending()).toBe(controller.pending());
  });

  it("queues concurrent requests FIFO and advances the head on answer", async () => {
    const controller = createApprovalController();
    const first = controller.requestApproval("primeiro");
    const second = controller.requestApproval("segundo");

    expect(controller.pending()?.prompt).toBe("primeiro");

    controller.answer(true);
    await expect(first).resolves.toBe(true);
    expect(controller.pending()?.prompt).toBe("segundo");

    controller.answer(false);
    await expect(second).resolves.toBe(false);
    expect(controller.pending()).toBeUndefined();
  });

  it("notifies subscribers when the pending request appears and clears", () => {
    const controller = createApprovalController();
    const listener = vi.fn();
    controller.subscribe(listener);

    void controller.requestApproval("merge?");
    expect(listener).toHaveBeenCalledTimes(1);

    controller.answer(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("ignores a second answer to an already-settled request", async () => {
    const controller = createApprovalController();
    const decision = controller.requestApproval("merge?");

    controller.answer(true);
    controller.answer(false); // no pending head now — must be a no-op
    await expect(decision).resolves.toBe(true);
  });

  it("stops notifying after unsubscribe", () => {
    const controller = createApprovalController();
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);

    unsubscribe();
    void controller.requestApproval("merge?");
    expect(listener).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// parseApprovalDecision — pure parsing of approval_decision NDJSON commands
// ---------------------------------------------------------------------------

describe("parseApprovalDecision", () => {
  it("parses a valid approval_decision with approved=true", () => {
    const line = JSON.stringify({
      type: "approval_decision",
      requestId: "1",
      approved: true,
    });
    expect(parseApprovalDecision(line)).toEqual({
      requestId: "1",
      approved: true,
    });
  });

  it("parses a valid approval_decision with approved=false", () => {
    const line = JSON.stringify({
      type: "approval_decision",
      requestId: "42",
      approved: false,
    });
    expect(parseApprovalDecision(line)).toEqual({
      requestId: "42",
      approved: false,
    });
  });

  it("returns null for a different type", () => {
    expect(
      parseApprovalDecision(
        JSON.stringify({ type: "approval_requested", requestId: "1" }),
      ),
    ).toBeNull();
  });

  it("returns null when requestId is missing", () => {
    expect(
      parseApprovalDecision(
        JSON.stringify({ type: "approval_decision", approved: true }),
      ),
    ).toBeNull();
  });

  it("returns null when approved is not a boolean", () => {
    expect(
      parseApprovalDecision(
        JSON.stringify({
          type: "approval_decision",
          requestId: "1",
          approved: "yes",
        }),
      ),
    ).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseApprovalDecision("not json at all")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseApprovalDecision("")).toBeNull();
  });

  it("returns null for a JSON primitive", () => {
    expect(parseApprovalDecision("42")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createStdinApproval — the stdin/stdout transport for the Native UI gate
// ---------------------------------------------------------------------------

describe("createStdinApproval", () => {
  function setup() {
    const emit = vi.fn();
    const input = new PassThrough();
    const ui = createStdinApproval({ emit, input });

    function sendDecision(requestId: string, approved: boolean): void {
      input.write(
        JSON.stringify({ type: "approval_decision", requestId, approved }) +
          "\n",
      );
    }

    return { emit, input, ui, sendDecision };
  }

  it("emits approval_requested and resolves when matched decision arrives", async () => {
    const { emit, ui, sendDecision } = setup();
    const decision = ui.requestApproval("Merge T-001?");

    expect(emit).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith({
      type: "approval_requested",
      requestId: "1",
      summary: "Merge T-001?",
    });

    sendDecision("1", true);
    await expect(decision).resolves.toBe(true);
  });

  it("resolves false when the decision rejects", async () => {
    const { ui, sendDecision } = setup();
    const decision = ui.requestApproval("Merge?");

    sendDecision("1", false);
    await expect(decision).resolves.toBe(false);
  });

  it("resolves two concurrent requests FIFO without clobber", async () => {
    const { emit, ui, sendDecision } = setup();
    const first = ui.requestApproval("primeiro");
    const second = ui.requestApproval("segundo");

    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenNthCalledWith(1, {
      type: "approval_requested",
      requestId: "1",
      summary: "primeiro",
    });
    expect(emit).toHaveBeenNthCalledWith(2, {
      type: "approval_requested",
      requestId: "2",
      summary: "segundo",
    });

    // Answer in FIFO order
    sendDecision("1", true);
    sendDecision("2", false);

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(false);
  });

  it("resolves concurrent requests even when decisions arrive out of order", async () => {
    const { ui, sendDecision } = setup();
    const first = ui.requestApproval("primeiro");
    const second = ui.requestApproval("segundo");

    // Answer second before first
    sendDecision("2", false);
    sendDecision("1", true);

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(false);
  });

  it("ignores orphan decisions (no matching pending request)", async () => {
    const { ui, sendDecision } = setup();
    const decision = ui.requestApproval("merge?");

    sendDecision("999", true); // orphan — no matching request
    sendDecision("1", false); // the real one

    await expect(decision).resolves.toBe(false);
  });

  it("ignores malformed lines without affecting pending requests", async () => {
    const { ui, input, sendDecision } = setup();
    const decision = ui.requestApproval("merge?");

    input.write("not json\n");
    input.write(JSON.stringify({ type: "other_command" }) + "\n");
    input.write("{}\n");
    sendDecision("1", true);

    await expect(decision).resolves.toBe(true);
  });

  it("ignores a duplicate decision for an already-resolved request", async () => {
    const { ui, sendDecision } = setup();
    const decision = ui.requestApproval("merge?");

    sendDecision("1", true);
    await expect(decision).resolves.toBe(true);

    // A second decision for the same requestId is silently ignored (orphan now)
    sendDecision("1", false); // no-op — no pending for "1"
  });
});
