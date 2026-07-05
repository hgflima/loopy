import { describe, expect, it } from "vitest";
import { topoLayers } from "../../src/scheduler/graph";
import type { TaskGraph } from "../../src/scheduler/types";

describe("topoLayers", () => {
  it("puts tasks with no deps in layer 0", () => {
    const graph: TaskGraph = {
      nodes: ["A", "B", "C"],
      edges: [],
    };

    expect(topoLayers(graph)).toEqual([["A", "B", "C"]]);
  });

  it("creates layers by dependency depth", () => {
    const graph: TaskGraph = {
      nodes: ["A", "B", "C"],
      edges: [["A", "B"], ["B", "C"]],
    };

    expect(topoLayers(graph)).toEqual([["A"], ["B"], ["C"]]);
  });

  it("handles diamond A→{B,C}→D", () => {
    const graph: TaskGraph = {
      nodes: ["A", "B", "C", "D"],
      edges: [["A", "B"], ["A", "C"], ["B", "D"], ["C", "D"]],
    };

    expect(topoLayers(graph)).toEqual([["A"], ["B", "C"], ["D"]]);
  });

  it("preserves backlog order within each layer", () => {
    // Z before Y in backlog, but both in layer 0
    const graph: TaskGraph = {
      nodes: ["Z", "Y", "X"],
      edges: [],
    };

    expect(topoLayers(graph)).toEqual([["Z", "Y", "X"]]);
  });

  it("handles complex DAG from plan", () => {
    // T-001 → T-002 → T-005
    // T-003 → T-004 → T-005
    const graph: TaskGraph = {
      nodes: ["T-001", "T-002", "T-003", "T-004", "T-005"],
      edges: [
        ["T-001", "T-002"],
        ["T-003", "T-004"],
        ["T-002", "T-005"],
        ["T-004", "T-005"],
      ],
    };

    expect(topoLayers(graph)).toEqual([
      ["T-001", "T-003"],
      ["T-002", "T-004"],
      ["T-005"],
    ]);
  });

  it("returns empty for empty graph", () => {
    const graph: TaskGraph = { nodes: [], edges: [] };
    expect(topoLayers(graph)).toEqual([]);
  });

  it("is deterministic across multiple calls", () => {
    const graph: TaskGraph = {
      nodes: ["A", "B", "C", "D"],
      edges: [["A", "C"], ["B", "C"], ["C", "D"]],
    };

    const first = topoLayers(graph);
    const second = topoLayers(graph);
    expect(first).toEqual(second);
  });
});
