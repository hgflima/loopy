import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { CardDetail } from "./CardDetail";

describe("CardDetail — shell rendering", () => {
  it("renders task id and title in the header", () => {
    const { container } = render(
      <CardDetail taskId="T-001" title="First task" onClose={vi.fn()} />,
    );

    expect(container.querySelector(".card-detail__id")?.textContent).toBe("T-001");
    expect(container.querySelector(".card-detail__title")?.textContent).toBe("First task");
  });

  it("has the aside landmark with correct aria-label", () => {
    const { container } = render(
      <CardDetail taskId="T-001" title="First task" onClose={vi.fn()} />,
    );

    const aside = container.querySelector("aside");
    expect(aside?.getAttribute("aria-label")).toBe("Detail for T-001");
  });

  it("renders the empty body area", () => {
    const { container } = render(
      <CardDetail taskId="T-001" title="First task" onClose={vi.fn()} />,
    );

    expect(container.querySelector(".card-detail__body")).toBeTruthy();
  });
});

describe("CardDetail — close interactions", () => {
  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(
      <CardDetail taskId="T-001" title="First task" onClose={onClose} />,
    );

    const btn = container.querySelector(".card-detail__close") as HTMLElement;
    fireEvent.click(btn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <CardDetail taskId="T-001" title="First task" onClose={onClose} />,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not call onClose on other keys", () => {
    const onClose = vi.fn();
    render(
      <CardDetail taskId="T-001" title="First task" onClose={onClose} />,
    );

    fireEvent.keyDown(window, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
