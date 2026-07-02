/**
 * First-run git setup (T-018): detect whether a directory is already a git repo
 * and, when it is not, initialize it (init on the parent branch + `.gitignore` +
 * an initial commit that includes the committed harness). Tested against a REAL
 * temporary directory (AD-6: real git, not mocked).
 *
 * `initGitRepo` is the mechanics only — the CLI runs it behind a human approval
 * gate (SPEC "Ask first: git init ... quando o diretório não é repo git").
 */
import { execa } from "execa";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initGitRepo, isGitRepo } from "../../src/git/worktree";

/** Hermetic git env: neutralize global/system config, supply an identity. */
const HERMETIC_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "Loopy Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Loopy Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

async function git(root: string, args: readonly string[]): Promise<string> {
  const res = await execa("git", [...args], { cwd: root, env: HERMETIC_ENV });
  return typeof res.stdout === "string" ? res.stdout : "";
}

describe("isGitRepo", () => {
  let dir: string;
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "loopy-setup-")));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("is false for a fresh, non-repo directory", async () => {
    expect(await isGitRepo(dir, HERMETIC_ENV)).toBe(false);
  });

  it("is true after the directory is initialized", async () => {
    await git(dir, ["init", "-b", "main"]);
    expect(await isGitRepo(dir, HERMETIC_ENV)).toBe(true);
  });
});

describe("initGitRepo", () => {
  let dir: string;
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "loopy-init-")));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("initializes a repo on the given default branch with one initial commit", async () => {
    // A pre-existing harness file must be captured by the initial commit.
    writeFileSync(join(dir, "keep.txt"), "harness\n");

    await initGitRepo({
      root: dir,
      defaultBranch: "main",
      ignore: [".worktrees/", ".loopy/", ".loopy.stop"],
      env: HERMETIC_ENV,
    });

    // It is now a repo, on `main`, with exactly one commit.
    expect(existsSync(join(dir, ".git"))).toBe(true);
    expect(await isGitRepo(dir, HERMETIC_ENV)).toBe(true);
    expect((await git(dir, ["rev-parse", "--abbrev-ref", "HEAD"])).trim()).toBe(
      "main",
    );
    const log = await git(dir, ["log", "--oneline"]);
    expect(log.trim().split("\n")).toHaveLength(1);

    // The harness file was committed and the working tree is clean.
    const tracked = await git(dir, ["ls-files"]);
    expect(tracked).toContain("keep.txt");
    expect(tracked).toContain(".gitignore");
    expect((await git(dir, ["status", "--porcelain"])).trim()).toBe("");
  });

  it("writes a .gitignore containing every requested ignore line", async () => {
    await initGitRepo({
      root: dir,
      defaultBranch: "main",
      ignore: [".worktrees/", ".loopy/", ".loopy.stop"],
      env: HERMETIC_ENV,
    });

    const ignore = readFileSync(join(dir, ".gitignore"), "utf8");
    expect(ignore).toContain(".worktrees/");
    expect(ignore).toContain(".loopy/");
    expect(ignore).toContain(".loopy.stop");
  });

  it("preserves and de-duplicates a pre-existing .gitignore", async () => {
    writeFileSync(join(dir, ".gitignore"), "node_modules/\n.worktrees/\n");

    await initGitRepo({
      root: dir,
      defaultBranch: "main",
      ignore: [".worktrees/", ".loopy/"],
      env: HERMETIC_ENV,
    });

    const ignore = readFileSync(join(dir, ".gitignore"), "utf8");
    // Existing entry kept, not duplicated; the new missing entry appended.
    expect(ignore).toContain("node_modules/");
    expect(ignore.match(/\.worktrees\//g)).toHaveLength(1);
    expect(ignore).toContain(".loopy/");
  });
});
