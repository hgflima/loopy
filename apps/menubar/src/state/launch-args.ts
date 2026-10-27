/**
 * Launch argv applied by the GUI (C-0020 / E2 + E3).
 *
 * The Rust side parses `Loopy [dir] [--task <id>] [--yes] [--verbose] [--run]`
 * (`src-tauri/src/launch_args.rs`) and hands the result to the webview twice
 * over: *pulled* once on mount (`take_launch_args`) and *pushed* for every
 * second instance (`launch-args` event). This module decides what to do with
 * it — a pure planner (AD-6); `App.tsx` executes the actions, routing any dir
 * switch through the existing dirty guard.
 */

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
  /** The initial argv, once (`null` = launched bare, nothing to apply). */
  take(): Promise<LaunchArgs | null>;
  /** Argv forwarded by later instances; resolves to the unsubscribe fn. */
  subscribe(onArgs: (args: LaunchArgs) => void): Promise<() => void>;
}

/** Only the flags the argv carries — prefill turns them on, never clears. */
export interface LaunchFlagsPatch {
  readonly yes?: true;
  readonly verbose?: true;
  readonly taskId?: string;
}

export type LaunchAction =
  /** Prefill the launch popover. */
  | { readonly kind: "setFlags"; readonly flags: LaunchFlagsPatch }
  /** Open another project — through the dirty guard, never around it. */
  | { readonly kind: "switchDir"; readonly dir: string }
  /** `--run`: start once `dir`'s loopy.yml has loaded, and only if it can start. */
  | { readonly kind: "startAfterLoad"; readonly dir: string }
  /**
   * A Run is active: it is not killed and no second Run is started. The args
   * are held (`deferred`, with `run` dropped) until the Run ends.
   */
  | {
      readonly kind: "warnRunActive";
      readonly dir: string | null;
      readonly runIgnored: boolean;
      readonly deferred: LaunchArgs;
    };

export interface LaunchContext {
  /** The dir the GUI currently shows (the dir input's value). */
  readonly currentDir: string;
  /** A Run is in progress (`runStatus === "running"`). */
  readonly isRunning: boolean;
}

/** Compare dirs modulo surrounding blanks and trailing separators. */
export function normalizeDir(dir: string): string {
  const trimmed = dir.trim();
  const stripped = trimmed.replace(/[\\/]+$/, "");
  return stripped === "" ? trimmed : stripped;
}

function flagsPatch(args: LaunchArgs): LaunchFlagsPatch {
  const task = args.task?.trim();
  return {
    ...(args.yes ? { yes: true as const } : {}),
    ...(args.verbose ? { verbose: true as const } : {}),
    ...(task ? { taskId: task } : {}),
  };
}

/**
 * Plan what to do with a received argv. Order matters: flags first, then the
 * dir switch, then the deferred start (which waits for the switch's load).
 */
export function planLaunchArgs(
  args: LaunchArgs,
  ctx: LaunchContext,
): LaunchAction[] {
  const current = normalizeDir(ctx.currentDir);
  const target =
    args.dir != null && args.dir.trim() !== "" ? normalizeDir(args.dir) : null;
  const switching = target !== null && target !== current;
  const flags = flagsPatch(args);
  const hasFlags = Object.keys(flags).length > 0;

  if (ctx.isRunning) {
    if (!switching && !hasFlags && !args.run) return [];
    return [
      {
        kind: "warnRunActive",
        dir: switching ? target : null,
        runIgnored: args.run,
        deferred: { ...args, run: false },
      },
    ];
  }

  const actions: LaunchAction[] = [];
  if (hasFlags) actions.push({ kind: "setFlags", flags });
  if (switching) actions.push({ kind: "switchDir", dir: target });
  const runDir = target ?? current;
  if (args.run && runDir !== "")
    actions.push({ kind: "startAfterLoad", dir: runDir });
  return actions;
}
