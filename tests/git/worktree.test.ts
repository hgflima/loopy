import { mkdtempSync, realpathSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createGit,
  isParentCleanPorcelain,
  toleratedDirtyEntry,
} from "../../src/git/worktree";

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

// ---------------------------------------------------------------------------
// isParentClean — the ONE tolerated dirty path: the root `loopy.yml` (B2).
//
// The product's natural path (author the config in the GUI, save, hit Start)
// leaves `loopy.yml` in the working tree — untracked when the project had none.
// That single change is tolerated; everything else stays exactly as strict.
// ---------------------------------------------------------------------------

describe("createGit — isParentClean tolerates only the root loopy.yml", () => {
  /** Commit a tracked `loopy.yml` so it can later be *modified*. */
  async function commitConfig(): Promise<void> {
    await writeFile(join(root, "loopy.yml"), "version: 1\n");
    await git(root, ["add", "-A"]);
    await git(root, ["commit", "-m", "add config"]);
  }

  it("(1) is true when only loopy.yml is modified", async () => {
    const g = createGit({ root });
    await commitConfig();
    await writeFile(join(root, "loopy.yml"), "version: 1\n# edited\n");
    expect(await g.isParentClean()).toBe(true);
  });

  it("(2) is true when only loopy.yml is new/untracked", async () => {
    const g = createGit({ root });
    await writeFile(join(root, "loopy.yml"), "version: 1\n");
    expect(await g.isParentClean()).toBe(true);
  });

  it("(3) is false when loopy.yml plus another modified file are dirty", async () => {
    const g = createGit({ root });
    await commitConfig();
    await writeFile(join(root, "loopy.yml"), "version: 1\n# edited\n");
    await writeFile(join(root, "file.txt"), "unstaged edit\n");
    expect(await g.isParentClean()).toBe(false);
  });

  it("(4) is false when loopy.yml plus another untracked file are present", async () => {
    const g = createGit({ root });
    await writeFile(join(root, "loopy.yml"), "version: 1\n");
    await writeFile(join(root, "stray.txt"), "new\n");
    expect(await g.isParentClean()).toBe(false);
  });

  it("(5) is false for ordinary dirt with no loopy.yml involved", async () => {
    const g = createGit({ root });
    await writeFile(join(root, "file.txt"), "unstaged edit\n");
    expect(await g.isParentClean()).toBe(false);
  });

  it("(6) is true for a clean working tree, as before", async () => {
    const g = createGit({ root });
    expect(await g.isParentClean()).toBe(true);
  });

  // --- Ambiguous cases, resolved to the most restrictive reading ------------

  it("is false when the loopy.yml lives in a subdirectory", async () => {
    const g = createGit({ root });
    await mkdir(join(root, "packages", "x"), { recursive: true });
    await writeFile(join(root, "packages", "x", "loopy.yml"), "version: 1\n");
    expect(await g.isParentClean()).toBe(false);
  });

  it("is false when a new loopy.yml is staged", async () => {
    const g = createGit({ root });
    await writeFile(join(root, "loopy.yml"), "version: 1\n");
    await git(root, ["add", "--", "loopy.yml"]);
    expect(await g.isParentClean()).toBe(false);
  });

  it("is false when a modified loopy.yml is staged", async () => {
    const g = createGit({ root });
    await commitConfig();
    await writeFile(join(root, "loopy.yml"), "version: 1\n# edited\n");
    await git(root, ["add", "--", "loopy.yml"]);
    expect(await g.isParentClean()).toBe(false);
  });

  it("is false when loopy.yml is deleted from the working tree", async () => {
    const g = createGit({ root });
    await commitConfig();
    await rm(join(root, "loopy.yml"));
    expect(await g.isParentClean()).toBe(false);
  });

  it("stays true when `.loopy/` is gitignored, and false when it is not", async () => {
    const g = createGit({ root });
    await writeFile(join(root, "loopy.yml"), "version: 1\n");
    await mkdir(join(root, ".loopy"), { recursive: true });
    await writeFile(join(root, ".loopy", "state.json"), "{}\n");
    // The harness repo ignores `.loopy/`: engine state never dirties the parent.
    expect(await g.isParentClean()).toBe(true);

    // Un-ignore it (committing only `.gitignore`, so the two files above stay
    // pending): the state dir is ordinary dirt again and is refused.
    await writeFile(join(root, ".gitignore"), ".worktrees/\n");
    await git(root, ["add", "--", ".gitignore"]);
    await git(root, ["commit", "-m", "stop ignoring .loopy"]);
    expect(await g.isParentClean()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// withToleratedDirtyAside — the flip side of the tolerated-dirty exception.
//
// Tolerating a dirty root `loopy.yml` leaves it in the parent working tree for
// the whole run. When a task's branch writes that same file, git refuses the
// merge *before starting it* — no MERGE_HEAD, so the conflict path is blind to
// it. These tests pin the real git behavior and the repair.
// ---------------------------------------------------------------------------

describe("createGit — withToleratedDirtyAside", () => {
  /** Commit a tracked root `loopy.yml` so it can later be *modified*. */
  async function commitConfig(): Promise<void> {
    await writeFile(join(root, "loopy.yml"), "version: 1\n");
    await git(root, ["add", "-A"]);
    await git(root, ["commit", "-m", "add config"]);
  }

  /** A task branch whose single commit writes the root `loopy.yml`. */
  async function branchWritingConfig(name: string): Promise<void> {
    const path = worktreePath(root, name);
    await g().addWorktree(path, `loopy/${name}`, "main");
    await writeFile(join(path, "loopy.yml"), "version: 1\nsteps: [a]\n");
    await git(path, ["add", "-A"]);
    await git(path, ["commit", "-m", `${name}: edit config`]);
  }

  const g = (): ReturnType<typeof createGit> => createGit({ root });

  it("reproduces the refusal it repairs: a dirty loopy.yml blocks the merge with no MERGE_HEAD", async () => {
    await commitConfig();
    await branchWritingConfig("T-060");
    await writeFile(join(root, "loopy.yml"), "version: 1\n# authored in the GUI\n");

    // The bare merge is refused before it starts...
    const merged = await g().merge("loopy/T-060", { message: "merge" });
    expect(merged.ok).toBe(false);
    // ...and leaves nothing for the conflict path to see.
    expect(merged.conflict).toBe(false);
    expect(await g().isMergeInProgress()).toBe(false);
  });

  it("merges with a modified loopy.yml aside, then restores it byte-for-byte", async () => {
    await commitConfig();
    await branchWritingConfig("T-061");
    const local = "version: 1\n# authored in the GUI\n";
    await writeFile(join(root, "loopy.yml"), local);

    const merged = await g().withToleratedDirtyAside("loopy/T-061", () =>
      g().merge("loopy/T-061", { message: "merge(T-061)" }),
    );

    expect(merged).toEqual({ ok: true, conflict: false });
    // The branch's version is what got committed...
    expect(await git(root, ["show", "HEAD:loopy.yml"])).toBe(
      "version: 1\nsteps: [a]",
    );
    // ...while the user's local edit is back, unchanged, and still only in the
    // working tree — the parent is tolerated-dirty again, exactly as before.
    expect(await readFile(join(root, "loopy.yml"), "utf8")).toBe(local);
    expect(await git(root, ["status", "--porcelain"])).toBe(" M loopy.yml");
    expect(await g().isParentClean()).toBe(true);
  });

  it("merges with an untracked loopy.yml aside, then restores it", async () => {
    // No committed config: the GUI just authored one (`??`).
    await branchWritingConfig("T-062");
    const local = "version: 1\n# authored in the GUI\n";
    await writeFile(join(root, "loopy.yml"), local);

    const merged = await g().withToleratedDirtyAside("loopy/T-062", () =>
      g().merge("loopy/T-062", { message: "merge(T-062)" }),
    );

    expect(merged).toEqual({ ok: true, conflict: false });
    expect(await git(root, ["show", "HEAD:loopy.yml"])).toBe(
      "version: 1\nsteps: [a]",
    );
    expect(await readFile(join(root, "loopy.yml"), "utf8")).toBe(local);
    expect(await git(root, ["status", "--porcelain"])).toBe(" M loopy.yml");
  });

  it("never lets the local edit reach the index (the PR #5 boundary)", async () => {
    await commitConfig();
    await branchWritingConfig("T-063");
    await writeFile(join(root, "loopy.yml"), "version: 1\n# local only\n");

    await g().withToleratedDirtyAside("loopy/T-063", () =>
      g().merge("loopy/T-063", { message: "merge(T-063)" }),
    );
    // A mark-done commit right after must not sweep the user's config in.
    await writeFile(join(root, "todo.md"), "- [x] T-063\n");
    await g().commitPaths([join(root, "todo.md")], "chore(loopy): mark done");

    const names = await git(root, [
      "show",
      "--name-only",
      "--pretty=format:",
      "HEAD",
    ]);
    expect(names.trim()).toBe("todo.md");
    expect(await git(root, ["status", "--porcelain"])).toBe(" M loopy.yml");
  });

  it("does not apply when the branch leaves loopy.yml alone", async () => {
    await commitConfig();
    const path = worktreePath(root, "T-064");
    await g().addWorktree(path, "loopy/T-064", "main");
    await writeFile(join(path, "file.txt"), "task work\n");
    await git(path, ["add", "-A"]);
    await git(path, ["commit", "-m", "unrelated"]);
    await writeFile(join(root, "loopy.yml"), "version: 1\n# local\n");

    let ran = false;
    const out = await g().withToleratedDirtyAside("loopy/T-064", async () => {
      ran = true;
      return "unreachable";
    });

    expect(out).toBeNull();
    expect(ran).toBe(false);
  });

  it("does not apply when the parent is dirty beyond the exception", async () => {
    await commitConfig();
    await branchWritingConfig("T-065");
    await writeFile(join(root, "loopy.yml"), "version: 1\n# local\n");
    await writeFile(join(root, "file.txt"), "unrelated dirt\n");

    let ran = false;
    const out = await g().withToleratedDirtyAside("loopy/T-065", async () => {
      ran = true;
      return "unreachable";
    });

    expect(out).toBeNull();
    expect(ran).toBe(false);
  });

  it("does not apply when the parent is clean", async () => {
    await commitConfig();
    await branchWritingConfig("T-066");

    let ran = false;
    const out = await g().withToleratedDirtyAside("loopy/T-066", async () => {
      ran = true;
      return "unreachable";
    });

    expect(out).toBeNull();
    expect(ran).toBe(false);
  });

  it("restores the local edit even when the body throws", async () => {
    await commitConfig();
    await branchWritingConfig("T-067");
    const local = "version: 1\n# local\n";
    await writeFile(join(root, "loopy.yml"), local);

    await expect(
      g().withToleratedDirtyAside("loopy/T-067", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await readFile(join(root, "loopy.yml"), "utf8")).toBe(local);
    expect(await g().isParentClean()).toBe(true);
  });

  it("surfaces a genuine content conflict instead of hiding it", async () => {
    await commitConfig();
    await branchWritingConfig("T-068");
    // The parent advances with a *conflicting* committed edit to the same file.
    await writeFile(join(root, "loopy.yml"), "version: 1\nsteps: [b]\n");
    await git(root, ["add", "-A"]);
    await git(root, ["commit", "-m", "parent edits config"]);
    // ...and the GUI leaves a local edit on top.
    await writeFile(join(root, "loopy.yml"), "version: 1\nsteps: [b]\n# local\n");

    const merged = await g().withToleratedDirtyAside("loopy/T-068", () =>
      g().merge("loopy/T-068", { message: "merge(T-068)" }),
    );

    // The refusal is gone, so the real conflict can finally be reported
    // (and `merge` aborted it, so the parent is usable for a rebase).
    expect(merged).toEqual({ ok: false, conflict: true });
    expect(await g().isMergeInProgress()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isParentCleanPorcelain — the pure verdict (AD-6)
// ---------------------------------------------------------------------------

describe("isParentCleanPorcelain", () => {
  it("accepts an empty dump", () => {
    expect(isParentCleanPorcelain("")).toBe(true);
    expect(isParentCleanPorcelain("\n")).toBe(true);
  });

  it("accepts exactly the untracked and modified-unstaged root loopy.yml", () => {
    expect(isParentCleanPorcelain("?? loopy.yml")).toBe(true);
    expect(isParentCleanPorcelain(" M loopy.yml")).toBe(true);
    expect(isParentCleanPorcelain(" M loopy.yml\n")).toBe(true);
  });

  it("rejects any staged, renamed or otherwise-coded loopy.yml entry", () => {
    for (const line of [
      "A  loopy.yml",
      "M  loopy.yml",
      "MM loopy.yml",
      "AM loopy.yml",
      " D loopy.yml",
      " T loopy.yml",
      "R  old.yml -> loopy.yml",
    ]) {
      expect(isParentCleanPorcelain(line), line).toBe(false);
    }
  });

  it("rejects a loopy.yml outside the repo root, and lookalike names", () => {
    for (const line of [
      "?? packages/x/loopy.yml",
      "?? sub/loopy.yml",
      "?? loopy.yaml",
      "?? my-loopy.yml",
      "?? loopy.yml.bak",
    ]) {
      expect(isParentCleanPorcelain(line), line).toBe(false);
    }
  });

  it("rejects the tolerated entry as soon as anything else rides along", () => {
    expect(isParentCleanPorcelain("?? loopy.yml\n M file.txt")).toBe(false);
    expect(isParentCleanPorcelain(" M file.txt\n?? loopy.yml")).toBe(false);
  });
});

describe("toleratedDirtyEntry", () => {
  it("names the entry the exception is carrying, with its code", () => {
    expect(toleratedDirtyEntry("?? loopy.yml")).toEqual({
      code: "??",
      path: "loopy.yml",
    });
    expect(toleratedDirtyEntry(" M loopy.yml\n")).toEqual({
      code: " M",
      path: "loopy.yml",
    });
  });

  it("is null for a clean tree — there is nothing to move aside", () => {
    expect(toleratedDirtyEntry("")).toBeNull();
    expect(toleratedDirtyEntry("\n")).toBeNull();
  });

  it("is null whenever the tree is dirty beyond the exception", () => {
    // Not tolerated at all...
    expect(toleratedDirtyEntry(" M file.txt")).toBeNull();
    expect(toleratedDirtyEntry("M  loopy.yml")).toBeNull();
    // ...and not even when the tolerated entry is only part of the story.
    expect(toleratedDirtyEntry("?? loopy.yml\n M file.txt")).toBeNull();
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

describe("createGit — diffNumstat (C-0017 size_*)", () => {
  it("sums added/removed lines and counts files across a task branch", async () => {
    const g = createGit({ root });
    const base = await git(root, ["rev-parse", "HEAD"]);
    const path = worktreePath(root, "T-050");
    await g.addWorktree(path, "loopy/T-050", "main");

    // One modified file (+1/−1) and one brand-new file (+2/−0).
    await writeFile(join(path, "file.txt"), "changed\n");
    await writeFile(join(path, "new.txt"), "one\ntwo\n");
    await git(path, ["add", "-A"]);
    await git(path, ["commit", "-m", "task work"]);

    const churn = await g.diffNumstat(base, "loopy/T-050");

    expect(churn).toEqual({ files: 2, added: 3, removed: 1 });
  });

  it("returns zeroes when the two refs have no diff", async () => {
    const g = createGit({ root });
    const base = await git(root, ["rev-parse", "HEAD"]);

    expect(await g.diffNumstat(base, "HEAD")).toEqual({
      files: 0,
      added: 0,
      removed: 0,
    });
  });

  it("counts a binary file toward files but not the line deltas", async () => {
    const g = createGit({ root });
    const base = await git(root, ["rev-parse", "HEAD"]);
    const path = worktreePath(root, "T-051");
    await g.addWorktree(path, "loopy/T-051", "main");

    // A NUL byte makes git treat the file as binary (numstat "-\t-").
    await writeFile(join(path, "blob.bin"), Buffer.from([0, 1, 2, 0, 255]));
    await git(path, ["add", "-A"]);
    await git(path, ["commit", "-m", "add binary"]);

    const churn = await g.diffNumstat(base, "loopy/T-051");

    expect(churn).toEqual({ files: 1, added: 0, removed: 0 });
  });

  it("returns null for a missing ref (best-effort, never throws)", async () => {
    const g = createGit({ root });
    expect(await g.diffNumstat("does-not-exist", "HEAD")).toBeNull();
  });
});
