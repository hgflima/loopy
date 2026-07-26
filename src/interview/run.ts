/**
 * The Interview orchestrator (C-0018 T-005, ADR-0012) — drives **one** phase of
 * an Interview end to end, then exits (D13: one process per phase, so the gate
 * between phases and the crash-and-resume path become the same code).
 *
 * Mechanics only (AD-1 — no loop behaviour, no script): the questions are the
 * harness's `/devy:*`, the engine only imposes the *form* via the {@link
 * fullEnvelope}. One {@link createAgentProcessPool} with **one** Agent; **one**
 * Session in `cwd = <dir>` — there is no worktree here, the Interview writes the
 * working tree directly. Mode is `acceptEdits` (the Interview must write the
 * `.md`; `plan` is read-only — see the `loopy-verdict-vs-plan-mode` memory), then
 * `setModel` → `setEffort`, best-effort, exactly as the `agent` Step does.
 *
 * The turn loop:
 *  - Turn 1: `fullEnvelope` + the devy command + the demand (+ attachments as
 *    ACP prompt blocks). Later turns: {@link reminder} + the human answer.
 *  - After **each** turn, {@link parseAsk}(`session.readText()`) →
 *    {@link decideTurn} decides the control frames + the flow: `change` →
 *    `change_resolved` (falling back to a before/after snapshot of `CHANGES_DIR`
 *    when the Agent never reported one — D10); prose → `agent_activity`;
 *    `ask`/`open` → `question_asked` and **wait** for the answer; `done` →
 *    `phase_finished` + exit 0.
 *  - Commands arrive as NDJSON on stdin (readline, the {@link createStdinApproval}
 *    shape): `question_answer` unblocks the next turn, `phase_wrap_up` sends the
 *    {@link wrapUp} turn and the phase ends at the normal `<loopy-done/>` (D17),
 *    `interview_cancel` ends the phase **without deleting anything** (D25).
 *
 * A failing turn (`stopReason ≠ end_turn`), a spawn failure, or an adapter fault
 * emits `interview_failed` and returns a non-zero exit code — a value at the
 * boundary, never a leaked stack trace (AD-5). **No telemetry, no checkpoint, no
 * git.**
 *
 * {@link decideTurn} is a PURE function (AD-6): the per-turn decision is testable
 * with no ACP at all. {@link runInterview} returns the process exit code so the
 * subcommand (T-006) only has to `process.exit(code)`.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type {
  ContentBlock,
  SessionNotification,
} from "@agentclientprotocol/sdk";

import { openAgent } from "../acp/agent";
import { translateUpdate } from "../acp/client";
import { createAgentProcessPool, type PerAgentOptions } from "../acp/pool";
import { classifyStopReason } from "../acp/session";
import type { LoggerPort, PermissionOnRequest, StopReason } from "../types";
import {
  createEventTransport,
  type CommandFrame,
  type ControlFrame,
  type EventTransport,
  type Phase,
} from "../tui/transport";
import { attachmentBlocks } from "./attachments";
import { fullEnvelope, reminder, wrapUp } from "./envelope";
import { parseAsk, type ParsedTurn } from "./parse-ask";
import { CHANGES_DIR, phaseCommand } from "./phases";

// ---------------------------------------------------------------------------
// Ports (injectable so the orchestrator runs with no subprocess in tests)
// ---------------------------------------------------------------------------

/**
 * The Session surface the Interview drives — a subset of {@link LoopySession}
 * (`../acp/session`). A `LoopySession` from `pool.session()` structurally
 * satisfies it; a test can implement just these seven methods.
 */
export interface InterviewSession {
  setMode(mode: string): Promise<void>;
  setModel(model: string): Promise<void>;
  setEffort(effort: string): Promise<void>;
  /** One text prompt turn; resolves with the ACP stop reason. */
  prompt(text: string): Promise<StopReason>;
  /** One prompt-blocks turn (answer text + attachment `resource_link`s). */
  promptBlocks(blocks: ContentBlock[]): Promise<StopReason>;
  /** The current turn's text buffer. */
  readText(): string;
  /** Cancel the in-flight turn (`session/cancel`). */
  cancel(): Promise<void>;
}

