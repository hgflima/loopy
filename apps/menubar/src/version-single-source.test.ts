/**
 * Guard: the app version is single-sourced from the repo-root package.json.
 *
 * Invariant (spec C-0012 §Boundaries — "Versão single-sourced"):
 *   - The repo-root package.json is the ONE authoritative version source.
 *   - apps/menubar/src-tauri/tauri.conf.json references it via a Tauri v2
 *     `version` path-ref ("../../../package.json") — NOT a hardcoded literal.
 *   - apps/menubar/package.json is kept aligned (hygiene; it is NOT the source).
 *
 * Why this is safe (confirmed against the Tauri v2 config reference): a
 * `version` path resolves relative to the tauri.conf.json directory (src-tauri/)
 * and takes precedence over Cargo.toml, so `getVersion()` reflects the root
 * version. The old relative-path bug (tauri#4723) was a v1 regression, resolved.
 *
 * Run: `npm test -w apps/menubar -- version-single-source`
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MENUBAR_ROOT = resolve(HERE, ".."); // src/ -> apps/menubar
const SRC_TAURI = resolve(MENUBAR_ROOT, "src-tauri"); // holds tauri.conf.json
const REPO_ROOT = resolve(MENUBAR_ROOT, "../.."); // apps/menubar -> repo root
const ROOT_PKG_PATH = resolve(REPO_ROOT, "package.json"); // the ONE version source
const VERSION_PATH_REF = "../../../package.json";
const SEMVER = /^\d+\.\d+\.\d+/;

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

const tauriConf = readJson(resolve(SRC_TAURI, "tauri.conf.json"));
const rootPkg = readJson(ROOT_PKG_PATH);
const menubarPkg = readJson(resolve(MENUBAR_ROOT, "package.json"));

describe("version single-sourcing (C-0012 §Boundaries)", () => {
  it("tauri.conf.json references the root package.json via path-ref, not a literal", () => {
    expect(tauriConf.version).toBe(VERSION_PATH_REF);
    expect(tauriConf.version).not.toMatch(SEMVER);
  });

  it("the path-ref resolves (from src-tauri/) to the repo-root package.json", () => {
    const resolved = resolve(SRC_TAURI, tauriConf.version as string);
    expect(resolved).toBe(ROOT_PKG_PATH);
  });

  it("the repo-root package.json holds an authoritative semver version", () => {
    expect(rootPkg.version).toMatch(SEMVER);
  });

  it("apps/menubar/package.json is aligned with the root version (hygiene, not the source)", () => {
    expect(menubarPkg.version).toBe(rootPkg.version);
  });
});
