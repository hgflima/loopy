/**
 * Resolve the Loopy GUI executable for `loopy open` (E1) — a pure function.
 *
 * All filesystem access is injected (`exists`, optional `list`), so the whole
 * search order can be tested on any host simulating macOS, Linux and Windows
 * (AD-6). Paths are built with `path.posix`/`path.win32` by the *target*
 * platform, never by the host's `node:path` default.
 *
 * Binary names: Tauri v2 does not rename the main binary unless
 * `mainBinaryName` is set, so the installed executable is the crate name
 * `loopy-menubar` (`apps/menubar/src-tauri/Cargo.toml`). `Loopy` (the
 * `productName`) is kept as a second name so a future `mainBinaryName` rename
 * keeps working. `loopy-menubar` is tried first on purpose: on macOS's
 * case-insensitive filesystem `Contents/MacOS/Loopy` would also match the
 * bundled sidecar `Contents/MacOS/loopy` — the CLI itself, not the GUI.
 */
import path from "node:path";

/** Where a candidate came from — surfaced in the "not found" error. */
export type AppSource = "env" | "sibling" | "default";

export interface ResolveAppInput {
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Directory of the running `loopy` executable (the bundled sidecar case). */
  readonly selfDir: string;
  readonly home: string;
  readonly exists: (path: string) => boolean;
  /**
   * Entry names of a directory (empty when missing/unreadable). Needed only for
   * the Linux AppImage globs (`Loopy*.AppImage`); without it those globs are
   * reported in `searched` but never matched.
   */
  readonly list?: (dir: string) => readonly string[];
}

export type ResolveAppResult =
  | { readonly ok: true; readonly path: string; readonly source: AppSource }
  | { readonly ok: false; readonly searched: readonly string[] };

interface Candidate {
  readonly path: string;
  readonly source: AppSource;
  /** A glob placeholder: listed in `searched`, never probed with `exists`. */
  readonly pattern?: true;
}

/** Executable names of the GUI, most likely first (see module doc). */
const UNIX_NAMES = ["loopy-menubar", "Loopy"] as const;
const WIN_NAMES = ["loopy-menubar.exe", "Loopy.exe"] as const;
const APPIMAGE = /^Loopy.*\.AppImage$/i;

function pathFor(platform: NodeJS.Platform): path.PlatformPath {
  return platform === "win32" ? path.win32 : path.posix;
}

function namesFor(platform: NodeJS.Platform): readonly string[] {
  return platform === "win32" ? WIN_NAMES : UNIX_NAMES;
}

/** `X.app` → its `Contents/MacOS/<name>` binaries; anything else → itself. */
function macBinaries(p: string): string[] {
  if (!p.replace(/\/+$/, "").endsWith(".app")) return [p];
  return UNIX_NAMES.map((n) => path.posix.join(p, "Contents", "MacOS", n));
}

/** (1) An explicit `LOOPY_APP` always wins — when it exists. */
function envCandidates(input: ResolveAppInput): Candidate[] {
  const value = input.env.LOOPY_APP?.trim();
  if (!value) return [];
  const paths = input.platform === "darwin" ? macBinaries(value) : [value];
  return paths.map((p) => ({ path: p, source: "env" }));
}

/**
 * (2) The GUI next to the running executable: inside an installed bundle the
 * sidecar `loopy` sits beside the GUI binary (macOS `Contents/MacOS/`, the
 * `.deb`'s `/usr/bin`, the Windows install dir), so this works with no PATH.
 */
function siblingCandidates(input: ResolveAppInput): Candidate[] {
  if (!input.selfDir) return [];
  const p = pathFor(input.platform);
  return namesFor(input.platform).map((n) => ({
    path: p.join(input.selfDir, n),
    source: "sibling",
  }));
}

function globCandidates(input: ResolveAppInput, dir: string): Candidate[] {
  const hits = (input.list?.(dir) ?? [])
    .filter((name) => APPIMAGE.test(name))
    // Deterministic, and newer versioned names (`Loopy_0.7.0…`) first.
    .sort()
    .reverse()
    .map((name): Candidate => ({
      path: path.posix.join(dir, name),
      source: "default",
    }));
  return hits.length > 0
    ? hits
    : [
        {
          path: path.posix.join(dir, "Loopy*.AppImage"),
          source: "default",
          pattern: true,
        },
      ];
}

/** (3) Default install locations per OS. */
function defaultCandidates(input: ResolveAppInput): Candidate[] {
  const { platform, env, home } = input;
  const mk = (p: string): Candidate => ({ path: p, source: "default" });

  if (platform === "darwin") {
    return [
      "/Applications/Loopy.app",
      path.posix.join(home, "Applications", "Loopy.app"),
    ]
      .flatMap(macBinaries)
      .map(mk);
  }

  if (platform === "win32") {
    const w = path.win32;
    const localAppData = env.LOCALAPPDATA || w.join(home, "AppData", "Local");
    const programFiles =
      env.ProgramFiles || env.PROGRAMFILES || "C:\\Program Files";
    const dirs = [
      w.join(localAppData, "Programs", "Loopy"),
      // Tauri's NSIS per-user installer default.
      w.join(localAppData, "Loopy"),
      w.join(programFiles, "Loopy"),
    ];
    return dirs.flatMap((d) => WIN_NAMES.map((n) => mk(w.join(d, n))));
  }

  // Linux (and other POSIX): the `.deb` binary on PATH, then AppImages.
  const pathDirs = (env.PATH ?? "").split(":").filter((d) => d.length > 0);
  return [
    ...pathDirs.flatMap((d) =>
      UNIX_NAMES.map((n) => mk(path.posix.join(d, n))),
    ),
    ...globCandidates(input, path.posix.join(home, "Applications")),
    ...globCandidates(input, path.posix.join(home, ".local", "bin")),
  ];
}

/**
 * Find the Loopy GUI executable (E1). Order matters: an explicit LOOPY_APP
 * always wins; the sibling check makes `loopy open` work from inside an
 * installed bundle with no PATH setup; defaults cover a normal install.
 * A missing candidate (including a stale LOOPY_APP) falls through to the next.
 */
export function resolveApp(input: ResolveAppInput): ResolveAppResult {
  const candidates = [
    ...envCandidates(input),
    ...siblingCandidates(input),
    ...defaultCandidates(input),
  ];
  const hit = candidates.find((c) => !c.pattern && input.exists(c.path));
  return hit
    ? { ok: true, path: hit.path, source: hit.source }
    : { ok: false, searched: candidates.map((c) => c.path) };
}
