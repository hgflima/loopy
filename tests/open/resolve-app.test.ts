import { describe, expect, it } from "vitest";
import { resolveApp, type ResolveAppInput } from "../../src/open";

/** Input with an in-memory filesystem: `files` exist, `dirs` list entries. */
function input(
  platform: NodeJS.Platform,
  opts: {
    env?: Record<string, string | undefined>;
    selfDir?: string;
    home?: string;
    files?: string[];
    dirs?: Record<string, string[]>;
  } = {},
): ResolveAppInput {
  const files = new Set(opts.files ?? []);
  return {
    platform,
    env: opts.env ?? {},
    selfDir: opts.selfDir ?? "",
    home: opts.home ?? (platform === "win32" ? "C:\\Users\\ana" : "/home/ana"),
    exists: (p) => files.has(p),
    list: (d) => opts.dirs?.[d] ?? [],
  };
}

describe("resolveApp — macOS", () => {
  const selfDir = "/Applications/Other.app/Contents/MacOS";

  it("LOOPY_APP wins over sibling and defaults", () => {
    const r = resolveApp(
      input("darwin", {
        env: { LOOPY_APP: "/opt/custom/loopy-menubar" },
        selfDir,
        home: "/Users/ana",
        files: [
          "/opt/custom/loopy-menubar",
          `${selfDir}/loopy-menubar`,
          "/Applications/Loopy.app/Contents/MacOS/loopy-menubar",
        ],
      }),
    );
    expect(r).toEqual({
      ok: true,
      path: "/opt/custom/loopy-menubar",
      source: "env",
    });
  });

  it("LOOPY_APP pointing at a .app resolves to the binary inside", () => {
    const r = resolveApp(
      input("darwin", {
        env: { LOOPY_APP: "/opt/Loopy.app" },
        files: ["/opt/Loopy.app/Contents/MacOS/loopy-menubar"],
      }),
    );
    expect(r).toEqual({
      ok: true,
      path: "/opt/Loopy.app/Contents/MacOS/loopy-menubar",
      source: "env",
    });
  });

  it("sibling of the bundled sidecar beats the defaults", () => {
    const r = resolveApp(
      input("darwin", {
        selfDir,
        home: "/Users/ana",
        files: [
          `${selfDir}/loopy-menubar`,
          "/Applications/Loopy.app/Contents/MacOS/loopy-menubar",
        ],
      }),
    );
    expect(r).toEqual({
      ok: true,
      path: `${selfDir}/loopy-menubar`,
      source: "sibling",
    });
  });

  it("missing LOOPY_APP falls through to /Applications then ~/Applications", () => {
    const sys = resolveApp(
      input("darwin", {
        env: { LOOPY_APP: "/nope/Loopy" },
        home: "/Users/ana",
        files: [
          "/Applications/Loopy.app/Contents/MacOS/loopy-menubar",
          "/Users/ana/Applications/Loopy.app/Contents/MacOS/loopy-menubar",
        ],
      }),
    );
    expect(sys).toEqual({
      ok: true,
      path: "/Applications/Loopy.app/Contents/MacOS/loopy-menubar",
      source: "default",
    });

    const user = resolveApp(
      input("darwin", {
        env: { LOOPY_APP: "/nope/Loopy" },
        home: "/Users/ana",
        files: [
          "/Users/ana/Applications/Loopy.app/Contents/MacOS/loopy-menubar",
        ],
      }),
    );
    expect(user).toEqual({
      ok: true,
      path: "/Users/ana/Applications/Loopy.app/Contents/MacOS/loopy-menubar",
      source: "default",
    });
  });

  it("nothing found lists every candidate in the order tried", () => {
    const r = resolveApp(
      input("darwin", {
        env: { LOOPY_APP: "/nope/Loopy" },
        selfDir,
        home: "/Users/ana",
      }),
    );
    expect(r).toEqual({
      ok: false,
      searched: [
        "/nope/Loopy",
        `${selfDir}/loopy-menubar`,
        "/Applications/Loopy.app/Contents/MacOS/loopy-menubar",
        "/Users/ana/Applications/Loopy.app/Contents/MacOS/loopy-menubar",
      ],
    });
  });
});

