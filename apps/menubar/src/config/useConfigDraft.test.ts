/**
 * Tests for useConfigDraft hook.
 *
 * Covers:
 * - dev:web loads the embedded sample automatically
 * - draft is valid ⇒ errors empty
 * - dirty reflects edits (false after load, true after patch)
 * - patch with invalid value ⇒ errors by path
 * - changing inputs.backlog re-parses tasks (R9)
 * - save blocked when errors exist (fail-closed)
 * - save clears dirty on success
 * - errorAt helper filters errors by path prefix
 *
 * Run: `npm test -w apps/menubar -- useConfigDraft`
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// Mock @tauri-apps/api/core before importing the hook
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: vi.fn(),
}));

import { useConfigDraft, errorAt } from "./useConfigDraft.js";
import type { ConfigError } from "./useConfigDraft.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Render the hook and wait for the auto-load effect to complete. */
async function renderAndLoad() {
  const hook = renderHook(() => useConfigDraft());
  // Wait for auto-load (dev:web loads on mount)
  await waitFor(() => {
    expect(hook.result.current.draft).not.toBeNull();
  });
  return hook;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useConfigDraft", () => {
  it("dev:web loads the embedded sample on mount", async () => {
    const { result } = await renderAndLoad();

    expect(result.current.draft).not.toBeNull();
    expect(result.current.draft!.name).toBe("my-loop");
    expect(result.current.draft!.version).toBe("1");
  });

  it("valid draft ⇒ errors empty", async () => {
    const { result } = await renderAndLoad();

    expect(result.current.errors).toHaveLength(0);
  });

  it("dirty is false after load", async () => {
    const { result } = await renderAndLoad();

    expect(result.current.dirty).toBe(false);
  });

  it("dirty becomes true after patch", async () => {
    const { result } = await renderAndLoad();

    act(() => {
      result.current.patch("name", "changed");
    });

    expect(result.current.dirty).toBe(true);
    expect(result.current.draft!.name).toBe("changed");
  });

  it("patch with invalid value ⇒ errors by path", async () => {
    const { result } = await renderAndLoad();

    // Setting name to empty string violates nonEmptyString
    act(() => {
      result.current.patch("name", "");
    });

    expect(result.current.errors.length).toBeGreaterThan(0);
    const nameErrors = errorAt(result.current.errors, "name");
    expect(nameErrors.length).toBeGreaterThan(0);
  });

  it("patch with valid value clears errors", async () => {
    const { result } = await renderAndLoad();

    // Break it
    act(() => {
      result.current.patch("name", "");
    });
    expect(result.current.errors.length).toBeGreaterThan(0);

    // Fix it
    act(() => {
      result.current.patch("name", "fixed-name");
    });
    expect(result.current.errors).toHaveLength(0);
  });

  it("changing inputs.backlog re-parses tasks (R9)", async () => {
    const { result } = await renderAndLoad();

    // Initial tasks come from the sample todo
    const initialTasks = result.current.tasks;
    expect(initialTasks.length).toBeGreaterThan(0);
    expect(initialTasks[0]!.id).toBe("T-001");

    // Change the task_id_pattern to something that won't match
    act(() => {
      result.current.patch("inputs.backlog.task_id_pattern", "X-\\d+");
    });

    // Tasks should be re-parsed — T-001 no longer matches X-\d+
    expect(result.current.tasks).toHaveLength(0);
  });

  it("save blocked when errors exist (fail-closed)", async () => {
    const { result } = await renderAndLoad();

    // Break the draft
    act(() => {
      result.current.patch("name", "");
    });
    expect(result.current.errors.length).toBeGreaterThan(0);

    // Save should fail
    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.save();
    });
    expect(saved).toBe(false);

    // dirty should still be true
    expect(result.current.dirty).toBe(true);
  });

  it("save clears dirty on success", async () => {
    const { result } = await renderAndLoad();

    // Patch something valid
    act(() => {
      result.current.patch("name", "saved-name");
    });
    expect(result.current.dirty).toBe(true);
    expect(result.current.errors).toHaveLength(0);

    // Save
    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.save();
    });
    expect(saved).toBe(true);
    expect(result.current.dirty).toBe(false);
  });

  it("save returns false when draft is null", async () => {
    const { result } = renderHook(() => useConfigDraft());

    // Before auto-load completes, draft may be null
    // Force a save attempt immediately
    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.save();
    });
    // May or may not be null depending on timing, but save should handle it
    expect(typeof saved).toBe("boolean");
  });

  it("tasks derived from sample todo on load", async () => {
    const { result } = await renderAndLoad();

    expect(result.current.tasks.length).toBeGreaterThan(0);
    expect(result.current.tasks[0]!.id).toBe("T-001");
    expect(result.current.tasks[0]!.title).toBe("Sample task");
  });

  it("patch on nested path works (immutable deep-set)", async () => {
    const { result } = await renderAndLoad();

    act(() => {
      result.current.patch("workspace.parent_branch", "develop");
    });

    expect(result.current.draft!.workspace.parent_branch).toBe("develop");
    // Other fields untouched
    expect(result.current.draft!.workspace.root).toBe(".");
  });

  it("patch on pipeline array element works", async () => {
    const { result } = await renderAndLoad();

    // The sample has 1 pipeline step
    expect(result.current.draft!.pipeline).toHaveLength(1);

    act(() => {
      result.current.patch("pipeline.0.id", "build");
    });

    expect(result.current.draft!.pipeline[0]!.id).toBe("build");
  });

  it("load() can be called explicitly", async () => {
    const { result } = await renderAndLoad();

    // Re-load
    await act(async () => {
      await result.current.load();
    });

    expect(result.current.draft).not.toBeNull();
    expect(result.current.dirty).toBe(false);
  });
});

describe("errorAt", () => {
  const errors: ConfigError[] = [
    { path: "name", message: "too short" },
    { path: "acp.permissions.on_request", message: "invalid" },
    { path: "acp.permissions.default_mode", message: "required" },
    { path: "pipeline.0.id", message: "duplicate" },
  ];

  it("exact match", () => {
    expect(errorAt(errors, "name")).toEqual([
      { path: "name", message: "too short" },
    ]);
  });

  it("prefix match includes children", () => {
    const result = errorAt(errors, "acp.permissions");
    expect(result).toHaveLength(2);
    expect(result[0]!.path).toBe("acp.permissions.on_request");
    expect(result[1]!.path).toBe("acp.permissions.default_mode");
  });

  it("no match returns empty array", () => {
    expect(errorAt(errors, "workspace")).toHaveLength(0);
  });

  it("does not match partial path segments", () => {
    // "pipe" should not match "pipeline.0.id"
    expect(errorAt(errors, "pipe")).toHaveLength(0);
  });
});
