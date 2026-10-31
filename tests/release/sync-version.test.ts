import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  VERSION_FILES,
  parseVersion,
  syncVersion,
} from "../../scripts/release/sync-version.mjs";

const files = () => ({
  root: { name: "@scope/loopy", version: "0.6.0", private: false },
  menubar: { name: "@scope/loopy-menubar", version: "0.5.1", private: true },
  lock: {
    name: "@scope/loopy",
    version: "0.6.0",
    lockfileVersion: 3,
    packages: {
      "": { name: "@scope/loopy", version: "0.6.0", workspaces: ["apps/*"] },
      "apps/menubar": { name: "@scope/loopy-menubar", version: "0.5.1" },
      "node_modules/yaml": { version: "2.8.0" },
    },
  },
});

describe("syncVersion", () => {
  it("leaves root and menubar on the same version", () => {
    const out = syncVersion(files(), "0.7.0");
    expect(out.root.version).toBe("0.7.0");
    expect(out.menubar.version).toBe("0.7.0");
    expect(out.root.version).toBe(out.menubar.version);
  });

  it("updates only the matching lockfile entries", () => {
    const out = syncVersion(files(), "1.0.0-beta.1");
    expect(out.lock.version).toBe("1.0.0-beta.1");
    const pkgs = out.lock.packages as Record<string, { version?: string }>;
    expect(pkgs[""]?.version).toBe("1.0.0-beta.1");
    expect(pkgs["apps/menubar"]?.version).toBe("1.0.0-beta.1");
    expect(pkgs["node_modules/yaml"]?.version).toBe("2.8.0");
  });

  it("does not mutate the input and keeps key order", () => {
    const input = files();
    const before = JSON.stringify(input);
    const out = syncVersion(input, "0.7.0");
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.keys(out.root)).toEqual(Object.keys(input.root));
    expect(Object.keys(out.lock)).toEqual(Object.keys(input.lock));
    expect(Object.keys(out.lock.packages as object)).toEqual(
      Object.keys(input.lock.packages),
    );
  });

  it.each(["v1.2.3", "1.2", "1.2.3.4", "01.2.3", "", "latest", " 1.2.3"])(
    "rejects non-semver %j",
    (bad) => {
      expect(() => syncVersion(files(), bad)).toThrow(/versão inválida/);
    },
  );

  it("rejects a lockfile without the workspace entries", () => {
    const f = files();
    const lock = { ...f.lock, packages: { "": f.lock.packages[""] } };
    expect(() => syncVersion({ ...f, lock }, "0.7.0")).toThrow(/apps\/menubar/);
  });
});

describe("parseVersion", () => {
  it("accepts semver with prerelease and build metadata", () => {
    expect(parseVersion("1.2.3-rc.1+sha.abc")).toBe("1.2.3-rc.1+sha.abc");
  });

  it("rejects non-strings", () => {
    expect(() => parseVersion(123)).toThrow(/versão inválida/);
  });
});

describe("VERSION_FILES", () => {
  it("points at manifests that exist and are in sync in this repo", () => {
    const read = (p: string) =>
      JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), "utf8"));
    expect(read(VERSION_FILES.menubar).version).toBe(
      read(VERSION_FILES.root).version,
    );
    expect(read(VERSION_FILES.lock).version).toBe(
      read(VERSION_FILES.root).version,
    );
  });
});
