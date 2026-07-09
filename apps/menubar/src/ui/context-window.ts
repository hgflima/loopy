/**
 * Pure helpers for context-window usage display (AD-6).
 *
 * `formatUsage` turns raw ACP token counters into a compact string
 * like "(287k / 29%)" for the agent raia header.
 *
 * Import directly — NOT re-exported from ui/index.ts.
 */

const WINDOW_FALLBACK: Record<string, number> = {
  "claude-opus-4-8": 1_000_000,
  "claude-sonnet-5": 200_000,
  "claude-haiku-4-5": 200_000,
};

function abbrev(n: number): string {
  if (n >= 1_000) {
    return `${Math.round(n / 1_000)}k`;
  }
  return String(n);
}

export function formatUsage(
  used?: number | null,
  size?: number | null,
  model?: string,
): string {
  const win =
    size != null && size > 0
      ? size
      : model
        ? WINDOW_FALLBACK[model]
        : undefined;

  if (used == null || win == null) return "";

  const pct = Math.round((used / win) * 100);
  return `(${abbrev(used)} / ${pct}%)`;
}
