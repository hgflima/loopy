import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  renderInstructions,
  TEMPLATE_PATH,
  type ReleaseAsset,
} from "../../scripts/release/render-instructions.mjs";

const SCRIPT = join(process.cwd(), "scripts/release/render-instructions.mjs");
const template = readFileSync(TEMPLATE_PATH, "utf8");
// Assembled so this test file does not carry the literal itself.
const ORIGINAL_REPO = ["hgflima", "loopy"].join("/");

const base = (repo: string) =>
  `https://github.com/${repo}/releases/download/v0.7.0`;
const assetsFor = (repo: string): ReleaseAsset[] => [
  {
    name: "Loopy_0.7.0_amd64.AppImage",
    url: `${base(repo)}/Loopy_0.7.0_amd64.AppImage`,
  },
  { name: "Loopy_0.7.0_amd64.deb", url: `${base(repo)}/Loopy_0.7.0_amd64.deb` },
  {
    name: "Loopy_0.7.0_aarch64.dmg",
    url: `${base(repo)}/Loopy_0.7.0_aarch64.dmg`,
  },
  {
    name: "Loopy_0.7.0_x64-setup.exe",
    url: `${base(repo)}/Loopy_0.7.0_x64-setup.exe`,
  },
  // Non-platform assets are ignored.
  { name: "Loopy_0.7.0_x64-setup.exe.sig", url: `${base(repo)}/x.sig` },
  { name: "Loopy_aarch64.app.tar.gz", url: `${base(repo)}/x.tar.gz` },
];

const input = (repo = "acme/loopy", assets = assetsFor(repo)) => ({
  template,
  version: "0.7.0",
  repo,
  npmPackage: "@acme/loopy",
  assets,
});

describe("renderInstructions", () => {
  it("injects version, repo, package and one URL per platform, with no placeholder left", () => {
    const out = renderInstructions(input());
    expect(out).toContain("0.7.0");
    expect(out).toContain("https://github.com/acme/loopy");
    expect(out).toContain("npm i -g @acme/loopy@0.7.0");
    for (const a of assetsFor("acme/loopy").slice(0, 4)) {
      expect(out).toContain(a.url);
      expect(out).toContain(a.name);
    }
    expect(out).not.toContain("x.sig");
    expect(out).not.toMatch(/\{\{[A-Z0-9_]+\}\}/);
  });

  it("keeps the safety and verification content", () => {
    const out = renderInstructions(input());
    expect(out).toContain(
      "xattr -dr com.apple.quarantine /Applications/Loopy.app",
    );
    expect(out).toContain("libfuse");
    expect(out).toContain("SmartScreen");
    expect(out).toContain("loopy --version");
    expect(out).toContain("loopy open --help");
    expect(out).toMatch(/EXPERIMENTA/);
    // Only ever mentioned as forbidden, never as a step.
    expect(out).not.toMatch(/^\s*(sudo\s+)?spctl --master-disable/m);
  });

  it.each(["AppImage", "deb", "dmg", "setup.exe"])(
    "fails when the .%s asset is missing",
    (ext) => {
      const assets = assetsFor("acme/loopy").filter(
        (a) => !a.name.endsWith(ext),
      );
      expect(() => renderInstructions(input("acme/loopy", assets))).toThrow(
        /release incompleto/,
      );
    },
  );

  it("fails on an ambiguous platform (two .dmg)", () => {
    const assets = [
      ...assetsFor("acme/loopy"),
      { name: "Loopy_0.7.0_x64.dmg", url: "https://x/y.dmg" },
    ];
    expect(() => renderInstructions(input("acme/loopy", assets))).toThrow(
      /mais de um asset/,
    );
  });

  it("derives the tag download URL when an asset has no url", () => {
    const assets = assetsFor("acme/loopy").map(({ name }) => ({ name }));
    const out = renderInstructions(input("acme/loopy", assets));
    expect(out).toContain(
      "https://github.com/acme/loopy/releases/download/v0.7.0/Loopy_0.7.0_aarch64.dmg",
    );
  });

  it("rejects malformed inputs", () => {
    expect(() => renderInstructions({ ...input(), version: "v0.7" })).toThrow(
      /semver/,
    );
    expect(() => renderInstructions({ ...input(), repo: "acme" })).toThrow(
      /owner\/name/,
    );
    expect(() => renderInstructions({ ...input(), repo: "a/b/c" })).toThrow(
      /owner\/name/,
    );
    expect(() => renderInstructions({ ...input(), npmPackage: "" })).toThrow(
      /pacote npm/,
    );
    const bad = assetsFor("acme/loopy").map((a, i) =>
      i === 0 ? { ...a, url: "ftp://x" } : a,
    );
    expect(() => renderInstructions(input("acme/loopy", bad))).toThrow(
      /url inválida/,
    );
  });

  it("fails on an unknown placeholder in the template", () => {
    expect(() =>
      renderInstructions({ ...input(), template: template + "{{NOPE}}" }),
    ).toThrow(/NOPE/);
  });

  it("rendered for another repo carries no trace of the original owner", () => {
    const out = renderInstructions(input("outra-org/loopy"));
    expect(out).not.toContain("hgflima");
    expect(out).toContain("https://github.com/outra-org/loopy/issues");
  });

  it("the template has no literal original repo", () => {
    expect(template).not.toContain(ORIGINAL_REPO);
  });
});

describe("render-instructions CLI", () => {
  it("renders to stdout and exits non-zero on an incomplete release", () => {
    const dir = mkdtempSync(join(tmpdir(), "render-instr-"));
    const ok = join(dir, "ok.json");
    writeFileSync(ok, JSON.stringify(assetsFor("o/r")));
    const args = [
      "--version",
      "0.7.0",
      "--repo",
      "o/r",
      "--npm-package",
      "pkg",
    ];
    const out = execFileSync(
      process.execPath,
      [SCRIPT, ...args, "--assets", ok],
      { encoding: "utf8" },
    );
    expect(out).toContain("npm i -g pkg@0.7.0");
    expect(out).toContain(
      "https://github.com/o/r/releases/download/v0.7.0/Loopy_0.7.0_amd64.deb",
    );

    const bad = join(dir, "bad.json");
    writeFileSync(
      bad,
      JSON.stringify(assetsFor("o/r").filter((a) => !a.name.endsWith(".dmg"))),
    );
    expect(() =>
      execFileSync(process.execPath, [SCRIPT, ...args, "--assets", bad], {
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).toThrow(/release incompleto/);
  });
});
