import { describe, it, expect } from "vitest";
import {
  segmentsFor,
  type Transcript,
} from "../../src/state/stream-history";

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
        "T-001": [{ stepId: "implement", text: "hello" }],
      };
      expect(segmentsFor("T-001", hist)).toEqual([
        { stepId: "implement", label: "implement", text: "hello" },
      ]);
    });

    it("consecutive chunks with same stepId → merged text", () => {
      const hist: Transcript = {
        "T-001": [
          { stepId: "implement", text: "hello " },
          { stepId: "implement", text: "world" },
        ],
      };
      expect(segmentsFor("T-001", hist)).toEqual([
        { stepId: "implement", label: "implement", text: "hello world" },
      ]);
    });

    it("chunks interleaved with step changes → separate segments", () => {
      const hist: Transcript = {
        "T-001": [
          { stepId: "implement", text: "code..." },
          { stepId: "implement", text: " more code" },
          { stepId: "simplify", text: "simplifying..." },
          { stepId: "audit", text: "AUDIT: PASS" },
        ],
      };
      expect(segmentsFor("T-001", hist)).toEqual([
        { stepId: "implement", label: "implement", text: "code... more code" },
        { stepId: "simplify", label: "simplify", text: "simplifying..." },
        { stepId: "audit", label: "audit", text: "AUDIT: PASS" },
      ]);
    });

    it("same stepId reappearing later → separate segments (fix-loop)", () => {
      const hist: Transcript = {
        "T-001": [
          { stepId: "implement", text: "first pass" },
          { stepId: "test", text: "fail" },
          { stepId: "implement", text: "fix" },
        ],
      };
      expect(segmentsFor("T-001", hist)).toEqual([
        { stepId: "implement", label: "implement", text: "first pass" },
        { stepId: "test", label: "test", text: "fail" },
        { stepId: "implement", label: "implement", text: "fix" },
      ]);
    });

    it("does not leak entries from other tasks", () => {
      const hist: Transcript = {
        "T-001": [{ stepId: "implement", text: "task 1" }],
        "T-002": [{ stepId: "implement", text: "task 2" }],
      };
      expect(segmentsFor("T-001", hist)).toEqual([
        { stepId: "implement", label: "implement", text: "task 1" },
      ]);
    });

    it("label equals stepId", () => {
      const hist: Transcript = {
        "T-001": [{ stepId: "my-custom-step", text: "x" }],
      };
      const [seg] = segmentsFor("T-001", hist);
      expect(seg!.label).toBe("my-custom-step");
    });
  });
});
