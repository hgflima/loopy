import { describe, it, expect } from "vitest";
import {
  appendStreamItem,
  TIMELINE_CAP,
  segmentsFor,
  overlayStepUsage,
  type Transcript,
  type StreamSegment,
} from "./stream-history";
import type { StreamItem, StreamUpdate, ToolCallState } from "loopy/tui/store";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function call(id: string, over: Partial<ToolCallState> = {}): ToolCallState {
  return {
    toolCallId: id,
    title: id,
    kind: "other",
    status: "pending",
    locations: [],
    content: [],
    ...over,
  };
}

const text = (t: string, messageId?: string): StreamUpdate =>
  messageId === undefined
    ? { kind: "text", text: t }
    : { kind: "text", text: t, messageId };

const thought = (t: string, messageId?: string): StreamUpdate =>
  messageId === undefined
    ? { kind: "thought", text: t }
    : { kind: "thought", text: t, messageId };

/** Fold a sequence of updates through `appendStreamItem` from empty. */
function fold(
  updates: readonly StreamUpdate[],
  cap = TIMELINE_CAP,
): readonly StreamItem[] {
  return updates.reduce<readonly StreamItem[]>(
    (items, u) => appendStreamItem(items, u, cap),
    [],
  );
}

// ---------------------------------------------------------------------------
// appendStreamItem — TIMELINE_CAP
// ---------------------------------------------------------------------------

