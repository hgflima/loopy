/**
 * Tests for StepDivider — label-only, agent, agent+usage, graceful degradation.
 *
 * Run: `npm test -w apps/menubar -- StepDivider`
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StepDivider } from "./StepDivider";

describe("StepDivider", () => {
  it("renders label only when no agent/usage", () => {
    const { container } = render(<StepDivider label="CHECKS" />);
    const pill = container.querySelector(".step-divider__pill");
    expect(pill?.textContent).toBe("CHECKS");
  });

  it("renders LABEL → Agent when agent is provided without usage", () => {
    const { container } = render(
      <StepDivider label="SIMPLIFY" agent="Codex" />,
    );
    const pill = container.querySelector(".step-divider__pill");
    expect(pill?.textContent).toBe("SIMPLIFY → Codex");
  });

  it("renders LABEL → Agent (usage) when both are provided", () => {
    const { container } = render(
      <StepDivider label="SIMPLIFY" agent="Codex" usage="(287k / 29%)" />,
    );
    const pill = container.querySelector(".step-divider__pill");
    expect(pill?.textContent).toBe("SIMPLIFY → Codex (287k / 29%)");
  });

  it("renders usage portion in a secondary span", () => {
    const { container } = render(
      <StepDivider label="IMPL" agent="Claude" usage="(200k / 20%)" />,
    );
    const usage = container.querySelector(".step-divider__usage");
    expect(usage).toBeTruthy();
    expect(usage?.textContent).toBe(" (200k / 20%)");
  });

  it("does not render usage span when usage is empty string", () => {
    const { container } = render(
      <StepDivider label="IMPL" agent="Claude" usage="" />,
    );
    expect(container.querySelector(".step-divider__usage")).toBeNull();
  });

  it("ignores usage when agent is absent", () => {
    const { container } = render(
      <StepDivider label="CHECKS" usage="(100k / 50%)" />,
    );
    const pill = container.querySelector(".step-divider__pill");
    expect(pill?.textContent).toBe("CHECKS");
    expect(container.querySelector(".step-divider__usage")).toBeNull();
  });

  it("has aria-hidden on the wrapper", () => {
    const { container } = render(<StepDivider label="BUILD" />);
    const div = container.querySelector(".step-divider");
    expect(div?.getAttribute("aria-hidden")).toBe("true");
  });
});
