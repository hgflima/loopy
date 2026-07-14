import { describe, expect, it } from "vitest";
import { maxLayerWidth } from "../../src/scheduler/graph";
import type { TaskGraph } from "../../src/scheduler/types";

describe("maxLayerWidth", () => {
  it("returns 0 for empty graph", () => {
    const graph: TaskGraph = { nodes: [], edges: [] };
    expect(maxLayerWidth(graph)).toBe(0);
  });

  it("returns 1 for a chain A→B→C", () => {
    const graph: TaskGraph = {
      nodes: ["A", "B", "C"],
      edges: [["A", "B"], ["B", "C"]],
    };
    expect(maxLayerWidth(graph)).toBe(1);
  });

  it("returns 4 for a fan (1 root, 4 leaves)", () => {
    const graph: TaskGraph = {
      nodes: ["R", "L1", "L2", "L3", "L4"],
      edges: [["R", "L1"], ["R", "L2"], ["R", "L3"], ["R", "L4"]],
    };
    expect(maxLayerWidth(graph)).toBe(4);
  });

  it("returns 2 for a diamond", () => {
    const graph: TaskGraph = {
      nodes: ["A", "B", "C", "D"],
      edges: [["A", "B"], ["A", "C"], ["B", "D"], ["C", "D"]],
    };
    expect(maxLayerWidth(graph)).toBe(2);
  });

  it("returns 5 for 5 disconnected tasks (multiple roots, no edges)", () => {
    const graph: TaskGraph = {
      nodes: ["T1", "T2", "T3", "T4", "T5"],
      edges: [],
    };
    expect(maxLayerWidth(graph)).toBe(5);
  });
});