/** A started Session plus its teardown (shuts the process pool down). */
export interface InterviewSessionHandle {
  readonly session: InterviewSession;
  dispose(): Promise<void>;
}

/**
 * Filesystem probes for resolving the Change dir and its files. Injected so the
 * orchestrator never touches disk under test. `CHANGES_DIR` is relative to the
 * target project root; a missing dir is an empty list, never an error (AD-5).
 */
export interface InterviewFs {
  /** Names of the subdirs under `<dir>/.harn/devy/changes` (snapshot). */
  listChanges(dir: string): Promise<readonly string[]>;
  /** File names present in a resolved change dir (for `phase_finished.files`). */
  listFiles(dir: string, changeDir: string): Promise<readonly string[]>;
}

/** Options for {@link runInterview}. The port fields default to the real ones. */
export interface RunInterviewOptions {
  /** Target project root — the Session's cwd (writes the working tree). */
  readonly dir: string;
  /** Which phase this process runs (D13: one process per phase). */
  readonly phase: Phase;
  /** The free-text demand (spec phase turn 1); ignored by refine/plan. */
  readonly demand?: string;
  /** The Change dir for refine/plan; the spec phase resolves it itself (D10). */
  readonly changeDir?: string;
  /** Attachment paths for turn 1 (D9), stored under `.loopy/attachments/`. */
  readonly attachments?: readonly string[];
  /** Agent preset name — the pool key. */
  readonly agent: string;
  /** Agent process argv (for `openAgent`). */
  readonly command: readonly string[];
  /** Best-effort per-Step model (ADR-0008). */
  readonly model?: string;
  /** Best-effort per-Step effort (ADR-0008). */
  readonly effort?: string;
  /** How `session/request_permission` is answered (default `allow`). */
  readonly permissionOnRequest?: PermissionOnRequest;

  // --- Injectable seams (real defaults) ---
  /** Control-frame sink (motor → GUI). Default: NDJSON on stdout. */
  readonly transport?: Pick<EventTransport, "emitControl">;
  /** NDJSON command stream (GUI → motor). Default: `process.stdin`. */
  readonly input?: NodeJS.ReadableStream;
  /** Open the single Session. Default: spawn a one-Agent pool. */
  readonly openSession?: () => Promise<InterviewSessionHandle>;
  /** Change-dir/file probes. Default: `node:fs`. */
  readonly fs?: InterviewFs;
  readonly logger?: LoggerPort;
}

/** The Interview always writes files, so it needs the write-capable mode. */
const ACCEPT_EDITS = "acceptEdits";

// ---------------------------------------------------------------------------
// The pure per-turn decision (AD-6)
// ---------------------------------------------------------------------------

/** What the orchestrator does once a turn's frames are emitted. */
export type TurnFlow =
  | { readonly kind: "await_answer"; readonly questionId: string }
  | { readonly kind: "finish" };

/** The purely-decided outcome of one turn: frames to emit (in order), then flow. */
export interface TurnDecision {
  /** Control frames to emit this turn, in order. */
  readonly frames: readonly ControlFrame[];
  /** What to do after emitting them. */
  readonly flow: TurnFlow;
}

/**
 * Decide, purely, what one Interview turn yields (AD-6).
 *
 * Given the {@link ParsedTurn}, the phase, and the turn index (used to mint a
 * deterministic id for an OPEN question, which carries none of its own),
 * produces the control frames to emit this turn — `change_resolved`,
 * `agent_activity`, `question_asked`, in that order — and the flow action.
 *
 * `phase_started` and `phase_finished` are the orchestrator's: they need the
 * resolved change dir and the file listing, which are I/O, so they are NOT built
 * here. No clock, no fs, no throw.
 */
