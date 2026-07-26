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
import {
  IconOpen,
  IconStop,
  IconInfo,
  IconPower,
  IconToolRead,
  IconToolWrite,
  IconToolExec,
  IconToolThink,
  IconToolMode,
  IconToolDanger,
  IconToolOther,
} from "./icons";
import * as barrel from "./index";

const ICONS = [
  { name: "IconOpen", Icon: IconOpen },
  { name: "IconStop", Icon: IconStop },
  { name: "IconInfo", Icon: IconInfo },
  { name: "IconPower", Icon: IconPower },
] as const;

/**
 * The seven tool-family glyphs (C-0019 §C1, R7c). Same canvas contract as the
 * menu icons, but they are NOT barrelled — `tool-kind.ts` imports them directly
 * (the barrel is a merge-serialization point for T-009/T-010).
 */
const TOOL_ICONS = [
  { name: "IconToolRead", Icon: IconToolRead },
  { name: "IconToolWrite", Icon: IconToolWrite },
  { name: "IconToolExec", Icon: IconToolExec },
  { name: "IconToolThink", Icon: IconToolThink },
  { name: "IconToolMode", Icon: IconToolMode },
  { name: "IconToolDanger", Icon: IconToolDanger },
  { name: "IconToolOther", Icon: IconToolOther },
] as const;

function assertIconContract(Icon: (props: Record<string, unknown>) => JSX.Element) {
  it("renders a 16×16 svg", () => {
    const { container } = render(<Icon />);
    const svg = container.querySelector("svg");

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
    const { container } = render(<Icon className="icon" />);
    expect(container.querySelector("svg")?.getAttribute("class")).toBe("icon");
  });
}

describe("menu icons", () => {
  for (const { name, Icon } of ICONS) {
    describe(name, () => {
      assertIconContract(Icon);
    });
  }

  it("re-exports every icon from the barrel", () => {
    for (const { name } of ICONS) {
      expect(typeof (barrel as Record<string, unknown>)[name]).toBe("function");
    }
  });
});

describe("tool-family icons", () => {
  for (const { name, Icon } of TOOL_ICONS) {
    describe(name, () => {
      assertIconContract(Icon);

      it("paints the tool hue on the stroke only — never a fill (C1)", () => {
        const markup =
          render(<Icon />).container.querySelector("svg")?.outerHTML ?? "";

        // The family hue rides on `currentColor` via the stroke...
        expect(markup).toContain('stroke="currentColor"');
        // ...and NEVER becomes a fill/tint: the only fill a tool glyph may
        // carry is the canvas reset (`fill="none"`) on the <svg> root, so the
        // distinction survives color-blindness (DESIGN.md §2, C1).
        const fills = [...markup.matchAll(/fill="([^"]*)"/g)].map((m) => m[1]);
        expect(fills.every((f) => f === "none")).toBe(true);
      });
    });
  }
});
