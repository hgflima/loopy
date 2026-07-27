/**
 * useInterviewProcess — the bridge between the `loopy interview` process and the
 * Specs Interview flow (C-0018, ADR-0012, T-010).
 *
 * It owns the flow's {@link InterviewState} (T-009's pure `advance` reducer) and
 * connects it to a **second managed process** (T-008's `InterviewState` in Rust,
 * deliberately not the Run's sidecar):
 *
 * - **spawns** `loopy interview <dir> --emit-events …` via
 *   `invoke("start_interview", { dir, args })`;
 * - **listens** to `interview://line|stderr|exit` (T-008), parses each line with
 *   {@link parseTransportLine} from the engine (never reimplemented), translates
 *   the Interview **control frames** into reducer events and dispatches them;
 * - **sends** `question_answer` / `phase_wrap_up` / `interview_cancel` back
 *   through `invoke("send_interview_command", { payload })`.
 *
 * **One Phase = one process (D13).** A process exits when its Phase ends: an
 * `interview://exit` with code 0 *after* `phase_finished` is the normal
 * shutdown; an exit *without* `phase_finished` is a failure. That distinction is
 * classified exactly like `applySidecarExit` does for the Run
 * (`store-bridge.ts`): a `procStatus` ref tracks `idle → running → finished`
 * (start-fail vs death-mid-run), and the reducer's `failed` stage is the
 * user-visible surface.
 *
 * `isTauri()` is **never** captured at module scope — it is called at the point
 * of use (the `Glance.tsx` pattern), so the hook stays mockable in tests.
 *
 * The pure edges (`controlToInterviewEvent`, `interviewEventForFrame`,
 * `advanceProcStatus`, `classifyInterviewExit`, `buildInterviewArgs`) are
 * exported and unit-tested in isolation (AD-6).
 */

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type Dispatch,
} from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  parseTransportLine,
  type ControlFrame,
  type CommandFrame,
  type Phase,
  type ParseResult,
} from "loopy/tui/transport";
import { STDERR_TAIL_CAP } from "../state/store-bridge";
import {
  advance,
  initialInterviewState,
  type InterviewState,
  type InterviewEvent,
} from "./interview-state";

// ---------------------------------------------------------------------------
// Process-level status — mirrors the Run's `runStatus` in store-bridge.ts.
// ---------------------------------------------------------------------------

/**
 * Where the interview **process** is in its single-Phase lifetime:
 * - `"idle"` — spawned, no `phase_started` yet (or never spawned);
 * - `"running"` — a `phase_started` arrived, the Phase is in flight;
 * - `"finished"` — a `phase_finished` arrived, the Phase produced its files.
 *
 * The reducer's {@link InterviewState.stage} is the *user-visible* surface; this
 * is the *process-visible* one, kept in a ref so the once-registered listeners
 * read the current value without re-subscribing.
 */
export type InterviewProcStatus = "idle" | "running" | "finished";

// ---------------------------------------------------------------------------
// start() options → the `loopy interview` phase flags
// ---------------------------------------------------------------------------

/** The knobs a spawn carries — the project dir plus the phase entry flags. */
export interface InterviewStartOptions {
  /** The project dir (the header's single source of truth, D6). */
  readonly dir: string;
  /** Resume into an existing Change; omit for a brand-new Change (D12/D13). */
  readonly change?: string;
  /** The Phase to run. A new-Change flow starts at `spec` (the engine default). */
  readonly phase?: Phase;
  /**
   * The free-text demand from the DESCRIBE stage — seeds the spec phase's turn 1
   * (`/devy:spec <demand>`, `phaseCommand` in the engine). Only the `spec` phase
   * reads it; `refine`/`plan` ignore it (they re-read the written `.md`).
   */
  readonly demand?: string;
  /** The probed agent preset (D16). */
  readonly agent?: string;
  /** The probed model (D18, best-effort). */
  readonly model?: string;
  /** The probed reasoning effort (D18, best-effort). */
  readonly effort?: string;
}

/**
 * Build the phase-flag argv for a spawn. Only the flags — the Rust side prepends
 * `interview <dir> --emit-events` (`build_interview_argv` in
 * `interview_process.rs`), so `dir` travels separately in the invoke payload.
 * Pure (AD-6); the order matches the Rust tests.
 */
export function buildInterviewArgs(opts: InterviewStartOptions): string[] {
  const args: string[] = [];
  if (opts.change) args.push("--change", opts.change);
  if (opts.phase) args.push("--phase", opts.phase);
  if (opts.agent) args.push("--agent", opts.agent);
  if (opts.model) args.push("--model", opts.model);
  if (opts.effort) args.push("--effort", opts.effort);
  // Appended last so the flag order of the other spawns is unchanged. The demand
  // is one argv element (Rust spawns argv directly, no shell — spaces and
  // newlines survive intact); an empty demand yields no flag (engine defaults to
  // a bare `/devy:spec`).
  if (opts.demand) args.push("--demand", opts.demand);
  return args;
}