describe("resolveApp — Linux", () => {
  const env = { PATH: "/usr/local/bin:/usr/bin" };

  it("LOOPY_APP → sibling → PATH, each falling through when missing", () => {
    const files = ["/opt/loopy/loopy-menubar", "/usr/bin/loopy-menubar"];
    expect(
      resolveApp(
        input("linux", {
          env: { ...env, LOOPY_APP: "/x/Loopy.AppImage" },
          files: ["/x/Loopy.AppImage", ...files],
        }),
      ),
    ).toEqual({ ok: true, path: "/x/Loopy.AppImage", source: "env" });
    expect(
      resolveApp(
        input("linux", {
          env: { ...env, LOOPY_APP: "/gone" },
          selfDir: "/opt/loopy",
          files,
        }),
      ),
    ).toEqual({
      ok: true,
      path: "/opt/loopy/loopy-menubar",
      source: "sibling",
    });
    expect(
      resolveApp(
        input("linux", {
          env: { ...env, LOOPY_APP: "/gone" },
          selfDir: "/elsewhere",
          files,
        }),
      ),
    ).toEqual({ ok: true, path: "/usr/bin/loopy-menubar", source: "default" });
  });

  it("PATH order is respected and `Loopy` is a second name", () => {
    const r = resolveApp(
      input("linux", {
        env,
        files: ["/usr/local/bin/Loopy", "/usr/bin/loopy-menubar"],
      }),
    );
    expect(r).toEqual({
      ok: true,
      path: "/usr/local/bin/Loopy",
      source: "default",
    });
  });

  it("finds an AppImage via the injected list, ~/Applications before ~/.local/bin", () => {
    const r = resolveApp(
      input("linux", {
        env,
        dirs: {
          "/home/ana/Applications": [
            "notes.txt",
            "Loopy_0.6.0_amd64.AppImage",
            "Loopy_0.7.0_amd64.AppImage",
          ],
          "/home/ana/.local/bin": ["Loopy.AppImage"],
        },
        files: [
          "/home/ana/Applications/Loopy_0.6.0_amd64.AppImage",
          "/home/ana/Applications/Loopy_0.7.0_amd64.AppImage",
          "/home/ana/.local/bin/Loopy.AppImage",
        ],
      }),
    );
    expect(r).toEqual({
      ok: true,
      path: "/home/ana/Applications/Loopy_0.7.0_amd64.AppImage",
      source: "default",
    });
  });

  it("falls back to ~/.local/bin AppImage", () => {
    const r = resolveApp(
      input("linux", {
        env,
        dirs: { "/home/ana/.local/bin": ["loopy", "Loopy.AppImage"] },
        files: ["/home/ana/.local/bin/Loopy.AppImage"],
      }),
    );
    expect(r).toEqual({
      ok: true,
      path: "/home/ana/.local/bin/Loopy.AppImage",
      source: "default",
    });
  });

  it("nothing found lists everything, with the AppImage globs as patterns", () => {
    const r = resolveApp(
      input("linux", {
        env: { ...env, LOOPY_APP: "/gone" },
        selfDir: "/opt/loopy",
      }),
    );
    expect(r).toEqual({
      ok: false,
      searched: [
        "/gone",
        "/opt/loopy/loopy-menubar",
        "/opt/loopy/Loopy",
        "/usr/local/bin/loopy-menubar",
        "/usr/local/bin/Loopy",
        "/usr/bin/loopy-menubar",
        "/usr/bin/Loopy",
        "/home/ana/Applications/Loopy*.AppImage",
        "/home/ana/.local/bin/Loopy*.AppImage",
      ],
    });
  });

  it("works without an injected list (globs reported, never matched)", () => {
    const rest: ResolveAppInput = {
      ...input("linux", { env: {} }),
      list: undefined,
    };
    const r = resolveApp({ ...rest, exists: () => false });
    expect(r).toEqual({
      ok: false,
      searched: [
        "/home/ana/Applications/Loopy*.AppImage",
        "/home/ana/.local/bin/Loopy*.AppImage",
      ],
    });
  });
});

describe("resolveApp — Windows", () => {
  const env = {
    LOCALAPPDATA: "C:\\Users\\ana\\AppData\\Local",
    ProgramFiles: "C:\\Program Files",
  };

  it("LOOPY_APP → sibling → defaults with win32 paths", () => {
    const files = [
      "D:\\apps\\Loopy\\loopy-menubar.exe",
      "C:\\Program Files\\Loopy\\loopy-menubar.exe",
    ];
    expect(
      resolveApp(
        input("win32", {
          env: { ...env, LOOPY_APP: "E:\\loopy-menubar.exe" },
          files: ["E:\\loopy-menubar.exe", ...files],
        }),
      ),
    ).toEqual({ ok: true, path: "E:\\loopy-menubar.exe", source: "env" });
    expect(
      resolveApp(
        input("win32", {
          env: { ...env, LOOPY_APP: "E:\\gone.exe" },
          selfDir: "D:\\apps\\Loopy",
          files,
        }),
      ),
    ).toEqual({
      ok: true,
      path: "D:\\apps\\Loopy\\loopy-menubar.exe",
      source: "sibling",
    });
    expect(
      resolveApp(input("win32", { env, selfDir: "D:\\other", files })),
    ).toEqual({
      ok: true,
      path: "C:\\Program Files\\Loopy\\loopy-menubar.exe",
      source: "default",
    });
  });

  it("per-user install under %LOCALAPPDATA%\\Programs beats %ProgramFiles%", () => {
    const r = resolveApp(
      input("win32", {
        env,
        files: [
          "C:\\Users\\ana\\AppData\\Local\\Programs\\Loopy\\loopy-menubar.exe",
          "C:\\Program Files\\Loopy\\loopy-menubar.exe",
        ],
      }),
    );
    expect(r).toEqual({
      ok: true,
      path: "C:\\Users\\ana\\AppData\\Local\\Programs\\Loopy\\loopy-menubar.exe",
      source: "default",
    });
  });

  it("nothing found lists everything in order; LOCALAPPDATA falls back to home", () => {
    const r = resolveApp(input("win32", { env: {}, selfDir: "D:\\bin" }));
    expect(r).toEqual({
      ok: false,
      searched: [
        "D:\\bin\\loopy-menubar.exe",
        "C:\\Users\\ana\\AppData\\Local\\Programs\\Loopy\\loopy-menubar.exe",
        "C:\\Users\\ana\\AppData\\Local\\Loopy\\loopy-menubar.exe",
        "C:\\Program Files\\Loopy\\loopy-menubar.exe",
      ],
    });
  });
});

