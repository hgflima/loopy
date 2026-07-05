import { describe, expect, it } from "vitest";
import { buildGraph } from "../../src/scheduler/graph";
import type { Task } from "../../src/types";

/** Helper: minimal task with only the fields buildGraph cares about. */
function task(
  id: string,
  deps: string[] = [],
  done = false,
): Task {
  return {
    id,
    slug: id.toLowerCase(),
    title: id,
    body: "",
    branch: id,
    done,
    deps,
  };
}

describe("buildGraph", () => {
  it("builds nodes in backlog order and edges from deps", () => {
    const tasks = [
      task("T-001"),
      task("T-002", ["T-001"]),
      task("T-003", ["T-001", "T-002"]),
    ];
    const result = buildGraph(tasks);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes).toEqual(["T-001", "T-002", "T-003"]);
    expect(result.value.edges).toEqual([
      ["T-001", "T-002"],
      ["T-001", "T-003"],
      ["T-002", "T-003"],
    ]);
  });

  it("includes done tasks as nodes (backlog completo)", () => {
    const tasks = [
      task("T-001", [], true),
      task("T-002", ["T-001"]),
    ];
    const result = buildGraph(tasks);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes).toEqual(["T-001", "T-002"]);
    expect(result.value.edges).toEqual([["T-001", "T-002"]]);
  });

  it("returns empty edges when no deps", () => {
    const tasks = [task("T-001"), task("T-002"), task("T-003")];
    const result = buildGraph(tasks);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.edges).toEqual([]);
  });

  it("returns error for orphan dep (id not in backlog)", () => {
    const tasks = [
      task("T-001"),
      task("T-002", ["T-999"]),
    ];
    const result = buildGraph(tasks);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("T-999");
    expect(result.error).toContain("T-002");
  });

  it("returns error listing the cycle", () => {
    const tasks = [
      task("T-001", ["T-003"]),
      task("T-002", ["T-001"]),
      task("T-003", ["T-002"]),
    ];
    const result = buildGraph(tasks);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/ciclo/i);
    // All three should appear in the cycle description
    expect(result.error).toContain("T-001");
    expect(result.error).toContain("T-002");
    expect(result.error).toContain("T-003");
  });

  it("detects self-loop as cycle", () => {
    const tasks = [task("T-001", ["T-001"])];
    const result = buildGraph(tasks);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/ciclo/i);
    expect(result.error).toContain("T-001");
  });

  it("handles empty backlog", () => {
    const result = buildGraph([]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes).toEqual([]);
    expect(result.value.edges).toEqual([]);
  });

  it("reports orphan before checking cycles", () => {
    // T-002 depends on T-999 (orphan) — should fail on orphan, not try cycle detection
    const tasks = [
      task("T-001"),
      task("T-002", ["T-999"]),
    ];
    const result = buildGraph(tasks);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("T-999");
  });
});
