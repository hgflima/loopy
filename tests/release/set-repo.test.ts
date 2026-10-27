import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRepo, setRepo } from "../../scripts/release/set-repo.mjs";

const pkg = {
  name: "@scope/loopy",
  version: "1.2.3",
  repository: { type: "git", url: "git+https://github.com/old/loopy.git" },
  bugs: { url: "https://github.com/old/loopy/issues", email: "a@b.c" },
  homepage: "https://github.com/old/loopy#readme",
  bin: { loopy: "dist/index.js" },
};

describe("setRepo", () => {
  it("points the three URLs at the new repo", () => {
    const out = setRepo(pkg, "acme/loopy-fork");
    expect(out.repository).toEqual({
      type: "git",
      url: "git+https://github.com/acme/loopy-fork.git",
    });
    expect(out.bugs).toEqual({
      url: "https://github.com/acme/loopy-fork/issues",
      email: "a@b.c",
    });
    expect(out.homepage).toBe("https://github.com/acme/loopy-fork#readme");
  });

  it("leaves other fields and key order untouched, without mutating input", () => {
    const before = JSON.stringify(pkg);
    const out = setRepo(pkg, "acme/x");
    expect(JSON.stringify(pkg)).toBe(before);
    expect(Object.keys(out)).toEqual(Object.keys(pkg));
    expect(out.name).toBe(pkg.name);
    expect(out.version).toBe(pkg.version);
    expect(out.bin).toEqual(pkg.bin);
  });

  it("creates the fields when absent", () => {
    const out = setRepo({ name: "x" }, "o/r");
    expect(out).toEqual({
      name: "x",
      repository: { type: "git", url: "git+https://github.com/o/r.git" },
      bugs: { url: "https://github.com/o/r/issues" },
      homepage: "https://github.com/o/r#readme",
    });
  });

  it.each([
    "foo",
    "a/b/c",
    "https://github.com/o/r",
    "github.com/o/r",
    "",
    "/r",
    "o/",
    "-o/r",
    "o/..",
    "o r/x",
  ])("rejects invalid repo %j", (bad) => {
    expect(() => setRepo(pkg, bad)).toThrow(/owner\/repo/);
  });

  it("accepts dots, underscores and hyphens in the repo name", () => {
    expect(parseRepo("my-org/my_repo.js")).toBe("my-org/my_repo.js");
  });
});

describe("set-repo.mjs source", () => {
  it("has no hardcoded upstream repo (E11)", () => {
    const src = readFileSync(
      new URL("../../scripts/release/set-repo.mjs", import.meta.url),
      "utf8",
    );
    expect(src).not.toContain("hgflima/loopy");
  });
});
