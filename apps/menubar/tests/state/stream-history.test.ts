import { describe, it, expect } from "vitest";
import { segmentsFor, type Transcript } from "../../src/state/stream-history";
import type { StreamItem } from "loopy/tui/store";

/** A text timeline item. */
const ti = (t: string): StreamItem => ({ item: "text", text: t });

describe("stream-history", () => {
  describe("segmentsFor", () => {
    it("returns [] for unknown taskId", () => {
      expect(segmentsFor("T-999", {})).toEqual([]);
    });

    it("returns [] for empty transcript", () => {
      expect(segmentsFor("T-001", { "T-001": [] })).toEqual([]);
    });

    it("single chunk → single segment", () => {
      const hist: Transcript = {
        "T-001": [{ stepId: "implement", item: ti("hello") }],
      };
      expect(segmentsFor("T-001", hist)).toEqual([
        { stepId: "implement", label: "implement", items: [ti("hello")] },
      ]);
    });

    it("consecutive chunks with same stepId → items collected in one segment", () => {
      const hist: Transcript = {
        "T-001": [
          { stepId: "implement", item: ti("hello ") },
          { stepId: "implement", item: ti("world") },
        ],
      };
      expect(segmentsFor("T-001", hist)).toEqual([
        {
          stepId: "implement",
          label: "implement",
          items: [ti("hello "), ti("world")],
        },
      ]);
    });

    it("chunks interleaved with step changes → separate segments", () => {
      const hist: Transcript = {
        "T-001": [
          { stepId: "implement", item: ti("code...") },
          { stepId: "implement", item: ti(" more code") },
          { stepId: "simplify", item: ti("simplifying...") },
          { stepId: "audit", item: ti("AUDIT: PASS") },
        ],
      };
      expect(segmentsFor("T-001", hist)).toEqual([
        {
          stepId: "implement",
          label: "implement",
          items: [ti("code..."), ti(" more code")],
        },
        {
          stepId: "simplify",
          label: "simplify",
          items: [ti("simplifying...")],
        },
        { stepId: "audit", label: "audit", items: [ti("AUDIT: PASS")] },
      ]);
    });

    it("same stepId reappearing later → separate segments (fix-loop)", () => {
      const hist: Transcript = {
        "T-001": [
          { stepId: "implement", item: ti("first pass") },
          { stepId: "test", item: ti("fail") },
          { stepId: "implement", item: ti("fix") },
        ],
      };
      expect(segmentsFor("T-001", hist)).toEqual([
        { stepId: "implement", label: "implement", items: [ti("first pass")] },
        { stepId: "test", label: "test", items: [ti("fail")] },
        { stepId: "implement", label: "implement", items: [ti("fix")] },
      ]);
    });

    it("does not leak entries from other tasks", () => {
      const hist: Transcript = {
        "T-001": [{ stepId: "implement", item: ti("task 1") }],
        "T-002": [{ stepId: "implement", item: ti("task 2") }],
      };
      expect(segmentsFor("T-001", hist)).toEqual([
        { stepId: "implement", label: "implement", items: [ti("task 1")] },
      ]);
    });

    it("label equals stepId", () => {
      const hist: Transcript = {
        "T-001": [{ stepId: "my-custom-step", item: ti("x") }],
      };
      const [seg] = segmentsFor("T-001", hist);
      expect(seg!.label).toBe("my-custom-step");
    });
  });
});
