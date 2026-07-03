import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { RunState, StepConfig } from "../../src/types";
import {
  clearTaskIn,
  completedStepsFor,
  emptyState,
  loadState,
  pipelineFingerprint,
  pruneOrphansIn,
  recordStepIn,
  saveState,
  setStatusIn,
} from "../../src/resume/state";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal pipeline for fingerprint tests. */
function makePipeline(...overrides: Record<string, unknown>[]): StepConfig[] {
  return overrides.map((o, i) => ({
    id: `step-${i}`,
    type: "shell" as const,
    run: [`echo ${i}`],
    ...o,
  })) as StepConfig[];
}

// ---------------------------------------------------------------------------
// pipelineFingerprint
// ---------------------------------------------------------------------------

describe("pipelineFingerprint", () => {
  it("returns a sha256-prefixed hex string", () => {
    const hash = pipelineFingerprint(makePipeline());
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("is stable (same pipeline => same hash)", () => {
    const p = makePipeline({ id: "a" }, { id: "b" });
    expect(pipelineFingerprint(p)).toBe(pipelineFingerprint(p));
  });

  it("changes when a step id changes", () => {
    const a = makePipeline({ id: "x" });
    const b = makePipeline({ id: "y" });
    expect(pipelineFingerprint(a)).not.toBe(pipelineFingerprint(b));
  });

  it("changes when step order changes", () => {
    const a = makePipeline({ id: "x" }, { id: "y" });
    const b = makePipeline({ id: "y" }, { id: "x" });
    expect(pipelineFingerprint(a)).not.toBe(pipelineFingerprint(b));
  });

  it("changes when step content changes (prompt)", () => {
    const a = makePipeline({ id: "s", type: "agent", prompt: "do A" });
    const b = makePipeline({ id: "s", type: "agent", prompt: "do B" });
    expect(pipelineFingerprint(a)).not.toBe(pipelineFingerprint(b));
  });

  it("changes when step content changes (run command)", () => {
    const a = makePipeline({ id: "s", type: "shell", run: ["echo a"] });
    const b = makePipeline({ id: "s", type: "shell", run: ["echo b"] });
    expect(pipelineFingerprint(a)).not.toBe(pipelineFingerprint(b));
  });
});

// ---------------------------------------------------------------------------
// completedStepsFor
// ---------------------------------------------------------------------------

describe("completedStepsFor", () => {
  const hash = "sha256:abc123";
  const state: RunState = {
    version: 1,
    tasks: {
      "T-001": {
        pipelineHash: hash,
        completedSteps: ["create-worktree", "implement"],
        status: "paused",
      },
      "T-002": {
        pipelineHash: hash,
        completedSteps: ["create-worktree"],
        status: "aborted",
      },
      "T-003": {
        pipelineHash: hash,
        completedSteps: ["create-worktree"],
        status: "running",
      },
    },
  };

  it("returns completed steps when hash matches and status is paused", () => {
    const result = completedStepsFor(state, "T-001", hash, { allowAborted: false });
    expect(result).toEqual(new Set(["create-worktree", "implement"]));
  });

  it("returns completed steps when hash matches and status is running", () => {
    const result = completedStepsFor(state, "T-003", hash, { allowAborted: false });
    expect(result).toEqual(new Set(["create-worktree"]));
  });

  it("returns empty set when task is absent", () => {
    const result = completedStepsFor(state, "T-999", hash, { allowAborted: false });
    expect(result).toEqual(new Set());
  });

  it("returns empty set when hash diverges", () => {
    const result = completedStepsFor(state, "T-001", "sha256:different", { allowAborted: false });
    expect(result).toEqual(new Set());
  });

  it("returns empty set for aborted without allowAborted", () => {
    const result = completedStepsFor(state, "T-002", hash, { allowAborted: false });
    expect(result).toEqual(new Set());
  });

  it("returns completed steps for aborted with allowAborted", () => {
    const result = completedStepsFor(state, "T-002", hash, { allowAborted: true });
    expect(result).toEqual(new Set(["create-worktree"]));
  });
});

// ---------------------------------------------------------------------------
// Pure transitions
// ---------------------------------------------------------------------------

describe("recordStepIn", () => {
  it("appends a step to an existing checkpoint", () => {
    const state: RunState = {
      version: 1,
      tasks: {
        "T-001": { pipelineHash: "h", completedSteps: ["a"], status: "running" },
      },
    };
    const next = recordStepIn(state, "T-001", "b", "h");
    expect(next.tasks["T-001"]?.completedSteps).toEqual(["a", "b"]);
    expect(next.tasks["T-001"]?.status).toBe("running");
  });

  it("creates a new checkpoint when task is absent", () => {
    const next = recordStepIn(emptyState(), "T-001", "a", "h");
    expect(next.tasks["T-001"]).toEqual({
      pipelineHash: "h",
      completedSteps: ["a"],
      status: "running",
    });
  });

  it("does not mutate the original state", () => {
    const state = emptyState();
    const next = recordStepIn(state, "T-001", "a", "h");
    expect(state.tasks["T-001"]).toBeUndefined();
    expect(next.tasks["T-001"]).toBeDefined();
  });
});

describe("setStatusIn", () => {
  it("sets status on an existing checkpoint", () => {
    const state: RunState = {
      version: 1,
      tasks: {
        "T-001": { pipelineHash: "h", completedSteps: ["a"], status: "running" },
      },
    };
    const next = setStatusIn(state, "T-001", "paused", "h");
    expect(next.tasks["T-001"]?.status).toBe("paused");
    expect(next.tasks["T-001"]?.completedSteps).toEqual(["a"]);
  });

  it("creates a checkpoint when task is absent", () => {
    const next = setStatusIn(emptyState(), "T-001", "running", "h");
    expect(next.tasks["T-001"]).toEqual({
      pipelineHash: "h",
      completedSteps: [],
      status: "running",
    });
  });
});

describe("clearTaskIn", () => {
  it("removes the task entry", () => {
    const state: RunState = {
      version: 1,
      tasks: {
        "T-001": { pipelineHash: "h", completedSteps: ["a"], status: "running" },
        "T-002": { pipelineHash: "h", completedSteps: [], status: "paused" },
      },
    };
    const next = clearTaskIn(state, "T-001");
    expect(next.tasks["T-001"]).toBeUndefined();
    expect(next.tasks["T-002"]).toBeDefined();
  });

  it("is a no-op when the task is absent", () => {
    const state = emptyState();
    const next = clearTaskIn(state, "T-001");
    expect(next).toEqual(emptyState());
  });
});

describe("pruneOrphansIn", () => {
  it("removes tasks not in knownTaskIds", () => {
    const state: RunState = {
      version: 1,
      tasks: {
        "T-001": { pipelineHash: "h", completedSteps: [], status: "running" },
        "T-002": { pipelineHash: "h", completedSteps: [], status: "paused" },
        "T-003": { pipelineHash: "h", completedSteps: [], status: "aborted" },
      },
    };
    const next = pruneOrphansIn(state, ["T-001", "T-003"]);
    expect(Object.keys(next.tasks)).toEqual(["T-001", "T-003"]);
  });

  it("returns empty tasks when none are known", () => {
    const state: RunState = {
      version: 1,
      tasks: {
        "T-001": { pipelineHash: "h", completedSteps: [], status: "running" },
      },
    };
    const next = pruneOrphansIn(state, []);
    expect(next.tasks).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// emptyState
// ---------------------------------------------------------------------------

describe("emptyState", () => {
  it("returns version 1 with no tasks", () => {
    expect(emptyState()).toEqual({ version: 1, tasks: {} });
  });
});

// ---------------------------------------------------------------------------
// I/O: loadState / saveState
// ---------------------------------------------------------------------------

describe("loadState / saveState", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `loopy-state-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadState returns emptyState when file does not exist", () => {
    expect(loadState(join(tmpDir, "nope.json"))).toEqual(emptyState());
  });

  it("loadState returns emptyState on invalid JSON", () => {
    const p = join(tmpDir, "bad.json");
    writeFileSync(p, "not json{{{", "utf8");
    expect(loadState(p)).toEqual(emptyState());
  });

  it("loadState returns emptyState on wrong version", () => {
    const p = join(tmpDir, "v2.json");
    writeFileSync(p, JSON.stringify({ version: 2, tasks: {} }), "utf8");
    expect(loadState(p)).toEqual(emptyState());
  });

  it("loadState returns emptyState on missing tasks field", () => {
    const p = join(tmpDir, "no-tasks.json");
    writeFileSync(p, JSON.stringify({ version: 1 }), "utf8");
    expect(loadState(p)).toEqual(emptyState());
  });

  it("round-trips through saveState and loadState", () => {
    const p = join(tmpDir, "state.json");
    const state: RunState = {
      version: 1,
      tasks: {
        "T-001": {
          pipelineHash: "sha256:abc",
          completedSteps: ["create-worktree", "implement"],
          status: "paused",
        },
      },
    };
    saveState(p, state);
    expect(loadState(p)).toEqual(state);
  });

  it("saveState creates parent directories recursively", () => {
    const p = join(tmpDir, "deep", "nested", "state.json");
    saveState(p, emptyState());
    expect(existsSync(p)).toBe(true);
    expect(loadState(p)).toEqual(emptyState());
  });

  it("saveState overwrites existing state atomically", () => {
    const p = join(tmpDir, "state.json");
    const v1: RunState = {
      version: 1,
      tasks: {
        "T-001": { pipelineHash: "h1", completedSteps: ["a"], status: "running" },
      },
    };
    const v2: RunState = {
      version: 1,
      tasks: {
        "T-001": { pipelineHash: "h1", completedSteps: ["a", "b"], status: "paused" },
      },
    };
    saveState(p, v1);
    saveState(p, v2);
    expect(loadState(p)).toEqual(v2);
    // No leftover .tmp file
    expect(existsSync(`${p}.tmp`)).toBe(false);
  });

  it("saveState writes well-formatted JSON", () => {
    const p = join(tmpDir, "fmt.json");
    saveState(p, emptyState());
    const raw = readFileSync(p, "utf8");
    expect(raw).toBe(JSON.stringify(emptyState(), null, 2));
  });
});
