import { describe, it, expect } from "vitest";
import {
  segmentsFor,
  overlayStepUsage,
  type Transcript,
  type StreamSegment,
} from "./stream-history";

describe("segmentsFor", () => {
  it("returns [] for unknown task", () => {
    expect(segmentsFor("missing", {})).toEqual([]);
  });

  it("returns [] for empty entries", () => {
    const hist: Transcript = { T1: [] };
    expect(segmentsFor("T1", hist)).toEqual([]);
  });

  it("merges consecutive entries with same stepId", () => {
    const hist: Transcript = {
      T1: [
        { stepId: "s1", text: "hello " },
        { stepId: "s1", text: "world" },
      ],
    };
    const segs = segmentsFor("T1", hist);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({
      stepId: "s1",
      label: "s1",
      text: "hello world",
    });
  });

  it("splits on stepId change", () => {
    const hist: Transcript = {
      T1: [
        { stepId: "s1", text: "a" },
        { stepId: "s2", text: "b" },
      ],
    };
    const segs = segmentsFor("T1", hist);
    expect(segs).toHaveLength(2);
    expect(segs[0]!.stepId).toBe("s1");
    expect(segs[1]!.stepId).toBe("s2");
  });

  it("reappearing stepId produces separate segment", () => {
    const hist: Transcript = {
      T1: [
        { stepId: "s1", text: "a" },
        { stepId: "s2", text: "b" },
        { stepId: "s1", text: "c" },
      ],
    };
    const segs = segmentsFor("T1", hist);
    expect(segs).toHaveLength(3);
    expect(segs[0]!.stepId).toBe("s1");
    expect(segs[1]!.stepId).toBe("s2");
    expect(segs[2]!.stepId).toBe("s1");
  });

  // --- T-008: telemetry propagation ---

  it("propagates agent/model from entries to segments", () => {
    const hist: Transcript = {
      T1: [
        { stepId: "s1", text: "a", agent: "claude", model: "opus" },
        { stepId: "s1", text: "b", agent: "claude", model: "opus" },
      ],
    };
    const segs = segmentsFor("T1", hist);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({
      agent: "claude",
      model: "opus",
    });
  });

  it("propagates usedTokens/size from last entry in segment", () => {
    const hist: Transcript = {
      T1: [
        { stepId: "s1", text: "a", usedTokens: 100, size: 200_000 },
        { stepId: "s1", text: "b", usedTokens: 150, size: 200_000 },
      ],
    };
    const segs = segmentsFor("T1", hist);
    expect(segs[0]!.usedTokens).toBe(150);
    expect(segs[0]!.size).toBe(200_000);
  });

  it("segments without telemetry have undefined fields", () => {
    const hist: Transcript = {
      T1: [{ stepId: "s1", text: "a" }],
    };
    const segs = segmentsFor("T1", hist);
    expect(segs[0]!.agent).toBeUndefined();
    expect(segs[0]!.model).toBeUndefined();
    expect(segs[0]!.usedTokens).toBeUndefined();
    expect(segs[0]!.size).toBeUndefined();
  });

  it("different steps carry their own telemetry", () => {
    const hist: Transcript = {
      T1: [
        { stepId: "s1", text: "a", agent: "claude", model: "opus", usedTokens: 100, size: 200_000 },
        { stepId: "s2", text: "b", agent: "codex", model: "codex-mini", usedTokens: 50, size: 128_000 },
      ],
    };
    const segs = segmentsFor("T1", hist);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ agent: "claude", model: "opus", usedTokens: 100, size: 200_000 });
    expect(segs[1]).toMatchObject({ agent: "codex", model: "codex-mini", usedTokens: 50, size: 128_000 });
  });

  it("step_started(agent/model) + usage_sample(used/size) intercalados produzem segmentos corretos", () => {
    // Simulates: step s1 starts with agent/model, then usage arrives, then more text
    const hist: Transcript = {
      T1: [
        { stepId: "s1", text: "chunk1", agent: "claude", model: "opus" },
        { stepId: "s1", text: "chunk2", agent: "claude", model: "opus", usedTokens: 5000, size: 200_000 },
        { stepId: "s1", text: "chunk3", agent: "claude", model: "opus", usedTokens: 8000, size: 200_000 },
        // step s2 starts — different agent
        { stepId: "s2", text: "chunk4", agent: "codex", model: "codex-mini" },
        { stepId: "s2", text: "chunk5", agent: "codex", model: "codex-mini", usedTokens: 3000, size: 128_000 },
      ],
    };
    const segs = segmentsFor("T1", hist);
    expect(segs).toHaveLength(2);

    // s1: last entry has usedTokens=8000
    expect(segs[0]).toMatchObject({
      stepId: "s1",
      text: "chunk1chunk2chunk3",
      agent: "claude",
      model: "opus",
      usedTokens: 8000,
      size: 200_000,
    });

    // s2: last entry has usedTokens=3000
    expect(segs[1]).toMatchObject({
      stepId: "s2",
      text: "chunk4chunk5",
      agent: "codex",
      model: "codex-mini",
      usedTokens: 3000,
      size: 128_000,
    });
  });
});

describe("overlayStepUsage", () => {
  const seg = (over: Partial<StreamSegment> = {}): StreamSegment => ({
    stepId: "s1",
    label: "s1",
    text: "hi",
    ...over,
  });

  it("fills usage from the live step when the snapshot has none (the #5 bug)", () => {
    // The transcript snapshot froze `usedTokens: undefined` because the
    // `usage_sample` landed AFTER the step's chunks. The live step is truth.
    const out = overlayStepUsage(
      [seg({ agent: "Claude", model: "claude-opus-4-8" })],
      [{ id: "s1", agentName: "Claude", model: "claude-opus-4-8", used: 34_421, size: 1_000_000 }],
    );
    expect(out[0]).toMatchObject({ usedTokens: 34_421, size: 1_000_000 });
  });

  it("keeps the snapshot value when the step is absent (best-effort)", () => {
    const out = overlayStepUsage([seg({ usedTokens: 100, size: 200_000 })], []);
    expect(out[0]).toMatchObject({ usedTokens: 100, size: 200_000 });
  });

  it("keeps the snapshot value when the live field is undefined (never blanks)", () => {
    const out = overlayStepUsage(
      [seg({ agent: "Claude", usedTokens: 100, size: 200_000 })],
      [{ id: "s1", agentName: "Claude" }], // no used/size yet
    );
    expect(out[0]).toMatchObject({ agent: "Claude", usedTokens: 100, size: 200_000 });
  });

  it("overlays live agent/model too, matching each segment by stepId", () => {
    const out = overlayStepUsage(
      [seg({ stepId: "s1" }), seg({ stepId: "s2", text: "yo" })],
      [
        { id: "s1", agentName: "Claude", used: 10, size: 100 },
        { id: "s2", agentName: "Codex", used: 20, size: 200 },
      ],
    );
    expect(out[0]).toMatchObject({ agent: "Claude", usedTokens: 10, size: 100 });
    expect(out[1]).toMatchObject({ agent: "Codex", usedTokens: 20, size: 200 });
  });
});
