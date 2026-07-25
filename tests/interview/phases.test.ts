import { describe, expect, it } from "vitest";

import { CHANGES_DIR, phaseCommand } from "../../src/interview/phases";
import type { Phase } from "../../src/tui/transport";

describe("phaseCommand — the single table the engine is allowed to own (AD-1)", () => {
  it("maps spec to /devy:spec with the demand appended", () => {
    expect(phaseCommand("spec", "um widget de busca")).toBe(
      "/devy:spec um widget de busca",
    );
  });

  it("maps refine to /devy:refine (no argument)", () => {
    expect(phaseCommand("refine")).toBe("/devy:refine");
  });

  it("maps plan to /devy:plan spec.md (the fixed input)", () => {
    expect(phaseCommand("plan")).toBe("/devy:plan spec.md");
  });

  it("ignores the demand for refine and plan", () => {
    expect(phaseCommand("refine", "ignored")).toBe("/devy:refine");
    expect(phaseCommand("plan", "ignored")).toBe("/devy:plan spec.md");
  });
});

describe("bug/debt tracks never spawn a process — asking their command is not a path", () => {
  it("has no phase entry for bug or debt (compile-time)", () => {
    // @ts-expect-error — "bug" is not a Phase; the bug track ends in a hand-off.
    phaseCommand("bug", "x");
    // @ts-expect-error — "debt" is not a Phase either.
    phaseCommand("debt", "x");
  });

  it("only the three authoring phases resolve to a command", () => {
    const phases: Phase[] = ["spec", "refine", "plan"];
    for (const p of phases) {
      expect(typeof phaseCommand(p, "d")).toBe("string");
    }
  });
});

describe("CHANGES_DIR — the harness address (one of only two copies)", () => {
  it("is the devy changes folder", () => {
    expect(CHANGES_DIR).toBe(".harn/devy/changes");
  });
});
