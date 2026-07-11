/**
 * Tests for T-003: Menu primitives — Menu / MenuItem / MenuSeparator.
 *
 * Covers the acceptance criteria:
 *  - items + icons render with the correct roles (menu / menuitem / separator);
 *  - `disabled` gets `aria-disabled` and never fires `onSelect`;
 *  - `onSelect` fires on click AND on Enter;
 *  - ↑/↓ rove focus across enabled items, skipping separators and disabled;
 *  - zero color literals in the stylesheet (tokens-only).
 *
 * Run: `npm test -w apps/menubar -- Menu`
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Menu, MenuItem, MenuSeparator } from "./Menu";

afterEach(cleanup);

// A tiny monochrome glyph — stands in for the real icons (T-002).
function Glyph() {
  return (
    <svg data-testid="glyph" width={16} height={16} viewBox="0 0 16 16">
      <rect x={3} y={3} width={10} height={10} fill="currentColor" />
    </svg>
  );
}

describe("Menu / MenuItem / MenuSeparator", () => {
  it("gives the container role=menu", () => {
    // Arrange / Act
    render(
      <Menu ariaLabel="Actions">
        <MenuItem>Abrir</MenuItem>
      </Menu>,
    );

    // Assert
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("renders each item as role=menuitem with its label and icon", () => {
    // Arrange / Act
    render(
      <Menu>
        <MenuItem icon={<Glyph />}>Abrir</MenuItem>
        <MenuItem icon={<Glyph />}>Sobre</MenuItem>
      </Menu>,
    );

    // Assert
    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(2);
    expect(screen.getByRole("menuitem", { name: "Abrir" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Sobre" })).toBeTruthy();
    expect(screen.getAllByTestId("glyph")).toHaveLength(2);
  });

  it("renders the icon inside an aria-hidden gutter", () => {
    // Arrange / Act
    render(
      <Menu>
        <MenuItem icon={<Glyph />}>Abrir</MenuItem>
      </Menu>,
    );

    // Assert — the icon is decorative; its wrapper is hidden from AT.
    const gutter = screen.getByTestId("glyph").closest("[aria-hidden]");
    expect(gutter).toBeTruthy();
    expect(gutter?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders separators with role=separator", () => {
    // Arrange / Act
    render(
      <Menu>
        <MenuItem>Abrir</MenuItem>
        <MenuSeparator />
        <MenuItem>Sair</MenuItem>
      </Menu>,
    );

    // Assert
    expect(screen.getAllByRole("separator")).toHaveLength(1);
  });

  it("calls onSelect when an enabled item is clicked", () => {
    // Arrange
    const onSelect = vi.fn();
    render(
      <Menu>
        <MenuItem onSelect={onSelect}>Abrir</MenuItem>
      </Menu>,
    );

    // Act
    fireEvent.click(screen.getByRole("menuitem", { name: "Abrir" }));

    // Assert
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("calls onSelect when Enter is pressed on an enabled item", () => {
    // Arrange
    const onSelect = vi.fn();
    render(
      <Menu>
        <MenuItem onSelect={onSelect}>Abrir</MenuItem>
      </Menu>,
    );
    const item = screen.getByRole("menuitem", { name: "Abrir" });
    item.focus();

    // Act
    fireEvent.keyDown(item, { key: "Enter" });

    // Assert — exactly once (no double-fire from a synthesized click).
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("marks a disabled item with aria-disabled and never fires onSelect", () => {
    // Arrange
    const onSelect = vi.fn();
    render(
      <Menu>
        <MenuItem disabled onSelect={onSelect}>
          Parar
        </MenuItem>
      </Menu>,
    );
    const item = screen.getByRole("menuitem", { name: "Parar" });

    // Act
    fireEvent.click(item);
    item.focus();
    fireEvent.keyDown(item, { key: "Enter" });

    // Assert
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("roves focus with ↑/↓, skipping separators and disabled items", () => {
    // Arrange
    render(
      <Menu ariaLabel="Actions">
        <MenuItem>Abrir</MenuItem>
        <MenuItem disabled>Parar</MenuItem>
        <MenuSeparator />
        <MenuItem>Sobre</MenuItem>
      </Menu>,
    );
    const menu = screen.getByRole("menu");
    const abrir = screen.getByRole("menuitem", { name: "Abrir" });
    const sobre = screen.getByRole("menuitem", { name: "Sobre" });

    // Act / Assert — ↓ from nowhere lands on the first enabled item.
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(abrir);

    // ↓ again skips the disabled "Parar" and the separator → "Sobre".
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(sobre);

    // ↑ moves back to "Abrir".
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(abrir);
  });

  it("wraps ↓ from the last enabled item back to the first", () => {
    // Arrange
    render(
      <Menu>
        <MenuItem>Abrir</MenuItem>
        <MenuItem>Sair</MenuItem>
      </Menu>,
    );
    const menu = screen.getByRole("menu");
    const abrir = screen.getByRole("menuitem", { name: "Abrir" });
    const sair = screen.getByRole("menuitem", { name: "Sair" });

    // Act — walk to the last item, then one more ↓.
    sair.focus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });

    // Assert
    expect(document.activeElement).toBe(abrir);
  });

  it("uses only design tokens — no color literals in Menu.css", () => {
    // Arrange
    const cssPath = resolve(import.meta.dirname, "Menu.css");
    const css = readFileSync(cssPath, "utf8");

    // Act / Assert — every color must come from a var(--token).
    const colorLiteral = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\s*\(/;
    expect(colorLiteral.test(css)).toBe(false);
  });
});