function questionFromControl(control: Extract<ControlFrame, { control: "question_asked" }>) {
  return {
    questionId: control.questionId,
    phase: control.phase,
    prompt: control.prompt,
    options: control.options,
    otherLabel: control.otherLabel,
    finding: control.finding,
    source: control.source,
  };
}

// ---------------------------------------------------------------------------
// Frame → reducer event translation (pure, AD-6)
// ---------------------------------------------------------------------------

/**
 * Translate one Interview **control frame** into a reducer {@link InterviewEvent},
 * or `null` when the control is not part of the Interview (a Run-direction
 * control — they arrive on the sidecar, never here, but be defensive).
 */
export function controlToInterviewEvent(
  control: ControlFrame,
): InterviewEvent | null {
  switch (control.control) {
    case "phase_started":
      return {
        kind: "phase_started",
        phase: control.phase,
        command: control.command,
        changeDir: control.changeDir,
      };
    case "change_resolved":
      return { kind: "change_resolved", changeDir: control.changeDir };
    case "question_asked":
      return {
        kind: "question_asked",
        question: questionFromControl(control),
      };
    case "agent_activity":
      return { kind: "activity", text: control.text };
    case "agent_stream":
      // C-0019 R7b — the live rich stream. The frame carries a `StreamUpdate`
      // (not a `StreamItem`); the reducer folds it with the SAME
      // `appendStreamItem`/`mergeToolCall` the Run uses (R2).
      return { kind: "agent_stream", update: control.update };
    case "phase_finished":
      return {
        kind: "phase_finished",
        phase: control.phase,
        changeDir: control.changeDir,
        files: control.files,
      };
    case "interview_failed":
      return { kind: "failed", reason: control.reason };
    default:
      // Run-direction controls (run_started / run_finished / approval_requested).
      return null;
  }
}

/**
 * Translate one parsed transport frame into a reducer event, or `null` when the
 * frame carries nothing the flow reacts to. Pure (AD-6).
 *
 * - **control** → {@link controlToInterviewEvent};
 * - **event** → only a `warning` StoreEvent maps here (e.g. two `ask` blocks in
 *   one turn — D25); the rest (`stream_chunk`, `usage_sample`, …) is transcript
 *   and telemetry, out of this reducer's scope;
 * - **command** / malformed → ignored (commands are the GUI→motor direction and
 *   never arrive on this channel).
 */
export function interviewEventForFrame(
  result: ParseResult,
): InterviewEvent | null {
  if (!result.ok) return null;
  switch (result.frame) {
    case "control":
      return controlToInterviewEvent(result.control);
    case "event":
      return result.event.type === "warning"
        ? { kind: "warning", text: result.event.message }
        : null;
    case "command":
      return null;
  }
}

// ---------------------------------------------------------------------------
// Process status & exit classification — one Phase, one process (D13)
// ---------------------------------------------------------------------------

/**
 * Advance the process-level status from one parsed frame — one Phase, one
 * process (D13). A `phase_started` opens the Phase (`running`); a
 * `phase_finished` closes it (`finished`); every other frame leaves the status
 * unchanged. Tracked so {@link classifyInterviewExit} can tell a clean shutdown
 * from a death. Pure (AD-6).
 */
export function advanceProcStatus(
  current: InterviewProcStatus,
  result: ParseResult,
): InterviewProcStatus {
  if (!result.ok || result.frame !== "control") return current;
  if (result.control.control === "phase_started") return "running";
  if (result.control.control === "phase_finished") return "finished";
  return current;
}

/**
 * Classify an interview process exit, mirroring `applySidecarExit` for the Run:
 *
 * - `finished` (a `phase_finished` was seen) → clean, `null`, regardless of the
 *   exit code — the process exits on purpose once its Phase produced files (D13);
 * - `idle` (no `phase_started` yet) → **start-fail**;
 * - `running` (a Phase started but never finished) → **death-mid-run**.
 *
 * Returns a pt-BR failure reason for the two failure cases, `null` for clean.
 * Pure (AD-6).
 */
