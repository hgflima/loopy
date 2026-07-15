/**
 * Git worktree + merge mechanics — the engine's isolation primitive.
 *
 * `loopy` never edits the `parent_branch` directly: each task runs in its own
 * worktree under `${workspace.worktrees_dir}/<id>` (SPEC "Boundaries"). This
 * module is the concrete implementation behind {@link GitPort} (see
 * `types.ts`), bound to a single workspace `root`. It covers exactly the
 * mechanics the pipeline needs:
 *
 *  - **add / remove worktree** — create a task's isolated checkout on a fresh
 *    branch from the parent; tear it down (`--force`) plus delete the branch on
 *    cleanup.
 *  - **merge (`--no-ff`)** — integrate a task branch into the parent. On a
 *    conflict it aborts cleanly (`git merge --abort`) and reports
 *    `{ ok: false, conflict: true }` so the orchestrator can escalate while
 *    preserving the worktree (`on_fail: escalate`, Q5).
 *  - **isParentClean** — `require_clean_parent`: is the parent working tree
 *    free of uncommitted changes before the next task starts.
 *
 * Design notes:
 *  - **Errors as values only where a failure is a normal outcome (AD-5).**
 *    {@link Git.merge} returns a {@link MergeResult} instead of throwing —
 *    conflicts and rejected merges are expected control flow. The structural
 *    operations ({@link Git.addWorktree}/{@link Git.removeWorktree}/
 *    {@link Git.deleteBranch}) throw on failure: a git error there is a real
 *    fault the orchestrator should surface, not route around.
 *  - **Non-interactive by construction.** A `--no-ff` merge always gets either
 *    an explicit `-m` message or `--no-edit`, so git never blocks on an editor.
 *  - No hardcoded loop behavior (AD-1): this is pure git mechanics; what runs,
 *    when, and how conflicts escalate is decided by `loopy.yml` + the
 *    orchestrator.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execa } from "execa";
import type { GitPort, MergeResult } from "../types";

/** Options for {@link createGit}. */
export interface CreateGitOptions {
  /** Absolute path of the workspace root (the parent repo checkout). */
  readonly root: string;
}

/**
 * {@link GitPort} plus the branch-deletion mechanic the `cleanup` step needs
 * (`git branch -D`). Kept a superset so the orchestrator can depend on the
 * narrow port while cleanup uses the full handle.
 */
export interface Git extends GitPort {
  /** Force-delete a branch (`git branch -D`). Throws if git refuses. */
  deleteBranch(branch: string): Promise<void>;
  /**
   * Stage exactly `paths` and commit them with `message` — the engine's own
   * bookkeeping commit (canonically the mark-done edit to `todo.md`, so the
   * `parent_branch` stays clean for the next task's `require_clean_parent`).
   * Staging only `paths` keeps unrelated changes out of the commit. Throws if
   * git refuses (a real fault, not normal flow — AD-5).
   */
  commitPaths(paths: readonly string[], message: string): Promise<void>;
}

/**
 * Build a {@link Git} bound to `options.root`. Every command runs with `cwd`
 * set to the root, so relative worktree paths (e.g. `.worktrees/T-001`)
 * resolve against the workspace exactly as they appear in `loopy.yml`.
 */
