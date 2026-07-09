/**
 * Tests for resize-helpers — pure helpers for the Kanban↔Stream divider (T-011).
 *
 * Run: `npm test -w apps/menubar -- resize-helpers`
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  clampFraction,
  fractionToPercent,
  readFraction,
  writeFraction,
  DEFAULT_FRACTION,
  MIN_FRACTION,
  MAX_FRACTION,
  STORAGE_KEY,
} from "./resize-helpers";

// ---------------------------------------------------------------------------
// clampFraction
// ---------------------------------------------------------------------------

describe("clampFraction", () => {
  it("returns value unchanged when within bounds", () => {
    expect(clampFraction(0.45)).toBe(0.45);
    expect(clampFraction(0.3)).toBe(0.3);
  });

  it("clamps below MIN to MIN", () => {
    expect(clampFraction(0.1)).toBe(MIN_FRACTION);
    expect(clampFraction(-1)).toBe(MIN_FRACTION);
  });

  it("clamps above MAX to MAX", () => {
    expect(clampFraction(0.9)).toBe(MAX_FRACTION);
    expect(clampFraction(2)).toBe(MAX_FRACTION);
  });

  it("returns exact boundary values", () => {
    expect(clampFraction(MIN_FRACTION)).toBe(MIN_FRACTION);
    expect(clampFraction(MAX_FRACTION)).toBe(MAX_FRACTION);
  });
});

// ---------------------------------------------------------------------------
// fractionToPercent
// ---------------------------------------------------------------------------

describe("fractionToPercent", () => {
  it("converts 0.45 to '45%'", () => {
    expect(fractionToPercent(0.45)).toBe("45%");
  });

  it("rounds to nearest integer", () => {
    expect(fractionToPercent(0.333)).toBe("33%");
    expect(fractionToPercent(0.667)).toBe("67%");
  });

  it("handles boundary values", () => {
    expect(fractionToPercent(MIN_FRACTION)).toBe("20%");
    expect(fractionToPercent(MAX_FRACTION)).toBe("70%");
  });
});

// ---------------------------------------------------------------------------
// readFraction / writeFraction (localStorage)
// ---------------------------------------------------------------------------

describe("readFraction", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns DEFAULT_FRACTION when nothing stored", () => {
    expect(readFraction()).toBe(DEFAULT_FRACTION);
  });

  it("reads and parses a valid stored fraction", () => {
    localStorage.setItem(STORAGE_KEY, "0.3");
    expect(readFraction()).toBe(0.3);
  });

  it("clamps a stored value below MIN", () => {
    localStorage.setItem(STORAGE_KEY, "0.05");
    expect(readFraction()).toBe(MIN_FRACTION);
  });

  it("clamps a stored value above MAX", () => {
    localStorage.setItem(STORAGE_KEY, "0.99");
    expect(readFraction()).toBe(MAX_FRACTION);
  });

  it("returns DEFAULT_FRACTION for non-numeric stored value", () => {
    localStorage.setItem(STORAGE_KEY, "garbage");
    expect(readFraction()).toBe(DEFAULT_FRACTION);
  });

  it("returns DEFAULT_FRACTION when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(readFraction()).toBe(DEFAULT_FRACTION);
    vi.restoreAllMocks();
  });
});

describe("writeFraction", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists a clamped fraction", () => {
    writeFraction(0.55);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("0.55");
  });

  it("clamps before persisting", () => {
    writeFraction(0.05);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(String(MIN_FRACTION));
  });

  it("does not throw when localStorage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => writeFraction(0.5)).not.toThrow();
    vi.restoreAllMocks();
  });
});
