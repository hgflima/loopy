/**
 * Renderer selection + wiring for the run's UX (T-017). This is the seam the
 * orchestrator reaches for to (a) obtain the human-gate {@link UiPort} for
 * `approval` steps and (b) push live progress {@link StoreEvent}s. It decides —
 * once, up front — between the live Ink TUI and the append-only line fallback,
 * then hides that choice behind one small {@link Ui} handle so the caller is
 * agnostic to which renderer is active.
 *
 * The decision (Success Criterion #6): mount the TUI **only** when `--no-tui`
 * was not passed (`flags.tui`), stdout is a real TTY, and an Ink `mount` was
 * provided; otherwise degrade to line logs. Keeping Ink behind an injected
 * {@link MountApp} (supplied by the entrypoint from `tui/mount.tsx`) means this
 * module — and its tests — never load React/Ink/JSX: the fallback path and the
 * whole selection matrix are exercised with a fake mount, and the visual tree is
 * validated separately via the store (AD-6).
 *
 * Approval transport follows the same fork (OQ2): `--yes` short-circuits to
 * auto-approve in either mode; otherwise the TUI uses its
 * {@link ApprovalController} (which the `ApprovalPrompt` renders/answers) and the
 * fallback uses a `readline` prompt.
 */
import {
  createApprovalController,
  createAutoApproval,
  createReadlineApproval,
  createStdinApproval,
  type ApprovalController,
} from "./approval";
import { createLineReporter } from "./line-reporter";
import { createStore, type Store, type StoreEvent } from "./store";
import {
  createEventTransport,
  type EventTransport,
} from "./transport";
import type { RunFlags, UiPort } from "../types";

/** Props an Ink mount receives — the live store + the approval controller. */
export interface MountProps {
  /** Observable run state the Ink tree renders (subscribes to). */
  readonly store: Store;
  /** The pending-approval controller the `ApprovalPrompt` renders/answers. */
  readonly approval: ApprovalController;
  /** Output stream for Ink (defaults to `process.stdout` inside the mount). */
  readonly stdout?: NodeJS.WriteStream;
  /** Input stream for Ink's `useInput` (defaults to `process.stdin`). */
  readonly stdin?: NodeJS.ReadStream;
}

/** A mounted Ink app handle. */
export interface MountInstance {
  /** Tear down the Ink render tree. */
  unmount(): void;
}

/**
 * Mounts the Ink `<App>` and returns its instance. Implemented by
 * `tui/mount.tsx` and injected here so this module stays free of React/Ink.
 */
export type MountApp = (props: MountProps) => MountInstance;

/** The unified UX handle the orchestrator drives, regardless of renderer. */
export interface Ui {
  /** Human-gate port for `approval` steps (`ctx.ui`). */
  readonly ui: UiPort;
  /** `true` when the live Ink TUI is mounted; `false` for the line fallback. */
  readonly tui: boolean;
  /** Push one progress event (to the TUI store or the line reporter). */
  dispatch(event: StoreEvent): void;
  /** Tear down the renderer (unmount Ink / flush). Idempotent-safe to call once. */
  stop(): void;
  /**
   * NDJSON transport handle — available only when `--emit-events` is active.
   * Used by `defaultRunLive` to emit `run_started` / `run_finished` control frames.
   */
  readonly transport?: EventTransport;
}

/** Options for {@link startUi}. */
export interface StartUiOptions {
  /** Parsed CLI flags (`tui`, `yes`, …). */
  readonly flags: RunFlags;
  /** Output stream (line fallback + Ink). Defaults to `process.stdout`. */
  readonly stdout?: NodeJS.WriteStream;
  /** Input stream (Ink `useInput` + readline). Defaults to `process.stdin`. */
  readonly stdin?: NodeJS.ReadStream;
  /** Overrides TTY detection (defaults to `stdout.isTTY`). Test seam. */
  readonly isTTY?: boolean;
  /** Ink mount (from `tui/mount.tsx`). Absent → the line fallback is forced. */
  readonly mount?: MountApp;
  /** Test seam: where fallback lines go (defaults to a newline-terminated `stdout.write`). */
  readonly linePrint?: (line: string) => void;
}

/**
 * Build the run's {@link Ui}: pick the renderer, wire the approval transport, and
 * return one handle for progress + approval + teardown.
 *
 * When `--emit-events` is active the dispatch is composed as a **fan-out**: the
 * base handler (store or line-reporter) **and** a NDJSON {@link EventTransport}
 * that serializes every {@link StoreEvent} to `stdout`. Approval switches to
 * {@link createStdinApproval} (stdin NDJSON commands). The transport is exposed
 * on the returned {@link Ui} so `defaultRunLive` can emit `run_started` /
 * `run_finished` control frames.
 */
export function startUi(options: StartUiOptions): Ui {
  const { flags, mount } = options;
  const out = options.stdout ?? process.stdout;
  const inp = options.stdin ?? process.stdin;
  const isTty = options.isTTY ?? Boolean(out.isTTY);

  // When --emit-events, stdout is the NDJSON channel — build the transport.
  const transport: EventTransport | undefined = flags.emitEvents
    ? createEventTransport((line) => { try { out.write(line); } catch { /* best-effort */ } })
    : undefined;

  /** Wrap a base dispatch with a fan-out to the transport (when active). */
  const fanOut = (base: (event: StoreEvent) => void): ((event: StoreEvent) => void) => {
    if (!transport) return base;
    return (event) => { base(event); transport.emit(event); };
  };

  /**
   * Pick the approval port: --emit-events → stdin NDJSON, --yes → auto-approve,
   * otherwise `fallback` (controller for TUI, readline for line mode).
   */
  const pickApproval = (fallback: UiPort): UiPort => {
    if (flags.emitEvents) {
      if (flags.yes) return createAutoApproval();
      return createStdinApproval({
        emit: (ctrl) => {
          transport!.emitControl({
            control: "approval_requested",
            requestId: ctrl.requestId,
            taskId: "",
            stepId: "",
            summary: ctrl.summary,
          });
        },
        input: inp,
      });
    }
    if (flags.yes) return createAutoApproval();
    return fallback;
  };

  if (flags.tui && isTty && mount !== undefined) {
    const store = createStore();
    const controller = createApprovalController();
    const instance = mount({
      store,
      approval: controller,
      stdout: options.stdout,
      stdin: options.stdin,
    });
    return {
      ui: pickApproval(controller),
      tui: true,
      dispatch: fanOut((event) => store.dispatch(event)),
      stop: () => instance.unmount(),
      transport,
    };
  }

  // Fallback (line-reporter). When --emit-events, line logs go to stderr
  // (stdout is reserved for NDJSON).
  const print =
    options.linePrint ?? (
      flags.emitEvents
        ? (line: string) => void process.stderr.write(`${line}\n`)
        : (line: string) => void out.write(`${line}\n`)
    );
  const reporter = createLineReporter({ print, verbose: flags.verbose });
  return {
    ui: pickApproval(createReadlineApproval({ input: options.stdin, output: options.stdout })),
    tui: false,
    dispatch: fanOut((event) => reporter.handle(event)),
    stop: () => {},
    transport,
  };
}
