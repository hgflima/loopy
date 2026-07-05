import { describe, expect, it } from "vitest";
import { readySet } from "../../src/scheduler/graph";
import type { SchedulerTaskStatus, TaskGraph } from "../../src/scheduler/types";

function status(
  entries: [string, SchedulerTaskStatus][],
): Map<string, SchedulerTaskStatus> {
  return new Map(entries);
}

describe("readySet", () => {
  it("returns blocked tasks whose deps are all done", () => {
    const graph: TaskGraph = {
      nodes: ["A", "B", "C"],
      edges: [["A", "B"], ["A", "C"]],
    };
    const s = status([
      ["A", "done"],
      ["B", "blocked"],
      ["C", "blocked"],
    ]);

    expect(readySet(graph, s)).toEqual(["B", "C"]);
  });

  it("does not include tasks with non-done deps", () => {
    const graph: TaskGraph = {
      nodes: ["A", "B", "C"],
      edges: [["A", "C"], ["B", "C"]],
    };
    const s = status([
      ["A", "done"],
      ["B", "blocked"],
      ["C", "blocked"],
    ]);

    // C depends on A (done) and B (blocked) → C not ready
    expect(readySet(graph, s)).toEqual(["B"]);
  });

  it("preserves backlog order as tie-breaker", () => {
    const graph: TaskGraph = {
      nodes: ["X", "Y", "Z"],
      edges: [],
    };
    const s = status([
      ["X", "blocked"],
      ["Y", "blocked"],
      ["Z", "blocked"],
    ]);

    // All blocked with no deps → all ready, in backlog order
    expect(readySet(graph, s)).toEqual(["X", "Y", "Z"]);
  });

  it("ignores tasks that are not blocked", () => {
    const graph: TaskGraph = {
      nodes: ["A", "B"],
      edges: [],
    };
    const s = status([
      ["A", "running"],
      ["B", "done"],
    ]);

    expect(readySet(graph, s)).toEqual([]);
  });

  it("handles task blocked by another that is escalated (not done)", () => {
    const graph: TaskGraph = {
      nodes: ["A", "B"],
      edges: [["A", "B"]],
    };
    const s = status([
      ["A", "escalated"],
      ["B", "blocked"],
    ]);

    // A is escalated (not done) → B stays blocked
    expect(readySet(graph, s)).toEqual([]);
  });

  it("handles blocked task with no deps as ready", () => {
    const graph: TaskGraph = {
      nodes: ["A"],
      edges: [],
    };
    const s = status([["A", "blocked"]]);

    expect(readySet(graph, s)).toEqual(["A"]);
  });
});
