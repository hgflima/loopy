import { describe, expect, it } from "vitest";
import { skipDescendants } from "../../src/scheduler/graph";
import type { TaskGraph } from "../../src/scheduler/types";

describe("skipDescendants", () => {
  it("returns direct descendants", () => {
    const graph: TaskGraph = {
      nodes: ["A", "B", "C"],
      edges: [["A", "B"], ["A", "C"]],
    };

    expect(skipDescendants(graph, "A")).toEqual(new Set(["B", "C"]));
  });

  it("returns transitive closure", () => {
    const graph: TaskGraph = {
      nodes: ["A", "B", "C"],
      edges: [["A", "B"], ["B", "C"]],
    };

    expect(skipDescendants(graph, "A")).toEqual(new Set(["B", "C"]));
  });

  it("handles diamond A→{B,C}→D", () => {
    const graph: TaskGraph = {
      nodes: ["A", "B", "C", "D"],
      edges: [["A", "B"], ["A", "C"], ["B", "D"], ["C", "D"]],
    };

    const result = skipDescendants(graph, "A");
    expect(result).toEqual(new Set(["B", "C", "D"]));
  });

  it("does not include the failed task itself", () => {
    const graph: TaskGraph = {
      nodes: ["A", "B"],
      edges: [["A", "B"]],
    };

    const result = skipDescendants(graph, "A");
    expect(result.has("A")).toBe(false);
    expect(result.has("B")).toBe(true);
  });

  it("returns empty set for a leaf task", () => {
    const graph: TaskGraph = {
      nodes: ["A", "B"],
      edges: [["A", "B"]],
    };

    expect(skipDescendants(graph, "B")).toEqual(new Set());
  });

  it("handles task not in graph (returns empty)", () => {
    const graph: TaskGraph = {
      nodes: ["A"],
      edges: [],
    };

    expect(skipDescendants(graph, "Z")).toEqual(new Set());
  });
});
