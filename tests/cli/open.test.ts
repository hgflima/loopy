/**
 * CLI wiring for the `open [dir]` subcommand (C-0020 T-010, D1/E1/E2).
 *
 * `locateApp` and `launchApp` are injected through {@link RunHooks}, so these
 * tests never depend on what is installed on the host and never spawn a real
 * GUI. They cover: registration, `dir` → absolute path, the E2 argv order, the
 * "GUI not found" error, and the regression that `loopy <dir>` still runs the
 * loop (not `open`).
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { run, type RunHooks } from "../../src/index";
import { buildGuiArgv } from "../../src/open";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      out: (t: string) => out.push(t),
      err: (t: string) => err.push(t),
    },
    stdout: () => out.join(""),
    stderr: () => err.join(""),
  };
}

const GUI = "/opt/Loopy/loopy-menubar";

interface Launch {
  readonly path: string;
  readonly argv: readonly string[];
}

/** Hooks with a found GUI that record every launch (no real spawn). */
function launchingHooks(extra: RunHooks = {}): {
  readonly hooks: RunHooks;
  readonly launches: Launch[];
} {
  const launches: Launch[] = [];
  const hooks: RunHooks = {
    locateApp: () => ({ ok: true, path: GUI, source: "default" }),
    launchApp: async (path, argv) => {
      launches.push({ path, argv: [...argv] });
      return { ok: true };
    },
    ...extra,
  };
  return { hooks, launches };
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0))
    rmSync(d, { recursive: true, force: true });
});

function tempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "loopy-open-"));
  tmpDirs.push(root);
  return root;
}

describe("buildGuiArgv (E2 contract)", () => {
  it("emits [dir] [--task <id>] [--yes] [--verbose] [--run] in this order", () => {
    expect(
      buildGuiArgv({
        dir: "/p",
        task: "T-003",
        yes: true,
        verbose: true,
        run: true,
      }),
    ).toEqual(["/p", "--task", "T-003", "--yes", "--verbose", "--run"]);
  });

  it("omits whatever was not asked for", () => {
    expect(buildGuiArgv({ yes: false, verbose: false, run: false })).toEqual(
      [],
    );
    expect(
      buildGuiArgv({ dir: "/p", yes: false, verbose: false, run: true }),
    ).toEqual(["/p", "--run"]);
  });
});

describe("loopy open", () => {
  it("is registered (shows in --help)", async () => {
    const c = capture();
    const code = await run(["--help"], c.io);
    expect(code).toBe(0);
    expect(c.stdout()).toMatch(/\bopen\b/);
  });

  it("resolves a relative dir to an absolute path against the cwd", async () => {
    const root = tempProject();
    const rel = relative(process.cwd(), root);
    const { hooks, launches } = launchingHooks();
    const c = capture();
    const code = await run(["open", rel], c.io, hooks);
    expect(code).toBe(0);
    expect(launches).toEqual([{ path: GUI, argv: [root] }]);
  });

  it("forwards the flags in the contract order regardless of CLI order", async () => {
    const root = tempProject();
    const { hooks, launches } = launchingHooks();
    const c = capture();
    const code = await run(
      ["open", "--run", "--verbose", root, "-y", "--task", "T-003"],
      c.io,
      hooks,
    );
    expect(code).toBe(0);
    expect(launches[0]?.argv).toEqual([
      root,
      "--task",
      "T-003",
      "--yes",
      "--verbose",
      "--run",
    ]);
  });

  it("without dir only opens/focuses the app (no dir in argv)", async () => {
    const { hooks, launches } = launchingHooks();
    const code = await run(["open"], capture().io, hooks);
    expect(code).toBe(0);
    expect(launches).toEqual([{ path: GUI, argv: [] }]);
  });

  it("GUI not found → exit != 0 listing every searched location + install hint", async () => {
    const root = tempProject();
    const launches: Launch[] = [];
    const hooks: RunHooks = {
      locateApp: () => ({
        ok: false,
        searched: [
          "/Applications/Loopy.app/Contents/MacOS/loopy-menubar",
          "/x/Loopy",
        ],
      }),
      launchApp: async (path, argv) => {
        launches.push({ path, argv });
        return { ok: true };
      },
    };
    const c = capture();
    const code = await run(["open", root], c.io, hooks);
    expect(code).not.toBe(0);
    expect(launches).toEqual([]);
    expect(c.stderr()).toContain(
      "/Applications/Loopy.app/Contents/MacOS/loopy-menubar",
    );
    expect(c.stderr()).toContain("/x/Loopy");
    expect(c.stderr()).toContain("instructions_install.txt");
    expect(c.stderr()).toContain("LOOPY_APP");
  });

  it("a spawn failure is an error value → exit != 0", async () => {
    const root = tempProject();
    const { hooks } = launchingHooks({
      launchApp: async () => ({ ok: false, error: "EACCES" }),
    });
    const c = capture();
    const code = await run(["open", root], c.io, hooks);
    expect(code).not.toBe(0);
    expect(c.stderr()).toContain("EACCES");
  });

  it("a missing dir → exit != 0 without launching", async () => {
    const root = tempProject();
    const { hooks, launches } = launchingHooks();
    const c = capture();
    const code = await run(["open", join(root, "nope")], c.io, hooks);
    expect(code).not.toBe(0);
    expect(launches).toEqual([]);
  });
});

describe("regression: loopy <dir> still runs the loop", () => {
  it("a folder named `open` is reached as `loopy ./open` and runs the loop", async () => {
    const root = tempProject();
    const dir = join(root, "open");
    mkdirSync(dir);
    const { hooks, launches } = launchingHooks();
    const c = capture();
    // No loopy.yml there: the loop path fails on config — proving it was the
    // loop (not `open`) that ran.
    const code = await run([dir, "--dry-run"], c.io, hooks);
    expect(code).not.toBe(0);
    expect(launches).toEqual([]);
    expect(c.stderr()).toMatch(/loopy\.yml/);
  });

  it("loopy <fixture> --dry-run plans the pipeline (never launches)", async () => {
    const { hooks, launches } = launchingHooks();
    const c = capture();
    const code = await run(
      ["tests/fixtures/project", "--dry-run", "--no-tui"],
      c.io,
      hooks,
    );
    expect(code).toBe(0);
    expect(launches).toEqual([]);
  });
});
