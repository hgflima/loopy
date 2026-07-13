/**
 * Launch wiring — what the "Iniciar" button actually does (T-014).
 *
 * Two Tauri commands, in order:
 * - `save_launch_config` — persists dir + flags so the next boot pre-fills them.
 *   Best-effort: a write failure must never block a Run.
 * - `start_sidecar` — spawns the motor. Rejects when the binary can't be
 *   resolved or spawned; the caller surfaces that as a start-fail.
 *
 * The argv/config mapping is pure (AD-6) so it is testable without a Tauri
 * runtime — the shape of `flags` is the CLI contract (`--yes`, `--task <id>`,
 * `--verbose`) and `task_id` is snake_case to match the Rust `LaunchConfig`.
 */

import type { LaunchFlags } from "../App";

/** Persisted shape — mirrors the serde field names of Rust's `LaunchConfig`. */
export interface PersistedLaunchConfig {
  readonly dir: string;
  readonly yes: boolean;
  readonly task_id: string;
  readonly verbose: boolean;
}

/** Map UI flags to the sidecar's argv (appended after `--no-tui --emit-events <dir>`). */
export function buildSidecarArgs(flags: LaunchFlags): string[] {
  const args: string[] = [];
  if (flags.yes) args.push("--yes");
  const taskId = flags.taskId.trim();
  if (taskId) args.push("--task", taskId);
  if (flags.verbose) args.push("--verbose");
  return args;
}

export function buildLaunchConfig(dir: string, flags: LaunchFlags): PersistedLaunchConfig {
  return { dir, yes: flags.yes, task_id: flags.taskId.trim(), verbose: flags.verbose };
}

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

/**
 * Persist the launch config (best-effort), then spawn the sidecar.
 * Rejects only when the spawn itself fails.
 */
export async function startSidecar(
  invoke: InvokeFn,
  dir: string,
  flags: LaunchFlags,
): Promise<void> {
  try {
    await invoke("save_launch_config", { config: buildLaunchConfig(dir, flags) });
  } catch {
    // Persisting is a convenience, not a precondition for the Run.
  }
  await invoke("start_sidecar", { dir, flags: buildSidecarArgs(flags) });
}
