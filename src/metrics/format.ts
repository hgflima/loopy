/**
 * Pure formatting functions for metric values (AD-6).
 *
 * - Tokens: raw → compact (k/M).
 * - Duration: ms → human h/m/s.
 * - Cost: amount+currency → "$0.42".
 * - Usage summary: in/out/cached or "n-a"/"n/d".
 */

import type { StepCost, TurnUsage } from "../types.js";

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/** Format a token count compactly: 0–999 as-is, 1k–999k, 1.0M+. */
export function formatTokens(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1_000;
    return k === Math.floor(k) ? `${k}k` : `${k.toFixed(1)}k`;
  }
  const m = n / 1_000_000;
  return m === Math.floor(m) ? `${m}M` : `${m.toFixed(1)}M`;
}

// ---------------------------------------------------------------------------
// Duration
// ---------------------------------------------------------------------------

/** Format milliseconds as human-readable: "1h 2m 3s", "45s", "0s". */
export function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1_000);
  if (totalSec <= 0) return "0s";

  const h = Math.floor(totalSec / 3_600);
  const m = Math.floor((totalSec % 3_600) / 60);
  const s = totalSec % 60;

  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

/** Format a StepCost as "$0.42" (or "n/d" when unavailable/null). */
export function formatCost(cost: StepCost | null): string {
  if (cost === null || !cost.available) return "n/d";
  const prefix = cost.currency === "USD" ? "$" : `${cost.currency} `;
  return `${prefix}${cost.amount.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Usage summary
// ---------------------------------------------------------------------------

/**
 * Format a TurnUsage as a compact summary string.
 * - `null` → `"n-a"` (non-agent step).
 * - `available: false` → `"n/d"` (ACP didn't report).
 * - Otherwise → `"in:12k out:3.4k cached:8k"`.
 */
export function formatUsage(usage: TurnUsage | null): string {
  if (usage === null) return "n-a";
  if (!usage.available) return "n/d";

  const parts = [
    `in:${formatTokens(usage.inputTokens)}`,
    `out:${formatTokens(usage.outputTokens)}`,
  ];

  const cached = (usage.cachedReadTokens ?? 0) + (usage.cachedWriteTokens ?? 0);
  if (cached > 0) parts.push(`cached:${formatTokens(cached)}`);

  return parts.join(" ");
}
