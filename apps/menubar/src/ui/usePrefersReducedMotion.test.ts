/**
 * Tests for usePrefersReducedMotion hook.
 *
 * Covers:
 * - Returns true when prefers-reduced-motion matches
 * - Returns false when it does not match
 * - Reacts to media query change events
 * - Cleans up the listener on unmount
 * - Degrades to false when matchMedia is unavailable
 *
 * Run: `npm test -w apps/menubar -- usePrefersReducedMotion`
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion.js";

function mockMatchMedia(matches: boolean) {
  const listeners: Array<(e: { matches: boolean }) => void> = [];
  const mql = {
    matches,
    addEventListener: vi.fn(
      (_event: string, cb: (e: { matches: boolean }) => void) => {
        listeners.push(cb);
      },
    ),
    removeEventListener: vi.fn(
      (_event: string, cb: (e: { matches: boolean }) => void) => {
        const idx = listeners.indexOf(cb);
        if (idx >= 0) listeners.splice(idx, 1);
      },
    ),
  };
  const spy = vi.fn(() => mql as unknown as MediaQueryList);
  vi.stubGlobal("matchMedia", spy);
  return { mql, listeners, spy };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("usePrefersReducedMotion", () => {
  it("returns true when reduced motion is preferred", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
  });

  it("returns false when reduced motion is not preferred", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });

  it("reacts to change events", () => {
    const { listeners } = mockMatchMedia(false);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);

    act(() => {
      for (const cb of listeners) cb({ matches: true });
    });
    expect(result.current).toBe(true);
  });

  it("removes the listener on unmount", () => {
    const { mql } = mockMatchMedia(false);
    const { unmount } = renderHook(() => usePrefersReducedMotion());
    unmount();
    expect(mql.removeEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
  });

  it("degrades to false when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });
});