/**
 * C-0021/B1: on a case-insensitive filesystem (APFS, NTFS) a `Loopy` candidate
 * matched the CLI `loopy` — from the npm `bin` dir, `loopy open . --yes`
 * launched a headless Run that approved its own gates.
 */
describe("resolveApp — never the CLI (B1)", () => {
  /** `exists` that ignores case, like APFS/NTFS. */
  function ci(files: string[]): (p: string) => boolean {
    const lower = new Set(files.map((f) => f.toLowerCase()));
    return (p) => lower.has(p.toLowerCase());
  }

  it("macOS: the npm `loopy` beside node never beats /Applications/Loopy.app", () => {
    const nodeBin = "/Users/ana/.nvm/versions/node/v22.13.0/bin";
    const r = resolveApp({
      ...input("darwin", { selfDir: nodeBin, home: "/Users/ana" }),
      exists: ci([
        `${nodeBin}/loopy`,
        `${nodeBin}/node`,
        "/Applications/Loopy.app/Contents/MacOS/loopy-menubar",
      ]),
    });
    expect(r).toEqual({
      ok: true,
      path: "/Applications/Loopy.app/Contents/MacOS/loopy-menubar",
      source: "default",
    });
  });

  it("macOS: the bundled sidecar `Contents/MacOS/loopy` is never the GUI", () => {
    const macos = "/Applications/Loopy.app/Contents/MacOS";
    const r = resolveApp({
      ...input("darwin", { selfDir: macos, home: "/Users/ana" }),
      exists: ci([`${macos}/loopy`]),
    });
    expect(r.ok).toBe(false);
  });

  it("Windows: `loopy.exe` beside the GUI is never picked", () => {
    const dir = "C:\\Users\\ana\\AppData\\Local\\Loopy";
    const r = resolveApp({
      ...input("win32", { selfDir: dir, env: {} }),
      exists: ci([`${dir}\\loopy.exe`]),
    });
    expect(r.ok).toBe(false);
  });

  it("an explicit LOOPY_APP naming the CLI falls through (any case)", () => {
    const cases = [
      [
        "darwin",
        "/usr/local/bin/LOOPY",
        "/Applications/Loopy.app/Contents/MacOS/loopy-menubar",
      ],
      ["linux", "/usr/bin/loopy", "/usr/bin/loopy-menubar"],
      [
        "win32",
        "C:\\npm\\Loopy.EXE",
        "C:\\Program Files\\Loopy\\loopy-menubar.exe",
      ],
    ] as const;
    for (const [platform, cli, gui] of cases) {
      const r = resolveApp(
        input(platform, {
          env: {
            LOOPY_APP: cli,
            PATH: "/usr/bin",
            ProgramFiles: "C:\\Program Files",
          },
          home: "/Users/ana",
          files: [cli, gui],
        }),
      );
      expect(r).toEqual({ ok: true, path: gui, source: "default" });
    }
  });

  it("Linux keeps `Loopy` as a GUI name (case-sensitive), never `loopy`", () => {
    const r = resolveApp(
      input("linux", {
        env: { PATH: "/usr/bin" },
        files: ["/usr/bin/loopy", "/usr/bin/Loopy"],
      }),
    );
    expect(r).toEqual({ ok: true, path: "/usr/bin/Loopy", source: "default" });
  });

  it("a candidate `isSelf` recognises is skipped", () => {
    const r = resolveApp({
      ...input("linux", {
        env: { PATH: "/a:/b" },
        files: ["/a/loopy-menubar", "/b/loopy-menubar"],
      }),
      isSelf: (p) => p === "/a/loopy-menubar",
    });
    expect(r).toEqual({
      ok: true,
      path: "/b/loopy-menubar",
      source: "default",
    });
  });
});

describe("resolveApp — purity", () => {
  it("never touches the filesystem: only the injected exists/list are called", () => {
    const probed: string[] = [];
    resolveApp({
      platform: "linux",
      env: { PATH: "/bin" },
      selfDir: "/s",
      home: "/h",
      exists: (p) => (probed.push(p), false),
      list: () => [],
    });
    // Patterns are never probed with exists.
    expect(probed).toEqual([
      "/s/loopy-menubar",
      "/s/Loopy",
      "/bin/loopy-menubar",
      "/bin/Loopy",
    ]);
  });
});
