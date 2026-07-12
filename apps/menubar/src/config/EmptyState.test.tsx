/**
 * Tests for EmptyState component (T-015).
 *
 * Covers:
 * - Renders the empty-state UI with title, hint, and CTA button
 * - Clicking the button calls onCreateFromTemplate
 *
 * Run: `npm test -w apps/menubar -- EmptyState`
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { EmptyState } from "./EmptyState";

afterEach(cleanup);

describe("EmptyState", () => {
  it("renders title, hint, and CTA button", () => {
    const { getByTestId, getByText } = render(
      <EmptyState onCreateFromTemplate={vi.fn()} />,
    );
    expect(getByTestId("empty-state")).toBeTruthy();
    expect(getByText("Nenhum loopy.yml encontrado")).toBeTruthy();
    expect(getByText(/Crie um a partir do template/)).toBeTruthy();
    const btn = getByTestId("btn-create-from-template");
    expect(btn.textContent).toContain("Criar loopy.yml a partir do template");
  });

  it("calls onCreateFromTemplate when button is clicked", () => {
    const handler = vi.fn();
    const { getByTestId } = render(
      <EmptyState onCreateFromTemplate={handler} />,
    );
    fireEvent.click(getByTestId("btn-create-from-template"));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not call onCreateFromTemplate on render", () => {
    const handler = vi.fn();
    render(<EmptyState onCreateFromTemplate={handler} />);
    expect(handler).not.toHaveBeenCalled();
  });
});
