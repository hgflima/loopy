/**
 * Tests for context-window: formatUsage pure function.
 *
 * Covers:
 * - Abbreviation helper (abbrev)
 * - Happy path with size provided
 * - Fallback to WINDOW_FALLBACK by model
 * - size overrides model fallback
 * - Missing used or missing window → ""
 * - Unknown model without size → ""
 * - Never throws
 *
 * Run: `npm test -w apps/menubar -- context-window`
 */

import { describe, it, expect } from "vitest";
import { formatUsage } from "./context-window.js";

describe("formatUsage", () => {
  it("returns formatted string when used and size are provided", () => {
    // Opus 1M with 200k used → "(200k / 20%)"
    expect(formatUsage(200_000, 1_000_000)).toBe("(200k / 20%)");
  });

  it("abbreviates thousands correctly", () => {
    expect(formatUsage(287_000, 1_000_000)).toBe("(287k / 29%)");
  });

  it("abbreviates values under 1k without suffix", () => {
    expect(formatUsage(500, 1_000_000)).toBe("(500 / 0%)");
  });

  it("rounds percentage", () => {
    expect(formatUsage(333_333, 1_000_000)).toBe("(333k / 33%)");
  });

  it("uses WINDOW_FALLBACK when size is absent but model is known", () => {
    expect(formatUsage(200_000, undefined, "claude-opus-4-8")).toBe(
      "(200k / 20%)",
    );
  });

  it("uses WINDOW_FALLBACK for sonnet", () => {
    expect(formatUsage(100_000, undefined, "claude-sonnet-5")).toBe(
      "(100k / 50%)",
    );
  });

  it("uses WINDOW_FALLBACK for haiku", () => {
    expect(formatUsage(50_000, undefined, "claude-haiku-4-5")).toBe(
      "(50k / 25%)",
    );
  });

  it("size overrides model fallback", () => {
    // size=500_000 wins over claude-opus-4-8 fallback of 1_000_000
    expect(formatUsage(200_000, 500_000, "claude-opus-4-8")).toBe(
      "(200k / 40%)",
    );
  });

  it('returns "" when used is undefined', () => {
    expect(formatUsage(undefined, 1_000_000)).toBe("");
  });

  it('returns "" when used is null', () => {
    expect(formatUsage(null as unknown as undefined, 1_000_000)).toBe("");
  });

  it('returns "" when both size and model are absent', () => {
    expect(formatUsage(100_000)).toBe("");
  });

  it('returns "" when model is unknown and size is absent', () => {
    expect(formatUsage(100_000, undefined, "gpt-5")).toBe("");
  });

  it('returns "" when size is 0', () => {
    expect(formatUsage(100_000, 0)).toBe("");
  });

  it('returns "" when size is negative', () => {
    expect(formatUsage(100_000, -1)).toBe("");
  });

  it("never throws on any combination of undefined inputs", () => {
    expect(() => formatUsage()).not.toThrow();
    expect(() => formatUsage(undefined)).not.toThrow();
    expect(() => formatUsage(undefined, undefined)).not.toThrow();
    expect(() => formatUsage(undefined, undefined, undefined)).not.toThrow();
    expect(() => formatUsage(0, 0, "")).not.toThrow();
  });

  it('all non-throwing cases return "" or a parenthesized string', () => {
    const result = formatUsage(200_000, 1_000_000);
    expect(result).toMatch(/^\(.+ \/ \d+%\)$/);

    const empty = formatUsage();
    expect(empty).toBe("");
  });
});
