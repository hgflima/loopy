/**
 * Load / merge / save of `.loopy/metrics.json`.
 *
 * Mirrors the I/O pattern of `src/resume/state.ts`: atomic write
 * (`mkdir -p` + `.tmp` + `rename`), tolerant load (absent/corrupt → empty).
 *
 * Invariants:
 * - Merge is **append-only** (each Run adds a record to `runs[]`).
 * - Change total is a **pure fold** over `runs[]` (no hidden mutable counter).
 * - Change.id/dir divergence → start fresh (never mix changes).
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ChangeMetrics, RunMetrics } from "../types.js";

// ---------------------------------------------------------------------------
// Empty factory
// ---------------------------------------------------------------------------

/** A fresh, empty ChangeMetrics for a given change. */
export function emptyChangeMetrics(
  changeId: string,
  changeDir: string,
): ChangeMetrics {
  return {
    version: 1,
    change: { id: changeId, dir: changeDir },
    runs: [],
  };
}

// ---------------------------------------------------------------------------
// Load (tolerant)
// ---------------------------------------------------------------------------

/**
 * Load metrics from disk. Tolerates absence and corruption — returns `null`
 * in both cases (caller decides whether to start fresh or skip).
 */
export function loadMetrics(path: string): ChangeMetrics | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      unknown
    >;
    if (
      parsed.version === 1 &&
      typeof parsed.change === "object" &&
      parsed.change !== null &&
      Array.isArray(parsed.runs)
    ) {
      return parsed as unknown as ChangeMetrics;
    }
  } catch {
    // file not found, permission error, or invalid JSON
  }
  return null;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

export interface ChangeRef {
  readonly id: string;
  readonly dir: string;
}

/**
 * Merge a new RunMetrics into an existing ChangeMetrics (or create fresh).
 * - Appends the run to `runs[]`.
 * - If existing `change.id`/`change.dir` diverge from `change`, starts fresh
 *   (never mixes changes).
 */
export function mergeRun(
  existing: ChangeMetrics | null,
  run: RunMetrics,
  change: ChangeRef,
): ChangeMetrics {
  if (
    existing === null ||
    existing.change.id !== change.id ||
    existing.change.dir !== change.dir
  ) {
    return { version: 1, change, runs: [run] };
  }

  return {
    ...existing,
    runs: [...existing.runs, run],
  };
}

// ---------------------------------------------------------------------------
// Save (atomic)
// ---------------------------------------------------------------------------

/**
 * Atomic write: `mkdirSync` (recursive) + write to `.tmp` + `renameSync`.
 * Never leaves a partial/corrupted `metrics.json`.
 */
export function saveMetrics(path: string, metrics: ChangeMetrics): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(metrics, null, 2), "utf8");
  renameSync(tmp, path);
}
