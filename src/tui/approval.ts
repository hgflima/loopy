/**
 * Approval transports (OQ2) — the concrete {@link UiPort} implementations behind
 * the `approval` step's human gate. The interpreter (`steps/approval.ts`) never
 * imports any of these; it just calls `ctx.ui.requestApproval(prompt)`, so the
 * engine stays agnostic to how the decision is obtained. This module supplies
 * the three transports the SPEC calls for:
 *
 *  - {@link createApprovalController} — the **Ink** transport. A live TUI cannot
 *    block on stdin the way readline does, so approval is modelled as a *pending
 *    request* the {@link ../tui/components/ApprovalPrompt} renders and answers via
 *    `useInput`. It is queue-backed (FIFO) and parallel-safe: a second request
 *    waits behind the first rather than clobbering it.
 *  - {@link createReadlineApproval} — the **no-TTY / `--no-tui`** fallback. Asks
 *    the human one line via `node:readline/promises`. The y/n parsing is a pure,
 *    separately tested function ({@link parseApprovalAnswer}); the readline wiring
 *    is a thin, injectable `ask` seam so the port is testable without a terminal.
 *  - {@link createAutoApproval} — the `--yes` / non-interactive short-circuit
 *    (also honored directly by the interpreter, so this is a belt-and-suspenders
 *    default that never blocks in CI).
 *
 * The controller exposes `pending()` + `subscribe()` shaped for React's
 * `useSyncExternalStore`: `pending()` returns a **stable reference** until the
 * head actually changes, so a re-render never loops.
 */
import { createInterface } from "node:readline/promises";
import type { UiPort } from "../types";

// ---------------------------------------------------------------------------
// y/n parsing (pure) + the readline fallback
// ---------------------------------------------------------------------------

const AFFIRMATIVE = new Set(["y", "yes", "s", "sim"]);

/**
 * Interpret a raw typed answer as approve (`true`) / reject (`false`). Accepts
 * English and pt-BR affirmatives (`y`/`yes`/`s`/`sim`), case- and
 * whitespace-insensitive; anything else (including an empty line) is a rejection,
 * matching the conservative `[y/N]` default.
 */
export function parseApprovalAnswer(raw: string): boolean {
  return AFFIRMATIVE.has(raw.trim().toLowerCase());
}

/** Options for {@link createReadlineApproval}. */
export interface ReadlineApprovalOptions {
  /** Input stream (defaults to `process.stdin`). */
  readonly input?: NodeJS.ReadableStream;
  /** Output stream the question is written to (defaults to `process.stdout`). */
  readonly output?: NodeJS.WritableStream;
  /** Test seam: ask a question and resolve the raw answer. Defaults to readline. */
  readonly ask?: (question: string) => Promise<string>;
}

/** Build the default readline-backed `ask`, opening/closing an interface per call. */
function readlineAsk(
  input: NodeJS.ReadableStream | undefined,
  output: NodeJS.WritableStream | undefined,
): (question: string) => Promise<string> {
  return async (question) => {
    const rl = createInterface({
      input: input ?? process.stdin,
      output: output ?? process.stdout,
    });
    try {
      return await rl.question(question);
    } finally {
      rl.close();
    }
  };
}

/**
 * The readline / no-TTY fallback {@link UiPort}: prompt one line and parse the
 * answer with {@link parseApprovalAnswer}.
 */
export function createReadlineApproval(
  options: ReadlineApprovalOptions = {},
): UiPort {
  const ask = options.ask ?? readlineAsk(options.input, options.output);
  return {
    async requestApproval(prompt) {
      const answer = await ask(`${prompt} [y/N] `);
      return parseApprovalAnswer(answer);
    },
  };
}

/** A {@link UiPort} that auto-approves — the `--yes` / non-interactive default. */
export function createAutoApproval(): UiPort {
  return { requestApproval: async () => true };
}

// ---------------------------------------------------------------------------
// The Ink controller transport
// ---------------------------------------------------------------------------

/** One pending approval the {@link ../tui/components/ApprovalPrompt} renders. */
export interface ApprovalRequest {
  /** The (already interpolated) question shown to the human. */
  readonly prompt: string;
  /** Resolve this request; ignored once the request is settled. */
  answer(approved: boolean): void;
}

/**
 * A {@link UiPort} whose decisions come from the live TUI. It also exposes the
 * head-of-queue request + a subscription so the Ink layer can render and answer
 * it (shaped for `useSyncExternalStore`).
 */
export interface ApprovalController extends UiPort {
  /** The request awaiting an answer, or `undefined`. Stable ref until it changes. */
  pending(): ApprovalRequest | undefined;
  /** Subscribe to head-of-queue changes; returns an idempotent unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Answer the current pending request (no-op when the queue is empty). */
  answer(approved: boolean): void;
}

/** Internal queue entry pairing a {@link ApprovalRequest} with its promise resolver. */
interface Entry {
  readonly request: ApprovalRequest;
  readonly resolve: (approved: boolean) => void;
  settled: boolean;
}

/** Build an {@link ApprovalController} (the Ink transport, OQ2). */
export function createApprovalController(): ApprovalController {
  const queue: Entry[] = [];
  const listeners = new Set<() => void>();

  const notify = (): void => {
    // Copy so a listener that (un)subscribes mid-notify can't disturb the walk.
    for (const listener of [...listeners]) listener();
  };

  const settle = (entry: Entry, approved: boolean): void => {
    if (entry.settled) return;
    entry.settled = true;
    const wasHead = queue[0] === entry;
    const index = queue.indexOf(entry);
    if (index !== -1) queue.splice(index, 1);
    entry.resolve(approved);
    // Only a change at the head alters what the ApprovalPrompt renders.
    if (wasHead) notify();
  };

  return {
    requestApproval(prompt) {
      return new Promise<boolean>((resolve) => {
        const entry: Entry = {
          resolve,
          settled: false,
          request: { prompt, answer: (approved) => settle(entry, approved) },
        };
        const wasEmpty = queue.length === 0;
        queue.push(entry);
        if (wasEmpty) notify();
      });
    },
    pending: () => queue[0]?.request,
    answer(approved) {
      const head = queue[0];
      if (head !== undefined) settle(head, approved);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
