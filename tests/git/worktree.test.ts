import { mkdtempSync, realpathSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGit } from "../../src/git/worktree";

// ---------------------------------------------------------------------------
// Real-repo harness (AD-6: git is exercised against a temporary repo, not
// mocked). Each test gets a fresh repo on `main` with one commit and a
// committed `.gitignore` that hides `.worktrees/` so the parent stays clean
// after a worktree is created under it.
// ---------------------------------------------------------------------------

/** Run a git command in `cwd`, isolated from the developer's global config. */
async function git(cwd: string, args: readonly string[]): Promise<string> {
  const res = await execa("git", args, {
    cwd,
    env: { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
    stripFinalNewline: true,
  });
  return res.stdout;
}

/** Absolute path of a worktree under the repo's `.worktrees/` dir. */
function worktreePath(root: string, name: string): string {
  return join(root, ".worktrees", name);
}

let root: string;

beforeEach(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "loopy-git-")));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.email", "test@example.com"]);
  await git(root, ["config", "user.name", "Loopy Test"]);
  await git(root, ["config", "commit.gpgsign", "false"]);
  await writeFile(join(root, ".gitignore"), ".worktrees/\n.loopy/\n");
  await writeFile(join(root, "file.txt"), "base\n");
  await git(root, ["add", "-A"]);
  await git(root, ["commit", "-m", "init"]);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** True when `path` exists on disk. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** True when a branch ref exists in the repo. */
