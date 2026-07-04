import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { ChangeMetrics, RunMetrics, TaskMetrics } from "../../src/types";
import {
  emptyChangeMetrics,
  loadMetrics,
  mergeRun,
  saveMetrics,
} from "../../src/metrics/store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkRunMetrics(index: number): RunMetrics {
  return {
    index,
    startedAt: `2026-01-0${index}T00:00:00Z`,
    finishedAt: `2026-01-0${index}T01:00:00Z`,
    stoppedBy: "backlog_empty",
    tasks: {
      "T-001": {
        steps: {
          "step-a": { type: "shell", visits: 1, durationMs: 500, usage: null },
        },
        cost: null,
      } satisfies TaskMetrics,
    },
  };
}

const CHANGE = { id: "C-001", dir: "changes/C-001" };

// ---------------------------------------------------------------------------
// emptyChangeMetrics
// ---------------------------------------------------------------------------

describe("emptyChangeMetrics", () => {
  it("returns version 1 with the given change and empty runs", () => {
    const result = emptyChangeMetrics("C-005", "dir/C-005");
    expect(result).toEqual({
      version: 1,
      change: { id: "C-005", dir: "dir/C-005" },
      runs: [],
    });
  });
});

// ---------------------------------------------------------------------------
// loadMetrics
// ---------------------------------------------------------------------------

describe("loadMetrics", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(
      tmpdir(),
      `loopy-metrics-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when file does not exist", () => {
    expect(loadMetrics(join(tmpDir, "nope.json"))).toBeNull();
  });

  it("returns null on invalid JSON", () => {
    const p = join(tmpDir, "bad.json");
    writeFileSync(p, "not json{{{", "utf8");
    expect(loadMetrics(p)).toBeNull();
  });

  it("returns null on wrong version", () => {
    const p = join(tmpDir, "v2.json");
    writeFileSync(p, JSON.stringify({ version: 2, change: {}, runs: [] }), "utf8");
    expect(loadMetrics(p)).toBeNull();
  });

  it("returns null when change field is missing", () => {
    const p = join(tmpDir, "no-change.json");
    writeFileSync(p, JSON.stringify({ version: 1, runs: [] }), "utf8");
    expect(loadMetrics(p)).toBeNull();
  });

  it("returns null when runs field is missing", () => {
    const p = join(tmpDir, "no-runs.json");
    writeFileSync(p, JSON.stringify({ version: 1, change: { id: "x", dir: "y" } }), "utf8");
    expect(loadMetrics(p)).toBeNull();
  });

  it("loads a valid metrics file", () => {
    const p = join(tmpDir, "ok.json");
    const data: ChangeMetrics = {
      version: 1,
      change: { id: "C-001", dir: "d" },
      runs: [mkRunMetrics(1)],
    };
    writeFileSync(p, JSON.stringify(data), "utf8");
    const loaded = loadMetrics(p);
    expect(loaded).toEqual(data);
  });
});

// ---------------------------------------------------------------------------
// mergeRun
// ---------------------------------------------------------------------------

describe("mergeRun", () => {
  it("creates fresh when existing is null", () => {
    const run = mkRunMetrics(1);
    const result = mergeRun(null, run, CHANGE);
    expect(result.version).toBe(1);
    expect(result.change).toEqual(CHANGE);
    expect(result.runs).toEqual([run]);
  });

  it("appends a run to existing runs[]", () => {
    const existing: ChangeMetrics = {
      version: 1,
      change: CHANGE,
      runs: [mkRunMetrics(1)],
    };
    const run2 = mkRunMetrics(2);
    const result = mergeRun(existing, run2, CHANGE);
    expect(result.runs).toHaveLength(2);
    expect(result.runs[0]).toEqual(mkRunMetrics(1));
    expect(result.runs[1]).toEqual(run2);
  });

  it("starts fresh when change.id diverges", () => {
    const existing: ChangeMetrics = {
      version: 1,
      change: { id: "C-OLD", dir: "old" },
      runs: [mkRunMetrics(1), mkRunMetrics(2)],
    };
    const run = mkRunMetrics(1);
    const result = mergeRun(existing, run, CHANGE);
    expect(result.change).toEqual(CHANGE);
    expect(result.runs).toEqual([run]);
  });

  it("starts fresh when change.dir diverges", () => {
    const existing: ChangeMetrics = {
      version: 1,
      change: { id: "C-001", dir: "old-dir" },
      runs: [mkRunMetrics(1)],
    };
    const run = mkRunMetrics(1);
    const result = mergeRun(existing, run, CHANGE);
    expect(result.change).toEqual(CHANGE);
    expect(result.runs).toEqual([run]);
  });

  it("does not mutate the existing object", () => {
    const existing: ChangeMetrics = {
      version: 1,
      change: CHANGE,
      runs: [mkRunMetrics(1)],
    };
    const origRuns = existing.runs;
    mergeRun(existing, mkRunMetrics(2), CHANGE);
    expect(existing.runs).toBe(origRuns);
    expect(existing.runs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// saveMetrics / round-trip
// ---------------------------------------------------------------------------

describe("saveMetrics", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(
      tmpdir(),
      `loopy-metrics-save-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("round-trips through saveMetrics and loadMetrics", () => {
    const p = join(tmpDir, "metrics.json");
    const data: ChangeMetrics = {
      version: 1,
      change: CHANGE,
      runs: [mkRunMetrics(1)],
    };
    saveMetrics(p, data);
    expect(loadMetrics(p)).toEqual(data);
  });

  it("creates parent directories recursively", () => {
    const p = join(tmpDir, "deep", "nested", "metrics.json");
    saveMetrics(p, emptyChangeMetrics("x", "y"));
    expect(existsSync(p)).toBe(true);
  });

  it("overwrites existing file atomically (no leftover .tmp)", () => {
    const p = join(tmpDir, "metrics.json");
    saveMetrics(p, emptyChangeMetrics("a", "b"));
    saveMetrics(p, emptyChangeMetrics("c", "d"));
    expect(loadMetrics(p)!.change.id).toBe("c");
    expect(existsSync(`${p}.tmp`)).toBe(false);
  });

  it("writes well-formatted JSON", () => {
    const p = join(tmpDir, "fmt.json");
    const data = emptyChangeMetrics("x", "y");
    saveMetrics(p, data);
    const raw = readFileSync(p, "utf8");
    expect(raw).toBe(JSON.stringify(data, null, 2));
  });
});
