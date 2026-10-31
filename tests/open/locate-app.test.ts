import { dirname } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isBundled, locateApp } from "../../src/open";

/**
 * C-0021/F2: under Node (the npm CLI) `dirname(process.execPath)` is Node's
 * `bin` dir, which also holds the npm `loopy` link — never a sibling search.
 */
describe("locateApp — under Node", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is not the bundled binary", () => {
    expect(isBundled).toBe(false);
  });

  it("never searches beside the Node executable", () => {
    // A PATH without Node's dir: any candidate there could only be a sibling.
    vi.stubEnv("PATH", "/nonexistent-loopy-test");
    vi.stubEnv("LOOPY_APP", "");
    const r = locateApp();
    const nodeDir = dirname(process.execPath);
    if (r.ok) expect(r.source).not.toBe("sibling");
    else expect(r.searched.some((p) => dirname(p) === nodeDir)).toBe(false);
  });
});
