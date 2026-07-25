/**
 * Tests for PhaseGate: the human gate between Phases (D12).
 *
 * The gate shows what the finished Phase wrote, then offers the next step:
 * `Refinar` / `Ir direto ao plano` / `Fechar`.
 *
 * Run: `npm test -w apps/menubar -- specs`
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { GateOption } from "./interview-state";

afterEach(cleanup);

const { PhaseGate } = await import("./PhaseGate");

const GATE_OPTIONS: readonly GateOption[] = [
  { next: "refine" },
  { next: "plan" },
  { next: "close" },
];

// ---------------------------------------------------------------------------

describe("PhaseGate", () => {
  it("shows the change dir and the files the Phase wrote", () => {
    const { getByText } = render(
      <PhaseGate
        phase="spec"
        changeDir=".harn/devy/changes/C-0018-specs-authoring"
        files={["spec.md"]}
        options={GATE_OPTIONS}
        onDecide={vi.fn()}
      />,
    );
    expect(getByText("spec.md")).not.toBeNull();
    expect(
      getByText(".harn/devy/changes/C-0018-specs-authoring"),
    ).not.toBeNull();
  });

  it("offers Refinar, Ir direto ao plano and Fechar", () => {
    const { getByText } = render(
      <PhaseGate
        phase="spec"
        changeDir="dir"
        files={["spec.md"]}
        options={GATE_OPTIONS}
        onDecide={vi.fn()}
      />,
    );
    expect(getByText("Refinar")).not.toBeNull();
    expect(getByText("Ir direto ao plano")).not.toBeNull();
    expect(getByText("Fechar")).not.toBeNull();
  });

  it("decides refine / plan / close on click", () => {
    const onDecide = vi.fn();
    const { getByText } = render(
      <PhaseGate
        phase="spec"
        changeDir="dir"
        files={["spec.md"]}
        options={GATE_OPTIONS}
        onDecide={onDecide}
      />,
    );
    fireEvent.click(getByText("Refinar"));
    fireEvent.click(getByText("Ir direto ao plano"));
    fireEvent.click(getByText("Fechar"));
    expect(onDecide).toHaveBeenNthCalledWith(1, "refine");
    expect(onDecide).toHaveBeenNthCalledWith(2, "plan");
    expect(onDecide).toHaveBeenNthCalledWith(3, "close");
  });

  it("only renders the offered options", () => {
    // After the refine Phase the gate might offer plan and close only.
    const { getByText, queryByText } = render(
      <PhaseGate
        phase="refine"
        changeDir="dir"
        files={["spec.md", "plan-notes.md"]}
        options={[{ next: "plan" }, { next: "close" }]}
        onDecide={vi.fn()}
      />,
    );
    expect(queryByText("Refinar")).toBeNull();
    expect(getByText("Ir direto ao plano")).not.toBeNull();
    expect(getByText("Fechar")).not.toBeNull();
  });

  it("offers to open a file when onOpenFile is provided", () => {
    const onOpenFile = vi.fn();
    const { getAllByText } = render(
      <PhaseGate
        phase="spec"
        changeDir="dir"
        files={["spec.md"]}
        options={GATE_OPTIONS}
        onDecide={vi.fn()}
        onOpenFile={onOpenFile}
      />,
    );
    fireEvent.click(getAllByText("Abrir")[0]!);
    expect(onOpenFile).toHaveBeenCalledWith("spec.md");
  });
});
