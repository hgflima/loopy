/**
 * Launch argv applied by the GUI (C-0020 / E2 + E3).
 *
 * The Rust side parses `Loopy [dir] [--task <id>] [--yes] [--verbose] [--run]`
 * (`src-tauri/src/launch_args.rs`) and queues every request — the initial argv
 * and each second instance's. The webview *drains* the queue
 * (`drain_launch_args`) at boot and whenever `launch-args-pending` nudges it:
 * a request never depends on a listener existing (C-0021 / M3). This module
 * decides what to do with it — a pure planner (AD-6); `App.tsx` executes the
 * actions, routing any dir switch through the existing dirty guard.
 */
import type { RunStatus } from "./store-bridge";

/** Serde mirror of the Rust `LaunchArgs` (`Option<String>` arrives as `null`). */
export interface LaunchArgs {
  readonly dir: string | null;
  readonly task: string | null;
  readonly yes: boolean;
  readonly verbose: boolean;
  readonly run: boolean;
}

/** Where launch args come from — Tauri in the app, a fake in tests. */
export interface LaunchArgsSource {
  /** Every request not yet applied, in arrival order (empty = nothing to do). */
  drain(): Promise<LaunchArgs[]>;
  /** Called when new requests were queued; resolves to the unsubscribe fn. */
  subscribe(onPending: () => void): Promise<() => void>;
}

/**
 * Flags to apply to the launch popover; an absent key leaves the field as is.
 * Without `--run` this carries only the flags present (prefill turns them on,
 * never clears). With `--run` it carries all three: the argv about to start a
 * Run is authoritative, so a `--yes` left by an earlier launch can't leak in.
 */
export interface LaunchFlagsPatch {
  readonly yes?: boolean;
  readonly verbose?: boolean;
  readonly taskId?: string;
}

export type LaunchAction =
  /** Prefill the launch popover. */
  | { readonly kind: "setFlags"; readonly flags: LaunchFlagsPatch }
  /** Open another project — through the dirty guard, never around it. */
  | { readonly kind: "switchDir"; readonly dir: string }
  /**
   * `--run` on the project already open: re-read it from disk first, through
   * the same dirty guard — a dirty draft is never auto-saved over a loopy.yml
   * that may have been edited elsewhere (C-0021 / B3).
   */
  | { readonly kind: "reloadDir"; readonly dir: string }
  /** `--run`: start once `dir`'s loopy.yml has loaded, and only if it can start. */
  | { readonly kind: "startAfterLoad"; readonly dir: string }
  /**
   * A Run is active: it is not killed and no second Run is started. The args
   * are held (`deferred`, with `run` dropped) until the Run ends — unless only
   * a `--run` arrived, which leaves nothing to hold.
   */
  | {
      readonly kind: "warnRunActive";
      readonly dir: string | null;
      readonly runIgnored: boolean;
      /** `null` when only a `--run` arrived: nothing is left to apply later. */
      readonly deferred: LaunchArgs | null;
    };

export interface LaunchContext {
  /** The dir the GUI currently shows (the dir input's value). */
  readonly currentDir: string;
  /** A Run is in progress — {@link isRunActive}, `starting` included. */
  readonly isRunning: boolean;
}

/**
 * A Run is active from the click on Iniciar, not from `run_started`: the frame
 * comes seconds later, and a `--run` in that window used to start a second Run
 * — killing the one starting up (C-0021 / B2).
 */
export function isRunActive(status: RunStatus): boolean {
  return status === "starting" || status === "running";
}

/** Compare dirs modulo surrounding blanks and trailing separators. */
export function normalizeDir(dir: string): string {
  const trimmed = dir.trim();
  const stripped = trimmed.replace(/[\\/]+$/, "");
  return stripped === "" ? trimmed : stripped;
}

function flagsPatch(args: LaunchArgs, starts: boolean): LaunchFlagsPatch {
  const task = args.task?.trim();
  if (starts)
    return { yes: args.yes, verbose: args.verbose, taskId: task ?? "" };
  return {
    ...(args.yes ? { yes: true as const } : {}),
    ...(args.verbose ? { verbose: true as const } : {}),
    ...(task ? { taskId: task } : {}),
  };
}

/**
 * Merge argv held during a Run (C-0021 / M2): the same result as applying `a`
 * then `b` in sequence — the later non-null dir and task win, flags only turn
 * on (prefill never clears), and `run` never survives (one Run at a time).
 */
export function coalesceLaunchArgs(a: LaunchArgs, b: LaunchArgs): LaunchArgs {
  return {
    dir: b.dir ?? a.dir,
    task: b.task ?? a.task,
    yes: a.yes || b.yes,
    verbose: a.verbose || b.verbose,
    run: false,
  };
}

/**
 * Requests drained together, as one (C-0021 / M3): coalesced in arrival order,
 * keeping the **last** request's `--run` — at boot no Run is active, and the
 * planner still drops it if one is.
 */
export function combineLaunchArgs(
  list: readonly LaunchArgs[],
): LaunchArgs | null {
  const last = list[list.length - 1];
  if (!last) return null;
  return { ...list.reduce(coalesceLaunchArgs), run: last.run };
}

/**
 * Plan what to do with a received argv. Order matters: flags first, then the
 * dir switch (or, for a `--run` on the same dir, its reload), then the
 * deferred start, which waits for that load.
 */
export function planLaunchArgs(
  args: LaunchArgs,
  ctx: LaunchContext,
): LaunchAction[] {
  const current = normalizeDir(ctx.currentDir);
  const target =
    args.dir != null && args.dir.trim() !== "" ? normalizeDir(args.dir) : null;
  const switching = target !== null && target !== current;
  const runDir = target ?? current;
  const starts = args.run && runDir !== "" && !ctx.isRunning;
  const flags = flagsPatch(args, starts);
  const hasFlags = Object.keys(flags).length > 0;

  if (ctx.isRunning) {
    if (!switching && !hasFlags && !args.run) return [];
    return [
      {
        kind: "warnRunActive",
        dir: switching ? target : null,
        runIgnored: args.run,
        deferred: switching || hasFlags ? { ...args, run: false } : null,
      },
    ];
  }

  const actions: LaunchAction[] = [];
  if (hasFlags) actions.push({ kind: "setFlags", flags });
  if (switching) actions.push({ kind: "switchDir", dir: target });
  else if (starts) actions.push({ kind: "reloadDir", dir: runDir });
  if (starts) actions.push({ kind: "startAfterLoad", dir: runDir });
  return actions;
}
