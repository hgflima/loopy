import { describe, expect, it, vi } from "vitest";
import {
  createApprovalController,
  createAutoApproval,
  createReadlineApproval,
  parseApprovalAnswer,
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