export function decideTurn(
  parsed: ParsedTurn,
  phase: Phase,
  turnIndex: number,
): TurnDecision {
  const frames: ControlFrame[] = [];

  // The Change dir the Agent reported this turn (D10) — orthogonal to `kind`.
  if (parsed.change !== undefined) {
    frames.push({ control: "change_resolved", changeDir: parsed.change });
  }

  // Prose → agent_activity, EXCEPT for an open question, where the prose IS the
  // prompt (emitting both would duplicate the text on the wire).
  if (parsed.kind !== "open" && parsed.prose !== "") {
    frames.push({ control: "agent_activity", phase, text: parsed.prose });
  }

  switch (parsed.kind) {
    case "ask": {
      // AskQuestion mirrors question_asked minus the motor-injected fields, so
      // forward every field verbatim, renaming its own `id` to `questionId`.
      const { id, ...rest } = parsed.question;
      frames.push({
        control: "question_asked",
        questionId: id,
        phase,
        ...rest,
      });
      return { frames, flow: { kind: "await_answer", questionId: id } };
    }
    case "open": {
      const questionId = `open-${turnIndex}`;
      frames.push({
        control: "question_asked",
        questionId,
        phase,
        prompt: parsed.text,
      });
      return { frames, flow: { kind: "await_answer", questionId } };
    }
    case "done":
      return { frames, flow: { kind: "finish" } };
  }
}

// ---------------------------------------------------------------------------
// stdin commands — readline over NDJSON, the createStdinApproval shape
// ---------------------------------------------------------------------------

/** One resolved stdin command relevant to the loop. */
type InterviewCommand =
  | {
      readonly kind: "answer";
      readonly text: string;
      readonly attachments?: readonly string[];
    }
  | { readonly kind: "wrap_up" }
  | { readonly kind: "cancel" };

/**
 * Parse one NDJSON stdin line into a {@link CommandFrame}. The GUI (the Rust
 * `interview_process.rs`) sends `command`-discriminated objects with no `frame`
 * wrapper — so this keys on `command`, not the transport's `frame`. Malformed or
 * unknown lines return `null`; the caller ignores them (AD-5, never throws).
 */
function parseInterviewCommand(line: string): CommandFrame | null {
  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;
  switch (o["command"]) {
    case "question_answer": {
      if (
        typeof o["questionId"] !== "string" ||
        typeof o["text"] !== "string"
      ) {
        return null;
      }
      const raw = o["attachments"];
      const attachments =
        Array.isArray(raw) && raw.every((a) => typeof a === "string")
          ? (raw as string[])
          : undefined;
      return {
        command: "question_answer",
        questionId: o["questionId"],
        text: o["text"],
        ...(attachments !== undefined ? { attachments } : {}),
      };
    }
    case "phase_wrap_up":
      return { command: "phase_wrap_up" };
    case "interview_cancel":
      return { command: "interview_cancel" };
    default:
      return null;
  }
}

/** The stdin command reader; mirrors {@link createStdinApproval}'s FIFO shape. */
interface CommandReader {
  /** True once an `interview_cancel` has arrived. */
  readonly cancelled: boolean;
  /** Side-effect to run the instant a cancel arrives (e.g. `session.cancel`). */
  onCancel(fn: () => void): void;
  /**
   * Resolve with the next command relevant to `questionId`: the matching
   * `question_answer`, a `phase_wrap_up`, or an `interview_cancel`. A mismatched
   * answer is dropped (orphan). Buffers a wrap-up/answer that arrived before the
   * `take` so no early command is lost.
   */
  take(questionId: string): Promise<InterviewCommand>;
  /** Stop listening. Idempotent. */
  close(): void;
}

