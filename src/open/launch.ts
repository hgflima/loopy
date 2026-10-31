/**
 * `loopy open` I/O shell (E1/E2): build the GUI argv (pure), find the GUI on
 * the real filesystem (thin wrapper over the pure {@link resolveApp}) and spawn
 * it detached.
 *
 * The spawn never uses a shell (`shell: false`): the project path travels as a
 * single argv element, so spaces or metacharacters in it are inert. On macOS the
 * binary inside `Contents/MacOS/` is launched directly — `open -a` would swallow
 * the argv when an instance is already running.
 *
 * Errors are values at this boundary (AD-5): a spawn failure (ENOENT, EACCES…)
 * comes back as `{ ok: false, error }`, never as a throw.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { resolveApp, type ResolveAppResult } from "./resolve-app";

/** What `loopy open` forwards to the GUI (contract E2). */
export interface OpenRequest {
  /** Absolute project dir; omitted = just open/focus the app. */
  readonly dir?: string;
  readonly task?: string;
  readonly yes: boolean;
  readonly verbose: boolean;
  readonly run: boolean;
}

/**
 * The GUI argv in the E2 contract order:
 * `[dir] [--task <id>] [--yes] [--verbose] [--run]`. Pure.
 */
export function buildGuiArgv(req: OpenRequest): string[] {
  const argv: string[] = [];
  if (req.dir !== undefined) argv.push(req.dir);
  if (req.task !== undefined) argv.push("--task", req.task);
  if (req.yes) argv.push("--yes");
  if (req.verbose) argv.push("--verbose");
  if (req.run) argv.push("--run");
  return argv;
}

export type LaunchResult =
  { readonly ok: true } | { readonly ok: false; readonly error: string };

/** Launches the GUI executable at `path` with `argv` (injectable for tests). */
export type LaunchApp = (
  path: string,
  argv: readonly string[],
) => Promise<LaunchResult>;

/** Finds the GUI executable on this host (injectable for tests). */
export type LocateApp = () => ResolveAppResult;

/**
 * Spawn the GUI detached from this process (it outlives the CLI): own process
 * group, no inherited stdio, no shell, `unref()` so Node does not wait on it.
 * Resolves once the OS confirms the spawn (or reports why it failed).
 */
export const launchDetached: LaunchApp = (path, argv) =>
  new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(path, [...argv], {
        detached: true,
        stdio: "ignore",
        shell: false,
      });
    } catch (err) {
      resolve({ ok: false, error: (err as Error).message });
      return;
    }
    child.once("error", (err) => resolve({ ok: false, error: err.message }));
    child.once("spawn", () => {
      child.unref();
      resolve({ ok: true });
    });
  });

/** Entry names of `dir`, or `[]` when missing/unreadable. */
function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Injected by `apps/menubar/scripts/build-sidecar.mjs` (`bun build --compile
 * --define`); undefined under Node, tsx and tsup.
 */
declare const __LOOPY_BUNDLED__: boolean | undefined;

/**
 * This process is the bundled sidecar, not the npm CLI under Node (F2). Only
 * then is `dirname(process.execPath)` the GUI's install dir; under Node it is
 * Node's `bin` dir, which also holds the npm `loopy` link (C-0021/B1).
 */
export const isBundled =
  typeof __LOOPY_BUNDLED__ !== "undefined" && __LOOPY_BUNDLED__ === true;

/** Canonical path, or the input itself when it can't be resolved. */
function canonical(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * `true` when `p` is the running CLI — its executable or its entry script
 * (`process.argv[1]`, the target of the npm `bin` link). Compared after
 * `realpath`, so links and case variants of the same file match.
 */
function isSelf(p: string): boolean {
  const target = canonical(p);
  return [process.execPath, process.argv[1]]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .some((s) => canonical(s) === target);
}

/**
 * Resolve the GUI against the real host: the running platform and env, the
 * directory of the running executable (only when bundled — F2), `$HOME`, and
 * the real filesystem.
 */
export const locateApp: LocateApp = () =>
  resolveApp({
    platform: process.platform,
    env: process.env,
    selfDir: isBundled ? dirname(process.execPath) : "",
    home: homedir(),
    exists: existsSync,
    list: listDir,
    isSelf,
  });
