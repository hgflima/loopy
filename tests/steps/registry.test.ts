import { describe, expect, it } from "vitest";
import {
  createNonAgentRegistry,
  createStepRegistry,
} from "../../src/steps/index";
import type { Step, StepResult, StepType } from "../../src/types";

/** A trivial interpreter of a given type that always succeeds. */
function fakeStep(type: StepType, result: StepResult = { ok: true }): Step {
  return { type, execute: async () => result };
}

describe("createStepRegistry", () => {
  it("maps each interpreter by its declared type", () => {
    const shell = fakeStep("shell");
    const checks = fakeStep("checks");
    const registry = createStepRegistry([shell, checks]);

    expect(registry.get("shell")).toBe(shell);
    expect(registry.get("checks")).toBe(checks);
    expect(registry.has("shell")).toBe(true);
    expect(registry.has("checks")).toBe(true);
  });

  it("returns undefined for a type with no registered interpreter", () => {
    const registry = createStepRegistry([fakeStep("shell")]);
    // `agent` is intentionally absent in the non-agent spine (T-010).
    expect(registry.get("agent")).toBeUndefined();
    expect(registry.has("agent")).toBe(false);
  });

  it("lets a later entry override an earlier one of the same type", () => {
    const first = fakeStep("shell");
    const second = fakeStep("shell");
    const registry = createStepRegistry([first, second]);
    expect(registry.get("shell")).toBe(second);
  });
});

describe("createNonAgentRegistry", () => {
  it("registers shell, checks and approval — but NOT agent", () => {
    const registry = createNonAgentRegistry();

    expect(registry.get("shell")?.type).toBe("shell");
    expect(registry.get("checks")?.type).toBe("checks");
    expect(registry.get("approval")?.type).toBe("approval");
    // The heart of T-010: the agent step is not wired yet (lands in T-015).
    expect(registry.has("agent")).toBe(false);
  });
});