/** Build a {@link CommandReader} over an NDJSON `input` stream. */
function createCommandReader(input: NodeJS.ReadableStream): CommandReader {
  const rl = createInterface({ input });

  let cancelled = false;
  let cancelHandler: (() => void) | undefined;
  let pendingWrapUp = false;
  const pendingAnswers = new Map<string, InterviewCommand>();
  let waiter:
    | {
        readonly questionId: string;
        readonly resolve: (c: InterviewCommand) => void;
      }
    | undefined;

  /** Hand `cmd` to the active waiter if it matches, else buffer it. */
  function deliver(cmd: InterviewCommand, answerId?: string): void {
    if (waiter && (cmd.kind !== "answer" || answerId === waiter.questionId)) {
      const resolve = waiter.resolve;
      waiter = undefined;
      resolve(cmd);
      return;
    }
    // No matching waiter — buffer what can still be consumed later. A cancel
    // needs no buffer: the `cancelled` flag makes every future `take` resolve it.
    if (cmd.kind === "wrap_up") pendingWrapUp = true;
    else if (cmd.kind === "answer" && answerId !== undefined) {
      pendingAnswers.set(answerId, cmd);
    }
  }

  rl.on("line", (line) => {
    const frame = parseInterviewCommand(line);
    if (frame === null) return;
    switch (frame.command) {
      case "question_answer":
        deliver(
          {
            kind: "answer",
            text: frame.text,
            ...(frame.attachments !== undefined
              ? { attachments: frame.attachments }
              : {}),
          },
          frame.questionId,
        );
        break;
      case "phase_wrap_up":
        deliver({ kind: "wrap_up" });
        break;
      case "interview_cancel":
        cancelled = true;
        cancelHandler?.();
        deliver({ kind: "cancel" });
        break;
    }
  });

  return {
    get cancelled(): boolean {
      return cancelled;
    },
    onCancel(fn: () => void): void {
      cancelHandler = fn;
    },
    take(questionId: string): Promise<InterviewCommand> {
      if (cancelled) return Promise.resolve({ kind: "cancel" });
      const buffered = pendingAnswers.get(questionId);
      if (buffered !== undefined) {
        pendingAnswers.delete(questionId);
        return Promise.resolve(buffered);
      }
      if (pendingWrapUp) {
        pendingWrapUp = false;
        return Promise.resolve({ kind: "wrap_up" });
      }
      return new Promise<InterviewCommand>((resolve) => {
        waiter = { questionId, resolve };
      });
    },
    close(): void {
      rl.close();
    },
  };
}

// ---------------------------------------------------------------------------
// The orchestrator
// ---------------------------------------------------------------------------

/** The next turn's prompt — plain text, or ACP blocks when carrying attachments. */
type TurnInput =
  { readonly text: string } | { readonly blocks: ContentBlock[] };

/** Send one turn: `promptBlocks` when it carries attachments, else `prompt`. */
function sendTurn(
  session: InterviewSession,
  input: TurnInput,
): Promise<StopReason> {
  return "blocks" in input
    ? session.promptBlocks(input.blocks)
    : session.prompt(input.text);
}

/** Compose a turn's prompt, packing attachments as `resource_link` blocks. */
function composeTurn(text: string, attachments?: readonly string[]): TurnInput {
  if (attachments !== undefined && attachments.length > 0) {
    return {
      blocks: [{ type: "text", text }, ...attachmentBlocks(attachments)],
    };
  }
  return { text };
}

/** A non-`end_turn` stop reason, phrased as a boundary value (AD-5), not thrown. */
function nonEndTurnReason(reason: StopReason): string {
  return `entrevista: o turno terminou com stopReason "${reason}" (esperado "end_turn").`;
}

