import { describe, expect, it } from "vitest";
import { resolveConcurrency } from "../../src/scheduler/graph";
import type { TaskGraph } from "../../src/scheduler/types";

// Helper: DAG with layers [3, 2, 1]  →  A,B,C (layer 0) → D,E (layer 1) → F (layer 2)
const dag321: TaskGraph = {
  nodes: ["A", "B", "C", "D", "E", "F"],
  edges: [
    ["A", "D"], ["B", "D"],
    ["B", "E"], ["C", "E"],
    ["D", "F"], ["E", "F"],
  ],
};

// Helper: 20 tasks with no deps — single layer of width 20
const loose20: TaskGraph = {
  nodes: Array.from({ length: 20 }, (_, i) => `T${i + 1}`),
  edges: [],
};

const emptyGraph: TaskGraph = { nodes: [], edges: [] };

describe("resolveConcurrency", () => {
  it("flag takes precedence over declared", () => {
    const r = resolveConcurrency({
      flag: 6,
      declared: 2,
      maxConcurrency: 4,
      graph: dag321,
    });
    expect(r.value).toBe(6);
    expect(r.auto).toBe(false);
  });

  it("D17: declared number is NOT clamped by maxConcurrency", () => {
    const r = resolveConcurrency({
      declared: 8,
      maxConcurrency: 4,
      graph: dag321,
    });
    expect(r.value).toBe(8);
    expect(r.auto).toBe(false);
  });

  it("auto in DAG [3,2,1] with cap 4 → 3", () => {
    const r = resolveConcurrency({
      declared: "auto",
      maxConcurrency: 4,
      graph: dag321,
    });
    expect(r.value).toBe(3);
    expect(r.auto).toBe(true);
    expect(r.width).toBe(3);
    expect(r.cap).toBe(4);
  });

  it("auto in DAG [3,2,1] with cap 2 → 2 (cap bites)", () => {
    const r = resolveConcurrency({
      declared: "auto",
      maxConcurrency: 2,
      graph: dag321,
    });
    expect(r.value).toBe(2);
    expect(r.auto).toBe(true);
  });

  it("auto with 20 loose tasks + cap 4 → 4", () => {
    const r = resolveConcurrency({
      declared: "auto",
      maxConcurrency: 4,
      graph: loose20,
    });
    expect(r.value).toBe(4);
    expect(r.auto).toBe(true);
    expect(r.width).toBe(20);
  });

  it("auto with empty graph → 1", () => {
    const r = resolveConcurrency({
      declared: "auto",
      maxConcurrency: 4,
      graph: emptyGraph,
    });
    expect(r.value).toBe(1);
    expect(r.auto).toBe(true);
    expect(r.width).toBe(0);
  });

  it("flag 'auto' overrides declared number", () => {
    const r = resolveConcurrency({
      flag: "auto",
      declared: 8,
      maxConcurrency: 4,
      graph: dag321,
    });
    expect(r.value).toBe(3);
    expect(r.auto).toBe(true);
  });

  it("widestLayer returns ids of the widest layer (first on tie)", () => {
    const r = resolveConcurrency({
      declared: "auto",
      maxConcurrency: 10,
      graph: dag321,
    });
    // Widest layer is layer 0: ["A", "B", "C"]
    expect(r.widestLayer).toEqual(["A", "B", "C"]);
  });

  it("widestLayer is stable on tie — returns the first widest layer", () => {
    // Two layers of equal width 2: [A, B] → [C, D]
    const tieGraph: TaskGraph = {
      nodes: ["A", "B", "C", "D"],
      edges: [["A", "C"], ["A", "D"], ["B", "C"], ["B", "D"]],
    };
    const r = resolveConcurrency({
      declared: "auto",
      maxConcurrency: 10,
      graph: tieGraph,
    });
    expect(r.widestLayer).toEqual(["A", "B"]);
  });
});