export function createGit(options: CreateGitOptions): Git {
  const { root } = options;

  /** Run git in the root, throwing execa's rich error on non-zero exit. */
  async function run(args: readonly string[]): Promise<string> {
    const res = await execa("git", args, {
      cwd: root,
      stripFinalNewline: true,
    });
    return res.stdout;
  }

  /** Run git in the root without throwing; resolves with the process exit code. */
  async function tryRun(args: readonly string[]): Promise<number> {
    const res = await execa("git", args, { cwd: root, reject: false });
    return typeof res.exitCode === "number" ? res.exitCode : res.failed ? 1 : 0;
  }

  /**
   * Run git in the root without throwing; resolve with the trimmed stdout on a
   * clean exit, or `null` on any failure (non-zero exit, spawn error). The
   * best-effort reader behind the C-0017 telemetry lookups.
   */
  async function tryRunOut(args: readonly string[]): Promise<string | null> {
    const res = await execa("git", args, {
      cwd: root,
      reject: false,
      stripFinalNewline: true,
    });
    return res.exitCode === 0 ? res.stdout.trim() : null;
  }

  /** True when a merge is in progress (MERGE_HEAD present) — i.e. a conflict. */
  async function mergeInProgress(): Promise<boolean> {
    const exitCode = await tryRun([
      "rev-parse",
      "--verify",
      "--quiet",
      "MERGE_HEAD",
    ]);
    return exitCode === 0;
  }

  return {
    async addWorktree(path, branch, parentBranch) {
      // `-b <branch>` creates the task branch at the parent tip in one shot.
      await run(["worktree", "add", "-b", branch, path, parentBranch]);
    },

    async removeWorktree(path, opts) {
      const args = ["worktree", "remove"];
      if (opts?.force) args.push("--force");
      args.push(path);
      await run(args);
    },

    async deleteBranch(branch) {
      await run(["branch", "-D", branch]);
    },

    async commitPaths(paths, message) {
      // `--` guards against a path being read as a revision; staging only these
      // paths keeps the commit scoped to the mark-done edit.
      await run(["add", "--", ...paths]);
      await run(["commit", "-m", message]);
    },

    async merge(branch, opts): Promise<MergeResult> {
      const noFf = opts?.noFf ?? true;
      const args = ["merge"];
      if (noFf) args.push("--no-ff");
      // Guarantee a non-interactive merge: explicit message, else --no-edit.
      if (opts?.message !== undefined) args.push("-m", opts.message);
      else args.push("--no-edit");
      args.push(branch);

      const exitCode = await tryRun(args);
      if (exitCode === 0) return { ok: true, conflict: false };

      // A failed merge with MERGE_HEAD set is a content conflict: abort so the
      // parent is restored and the worktree can be preserved for escalation.
      if (await mergeInProgress()) {
        await tryRun(["merge", "--abort"]);
        return { ok: false, conflict: true };
      }
      // Non-conflict failure (e.g. unknown branch): nothing to abort.
      return { ok: false, conflict: false };
    },

    async isParentClean() {
      // Porcelain is empty exactly when the tree has no staged, unstaged, or
      // untracked (non-ignored) changes. `.worktrees/`/`.loopy/` are gitignored
      // so a live worktree never dirties the parent.
      const out = await run(["status", "--porcelain"]);
      return out.trim() === "";
    },

    async isMergeInProgress() {
      return mergeInProgress();
    },

    async rebaseOnto(worktreePath, parentBranch) {
      // Clean up any in-progress merge on the parent so the tree is usable.
      if (await mergeInProgress()) {
        await tryRun(["merge", "--abort"]);
      }
      // Rebase the task branch (in the worktree) onto the current parent tip.
      const exitCode = await tryRun([
        "-C",
        worktreePath,
        "rebase",
        parentBranch,
      ]);
      if (exitCode === 0) return { ok: true, conflict: false };
      // Conflict or error: abort so the worktree is restored to pre-rebase state.
      await tryRun(["-C", worktreePath, "rebase", "--abort"]);
      return { ok: false, conflict: true };
    },

    async revParseHead() {
      // Best-effort (C-0017 base_sha): null in a repo with no commits yet.
      return tryRunOut(["rev-parse", "HEAD"]);
    },

    async remoteOriginUrl() {
      // Best-effort (C-0017 repo): null when no `origin` remote is configured.
      return tryRunOut(["remote", "get-url", "origin"]);
    },
  };
}

// ---------------------------------------------------------------------------
// First-run setup (T-018) — init a workspace that is not yet a git repo.
//
// These are standalone (not part of {@link Git}, which assumes an existing
// repo): the CLI calls them BEFORE building a `Git`, gated behind a human
// approval (SPEC "Ask first: git init ... quando o diretório não é repo git").
// ---------------------------------------------------------------------------

/**
 * Whether `root` is inside a git working tree. Uses
 * `git rev-parse --is-inside-work-tree` (non-throwing): exit 0 ⇒ a repo,
 * non-zero (or an error) ⇒ not a repo.
 */
export async function isGitRepo(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const res = await execa("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: root,
    env,
    reject: false,
  });
  return res.exitCode === 0 && res.stdout.trim() === "true";
}

/** Options for {@link initGitRepo}. */
export interface InitGitRepoOptions {
  /** Absolute path of the workspace to initialize. */
  readonly root: string;
  /** Branch the repo is initialized on (canonically `workspace.parent_branch`). */
  readonly defaultBranch: string;
  /** Lines to ensure present in `.gitignore` (created or appended, de-duped). */
  readonly ignore: readonly string[];
  /** Initial commit message (defaults to a `chore(loopy)` bookkeeping message). */
  readonly commitMessage?: string;
  /** Process env for git (defaults to `process.env` — uses the user's identity). */
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Ensure `.gitignore` under `root` contains every line in `ignore`, preserving
 * any existing content and never duplicating a line already present. Writes the
 * updated file to disk.
 */
function ensureGitignore(root: string, ignore: readonly string[]): void {
  const path = join(root, ".gitignore");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const present = new Set(
    existing
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== ""),
  );
  const missing = ignore.filter((line) => !present.has(line.trim()));
  if (existing === "" && missing.length === 0) return;

  // Keep existing bytes; append only the missing lines, with a clean newline seam.
  const base =
    existing === "" || existing.endsWith("\n") ? existing : `${existing}\n`;
  const appended = missing.length > 0 ? `${missing.join("\n")}\n` : "";
  writeFileSync(path, `${base}${appended}`, "utf8");
}

/**
 * Initialize `root` as a git repo on `defaultBranch`, write the `.gitignore`,
 * and create the initial commit capturing everything present (the committed
 * harness — `.claude` — included, per SPEC). Mechanics only: what to ignore and
 * which branch come from config (AD-1); the caller owns the approval gate.
 */
export async function initGitRepo(options: InitGitRepoOptions): Promise<void> {
  const { root, defaultBranch, ignore } = options;
  const env = options.env ?? process.env;
  const message = options.commitMessage ?? "chore(loopy): initialize workspace";

  const run = (args: readonly string[]): Promise<unknown> =>
    execa("git", [...args], { cwd: root, env });

  await run(["init", "-b", defaultBranch]);
  ensureGitignore(root, ignore);
  await run(["add", "-A"]);
  await run(["commit", "-m", message]);
}