/**
 * Build the Interview's `onUpdate` (R1, C-0019 T-013) — the **filtered** live
 * stream. Each ACP `SessionUpdate` is translated to a {@link StreamUpdate}
 * ({@link translateUpdate}, T-002) and every one is forwarded as an
 * `agent_stream` control frame **except** `text`: thoughts, tool calls, plan,
 * mode and the `raw` catch-all narrate live, while the prose
 * (`agent_message_chunk` → `text`) is dropped here and arrives once, at end of
 * turn, via `agent_activity` — after {@link parseAsk} has stripped the Envelope.
 *
 * Filtering the raw text is the whole point (R1, the spec's "Never"): the Agent
 * writes `<loopy-ask>{json}</loopy-ask>` **inside** its own message
 * (`envelope.ts`), and `stripBlocks` (`parse-ask.ts`) only removes it at end of
 * turn — streaming the live text would show the question's JSON being typed and
 * deliver the same turn twice. On the Interview channel the `user_message_chunk`
 * (our Envelope coming back — D3) survives as `raw`, behind a closed disclosure;
 * it does not vanish.
 *
 * `translateUpdate` returns `undefined` for `usage_update` (its own path), so
 * that update emits nothing here either, and a turn with no update emits no
 * frame. There is no session map: one Phase, one Agent Process, one Session.
 */
export function createStreamForwarder(
  transport: Pick<EventTransport, "emitControl">,
  phase: Phase,
): (notification: SessionNotification) => void {
  return (notification) => {
    const update = translateUpdate(notification.update);
    if (!isForwardableStreamUpdate(update)) return;
    transport.emitControl({ control: "agent_stream", phase, update });
  };
}

function isForwardableStreamUpdate(
  update: ReturnType<typeof translateUpdate>,
): update is Exclude<ReturnType<typeof translateUpdate>, undefined | { kind: "text" }> {
  return update !== undefined && update.kind !== "text";
}

/**
 * The real Session opener: a one-Agent process pool, one Session at `cwd`. The
 * `onUpdate` is the filtered live stream (R1) — see {@link createStreamForwarder}.
 */
async function defaultOpenSession(
  options: RunInterviewOptions,
  onUpdate: (notification: SessionNotification) => void,
): Promise<InterviewSessionHandle> {
  const agentOptions = new Map<string, PerAgentOptions>([
    [options.agent, { command: options.command }],
  ]);
  const pool = await createAgentProcessPool(
    agentOptions,
    async (_name, opts) =>
      openAgent({
        command: opts.command,
        cwd: options.dir,
        env: opts.env,
        permissions: { on_request: options.permissionOnRequest ?? "allow" },
        onUpdate,
        logger: options.logger,
      }),
    options.logger,
  );
  const session = await pool.session(options.agent, options.dir);
  return {
    session,
    dispose: () => pool.shutdownAll(),
  };
}