export function classifyInterviewExit(
  status: InterviewProcStatus,
  exitCode: number,
): string | null {
  if (status === "finished") return null;
  if (status === "idle")
    return `A entrevista encerrou antes de iniciar a fase (código ${exitCode}).`;
  return `A entrevista encerrou antes de concluir a fase (código ${exitCode}).`;
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

/** What the Interview components (T-011/T-012) drive the process through. */
export interface UseInterviewProcess {
  /** The flow state (T-009's reducer output). */
  readonly state: InterviewState;
  /** Rolling tail of process stderr, surfaced alongside a failure. */
  readonly stderrTail: readonly string[];
  /**
   * Dispatch a **local** flow event (`triaged` / `described` / `gate_decision`)
   * that the human drives before/between Phases. Process-driven events are
   * dispatched internally from the frames — callers never dispatch those.
   */
  readonly dispatch: Dispatch<InterviewEvent>;
  /** Spawn `loopy interview` for a Phase (via `start_interview`). */
  start(opts: InterviewStartOptions): Promise<void>;
  /** Answer the pending question — records it and sends `question_answer`. */
  answer(
    questionId: string,
    text: string,
    attachments?: readonly string[],
  ): void;
  /** "Chega, grave o que temos" (D17) — sends `phase_wrap_up`. */
  wrapUp(): void;
  /** Cancel the Interview — sends `interview_cancel`; erases nothing (D25). */
  cancel(): void;
}

export function useInterviewProcess(): UseInterviewProcess {
  const [state, dispatch] = useReducer(advance, null, initialInterviewState);
  const [stderrTail, setStderrTail] = useState<readonly string[]>([]);
  // Process status, kept in a ref so the once-registered exit listener reads the
  // current value without the effect re-subscribing on every phase transition.
  const procStatus = useRef<InterviewProcStatus>("idle");

  // Register the three interview:// listeners once. They drive the reducer for
  // as long as the hook is mounted; a late frame after a terminal stage is a
  // no-op in the reducer (structural sharing, AD-5), so always-on is safe.
  useEffect(() => {
    if (!isTauri()) return; // dev:web / jsdom: no process to listen to

    const unLine = listen<string>("interview://line", (event) => {
      const result = parseTransportLine(event.payload);
      // One Phase = one process (D13): remember when the Phase actually starts
      // and finishes, so the exit handler can tell a clean shutdown from a death.
      procStatus.current = advanceProcStatus(procStatus.current, result);
      const ev = interviewEventForFrame(result);
      if (ev) dispatch(ev);
    });

    const unStderr = listen<string>("interview://stderr", (event) => {
      setStderrTail((prev) => [
        ...prev.slice(-(STDERR_TAIL_CAP - 1)),
        event.payload,
      ]);
    });

    const unExit = listen<number>("interview://exit", (event) => {
      const reason = classifyInterviewExit(procStatus.current, event.payload);
      // Clean exit (Phase finished) leaves the reducer at its gate/saved stage;
      // an abnormal exit surfaces as the visible `failed` stage.
      if (reason) dispatch({ kind: "failed", reason });
    });

    return () => {
      unLine.then((fn) => fn());
      unStderr.then((fn) => fn());
      unExit.then((fn) => fn());
    };
  }, []);

  const send = useCallback((frame: CommandFrame) => {
    if (!isTauri()) return;
    invoke("send_interview_command", {
      payload: JSON.stringify(frame),
    }).catch(() => {});
  }, []);

  const start = useCallback(
    async (opts: InterviewStartOptions): Promise<void> => {
      // A fresh process: reset the process-level tracking. The reducer state is
      // owned by the flow — `described` / `gate_decision` already moved it into
      // the Phase; `phase_started` will confirm it.
      procStatus.current = "idle";
      setStderrTail([]);
      if (!isTauri()) return;
      try {
        await invoke("start_interview", {
          dir: opts.dir,
          args: buildInterviewArgs(opts),
        });
      } catch (e) {
        // The spawn never happened, so no `interview://exit` will arrive to
        // drive the failure. Feed the start-fail path by hand (mirrors
        // main.tsx's handleStartRun) so a failed launch can't look like success.
        const message = e instanceof Error ? e.message : String(e);
        setStderrTail((prev) => [...prev, message]);
        dispatch({
          kind: "failed",
          reason: classifyInterviewExit("idle", -1) ?? message,
        });
      }
    },
    [],
  );

  const answer = useCallback(
    (
      questionId: string,
      text: string,
      attachments?: readonly string[],
    ): void => {
      dispatch({ kind: "answered", questionId, text, attachments });
      // Omit `attachments` when empty — matches the Rust `format_question_answer`
      // and the wire shape the engine expects.
      const frame: CommandFrame =
        attachments && attachments.length > 0
          ? { command: "question_answer", questionId, text, attachments }
          : { command: "question_answer", questionId, text };
      send(frame);
    },
    [send],
  );

  const wrapUp = useCallback((): void => {
    dispatch({ kind: "wrap_up" });
    send({ command: "phase_wrap_up" });
  }, [send]);

  const cancel = useCallback((): void => {
    dispatch({ kind: "cancel" });
    send({ command: "interview_cancel" });
  }, [send]);

  return { state, stderrTail, dispatch, start, answer, wrapUp, cancel };
}
