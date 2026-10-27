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
        env: { LOOPY_APP: "/opt/custom/Loopy" },
        selfDir,
        home: "/Users/ana",
        files: [
          "/opt/custom/Loopy",
          `${selfDir}/loopy-menubar`,
          "/Applications/Loopy.app/Contents/MacOS/loopy-menubar",
        ],
      }),
    );
    expect(r).toEqual({ ok: true, path: "/opt/custom/Loopy", source: "env" });
  });

  it("LOOPY_APP pointing at a .app resolves to the binary inside", () => {
    const r = resolveApp(
      input("darwin", {
        env: { LOOPY_APP: "/opt/Loopy.app" },
        files: ["/opt/Loopy.app/Contents/MacOS/Loopy"],
      }),
    );
    expect(r).toEqual({
      ok: true,
      path: "/opt/Loopy.app/Contents/MacOS/Loopy",
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
        files: ["/Users/ana/Applications/Loopy.app/Contents/MacOS/Loopy"],
      }),
    );
    expect(user).toEqual({
      ok: true,
      path: "/Users/ana/Applications/Loopy.app/Contents/MacOS/Loopy",
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
        `${selfDir}/Loopy`,
        "/Applications/Loopy.app/Contents/MacOS/loopy-menubar",
        "/Applications/Loopy.app/Contents/MacOS/Loopy",
        "/Users/ana/Applications/Loopy.app/Contents/MacOS/loopy-menubar",
        "/Users/ana/Applications/Loopy.app/Contents/MacOS/Loopy",
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
      "D:\\apps\\Loopy\\Loopy.exe",
      "C:\\Program Files\\Loopy\\Loopy.exe",
    ];
    expect(
      resolveApp(
        input("win32", {
          env: { ...env, LOOPY_APP: "E:\\Loopy.exe" },
          files: ["E:\\Loopy.exe", ...files],
        }),
      ),
    ).toEqual({ ok: true, path: "E:\\Loopy.exe", source: "env" });
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
      path: "D:\\apps\\Loopy\\Loopy.exe",
      source: "sibling",
    });
    expect(
      resolveApp(input("win32", { env, selfDir: "D:\\other", files })),
    ).toEqual({
      ok: true,
      path: "C:\\Program Files\\Loopy\\Loopy.exe",
      source: "default",
    });
  });

  it("per-user install under %LOCALAPPDATA%\\Programs beats %ProgramFiles%", () => {
    const r = resolveApp(
      input("win32", {
        env,
        files: [
          "C:\\Users\\ana\\AppData\\Local\\Programs\\Loopy\\Loopy.exe",
          "C:\\Program Files\\Loopy\\Loopy.exe",
        ],
      }),
    );
    expect(r).toEqual({
      ok: true,
      path: "C:\\Users\\ana\\AppData\\Local\\Programs\\Loopy\\Loopy.exe",
      source: "default",
    });
  });

  it("nothing found lists everything in order; LOCALAPPDATA falls back to home", () => {
    const r = resolveApp(input("win32", { env: {}, selfDir: "D:\\bin" }));
    expect(r).toEqual({
      ok: false,
      searched: [
        "D:\\bin\\loopy-menubar.exe",
        "D:\\bin\\Loopy.exe",
        "C:\\Users\\ana\\AppData\\Local\\Programs\\Loopy\\loopy-menubar.exe",
        "C:\\Users\\ana\\AppData\\Local\\Programs\\Loopy\\Loopy.exe",
        "C:\\Users\\ana\\AppData\\Local\\Loopy\\loopy-menubar.exe",
        "C:\\Users\\ana\\AppData\\Local\\Loopy\\Loopy.exe",
        "C:\\Program Files\\Loopy\\loopy-menubar.exe",
        "C:\\Program Files\\Loopy\\Loopy.exe",
      ],
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