async function branchExists(cwd: string, branch: string): Promise<boolean> {
  const res = await execa(
    "git",
    ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
    {
      cwd,
      env: { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
      reject: false,
    },
  );
  return res.exitCode === 0;
}

// ---------------------------------------------------------------------------
// addWorktree / removeWorktree / deleteBranch
// ---------------------------------------------------------------------------

describe("createGit — worktree lifecycle", () => {
  it("creates a worktree on a new branch from the parent branch", async () => {
    const g = createGit({ root });
    const path = worktreePath(root, "T-001");

    await g.addWorktree(path, "loopy/T-001", "main");

    expect(await exists(path)).toBe(true);
    // The worktree checks out the new branch at the parent's tip.
    expect(await branchExists(root, "loopy/T-001")).toBe(true);
    expect(await git(path, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
      "loopy/T-001",
    );
    // It carries the parent's committed content.
    expect(await readFile(join(path, "file.txt"), "utf8")).toBe("base\n");
  });

  it("removes a worktree with --force even when it has uncommitted changes", async () => {
    const g = createGit({ root });
    const path = worktreePath(root, "T-002");
    await g.addWorktree(path, "loopy/T-002", "main");
    // Dirty the worktree so a non-forced remove would refuse.
    await writeFile(join(path, "file.txt"), "dirty\n");

    await g.removeWorktree(path, { force: true });

    expect(await exists(path)).toBe(false);
  });

  it("deletes the task branch after its worktree is removed", async () => {
    const g = createGit({ root });
    const path = worktreePath(root, "T-003");
    await g.addWorktree(path, "loopy/T-003", "main");
    await g.removeWorktree(path, { force: true });

    await g.deleteBranch("loopy/T-003");

    expect(await branchExists(root, "loopy/T-003")).toBe(false);
  });

  it("rejects when adding a worktree at an occupied path", async () => {
    const g = createGit({ root });
    const path = worktreePath(root, "T-004");
    await g.addWorktree(path, "loopy/T-004", "main");

    await expect(g.addWorktree(path, "loopy/T-004b", "main")).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// merge — --no-ff success + conflict abort (on_fail: escalate)
// ---------------------------------------------------------------------------

describe("createGit — merge", () => {
  it("merges a non-conflicting branch with --no-ff, creating a merge commit", async () => {
    const g = createGit({ root });
    const path = worktreePath(root, "T-010");
    await g.addWorktree(path, "loopy/T-010", "main");
    // A brand-new file in the worktree — no overlap with the parent.
    await writeFile(join(path, "feature.txt"), "hello\n");
    await git(path, ["add", "-A"]);
    await git(path, ["commit", "-m", "add feature"]);

    const result = await g.merge("loopy/T-010", { message: "merge T-010" });

    expect(result.ok).toBe(true);
    expect(result.conflict).toBe(false);
    // The feature file is now on the parent branch.
    expect(await exists(join(root, "feature.txt"))).toBe(true);
    // --no-ff forces a merge commit (two parents).
    const parents = await git(root, [
      "rev-list",
      "--parents",
      "-n",
      "1",
      "HEAD",
    ]);
    expect(parents.trim().split(/\s+/)).toHaveLength(3);
  });

  it("aborts a conflicting merge cleanly and signals a conflict (worktree preserved)", async () => {
    const g = createGit({ root });
    const path = worktreePath(root, "T-011");
    await g.addWorktree(path, "loopy/T-011", "main");
    // Both sides touch the same line → conflict.
    await writeFile(join(path, "file.txt"), "worktree change\n");
    await git(path, ["add", "-A"]);
    await git(path, ["commit", "-m", "worktree change"]);
    await writeFile(join(root, "file.txt"), "parent change\n");
    await git(root, ["add", "-A"]);
    await git(root, ["commit", "-m", "parent change"]);

    const result = await g.merge("loopy/T-011", { message: "merge T-011" });

    expect(result.ok).toBe(false);
    expect(result.conflict).toBe(true);
    // Abort restored the parent's content — no merge left in progress.
    expect(await readFile(join(root, "file.txt"), "utf8")).toBe(
      "parent change\n",
    );
    expect(await g.isParentClean()).toBe(true);
    // Escalation preserves the worktree for inspection.
    expect(await exists(path)).toBe(true);
  });

  it("reports a non-conflict merge failure without a phantom conflict", async () => {
    const g = createGit({ root });

    const result = await g.merge("does-not-exist");

    expect(result.ok).toBe(false);
    expect(result.conflict).toBe(false);
    // Nothing was left in progress to abort.
    expect(await g.isParentClean()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// rebaseOnto — merge-conflict recovery (T-008)
// ---------------------------------------------------------------------------

describe("createGit — rebaseOnto", () => {
  it("rebases a non-conflicting task branch onto an advanced parent", async () => {
    const g = createGit({ root });
    const path = worktreePath(root, "T-030");
    await g.addWorktree(path, "loopy/T-030", "main");

    // Task edits a new file.
    await writeFile(join(path, "feature.txt"), "task work\n");
    await git(path, ["add", "-A"]);
    await git(path, ["commit", "-m", "task commit"]);

    // Parent advances with a non-overlapping change.
    await writeFile(join(root, "other.txt"), "parent advance\n");
    await git(root, ["add", "-A"]);
    await git(root, ["commit", "-m", "parent advance"]);

    const result = await g.rebaseOnto(path, "main");

    expect(result.ok).toBe(true);
    expect(result.conflict).toBe(false);
    // Task branch now has the parent's advance as ancestor.
    const log = await git(path, ["log", "--oneline"]);
    expect(log).toContain("task commit");
    expect(log).toContain("parent advance");
  });

  it("aborts merge in progress on parent before rebasing", async () => {
    const g = createGit({ root });
    const path = worktreePath(root, "T-031");
    await g.addWorktree(path, "loopy/T-031", "main");

    // Create a conflict scenario: both sides edit file.txt.
    await writeFile(join(path, "file.txt"), "task side\n");
    await git(path, ["add", "-A"]);
    await git(path, ["commit", "-m", "task change"]);
    await writeFile(join(root, "file.txt"), "parent side\n");
    await git(root, ["add", "-A"]);
    await git(root, ["commit", "-m", "parent change"]);

    // Attempt a merge that conflicts (raw git, not Git.merge — which auto-aborts).
    await execa("git", ["merge", "--no-ff", "loopy/T-031", "-m", "will-conflict"], {
      cwd: root,
      reject: false,
    });
    // MERGE_HEAD is present — the parent is mid-conflict.
    expect(await g.isMergeInProgress()).toBe(true);

    // rebaseOnto should abort the merge first, then rebase.
    // Here the rebase will also conflict (same file), so it aborts the rebase too.
    const result = await g.rebaseOnto(path, "main");

    // The merge is no longer in progress.
    expect(await g.isMergeInProgress()).toBe(false);
    // Rebase conflicted (same file), so it signals failure.
    expect(result.ok).toBe(false);
    expect(result.conflict).toBe(true);
    // Parent is clean (merge was aborted).
    expect(await g.isParentClean()).toBe(true);
  });

  it("recovers a conflict via rebase when changes don't overlap", async () => {
    const g = createGit({ root });
    const path = worktreePath(root, "T-032");
    await g.addWorktree(path, "loopy/T-032", "main");

    // Task adds a new file.
    await writeFile(join(path, "feature.txt"), "task work\n");
    await git(path, ["add", "-A"]);
    await git(path, ["commit", "-m", "add feature"]);

    // Parent advances file.txt (no overlap with task).
    await writeFile(join(root, "file.txt"), "parent advanced\n");
    await git(root, ["add", "-A"]);
    await git(root, ["commit", "-m", "parent advance"]);

    const result = await g.rebaseOnto(path, "main");

    expect(result.ok).toBe(true);
    expect(result.conflict).toBe(false);
    // After rebase, the task branch has both changes.
    expect(await readFile(join(path, "feature.txt"), "utf8")).toBe("task work\n");
    expect(await readFile(join(path, "file.txt"), "utf8")).toBe("parent advanced\n");
  });

  it("aborts a conflicting rebase and returns conflict:true", async () => {
    const g = createGit({ root });
    const path = worktreePath(root, "T-033");
    await g.addWorktree(path, "loopy/T-033", "main");

    // Both edit the same file → rebase conflict.
    await writeFile(join(path, "file.txt"), "task version\n");
    await git(path, ["add", "-A"]);
    await git(path, ["commit", "-m", "task edit"]);
    await writeFile(join(root, "file.txt"), "parent version\n");
    await git(root, ["add", "-A"]);
    await git(root, ["commit", "-m", "parent edit"]);

    const result = await g.rebaseOnto(path, "main");

    expect(result.ok).toBe(false);
    expect(result.conflict).toBe(true);
    // Rebase was aborted — task branch still has its original content.
    expect(await readFile(join(path, "file.txt"), "utf8")).toBe("task version\n");
    // Parent is unaffected.
    expect(await readFile(join(root, "file.txt"), "utf8")).toBe("parent version\n");
  });
});

// ---------------------------------------------------------------------------
// isMergeInProgress
// ---------------------------------------------------------------------------

describe("createGit — isMergeInProgress", () => {
  it("returns false on a clean repo", async () => {
    const g = createGit({ root });
    expect(await g.isMergeInProgress()).toBe(false);
  });

  it("returns true when MERGE_HEAD is present", async () => {
    const g = createGit({ root });
    const path = worktreePath(root, "T-040");
    await g.addWorktree(path, "loopy/T-040", "main");

    // Create conflict.
    await writeFile(join(path, "file.txt"), "conflict\n");
    await git(path, ["add", "-A"]);
    await git(path, ["commit", "-m", "conflict"]);
    await writeFile(join(root, "file.txt"), "other\n");
    await git(root, ["add", "-A"]);
    await git(root, ["commit", "-m", "other"]);

    // Raw merge that leaves MERGE_HEAD.
    await execa("git", ["merge", "--no-ff", "loopy/T-040"], {
      cwd: root,
      reject: false,
    });

    expect(await g.isMergeInProgress()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// commitPaths — the engine's mark-done bookkeeping commit
// ---------------------------------------------------------------------------

describe("createGit — commitPaths", () => {
  it("stages only the given paths and commits them with the message", async () => {
    const g = createGit({ root });
    await writeFile(join(root, "file.txt"), "changed\n"); // tracked change
    await writeFile(join(root, "other.txt"), "unrelated\n"); // must NOT be swept in

    await g.commitPaths([join(root, "file.txt")], "chore: mark done");

    // The message landed as the newest commit...
    const subject = await git(root, ["log", "-1", "--pretty=%s"]);
    expect(subject).toBe("chore: mark done");
    // ...containing only file.txt (other.txt stays untracked/uncommitted).
    const names = await git(root, [
      "show",
      "--name-only",
      "--pretty=format:",
      "HEAD",
    ]);
    expect(names.trim()).toBe("file.txt");
    expect(await exists(join(root, "other.txt"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isParentClean — require_clean_parent detection
// ---------------------------------------------------------------------------

describe("createGit — isParentClean (require_clean_parent)", () => {
  it("is true for a freshly-committed parent working tree", async () => {
    const g = createGit({ root });
    expect(await g.isParentClean()).toBe(true);
  });

  it("stays true after a worktree is created under an ignored dir", async () => {
    const g = createGit({ root });
    await g.addWorktree(worktreePath(root, "T-020"), "loopy/T-020", "main");
    expect(await g.isParentClean()).toBe(true);
  });

  it("is false when a tracked file has uncommitted modifications", async () => {
    const g = createGit({ root });
    await writeFile(join(root, "file.txt"), "unstaged edit\n");
    expect(await g.isParentClean()).toBe(false);
  });

  it("is false when there is an untracked (non-ignored) file", async () => {
    const g = createGit({ root });
    await writeFile(join(root, "stray.txt"), "new\n");
    expect(await g.isParentClean()).toBe(false);
  });

  it("is false when there are staged-but-uncommitted changes", async () => {
    const g = createGit({ root });
    await mkdir(join(root, "sub"), { recursive: true });
    await writeFile(join(root, "sub", "b.txt"), "staged\n");
    await git(root, ["add", "-A"]);
    expect(await g.isParentClean()).toBe(false);
  });
});

describe("createGit — revParseHead (C-0017 base_sha)", () => {
  it("returns the parent HEAD sha", async () => {
    const g = createGit({ root });
    const expected = await git(root, ["rev-parse", "HEAD"]);
    expect(await g.revParseHead()).toBe(expected);
  });

  it("returns null in a repo with no commits yet (best-effort)", async () => {
    const empty = realpathSync(mkdtempSync(join(tmpdir(), "loopy-git-empty-")));
    await git(empty, ["init", "-b", "main"]);
    const g = createGit({ root: empty });
    // `rev-parse HEAD` fails with no commits — degrades to null, never throws.
    expect(await g.revParseHead()).toBeNull();
    await rm(empty, { recursive: true, force: true });
  });
});

describe("createGit — remoteOriginUrl (C-0017 repo)", () => {
  it("returns the configured origin url", async () => {
    const g = createGit({ root });
    await git(root, [
      "remote",
      "add",
      "origin",
      "git@github.com:hgflima/acp-agentic-loop.git",
    ]);
    expect(await g.remoteOriginUrl()).toBe(
      "git@github.com:hgflima/acp-agentic-loop.git",
    );
  });

  it("returns null when no origin remote is configured (best-effort)", async () => {
    const g = createGit({ root });
    expect(await g.remoteOriginUrl()).toBeNull();
  });
});
