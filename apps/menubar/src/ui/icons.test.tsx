/**
 * Smoke tests for the monochrome menu icons (C-0012, §Decisões #6).
 *
 * Every icon must: render an <svg>, carry `aria-hidden`, inherit its color via
 * `currentColor` (never a hardcoded literal), and forward arbitrary SVG props
 * so a MenuItem can style/size it. It must also be reachable from the barrel.
 *
 * Run: `npm test -w apps/menubar -- icons`
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { IconOpen, IconStop, IconInfo, IconPower } from "./icons";
import * as barrel from "./index";

const ICONS = [
  { name: "IconOpen", Icon: IconOpen },
  { name: "IconStop", Icon: IconStop },
  { name: "IconInfo", Icon: IconInfo },
  { name: "IconPower", Icon: IconPower },
] as const;

describe("menu icons", () => {
  for (const { name, Icon } of ICONS) {
    describe(name, () => {
      it("renders a 16×16 svg", () => {
        // Arrange / Act
        const { container } = render(<Icon />);
        const svg = container.querySelector("svg");

        // Assert
        expect(svg).not.toBeNull();
        expect(svg?.getAttribute("viewBox")).toBe("0 0 16 16");
        expect(svg?.getAttribute("width")).toBe("16");
        expect(svg?.getAttribute("height")).toBe("16");
      });

      it("is aria-hidden", () => {
        const { container } = render(<Icon />);
        expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
          "true",
        );
      });

      it("inherits color via currentColor, with no color literal", () => {
        const markup = render(<Icon />).container.querySelector("svg")?.outerHTML ?? "";

        expect(markup).toContain("currentColor");
        // No hex, rgb(), or hsl() color literals — icons are monochromatic.
        expect(markup).not.toContain("#");
        expect(markup).not.toMatch(/rgb|hsl/i);
      });

      it("forwards svg props (e.g. className)", () => {
        const { container } = render(<Icon className="menu-item__icon" />);
        expect(container.querySelector("svg")?.getAttribute("class")).toBe(
          "menu-item__icon",
        );
      });
    });
  }

  it("re-exports every icon from the barrel", () => {
    for (const { name } of ICONS) {
      expect(typeof (barrel as Record<string, unknown>)[name]).toBe("function");
    }
  });
});