describe("TIMELINE_CAP", () => {
  it("is 500 (R6 — the ring ceiling)", () => {
    expect(TIMELINE_CAP).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// appendStreamItem — rule (a)/(b): tool call by toolCallId, not adjacency
// ---------------------------------------------------------------------------

describe("appendStreamItem — tool calls (rules a/b)", () => {
  it("tool_call + two tool_delta interleaved with text produce ONE merged card", () => {
    const items = fold([
      { kind: "tool_call", call: call("tc-1", { title: "Read file" }) },
      text("thinking about it…"),
      {
        kind: "tool_delta",
        delta: { toolCallId: "tc-1", status: "in_progress" },
      },
      text("still working…"),
      {
        kind: "tool_delta",
        delta: {
          toolCallId: "tc-1",
          status: "completed",
          content: [{ kind: "text", text: "42 lines" }],
        },
      },
    ]);

    // Exactly one tool item — the deltas merged into the original card, they did
    // not fabricate new ones.
    const tools = items.filter((it) => it.item === "tool");
    expect(tools).toHaveLength(1);

    const tool = tools[0] as Extract<StreamItem, { item: "tool" }>;
    expect(tool.call).toMatchObject({
      toolCallId: "tc-1",
      title: "Read file", // preserved from tool_call (delta never changed it)
      status: "completed", // final merged status
      content: [{ kind: "text", text: "42 lines" }],
    });

    // The two text items survive, interleaved between/around the single card.
    expect(items.filter((it) => it.item === "text")).toHaveLength(2);
  });

  it("finds the card by toolCallId even with another card in between", () => {
    const items = fold([
      { kind: "tool_call", call: call("tc-1") },
      { kind: "tool_call", call: call("tc-2") },
      {
        kind: "tool_delta",
        delta: { toolCallId: "tc-1", status: "completed" },
      },
    ]);
    const byId = Object.fromEntries(
      items
        .filter(
          (it): it is Extract<StreamItem, { item: "tool" }> =>
            it.item === "tool",
        )
        .map((it) => [it.call.toolCallId, it.call.status]),
    );
    expect(byId["tc-1"]).toBe("completed");
    expect(byId["tc-2"]).toBe("pending");
  });

  it("orphan tool_delta (no matching card) is discarded — no item fabricated", () => {
    const before: readonly StreamItem[] = [{ item: "text", text: "hi" }];
    const after = appendStreamItem(before, {
      kind: "tool_delta",
      delta: { toolCallId: "ghost", status: "completed" },
    });
    expect(after).toEqual(before);
    // No card materialized, and the list is untouched (same reference).
    expect(after).toBe(before);
    expect(after.some((it) => it.item === "tool")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// appendStreamItem — rule (c): text/thought concatenation by messageId
// ---------------------------------------------------------------------------

describe("appendStreamItem — text/thought by messageId (rule c)", () => {
  it("two text chunks with the SAME messageId concatenate into one item", () => {
    const items = fold([text("Hello ", "m1"), text("world", "m1")]);
    expect(items).toEqual([
      { item: "text", text: "Hello world", messageId: "m1" },
    ]);
  });

  it("text chunks with DIFFERENT messageId open two items", () => {
    const items = fold([text("a", "m1"), text("b", "m2")]);
    expect(items).toEqual([
      { item: "text", text: "a", messageId: "m1" },
      { item: "text", text: "b", messageId: "m2" },
    ]);
  });

  it("text chunks WITHOUT messageId always open a new item (absent ≠ match)", () => {
    const items = fold([text("a"), text("b")]);
    expect(items).toEqual([
      { item: "text", text: "a" },
      { item: "text", text: "b" },
    ]);
  });

  it("thought concatenates by messageId, same as text", () => {
    const items = fold([thought("step 1. ", "t1"), thought("step 2.", "t1")]);
    expect(items).toEqual([
      { item: "thought", text: "step 1. step 2.", messageId: "t1" },
    ]);
  });

  it("a text update never merges into a thought item, even with equal messageId", () => {
    const items = fold([
      thought("pondering", "shared"),
      text("output", "shared"),
    ]);
    expect(items).toEqual([
      { item: "thought", text: "pondering", messageId: "shared" },
      { item: "text", text: "output", messageId: "shared" },
    ]);
  });

  it("a tool card between two same-messageId texts breaks the concatenation", () => {
    // The concat rule looks at the IMMEDIATELY previous item, not the whole list.
    const items = fold([
      text("before ", "m1"),
      { kind: "tool_call", call: call("tc-1") },
      text("after", "m1"),
    ]);
    expect(items).toEqual([
      { item: "text", text: "before ", messageId: "m1" },
      { item: "tool", call: call("tc-1") },
      { item: "text", text: "after", messageId: "m1" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// appendStreamItem — plan / mode / raw
// ---------------------------------------------------------------------------

describe("appendStreamItem — plan / mode / raw", () => {
  it("plan appends a plan item", () => {
    const items = fold([
      {
        kind: "plan",
        entries: [{ content: "do it", priority: "high", status: "pending" }],
      },
    ]);
    expect(items).toEqual([
      {
        item: "plan",
        entries: [{ content: "do it", priority: "high", status: "pending" }],
      },
    ]);
  });

  it("mode appends a mode item", () => {
    const items = fold([{ kind: "mode", modeId: "plan" }]);
    expect(items).toEqual([{ item: "mode", modeId: "plan" }]);
  });

  it("raw maps updateKind → kind and keeps the payload (D3, nothing vanishes)", () => {
    const items = fold([
      { kind: "raw", updateKind: "session_info_update", payload: { a: 1 } },
    ]);
    expect(items).toEqual([
      { item: "raw", kind: "session_info_update", payload: { a: 1 } },
    ]);
  });
});

// ---------------------------------------------------------------------------
// appendStreamItem — rule (d): ring cap + elided marker
// ---------------------------------------------------------------------------

describe("appendStreamItem — ring cap + elided (rule d)", () => {
  it("stays untouched below the cap", () => {
    const items = fold([text("a"), text("b"), text("c")], 3);
    expect(items).toHaveLength(3);
    expect(items.some((it) => it.item === "elided")).toBe(false);
  });

  it("drops the oldest and puts an elided marker on top when overflowing", () => {
    const items = fold([text("a"), text("b"), text("c"), text("d")], 3);
    // 4th push over cap=3: oldest ("a") drops, elided(1) leads.
    expect(items[0]).toEqual({ item: "elided", count: 1 });
    expect(items.slice(1)).toEqual([
      { item: "text", text: "b" },
      { item: "text", text: "c" },
      { item: "text", text: "d" },
    ]);
  });

  it("accumulates the elided count on repeated cuts — never duplicates the marker", () => {
    const items = fold(
      [text("a"), text("b"), text("c"), text("d"), text("e")],
      3,
    );
    // Two cuts (a, then b): the single marker reads 2, not two markers of 1.
    expect(items.filter((it) => it.item === "elided")).toHaveLength(1);
    expect(items[0]).toEqual({ item: "elided", count: 2 });
    expect(items.slice(1)).toEqual([
      { item: "text", text: "c" },
      { item: "text", text: "d" },
      { item: "text", text: "e" },
    ]);
  });

  it("the elided marker is not counted as a cuttable item (cap bounds real items)", () => {
    const items = fold(
      [text("a"), text("b"), text("c"), text("d"), text("e"), text("f")],
      3,
    );
    // 6 items, cap 3 → 3 dropped, 3 kept, one marker.
    expect(items[0]).toEqual({ item: "elided", count: 3 });
    expect(items.filter((it) => it.item !== "elided")).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// segmentsFor — grouping by Step (unchanged semantics, now over items)
// ---------------------------------------------------------------------------

const ti = (t: string): StreamItem => ({ item: "text", text: t });

describe("segmentsFor", () => {
  it("returns [] for unknown task", () => {
    expect(segmentsFor("missing", {})).toEqual([]);
  });

  it("returns [] for empty entries", () => {
    const hist: Transcript = { T1: [] };
    expect(segmentsFor("T1", hist)).toEqual([]);
  });

  it("collects items of consecutive entries with the same stepId into one segment", () => {
    const hist: Transcript = {
      T1: [
        { stepId: "s1", item: ti("hello ") },
        { stepId: "s1", item: ti("world") },
      ],
    };
    const segs = segmentsFor("T1", hist);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({
      stepId: "s1",
      label: "s1",
      items: [ti("hello "), ti("world")],
    });
  });

  it("splits on stepId change", () => {
    const hist: Transcript = {
      T1: [
        { stepId: "s1", item: ti("a") },
        { stepId: "s2", item: ti("b") },
      ],
    };
    const segs = segmentsFor("T1", hist);
    expect(segs).toHaveLength(2);
    expect(segs[0]!.stepId).toBe("s1");
    expect(segs[1]!.stepId).toBe("s2");
  });

  it("a stepId reappearing after a Desvio produces a separate segment", () => {
    const hist: Transcript = {
      T1: [
        { stepId: "s1", item: ti("a") },
        { stepId: "s2", item: ti("b") },
        { stepId: "s1", item: ti("c") },
      ],
    };
    const segs = segmentsFor("T1", hist);
    expect(segs).toHaveLength(3);
    expect(segs.map((s) => s.stepId)).toEqual(["s1", "s2", "s1"]);
  });

  it("carries heterogeneous items (tool cards, thoughts) inside a segment", () => {
    const toolItem: StreamItem = { item: "tool", call: call("tc-1") };
    const hist: Transcript = {
      T1: [
        { stepId: "s1", item: ti("looking…") },
        { stepId: "s1", item: toolItem },
      ],
    };
    const segs = segmentsFor("T1", hist);
    expect(segs[0]!.items).toEqual([ti("looking…"), toolItem]);
  });

  // --- telemetry propagation (unchanged from T-008) ---

  it("propagates agent/model from entries and usedTokens/size from the LAST entry", () => {
    const hist: Transcript = {
      T1: [
        {
          stepId: "s1",
          item: ti("a"),
          agent: "claude",
          model: "opus",
          usedTokens: 100,
          size: 200_000,
        },
        {
          stepId: "s1",
          item: ti("b"),
          agent: "claude",
          model: "opus",
          usedTokens: 150,
          size: 200_000,
        },
      ],
    };
    const segs = segmentsFor("T1", hist);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({
      agent: "claude",
      model: "opus",
      usedTokens: 150,
      size: 200_000,
    });
  });

  it("segments without telemetry have undefined fields", () => {
    const hist: Transcript = { T1: [{ stepId: "s1", item: ti("a") }] };
    const segs = segmentsFor("T1", hist);
    expect(segs[0]!.agent).toBeUndefined();
    expect(segs[0]!.usedTokens).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// overlayStepUsage — intact (still repairs the late usage_sample)
// ---------------------------------------------------------------------------

describe("overlayStepUsage", () => {
  const seg = (over: Partial<StreamSegment> = {}): StreamSegment => ({
    stepId: "s1",
    label: "s1",
    items: [ti("hi")],
    ...over,
  });

  it("fills usage from the live step when the snapshot has none (the #5 bug)", () => {
    const out = overlayStepUsage(
      [seg({ agent: "Claude", model: "claude-opus-4-8" })],
      [
        {
          id: "s1",
          agentName: "Claude",
          model: "claude-opus-4-8",
          used: 34_421,
          size: 1_000_000,
        },
      ],
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
      [{ id: "s1", agentName: "Claude" }],
    );
    expect(out[0]).toMatchObject({
      agent: "Claude",
      usedTokens: 100,
      size: 200_000,
    });
  });

  it("preserves the segment's items untouched", () => {
    const items = [ti("a"), ti("b")];
    const out = overlayStepUsage(
      [seg({ items })],
      [{ id: "s1", used: 1, size: 2 }],
    );
    expect(out[0]!.items).toBe(items);
  });
});