/** The real fs probes over `node:fs` — a missing dir is an empty list (AD-5). */
const defaultFs: InterviewFs = {
  async listChanges(dir: string): Promise<readonly string[]> {
    try {
      const entries = await readdir(join(dir, CHANGES_DIR), {
        withFileTypes: true,
      });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  },
  async listFiles(dir: string, changeDir: string): Promise<readonly string[]> {
    try {
      const entries = await readdir(join(dir, changeDir), {
        withFileTypes: true,
      });
      return entries.filter((e) => e.isFile()).map((e) => e.name);
    } catch {
      return [];
    }
  },
};

/**
 * Resolve the Change dir for `phase_finished`: the one the Agent reported (D10),
 * else the seeded dir (refine/plan know it up front), else the before/after
 * snapshot fallback — the first directory that appeared during the phase. When
 * nothing new appeared, degrade to `CHANGES_DIR` (a value, not a throw — AD-5).
 */
async function resolveFinalChangeDir(
  reported: string | undefined,
  fs: InterviewFs,
  dir: string,
  before: ReadonlySet<string>,
): Promise<string> {
  if (reported !== undefined) return reported;
  const after = await fs.listChanges(dir);
  const fresh = after.find((name) => !before.has(name));
  return fresh !== undefined ? `${CHANGES_DIR}/${fresh}` : CHANGES_DIR;
}

/**
 * Run one phase of the Interview to completion and return the process exit code
 * (0 = finished or cancelled; ≠ 0 = failed). See the module docstring.
 */
export async function runInterview(
  options: RunInterviewOptions,
): Promise<number> {
  const { dir, phase } = options;
  const transport =
    options.transport ??
    createEventTransport((line) => {
      process.stdout.write(line);
    });
  const input = options.input ?? process.stdin;
  const fs = options.fs ?? defaultFs;
  const logger = options.logger;
  const openSession =
    options.openSession ??
    (() =>
      defaultOpenSession(options, createStreamForwarder(transport, phase)));

  const commands = createCommandReader(input);
  let handle: InterviewSessionHandle | undefined;

  try {
    // Snapshot the Change folder before anything is written — the D10 fallback
    // when the Agent never reports `<loopy-change>`.
    const changesBefore = new Set(await fs.listChanges(dir));

    // phase_started first — instant feedback (the spike saw ~5 min to the first
    // question). The spec phase omits `changeDir` (it does not exist yet — D10).
    transport.emitControl({
      control: "phase_started",
      phase,
      command: phaseCommand(phase, options.demand),
      ...(options.changeDir !== undefined
        ? { changeDir: options.changeDir }
        : {}),
    });

    handle = await openSession();
    const session = handle.session;
    commands.onCancel(() => {
      void session.cancel().catch(() => {});
    });

    // Mode is fail-closed (a wrong agent throws → caught below); model/effort are
    // best-effort. Order matches the `agent` Step: mode → model → effort.
    await session.setMode(ACCEPT_EDITS);
    if (options.model !== undefined) await session.setModel(options.model);
    if (options.effort !== undefined) await session.setEffort(options.effort);

    // Seed the change dir from options (known for refine/plan); the spec phase
    // fills it in from the Agent's report or the snapshot fallback.
    let resolvedChangeDir = options.changeDir;
    let changeResolvedEmitted = false;

    // Turn 1: the full envelope + the devy command (+ attachments as blocks).
    const command = phaseCommand(phase, options.demand);
    let next: TurnInput = composeTurn(
      `${fullEnvelope(phase, options.changeDir)}\n\n${command}`,
      options.attachments,
    );

    for (let turnIndex = 0; ; turnIndex += 1) {
      const stopReason = await sendTurn(session, next);

      // A cancel may have arrived mid-turn — honour it before anything else (D25).
      if (commands.cancelled) return 0;

      const outcome = classifyStopReason(stopReason);
      if (outcome === "stop_signal") return 0; // cancelled — no phase_finished
      if (outcome === "failure") {
        transport.emitControl({
          control: "interview_failed",
          reason: nonEndTurnReason(stopReason),
        });
        return 1;
      }

      const parsed = parseAsk(session.readText());
      if (parsed.warning !== undefined) {
        logger?.debug(`[interview] ${parsed.warning}`);
      }
      const decision = decideTurn(parsed, phase, turnIndex);

      for (const frame of decision.frames) {
        if (frame.control === "change_resolved") {
          resolvedChangeDir = frame.changeDir;
          if (changeResolvedEmitted) continue; // emit change_resolved only once
          changeResolvedEmitted = true;
        }
        transport.emitControl(frame);
      }

      if (decision.flow.kind === "finish") {
        const changeDir = await resolveFinalChangeDir(
          resolvedChangeDir,
          fs,
          dir,
          changesBefore,
        );
        const files = await fs.listFiles(dir, changeDir);
        transport.emitControl({
          control: "phase_finished",
          phase,
          changeDir,
          files: [...files],
        });
        return 0;
      }

      // await_answer — block until the human answers, wraps up, or cancels.
      const cmd = await commands.take(decision.flow.questionId);
      if (cmd.kind === "cancel") return 0; // no phase_finished (D25)
      next =
        cmd.kind === "wrap_up"
          ? { text: wrapUp() }
          : composeTurn(`${reminder()}\n\n${cmd.text}`, cmd.attachments);
    }
  } catch (err) {
    // AD-5: any genuine fault (spawn, adapter, unexpected) is a boundary value,
    // not a leaked stack trace.
    const reason = err instanceof Error ? err.message : String(err);
    transport.emitControl({ control: "interview_failed", reason });
    return 1;
  } finally {
    commands.close();
    if (handle !== undefined) await handle.dispose().catch(() => {});
  }
}
