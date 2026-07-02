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
 *    preserving the worktree (`on_conflict: escalate`, Q5).
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
  };
}
