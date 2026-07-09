/**
 * Pure helpers for the Kanban↔Stream resize divider (T-011, AD-6).
 *
 * All functions are side-effect-free and independently testable.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default stream height as a fraction of the viewport. */
export const DEFAULT_FRACTION = 0.45;
/** Minimum allowed fraction. */
export const MIN_FRACTION = 0.2;
/** Maximum allowed fraction. */
export const MAX_FRACTION = 0.7;
/** localStorage key for persisted fraction. */
export const STORAGE_KEY = "loopy:stream-fraction";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Clamp a fraction between MIN and MAX. */
export function clampFraction(value: number): number {
  return Math.min(MAX_FRACTION, Math.max(MIN_FRACTION, value));
}

/** Convert a fraction (0–1) to a CSS percentage string, e.g. `"45%"`. */
export function fractionToPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** Read persisted fraction from localStorage, falling back to default. */
export function readFraction(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return DEFAULT_FRACTION;
    const n = Number(raw);
    return Number.isFinite(n) ? clampFraction(n) : DEFAULT_FRACTION;
  } catch {
    return DEFAULT_FRACTION;
  }
}

/** Persist a fraction to localStorage. */
export function writeFraction(fraction: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(clampFraction(fraction)));
  } catch {
    // localStorage unavailable — silently ignore.
  }
}
