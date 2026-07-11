/**
 * Tests for T-006: About window content.
 *
 * Covers:
 * - Version via `getVersion()` (mocked → "0.3.0")
 * - PT tagline and author/copyright (year via `new Date().getFullYear()`)
 * - Wordmark rendered for both themes (light + dark, swapped by CSS)
 * - GitHub/npm links call `openUrl` with the right destination (mocked)
 * - DS compliance: zero inline color literals
 *
 * Run: `npm test -w apps/menubar -- About`
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

afterEach(cleanup);

// Mock Tauri APIs. `vi.mock` is hoisted, but the factories only run when the
// module is first imported — which is the dynamic `await import("./About")`
// BELOW, after these consts exist. So the closures capture initialized fns
// (mirrors the Glance.test.tsx pattern).
const mockGetVersion = vi.fn(() => Promise.resolve("0.3.0"));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: () => mockGetVersion(),
}));

const mockOpenUrl = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (...args: unknown[]) => mockOpenUrl(...args),
}));

const { About } = await import("./About");

// The two link destinations are the contract — kept in sync with About.tsx.
const GITHUB_URL = "https://github.com/hgflima/loopy";
const NPM_URL = "https://www.npmjs.com/package/@hgflima/loopy";

/**
 * Render + let the async `getVersion()` state update settle inside `act`, so
 * no test leaks an un-awaited setState into the next one.
 */
async function renderAbout() {
  const utils = render(<About />);
  await utils.findByText(/0\.3\.0/);
  return utils;
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

describe("About — content", () => {
  it("shows the version from getVersion()", async () => {
    const { findByText } = render(<About />);
    expect(await findByText(/0\.3\.0/)).toBeTruthy();
  });

  it("shows the PT tagline", async () => {
    const { getByText } = await renderAbout();
    expect(
      getByText("Motor de loop agêntico config-driven via ACP"),
    ).toBeTruthy();
  });

  it("shows the author and the current-year copyright", async () => {
    const { container } = await renderAbout();
    const year = String(new Date().getFullYear());
    expect(container.textContent).toContain("Henrique Lima");
    expect(container.textContent).toContain(year);
  });

  it("renders the wordmark for both light and dark themes", async () => {
    const { getAllByAltText } = await renderAbout();
    expect(getAllByAltText("Loopy").length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Links → opener
// ---------------------------------------------------------------------------

describe("About — links", () => {
  beforeEach(() => mockOpenUrl.mockClear());

  it("GitHub link opens the repository URL", async () => {
    const { getByText } = await renderAbout();
    fireEvent.click(getByText("GitHub"));
    expect(mockOpenUrl).toHaveBeenCalledWith(GITHUB_URL);
  });

  it("npm link opens the package URL", async () => {
    const { getByText } = await renderAbout();
    fireEvent.click(getByText("npm"));
    expect(mockOpenUrl).toHaveBeenCalledWith(NPM_URL);
  });
});

// ---------------------------------------------------------------------------
// DS compliance: zero inline color literals
// ---------------------------------------------------------------------------

describe("About — no color literals in DOM", () => {
  const COLOR_RE =
    /#[0-9a-fA-F]{3,8}\b|rgba?\(|oklch\(|cyan|orange|blue|red|green|magenta/;

  it("has no inline color styles", async () => {
    const { container } = await renderAbout();
    const parts: string[] = [];
    container
      .querySelectorAll("[style]")
      .forEach((el) => parts.push((el as HTMLElement).style.cssText));
    expect(parts.join(" ")).not.toMatch(COLOR_RE);
  });
});
